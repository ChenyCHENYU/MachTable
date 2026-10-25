import type { GridApi } from "../types/api";
import type { RowDragEndEvent, RowDragIntent } from "../types/events";
import type { GridOptions } from "../types/options";
import { canReplaceGridData, ownsGridRowDragFactory, setGridRowDragFactory } from "../lib/adapterLifecycle";
import { abortable } from "../lib/abortable";
import type { RowDragDriverFactory } from "../lib/rowDragDriver";
import { createOrderDragSession } from "./dragSession";
import { OrderingDragDriver } from "./dragDriver";
import { createRowOrderValidator, inverseRowOrderOperations, moveTreeNodes, reorderRows, validateRowOrderRestore } from "./moveRows";
import { nodeSnapshot, ownsNodes, ownsSnapshot, RowOrderHistory, snapshot, type NodeEntry, type OrderHistoryEntry, type SnapshotEntry } from "./history";
import type { RowOrderIntent, RowOrderOptions, RowOrderPlan } from "./types";

type Revision = string | number;
interface KeyboardFocus<T> { api: GridApi<T>; intent: RowDragIntent; restore(canFocus: () => boolean): void; release(): void; generation: number }
export type RowOrderOperation = "move" | "undo" | "redo";
export interface RowOrderSaveContext<TData> {
  signal: AbortSignal;
  plan: RowOrderPlan<TData>;
  operation: RowOrderOperation;
  /** Apply the complete ordered batch in one revision CAS, or persist plan.after atomically. */
  operations: readonly RowOrderIntent[];
}
export type RowOrderSaveResult = { status?: "saved"; revision?: Revision } | { status: "conflict"; revision?: Revision; message?: string };

export interface RowOrderState<TData> {
  status: "idle" | "saving" | "saved" | "error" | "conflict";
  error: unknown | null;
  revision?: Revision;
  plan: RowOrderPlan<TData> | null;
  canUndo: boolean;
  canRedo: boolean;
}

export interface RowOrderControllerOptions<TData> extends RowOrderOptions<TData> {
  getRows(): readonly TData[];
  /** Install a complete immutable model. Refuse dirty edits before replacing grid data. */
  applyRows(rows: readonly TData[]): void;
  treeData?: boolean;
  getRevision?(): Revision | undefined;
  save?(intent: RowOrderIntent, context: RowOrderSaveContext<TData>): Promise<void | RowOrderSaveResult>;
  onStateChange?(state: Readonly<RowOrderState<TData>>): void;
}

export interface RowOrderController<TData> {
  readonly state: Readonly<RowOrderState<TData>>;
  bindings: Pick<GridOptions<TData>, "applyRowDrag" | "rowDragPolicy" | "onRowDragEnd"> & { applyRowDrag: false };
  preview(intent: RowOrderIntent): RowOrderPlan<TData>;
  move(intent: RowOrderIntent): Promise<RowOrderPlan<TData>>;
  undo(): Promise<RowOrderPlan<TData>>;
  redo(): Promise<RowOrderPlan<TData>>;
  subscribe(listener: (state: Readonly<RowOrderState<TData>>) => void): () => void;
  dispose(): void;
}

export class RowOrderConflictError extends Error {
  constructor(message = "The row order changed on the server. Reload before trying again.", readonly serverRevision?: Revision) {
    super(message);
    this.name = "RowOrderConflictError";
  }
}

function acceptedRevision(result: void | RowOrderSaveResult): Revision | undefined {
  if (result?.status === "conflict") throw new RowOrderConflictError(result.message, result.revision);
  return result?.revision;
}

function destination(intent: Omit<RowOrderIntent, "targetId"> & { targetId: string | null }): RowOrderIntent {
  if (intent.targetId === null) throw new Error("[MachTable] Row ordering requires an existing destination.");
  return { ...intent, targetId: intent.targetId };
}

