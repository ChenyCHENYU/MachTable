import type {
  GridDataProcessor,
  GridDataProcessorRequest,
  GridDataProcessorResult
} from "../types/options";
import type { AdvancedFilterNode } from "../types/advancedFilter";
import { getByPath } from "./path";
import { defaultComparator } from "./compare";
import { evaluateColumnFilter } from "../services/filterService";

export type GridDataProcessorPayload<TData = any> = Omit<GridDataProcessorRequest<TData>, "signal">;

export interface GridWorkerProcessMessage<TData = any> {
  type: "mach-table:process";
  requestId: number;
  payload: GridDataProcessorPayload<TData>;
}

export interface GridWorkerCancelMessage {
  type: "mach-table:cancel";
  requestId: number;
}

export type GridWorkerRequestMessage<TData = any> =
  | GridWorkerProcessMessage<TData>
  | GridWorkerCancelMessage;

export type GridWorkerResponseMessage =
  | { type: "mach-table:result"; requestId: number; rowIds: readonly string[] }
  | { type: "mach-table:error"; requestId: number; message: string };

export interface WorkerDataProcessorOptions {
  /** Terminate the lazily-created worker when the grid is destroyed. Defaults to true. */
  terminateOnDestroy?: boolean;
}

export interface FieldDataProcessorOptions {
  /** Cooperative cancellation/yield granularity. Defaults to 2,000 rows. */
  yieldEvery?: number;
  isCancelled?: () => boolean;
}

interface ProcessedRow<TData> {
  id: string;
  data: TData;
  order: number;
}

function evaluateAdvancedRow<TData>(
  node: AdvancedFilterNode,
  data: TData,
  fields: ReadonlyMap<string, string>
): boolean {
  if (node.kind === "condition") {
    const field = fields.get(node.colId);
    return field == null || evaluateColumnFilter(getByPath(data, field), node.filter);
  }
  const passed = node.operator === "or"
    ? node.children.some((child) => evaluateAdvancedRow(child, data, fields))
    : node.children.every((child) => evaluateAdvancedRow(child, data, fields));
  return node.not ? !passed : passed;
}

function passesColumnFilters<TData>(
  data: TData,
  request: GridDataProcessorPayload<TData>,
  fields: ReadonlyMap<string, string>
): boolean {
  for (const [colId, filter] of Object.entries(request.filterModel)) {
    const field = fields.get(colId);
    if (field != null && !evaluateColumnFilter(getByPath(data, field), filter)) return false;
  }
  return true;
}

function passesQuickFilter<TData>(
  data: TData,
  request: GridDataProcessorPayload<TData>,
  tokens: readonly string[]
): boolean {
  return tokens.every((token) => request.columns.some((column) => {
    const value = column.field == null ? null : getByPath(data, column.field);
    return String(value ?? "").toLowerCase().includes(token);
  }));
}

function passesWorkerFilters<TData>(
  data: TData,
  request: GridDataProcessorPayload<TData>,
  fields: ReadonlyMap<string, string>,
  quickTokens: readonly string[]
): boolean {
  if (!passesColumnFilters(data, request, fields)) return false;
  if (request.advancedFilterModel && !evaluateAdvancedRow(request.advancedFilterModel.root, data, fields)) return false;
  return passesQuickFilter(data, request, quickTokens);
}

function sortProcessedRows<TData>(
  rows: ProcessedRow<TData>[],
  request: GridDataProcessorPayload<TData>,
  fields: ReadonlyMap<string, string>
): void {
  if (request.sortModel.length === 0) return;
  rows.sort((left, right) => {
    for (const sort of request.sortModel) {
      const field = fields.get(sort.colId);
      if (!field) continue;
      const compared = defaultComparator(getByPath(left.data, field), getByPath(right.data, field));
      if (compared !== 0) return sort.direction === "desc" ? -compared : compared;
    }
    return left.order - right.order;
  });
}

function throwIfCancelled(isCancelled?: () => boolean): void {
  if (!isCancelled?.()) return;
  const error = new Error("Data processing aborted");
  error.name = "AbortError";
  throw error;
}

/** Built-in serializable field-path processor intended to run inside an application Worker. */
export async function processFieldDataRequest<TData = any>(
  request: GridDataProcessorPayload<TData>,
  options: FieldDataProcessorOptions = {}
): Promise<GridDataProcessorResult> {
  const fields = new Map(
    request.columns.flatMap((column) => column.field ? [[column.colId, column.field] as const] : [])
  );
  const quickTokens = request.quickFilterText?.trim().toLowerCase().split(/\s+/).filter(Boolean) ?? [];
  const yieldEvery = Math.max(100, Math.trunc(options.yieldEvery ?? 2_000));
  const filtered: ProcessedRow<TData>[] = [];
  for (let index = 0; index < request.rows.length; index++) {
    throwIfCancelled(options.isCancelled);
    if (index > 0 && index % yieldEvery === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const row = request.rows[index];
    if (passesWorkerFilters(row.data, request, fields, quickTokens)) {
      filtered.push({ id: row.id, data: row.data, order: index });
    }
  }
  sortProcessedRows(filtered, request, fields);
  return { rowIds: filtered.map((row) => row.id) };
}

export interface GridDataWorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent<GridWorkerRequestMessage>) => void): void;
  postMessage(message: GridWorkerResponseMessage): void;
}