/** Optimistic ordering owns only its own installed model and in-flight save. */
export function createRowOrderController<T>(options: RowOrderControllerOptions<T>): RowOrderController<T> {
  let state: RowOrderState<T> = { status: "idle", error: null, revision: options.getRevision?.(), plan: null, canUndo: false, canRedo: false };
  let generation = 0;
  let disposed = false;
  let pending: AbortController | null = null;
  let pendingModelCurrent: (() => boolean) | null = null;
  let boundApi: GridApi<T> | null = null;
  let unbindApi = () => {};
  let releaseDriver = () => {};
  let editGeneration = 0;
  let keyboardFocus: KeyboardFocus<T> | null = null;
  const history = new RowOrderHistory<T>();
  let historyScope: { rows: SnapshotEntry<T>[]; nodes: NodeEntry<T>[]; api: GridApi<T> | null; revision?: Revision } | null = null;
  const listeners = new Set<(state: Readonly<RowOrderState<T>>) => void>();
  const childrenKey = options.childrenKey ?? "children" as keyof T & string;
  let feedbackCache: { rows: readonly T[]; revision?: Revision; sources: string; rowIds: readonly string[]; validate(intent: RowOrderIntent): void } | null = null;
  const clearHistory = (): void => { history.clear(); historyScope = null; };
  const abortPending = (): boolean => {
    if (!pending) return false;
    const request = pending;
    generation++; pending = null; pendingModelCurrent = null; request.abort();
    return true;
  };
  const historyFlags = (status = state.status) => ({ canUndo: !disposed && status !== "saving" && history.canUndo, canRedo: !disposed && status !== "saving" && history.canRedo });
  const publish = (next: RowOrderState<T>): void => {
    state = Object.freeze({ ...next, ...historyFlags(next.status) });
    if (boundApi && !boundApi.isDestroyed()) boundApi.view.refreshCells();
    const observers = [(next: Readonly<RowOrderState<T>>) => options.onStateChange?.(next), ...listeners];
    for (const observer of observers) {
      try { observer?.(state); }
      catch (error) { console.error("[MachTable] Row order state observer failed", error); }
    }
  };
  const getRevision = (): Revision | undefined => options.getRevision?.() ?? state.revision;
  const cancelKeyboardFocus = (focus = keyboardFocus): void => {
    focus?.release();
    if (keyboardFocus === focus) keyboardFocus = null;
  };
  const cancelReplacedSave = (): void => {
    if (!pendingModelCurrent || pendingModelCurrent()) return;
    abortPending(); clearHistory(); cancelKeyboardFocus();
    publish({ ...state, status: "idle", plan: null, error: null });
  };
  const driverFactory: RowDragDriverFactory = host => new OrderingDragDriver(host, node => createOrderDragSession(host.api, node, options.getRows(), options, options.treeData === true, getRevision()), (intent, restore) => {
    cancelKeyboardFocus();
    const source = document.activeElement;
    const onFocus = (event: FocusEvent) => { if (event.target !== source && event.target !== document.body) cancelKeyboardFocus(focus); };
    const focus: KeyboardFocus<T> = { api: host.api, intent, restore, generation: generation + 1, release: () => document.removeEventListener("focusin", onFocus, true) };
    keyboardFocus = focus;
    document.addEventListener("focusin", onFocus, true);
  });
  const syncHistory = (): void => {
    cancelReplacedSave();
    if (!pending && historyScope && (historyScope.api !== boundApi || historyScope.revision !== getRevision() ||
      !ownsNodes(boundApi, historyScope.nodes) || !ownsSnapshot(options.getRows(), historyScope.rows, childrenKey, options.treeData === true))) clearHistory();
    const flags = historyFlags();
    if (state.canUndo !== flags.canUndo || state.canRedo !== flags.canRedo) state = Object.freeze({ ...state, ...flags });
  };
  const bindApi = (api: GridApi<T>): void => {
    if (api === boundApi) {
      cancelReplacedSave();
      if (!ownsGridRowDragFactory(api, driverFactory)) { releaseDriver(); releaseDriver = setGridRowDragFactory(api, driverFactory); }
      return;
    }
    const cancelled = abortPending();
    unbindApi();
    releaseDriver();
    cancelKeyboardFocus();
    clearHistory();
    boundApi = api;
    releaseDriver = setGridRowDragFactory(api, driverFactory);
    unbindApi = api.on("cellValueChanged", () => {
      editGeneration++;
      const changed = history.canUndo || history.canRedo;
      clearHistory();
      if (changed) publish({ ...state, status: pending ? "saving" : "idle", plan: pending ? state.plan : null, error: null });
    });
    if (cancelled) publish({ ...state, status: "idle", plan: null, error: null });
  };
  const preview = (intent: RowOrderIntent): RowOrderPlan<T> => {
    syncHistory();
    if (disposed) throw new Error("[MachTable] The row order controller is disposed.");
    if (pending) throw new Error("[MachTable] A row order save is already in progress.");
    const revision = getRevision();
    if (revision !== undefined && intent.expectedRevision !== undefined && intent.expectedRevision !== revision) throw new RowOrderConflictError();
    const input = { ...intent, expectedRevision: intent.expectedRevision ?? revision };
    return (options.treeData ? moveTreeNodes : reorderRows)(options.getRows(), input, options);
  };
  const execute = async (plan: RowOrderPlan<T>, operation: RowOrderOperation, operations: readonly RowOrderIntent[], entry: OrderHistoryEntry<T>, focus?: KeyboardFocus<T>): Promise<RowOrderPlan<T>> => {
    if (!plan.changed) return plan;
    const api = boundApi;
    if (api && !canReplaceGridData(api)) throw new Error("[MachTable] Save or discard edited rows before changing their order.");
    const currentGeneration = ++generation;
    feedbackCache = null;
    const request = new AbortController();
    pending = request; pendingModelCurrent = null;
    const sourceRevision = getRevision();
    const startingEditGeneration = editGeneration;
    let installed: SnapshotEntry<T>[] | null = null;
    let installedNodes: NodeEntry<T>[] = [];
    let completed = false, recovered = false;
    let completionRevision = sourceRevision;
    const restoreFocus = (owned: boolean): void => {
      if (!focus) return;
      if (!owned || focus !== keyboardFocus || focus.api !== boundApi) { cancelKeyboardFocus(focus); return; }
      const scope = historyScope;
      focus.restore(() => {
        const modelOwned = scope !== null && scope === historyScope && scope.revision === getRevision() && ownsNodes(focus.api, scope.nodes) && ownsSnapshot(options.getRows(), scope.rows, childrenKey, options.treeData === true);
        const allowed = modelOwned && keyboardFocus === focus && !disposed && generation === focus.generation && boundApi === focus.api && ownsGridRowDragFactory(focus.api, driverFactory);
        cancelKeyboardFocus(focus);
        return allowed;
      });
    };
    const current = (): boolean => !disposed && generation === currentGeneration;
    const owns = (): boolean => current() && (!api || (boundApi === api && !api.isDestroyed())) && installed !== null && getRevision() === sourceRevision &&
      ownsNodes(api, installedNodes) && ownsSnapshot(options.getRows(), installed, childrenKey, options.treeData === true);
    const recover = (error: unknown): void => {
      if (!owns()) {
        if (current() && !installed) publish({ ...state, status: "error", error, plan });
        return;
      }
      // Edits may start while persistence is pending. Never clear them to restore an old order.
      const safe = !api || canReplaceGridData(api);
      let failure = safe ? error : Object.assign(new Error("[MachTable] Row order could not be saved. Automatic rollback was skipped to preserve new edits. Save or discard those edits, then reload the row order."), { cause: error });
      if (safe) {
        pendingModelCurrent = null; // This replacement is the owned compensation, not an external reload.
        try { options.applyRows(plan.before); recovered = true; }
        catch (rollbackError) { failure = Object.assign(new Error("[MachTable] Row order could not be saved or restored. Reload the row order before trying again."), { cause: error, rollbackError }); }
      }
      if (!current()) return;
      if (!recovered) clearHistory();
      publish({ ...state, status: error instanceof RowOrderConflictError ? "conflict" : "error", error: failure });
    };
    const finalize = (): void => {
      // A rebound controller may already be saving a new model before this aborted waiter runs.
      if (!current()) { restoreFocus(false); return; }
      const revision = getRevision();
      let focusOwned = false;
      if (completed && current() && (revision === sourceRevision || revision === completionRevision) && ownsNodes(api, installedNodes) && ownsSnapshot(options.getRows(), installed!, childrenKey, options.treeData === true)) {
        historyScope = { rows: installed!, nodes: installedNodes, api, revision };
        focusOwned = true;
      } else if (recovered && current()) {
        historyScope = { rows: snapshot(options.getRows(), childrenKey, options.treeData === true), nodes: nodeSnapshot(api), api, revision };
        focusOwned = ownsSnapshot(options.getRows(), snapshot(plan.before, childrenKey, options.treeData === true), childrenKey, options.treeData === true);
      }
      else clearHistory();
      if (pending === request) {
        pending = null; pendingModelCurrent = null;
        if (boundApi && !boundApi.isDestroyed()) boundApi.view.refreshCells();
      }
      if (current() && state.status === "saving") publish({ ...state, status: "idle", plan: null });
      syncHistory();
      restoreFocus(focusOwned);
    };
    try {
      options.applyRows(plan.after);
      installed = snapshot(options.getRows(), childrenKey, options.treeData === true);
      installedNodes = nodeSnapshot(api);
      const rows = options.getRows(), sentinel = installedNodes[0]?.node;
      // setData/reload replace nodes; cell editing preserves them. Keep handle rendering O(1).
      pendingModelCurrent = api && sentinel ? () => !api.isDestroyed() && api.rows.getById(sentinel.id) === sentinel : () => options.getRows() === rows;
      publish({ ...state, status: "saving", error: null, plan });
      if (!owns()) return plan;
      const revision = acceptedRevision(await abortable(Promise.resolve(options.save?.(plan.intent, { signal: request.signal, plan, operation, operations })), request.signal));
      if (owns()) {
        completed = true;
        completionRevision = revision ?? sourceRevision;
        if (editGeneration === startingEditGeneration) history.commit(operation, entry);
        else clearHistory();
        publish({ ...state, status: "saved", revision: completionRevision });
      }
      return plan;
    } catch (error) {
      recover(error);
      throw error;
    } finally {
      finalize();
    }
  };
  const moveWithFocus = async (intent: RowOrderIntent, focus?: KeyboardFocus<T>): Promise<RowOrderPlan<T>> => {
    if (focus !== keyboardFocus) focus = undefined;
    if (keyboardFocus !== focus) cancelKeyboardFocus();
    const plan = preview(intent);
    if (!plan.changed) cancelKeyboardFocus(focus);
    const inverse = plan.changed ? inverseRowOrderOperations(plan, options, options.treeData === true) : [];
    return execute(plan, "move", [plan.intent], { plan, inverse }, focus);
  };
  const move = (intent: RowOrderIntent): Promise<RowOrderPlan<T>> => moveWithFocus(intent);
  const restore = async (operation: "undo" | "redo"): Promise<RowOrderPlan<T>> => {
    cancelKeyboardFocus();
    syncHistory();
    if (disposed || pending) throw new Error("[MachTable] Row ordering is unavailable while disposed or saving.");
    const entry = history.peek(operation);
    if (!entry) throw new Error(`[MachTable] Nothing to ${operation}.`);
    const operations = (operation === "undo" ? entry.inverse : [entry.plan.intent]).map(intent => ({ ...intent, expectedRevision: getRevision() }));
    const before = options.getRows(), after = operation === "undo" ? entry.plan.before : entry.plan.after;
    validateRowOrderRestore(before, after, operations, options, options.treeData === true);
    const plan = { before, after, intent: operations[0], rowIds: entry.plan.rowIds, changed: true };
    return execute(plan, operation, operations, entry);
  };
  const canDrop = (intent: RowOrderIntent): boolean | string => {
    try {
      if (disposed || pending) return false;
      const rows = options.getRows();
      const revision = getRevision();
      if (revision !== undefined && intent.expectedRevision !== undefined && intent.expectedRevision !== revision) return false;
      const sources = feedbackCache?.rowIds === intent.rowIds ? feedbackCache.sources : JSON.stringify(intent.rowIds.map(String));
      if (!feedbackCache || feedbackCache.rows !== rows || feedbackCache.revision !== revision || feedbackCache.sources !== sources) {
        feedbackCache = { rows, revision, sources, rowIds: intent.rowIds, validate: createRowOrderValidator(rows, intent.rowIds, options, options.treeData === true) };
      }
      feedbackCache.rowIds = intent.rowIds;
      feedbackCache.validate(intent);
      return true;
    } catch (error) { return error instanceof Error ? error.message : false; }
  };
  const onRowDragEnd = (event: RowDragEndEvent<T>): void => {
    const intent = event.intent;
    if (event.applied || !intent) return;
    bindApi(event.api);
    const beforeMove = generation;
    const focus = keyboardFocus?.intent === intent ? keyboardFocus : undefined;
    void Promise.resolve().then(() => moveWithFocus(destination(intent), focus)).catch((error: unknown) => {
      if (focus && focus.generation !== generation) cancelKeyboardFocus(focus);
      if (!disposed && generation === beforeMove && state.status !== "saving") {
        publish({ ...state, status: error instanceof RowOrderConflictError ? "conflict" : "error", error });
      }
    });
  };
  const canInteract = (api: GridApi<T>): boolean | string => {
    if (disposed) return false;
    bindApi(api);
    if (pending) return "Wait for the current row order to finish saving.";
    return canReplaceGridData(api) || "Save or discard edited rows before changing their order.";
  };
  return {
    get state() { syncHistory(); return state; },
    bindings: {
      applyRowDrag: false,
      rowDragPolicy: {
        canDrag: ({ api }) => canInteract(api),
        canDrop: ({ intent, api }) => {
          const allowed = canInteract(api);
          if (allowed !== true) return allowed;
          try { return canDrop(destination(intent)); } catch (error) { return error instanceof Error ? error.message : false; }
        },
        getRevision
      },
      onRowDragEnd
    },
    preview,
    move,
    undo: () => restore("undo"),
    redo: () => restore("redo"),
    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispose() {
      disposed = true; generation++; pending?.abort(); pending = null; pendingModelCurrent = null; unbindApi(); releaseDriver(); cancelKeyboardFocus(); clearHistory();
      if (boundApi && !boundApi.isDestroyed()) boundApi.view.refreshCells();
      boundApi = null; feedbackCache = null; listeners.clear();
      state = Object.freeze({ ...state, status: "idle", error: null, plan: null, canUndo: false, canRedo: false });
    }
  };
}