/** Installs the standard field-path protocol in a dedicated Worker module. */
export function installGridDataWorker(scope: GridDataWorkerScope): void {
  const cancelled = new Set<number>();
  scope.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "mach-table:cancel") {
      cancelled.add(message.requestId);
      return;
    }
    const { requestId } = message;
    cancelled.delete(requestId);
    void processFieldDataRequest(message.payload, {
      isCancelled: () => cancelled.has(requestId)
    }).then((result) => {
      if (!cancelled.has(requestId)) {
        scope.postMessage({ type: "mach-table:result", requestId, rowIds: result.rowIds });
      }
    }).catch((error) => {
      if (!cancelled.has(requestId)) {
        scope.postMessage({
          type: "mach-table:error",
          requestId,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }).finally(() => cancelled.delete(requestId));
  });
}

function abortError(reason?: unknown): Error {
  if (reason instanceof Error) return reason;
  const error = new Error(typeof reason === "string" ? reason : "Data processing aborted");
  error.name = "AbortError";
  return error;
}

/**
 * Adapts a dedicated Web Worker to GridDataProcessor without Blob URLs or eval.
 * The host controls the worker URL, keeping CSP and bundler behavior explicit.
 */
export function createWorkerDataProcessor<TData = any>(
  createWorker: () => Worker,
  options: WorkerDataProcessorOptions = {}
): GridDataProcessor<TData> {
  let worker: Worker | null = null;
  let sequence = 0;
  let destroyed = false;
  const pending = new Map<number, {
    resolve: (result: GridDataProcessorResult) => void;
    reject: (reason: unknown) => void;
    signal: AbortSignal;
    abort: () => void;
  }>();

  const settleAll = (reason: unknown) => {
    for (const entry of pending.values()) {
      entry.signal.removeEventListener("abort", entry.abort);
      entry.reject(reason);
    }
    pending.clear();
  };

  const handleMessage = (event: MessageEvent<GridWorkerResponseMessage>) => {
    const message = event.data;
    if (!message || (message.type !== "mach-table:result" && message.type !== "mach-table:error")) return;
    const entry = pending.get(message.requestId);
    if (!entry) return;
    pending.delete(message.requestId);
    entry.signal.removeEventListener("abort", entry.abort);
    if (message.type === "mach-table:result") entry.resolve({ rowIds: message.rowIds });
    else entry.reject(new Error(message.message));
  };

  const detachWorker = (target: Worker): void => {
    target.removeEventListener("message", handleMessage);
    target.removeEventListener("error", handleError);
  };

  const handleError = (event: ErrorEvent) => {
    const failed = worker;
    worker = null;
    if (failed) {
      detachWorker(failed);
      failed.terminate();
    }
    settleAll(event.error ?? new Error(event.message || "Grid data worker failed"));
  };

  const ensureWorker = (): Worker => {
    if (worker) return worker;
    if (destroyed) throw new Error("Worker data processor has been destroyed");
    worker = createWorker();
    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);
    return worker;
  };

  return {
    process(request) {
      if (request.signal.aborted) return Promise.reject(abortError(request.signal.reason));
      const requestId = ++sequence;
      return new Promise<GridDataProcessorResult>((resolve, reject) => {
        const abort = () => {
          const entry = pending.get(requestId);
          if (!entry) return;
          pending.delete(requestId);
          worker?.postMessage({ type: "mach-table:cancel", requestId } satisfies GridWorkerCancelMessage);
          reject(abortError(request.signal.reason));
        };
        pending.set(requestId, { resolve, reject, signal: request.signal, abort });
        request.signal.addEventListener("abort", abort, { once: true });
        const { signal: _signal, ...payload } = request;
        void _signal;
        try {
          ensureWorker().postMessage({
            type: "mach-table:process",
            requestId,
            payload
          } satisfies GridWorkerProcessMessage<TData>);
        } catch (error) {
          pending.delete(requestId);
          request.signal.removeEventListener("abort", abort);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      settleAll(abortError("Worker data processor destroyed"));
      if (worker) {
        const current = worker;
        detachWorker(current);
        if (options.terminateOnDestroy !== false) current.terminate();
      }
      worker = null;
    }
  };
}
