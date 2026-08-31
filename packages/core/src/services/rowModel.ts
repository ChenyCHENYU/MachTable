import type { GridCore } from "../core/gridCore";
import type { RowNode } from "../types/row";
import type { FilterModel } from "../types/colDef";
import type { AdvancedFilterModel } from "../types/advancedFilter";
import type { RowTransaction } from "../types/api";
import { doesNodePassFilters } from "./filterService";
import { sortNodes } from "./sortService";
import { createAggResolver } from "../lib/aggregate";
import { defaultComparator } from "../lib/compare";
import { normalizeAdvancedFilterModel, normalizeFilterModel } from "../lib/advancedFilter";
import {
  RemoteBlockCache,
  type RemoteBlockResult
} from "./remoteBlockCache";
import type { RemoteBlockCacheSnapshot } from "../types/api";

type ColumnLike = import("./column").Column;
type RowModelContext = Pick<
  GridCore<any>,
  | "bodyRenderer"
  | "changeTracker"
  | "columnModel"
  | "emit"
  | "getApi"
  | "getCellValue"
  | "getLocaleText"
  | "headerRenderer"
  | "isDestroyed"
  | "nextId"
  | "options"
  | "performanceMonitor"
  | "relayout"
  | "reportError"
  | "requestUpdate"
  | "selectionService"
  | "skeleton"
  | "undoService"
>;

function readChildren(data: unknown, key: string): unknown[] | undefined {
  if (data == null || typeof data !== "object") return undefined;
  const value = (data as Record<string, unknown>)[key];
  return Array.isArray(value) ? value : undefined;
}

export class RowModel<TData = any> {
  private all: RowNode<TData>[] = [];
  private roots: RowNode<TData>[] = [];
  private childIds = new Map<string, string[]>();
  private displayed: RowNode<TData>[] = [];
  private nodesById = new Map<string, RowNode<TData>>();
  private filterModel: FilterModel = {};
  private advancedFilterModel: AdvancedFilterModel | null = null;
  private quickFilter: string | null = null;
  private expandedIds = new Set<string>();
  private groupExpandedIds = new Set<string>();
  private knownGroupIds: string[] = [];
  private spanInfo = new Map<string, Int32Array>();
  private mastersBuf: RowNode<TData>[] = [];
  private infiniteLastRow: number | null = null;
  private infiniteRequested = false;
  private infiniteLoading = false;
  private infiniteSeq = 0;
  private infiniteAbort: AbortController | null = null;
  private infiniteRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private infinitePendingResolve: (() => void) | null = null;
  private treeDepth = new WeakMap<RowNode<TData>, number>();
  private rowSequence = new WeakMap<RowNode<TData>, number>();
  private treeLoadControllers = new Map<string, AbortController>();
  private treeLoadPromises = new Map<string, Promise<readonly TData[]>>();
  private displayRevision = 0;
  private blockNodes = new Map<number, RowNode<TData>>();
  private blockPlaceholders = new Map<number, RowNode<TData>>();
  private installedBlocks = new Set<number>();
  private blockCache = new RemoteBlockCache<TData>(12, (blockIndex) => this.evictBlock(blockIndex));
  private dataProcessorSeq = 0;
  private dataProcessorAbort: AbortController | null = null;
  private skipDataProcessorOnce = false;

  constructor(private core: RowModelContext) {
    this.advancedFilterModel = normalizeAdvancedFilterModel(core.options.advancedFilterModel);
  }

  resolveRowId(data: TData, index: number, fallback: string): string {
    const getRowId = this.core.options.getRowId;
    if (!getRowId) return fallback;
    try {
      const id = getRowId({ data, index, api: this.core.getApi() });
      if (typeof id === "string" && id.length > 0) return id;
      this.core.reportError(new Error("getRowId must return a non-empty string"), "getRowId", { index });
    } catch (error) {
      this.core.reportError(error, "getRowId", { index });
    }
    return fallback;
  }

  get isTree(): boolean {
    return this.core.options.treeData;
  }

  get isInfinite(): boolean {
    return this.core.options.datasource != null;
  }

  get isBlockDatasource(): boolean {
    return this.isInfinite && this.core.options.datasourceMode === "block";
  }

  getDisplayTotalCount(): number {
    if (this.isInfinite) {
      if (this.isBlockDatasource) return this.resolveBlockRowCount();
      const detailRows = Math.max(0, this.displayed.length - this.all.length);
      return (this.infiniteLastRow ?? this.all.length) + detailRows;
    }
    return this.displayed.length;
  }

  getDisplayRevision(): number { return this.displayRevision; }

  isLoadingInfinite(): boolean {
    return this.infiniteLoading;
  }

  startInfinite(signal?: AbortSignal): Promise<void> {
    if (!this.isInfinite) return Promise.resolve();
    if (signal?.aborted) return Promise.resolve();
    this.cancelInfiniteRequest();
    this.infiniteLastRow = null;
    this.infiniteRequested = false;
    this.all = [];
    this.roots = [];
    this.nodesById.clear();
    this.expandedIds.clear();
    this.core.undoService.clear();
    this.refreshPipeline();
    this.core.requestUpdate({ data: true });
    if (this.isBlockDatasource) {
      this.blockCache.configure(this.core.options.maxBlocksInCache);
      return this.loadRandomBlock(0, signal);
    }
    return this.loadBlock(0, undefined, signal);
  }

  reloadInfinite(signal?: AbortSignal): Promise<void> {
    if (!this.isInfinite) return Promise.resolve();
    return this.startInfinite(signal);
  }

  private setInfiniteLoading(v: boolean): void {
    this.infiniteLoading = v;
    this.core.skeleton.setInfiniteLoading(v, this.core.getLocaleText("loading"));
  }

  private loadBlock(start: number, end?: number, externalSignal?: AbortSignal): Promise<void> {
    if (!this.isInfinite || this.infiniteRequested) return Promise.resolve();
    if (this.infiniteLastRow != null && start >= this.infiniteLastRow) return Promise.resolve();
    const datasource = this.core.options.datasource!;
    const blockSize = this.core.options.blockSize;
    const stop = end ?? start + blockSize;
    if (stop <= start) return Promise.resolve();
    const seq = ++this.infiniteSeq;
    const controller = new AbortController();
    const abortFromExternal = () => controller.abort(externalSignal?.reason);
    externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
    this.infiniteAbort = controller;
    this.infiniteRequested = true;
    this.setInfiniteLoading(true);

    return new Promise<void>((resolve) => {
      let settled = false;
      let attempt = 0;
      this.infinitePendingResolve = resolve;
      const done = (reason?: unknown) => {
        if (settled) return;
        settled = true;
        externalSignal?.removeEventListener("abort", abortFromExternal);
        if (seq === this.infiniteSeq) {
          this.infiniteRequested = false;
          this.infiniteAbort = null;
          this.infinitePendingResolve = null;
          this.setInfiniteLoading(false);
          if (reason != null && (reason as { name?: string })?.name !== "AbortError") {
            this.core.reportError(reason, "datasource.getRows", { startRow: start, endRow: stop });
          }
        }
        resolve();
      };

      const runAttempt = () => {
        if (settled || seq !== this.infiniteSeq || controller.signal.aborted || this.core.isDestroyed()) {
          done();
          return;
        }
        attempt++;
        let attemptSettled = false;
        const failAttempt = (reason?: unknown) => {
          if (attemptSettled || settled) return;
          attemptSettled = true;
          if (seq !== this.infiniteSeq || controller.signal.aborted || this.core.isDestroyed()) {
            done();
            return;
          }
          if (attempt <= this.core.options.datasourceRetryCount) {
            const delay = Math.min(
              this.core.options.datasourceRetryDelay * 2 ** Math.max(0, attempt - 1),
              30_000
            );
            this.infiniteRetryTimer = setTimeout(() => {
              this.infiniteRetryTimer = null;
              runAttempt();
            }, delay);
            return;
          }
          done(reason ?? new Error("Datasource request failed"));
        };

        try {
          const request = datasource.getRows({
            startRow: start,
            endRow: stop,
            sortModel: this.core.columnModel.getSortModel(),
            filterModel: this.getFilterModel(),
            advancedFilterModel: this.getAdvancedFilterModel(),
            quickFilterText: this.quickFilter,
            signal: controller.signal,
            onSuccess: (rows, lastRow) => {
              if (attemptSettled || settled) return;
              attemptSettled = true;
              if (seq !== this.infiniteSeq || this.core.isDestroyed() || controller.signal.aborted) {
                done();
                return;
              }
              const received = rows ?? [];
              if (typeof lastRow === "number" && lastRow >= 0) {
                this.infiniteLastRow = lastRow;
              } else if (received.length < stop - start) {
                this.infiniteLastRow = start + received.length;
              }
              const wasEmpty = this.all.length === 0;
              this.appendInfiniteRows(received);
              done();
              this.refreshPipeline();
              this.core.requestUpdate({ data: true });
              if (wasEmpty) this.core.relayout();
              this.core.headerRenderer.refreshSelectAllCheckbox();
            },
            fail: failAttempt
          });
          if (request && typeof request.catch === "function") {
            void request.catch(failAttempt);
          }
        } catch (error) {
          failAttempt(error);
        }
      };

      runAttempt();
    });
  }

  private cancelInfiniteRequest(): void {
    this.infiniteSeq++;
    if (this.infiniteRetryTimer != null) clearTimeout(this.infiniteRetryTimer);
    this.infiniteRetryTimer = null;
    this.infiniteAbort?.abort();
    this.infiniteAbort = null;
    this.infiniteRequested = false;
    this.setInfiniteLoading(false);
    this.infinitePendingResolve?.();
    this.infinitePendingResolve = null;
    this.blockCache.purge();
    this.blockNodes.clear();
    this.blockPlaceholders.clear();
    this.installedBlocks.clear();
  }

  private appendInfiniteRows(rows: TData[]): void {
    for (const data of rows) {
      if (data == null) continue;
      const index = this.all.length;
      const id = this.resolveRowId(data, index, `inf-${this.core.nextId()}`);
      if (this.nodesById.has(id)) {
        this.core.reportError(new Error(`Duplicate row id: ${id}`), "datasource.getRows", { rowId: id });
        continue;
      }
      const node: RowNode<TData> = {
        id,
        data,
        rowIndex: -1,
        selected: this.core.selectionService.isSelected(id)
      };
      this.all.push(node);
      this.nodesById.set(id, node);
      this.roots.push(node);
    }
  }

  private loadRandomBlock(blockIndex: number, externalSignal?: AbortSignal): Promise<void> {
    if (!this.isBlockDatasource || blockIndex < 0) return Promise.resolve();
    if (externalSignal?.aborted) return Promise.reject(this.abortError(externalSignal.reason));
    const blockSize = this.core.options.blockSize;
    const start = blockIndex * blockSize;
    if (start >= this.resolveBlockRowCount()) return Promise.resolve();
    const stop = this.infiniteLastRow == null
      ? start + blockSize
      : Math.min(this.infiniteLastRow, start + blockSize);
    const request = this.blockCache.load(
      blockIndex,
      (signal) => this.requestDatasourceRange(start, stop, signal),
      externalSignal
    );
    this.setInfiniteLoading(this.all.length === 0 && this.blockCache.snapshot().loadingBlockCount > 0);
    return request.then((result) => {
      if (externalSignal?.aborted || this.core.isDestroyed() || !this.isBlockDatasource) return;
      if (this.installedBlocks.has(blockIndex)) return;
      this.installBlock(blockIndex, result);
      this.refreshPipeline();
      this.core.requestUpdate({ data: true });
      this.core.headerRenderer.refreshSelectAllCheckbox();
    }).catch((error) => {
      if ((error as { name?: string })?.name !== "AbortError") {
        this.core.reportError(error, "datasource.getRows", { startRow: start, endRow: stop });
      }
      throw error;
    }).finally(() => {
      this.setInfiniteLoading(this.all.length === 0 && this.blockCache.snapshot().loadingBlockCount > 0);
    });
  }

  private requestDatasourceRange(
    startRow: number,
    endRow: number,
    signal: AbortSignal
  ): Promise<RemoteBlockResult<TData>> {
    const datasource = this.core.options.datasource!;
    return new Promise((resolve, reject) => {
      let attempt = 0;
      let retryTimer: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      const finishReject = (reason?: unknown) => {
        if (settled) return;
        settled = true;
        if (retryTimer != null) clearTimeout(retryTimer);
        signal.removeEventListener("abort", abort);
        reject(reason instanceof Error ? reason : new Error(
          typeof reason === "string" ? reason : "Datasource request failed"
        ));
      };
      const abort = () => finishReject(this.abortError(signal.reason));
      signal.addEventListener("abort", abort, { once: true });

      const runAttempt = () => {
        if (settled) return;
        if (signal.aborted || this.core.isDestroyed()) {
          abort();
          return;
        }
        attempt++;
        let attemptSettled = false;
        const failAttempt = (reason?: unknown) => {
          if (attemptSettled || settled) return;
          attemptSettled = true;
          if (signal.aborted || this.core.isDestroyed()) {
            abort();
            return;
          }
          if (attempt <= this.core.options.datasourceRetryCount) {
            const delay = Math.min(
              this.core.options.datasourceRetryDelay * 2 ** Math.max(0, attempt - 1),
              30_000
            );
            retryTimer = setTimeout(() => {
              retryTimer = null;
              runAttempt();
            }, delay);
          } else {
            finishReject(reason);
          }
        };
        try {
          const response = datasource.getRows({
            startRow,
            endRow,
            sortModel: this.core.columnModel.getSortModel(),
            filterModel: this.getFilterModel(),
            advancedFilterModel: this.getAdvancedFilterModel(),
            quickFilterText: this.quickFilter,
            signal,
            onSuccess: (rows, lastRow) => {
              if (attemptSettled || settled) return;
              attemptSettled = true;
              settled = true;
              signal.removeEventListener("abort", abort);
              resolve({
                rows: rows ?? [],
                ...(typeof lastRow === "number" && lastRow >= 0 ? { lastRow } : {})
              });
            },
            fail: failAttempt
          });
          if (response && typeof response.catch === "function") void response.catch(failAttempt);
        } catch (error) {
          failAttempt(error);
        }
      };
      runAttempt();
    });
  }

  private installBlock(blockIndex: number, result: RemoteBlockResult<TData>): void {
    const blockSize = this.core.options.blockSize;
    const start = blockIndex * blockSize;
    this.evictBlock(blockIndex);
    if (typeof result.lastRow === "number" && result.lastRow >= 0) {
      this.infiniteLastRow = result.lastRow;
    } else if (result.rows.length < blockSize) {
      this.infiniteLastRow = start + result.rows.length;
    }
    result.rows.forEach((data, offset) => {
      if (data == null) return;
      const absoluteIndex = start + offset;
      if (this.infiniteLastRow != null && absoluteIndex >= this.infiniteLastRow) return;
      const id = this.resolveRowId(data, absoluteIndex, `block-${absoluteIndex}`);
      const duplicate = this.nodesById.get(id);
      if (duplicate && duplicate.rowIndex !== absoluteIndex) {
        this.core.reportError(new Error(`Duplicate row id: ${id}`), "datasource.getRows", { rowId: id });
        return;
      }
      const node: RowNode<TData> = {
        id,
        data,
        rowIndex: absoluteIndex,
        selected: this.core.selectionService.isSelected(id)
      };
      this.blockNodes.set(absoluteIndex, node);
      this.blockPlaceholders.delete(absoluteIndex);
      this.nodesById.set(id, node);
      this.rowSequence.set(node, absoluteIndex + 1);
    });
    this.rebuildLoadedBlockRows();
    this.installedBlocks.add(blockIndex);
  }

  private evictBlock(blockIndex: number): void {
    this.installedBlocks.delete(blockIndex);
    const blockSize = this.core.options.blockSize;
    const start = blockIndex * blockSize;
    for (let index = start; index < start + blockSize; index++) {
      const node = this.blockNodes.get(index);
      if (!node) continue;
      this.blockNodes.delete(index);
      if (this.nodesById.get(node.id) === node) this.nodesById.delete(node.id);
    }
    this.rebuildLoadedBlockRows();
  }

  private rebuildLoadedBlockRows(): void {
    this.all = [...this.blockNodes.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, node]) => node);
    this.roots = this.all;
  }

  private resolveBlockRowCount(): number {
    if (this.infiniteLastRow != null) return this.infiniteLastRow;
    if (this.core.options.datasourceRowCount != null) return this.core.options.datasourceRowCount;
    if (this.blockNodes.size === 0) return this.core.options.blockSize;
    let greatest = 0;
    for (const index of this.blockNodes.keys()) greatest = Math.max(greatest, index + 1);
    return greatest + this.core.options.blockSize;
  }

  private blockPlaceholder(index: number): RowNode<TData> {
    let placeholder = this.blockPlaceholders.get(index);
    if (!placeholder) {
      placeholder = {
        id: `__mach_loading_${index}`,
        data: null,
        rowIndex: index,
        selected: false,
        loading: true
      };
      this.blockPlaceholders.set(index, placeholder);
      if (this.blockPlaceholders.size > 2_000) {
        const oldest = this.blockPlaceholders.keys().next().value;
        if (oldest != null) this.blockPlaceholders.delete(oldest);
      }
    }
    return placeholder;
  }

  private abortError(reason?: unknown): Error {
    if (reason instanceof Error) return reason;
    const error = new Error(typeof reason === "string" ? reason : "Operation aborted");
    error.name = "AbortError";
    return error;
  }

  checkInfiniteScroll(lastVisibleIndex: number): void {
    if (this.isBlockDatasource) {
      if (lastVisibleIndex < 0) return;
      const blockSize = this.core.options.blockSize;
      const target = Math.floor(lastVisibleIndex / blockSize);
      const radius = this.core.options.blockPrefetch;
      for (let distance = 0; distance <= radius; distance++) {
        const candidates = distance === 0 ? [target] : [target + distance, target - distance];
        for (const blockIndex of candidates) {
          if (blockIndex < 0 || blockIndex * blockSize >= this.resolveBlockRowCount()) continue;
          void this.loadRandomBlock(blockIndex).catch(() => undefined);
        }
      }
      return;
    }
    if (!this.isInfinite || this.infiniteRequested) return;
    const loaded = this.all.length;
    if (this.infiniteLastRow != null && loaded >= this.infiniteLastRow) return;
    const buffer = this.core.options.infiniteBufferRows;
    if (lastVisibleIndex + buffer < loaded && lastVisibleIndex < loaded) return;
    const blockSize = this.core.options.blockSize;
    const stop = this.infiniteLastRow == null
      ? loaded + blockSize
      : Math.min(this.infiniteLastRow, loaded + blockSize);
    void this.loadBlock(loaded, stop);
  }

  onServerParamsChanged(): Promise<void> {
    return this.reloadInfinite().catch(() => undefined);
  }

  onDatasourceChanged(): Promise<void> {
    this.cancelInfiniteRequest();
    if (this.isInfinite) return this.startInfinite().catch(() => undefined);
    this.infiniteLastRow = null;
    this.setRowData(this.core.options.rowData);
    this.core.requestUpdate({ data: true });
    return Promise.resolve();
  }

  destroy(): void {
    this.cancelInfiniteRequest();
    this.cancelTreeLoads();
    this.cancelDataProcessor();
    this.core.options.dataProcessor?.destroy?.();
  }

  ensureRowsLoaded(startRow: number, endRow: number, signal?: AbortSignal): Promise<void> {
    if (!this.isBlockDatasource) return Promise.resolve();
    const blockSize = this.core.options.blockSize;
    const start = Math.max(0, Math.trunc(startRow));
    const end = Math.min(this.resolveBlockRowCount(), Math.max(start, Math.trunc(endRow)));
    const firstBlock = Math.floor(start / blockSize);
    const lastBlock = Math.max(firstBlock, Math.floor(Math.max(start, end - 1) / blockSize));
    const requests: Promise<void>[] = [];
    for (let block = firstBlock; block <= lastBlock; block++) {
      requests.push(this.loadRandomBlock(block, signal));
    }
    return Promise.all(requests).then(() => undefined);
  }

  purgeDatasourceCache(): void {
    if (!this.isBlockDatasource) return;
    this.blockCache.purge();
    this.blockNodes.clear();
    this.blockPlaceholders.clear();
    this.installedBlocks.clear();
    this.all = [];
    this.roots = [];
    this.nodesById.clear();
    this.refreshPipeline();
    this.core.requestUpdate({ data: true });
  }

  getDatasourceCacheSnapshot(): RemoteBlockCacheSnapshot {
    return this.blockCache.snapshot();
  }

  setRowData(rows: TData[] | null | undefined): void {
    this.cancelTreeLoads();
    this.core.changeTracker.clear();
    const getRowId = this.core.options.getRowId;
    const childrenKey = this.core.options.childrenKey;
    const next: RowNode<TData>[] = [];
    const roots: RowNode<TData>[] = [];
    const byId = new Map<string, RowNode<TData>>();
    const childIds = new Map<string, string[]>();
    let autoSeq = 0;

    const buildNode = (data: TData, depth: number, parentId: string | null): RowNode<TData> | null => {
      const index = autoSeq++;
      const id = this.resolveRowId(data, index, `auto-${index}`);
      if (byId.has(id)) {
        this.core.reportError(new Error(`Duplicate row id: ${id}`), "rowData", { rowId: id, index });
        return null;
      }
      const children = this.isTree ? readChildren(data, childrenKey) : undefined;
      const node: RowNode<TData> = {
        id,
        data,
        rowIndex: -1,
        selected: false,
        treeChildrenLoaded: Array.isArray(children)
      };
      this.treeDepth.set(node, depth);
      next.push(node);
      byId.set(id, node);
      if (parentId != null) {
        const list = childIds.get(parentId) ?? [];
        list.push(id);
        childIds.set(parentId, list);
      } else {
        roots.push(node);
      }
      if (this.isTree && Array.isArray(children)) {
        for (const child of children) {
          if (child != null) buildNode(child as TData, depth + 1, id);
        }
      }
      return node;
    };

    (rows ?? []).forEach((data) => {
      if (data != null) buildNode(data, 0, null);
    });

    this.all = next;
    this.roots = roots;
    this.childIds = childIds;
    this.nodesById = byId;
    this.core.undoService.clear();
    for (const id of [...this.expandedIds]) {
      if (!byId.has(id)) this.expandedIds.delete(id);
    }
    if (this.core.options.defaultExpandAll) {
      for (const node of next) {
        if (this.getChildrenCount(node.id) > 0) this.expandedIds.add(node.id);
      }
    }

    this.core.selectionService.onRowsRebuilt(getRowId != null);
    this.refreshPipeline();
  }

  getChildrenIds(id: string): string[] {
    return this.childIds.get(id) ?? [];
  }

  getChildrenCount(id: string): number {
    return this.childIds.get(id)?.length ?? 0;
  }

  hasChildren(id: string): boolean {
    return this.getChildrenCount(id) > 0;
  }

  isTreeRowLoading(id: string): boolean {
    return this.nodesById.get(id)?.treeLoading === true;
  }

  private cancelTreeLoads(): void {
    for (const controller of this.treeLoadControllers.values()) controller.abort();
    this.treeLoadControllers.clear();
    this.treeLoadPromises.clear();
  }

  loadTreeChildren(id: string, force = false): Promise<readonly TData[]> {
    const node = this.nodesById.get(id);
    const loader = this.core.options.loadTreeChildren;
    if (!this.isTree || !node?.data || !loader) return Promise.resolve([]);
    if (!force && node.treeChildrenLoaded) {
      return Promise.resolve(this.getChildrenIds(id).flatMap((childId) => {
        const data = this.nodesById.get(childId)?.data;
        return data == null ? [] : [data];
      }));
    }
    const pending = this.treeLoadPromises.get(id);
    if (pending && !force) return pending;
    this.treeLoadControllers.get(id)?.abort();
    const controller = new AbortController();
    this.treeLoadControllers.set(id, controller);
    node.treeLoading = true;
    node.treeLoadError = undefined;
    this.core.requestUpdate({ data: true });

    const request = Promise.resolve().then(() => loader({
      data: node.data!,
      node,
      api: this.core.getApi(),
      signal: controller.signal
    })).then((children) => {
      if (controller.signal.aborted || this.core.isDestroyed()) return [];
      if (!Array.isArray(children)) {
        throw new TypeError("[MachTable] loadTreeChildren must resolve to an array.");
      }
      this.replaceTreeChildren(node, children as readonly TData[]);
      node.treeChildrenLoaded = true;
      node.treeLoadError = undefined;
      this.core.emit("treeChildrenLoaded", { rowId: id, rowNode: node, children });
      return children;
    }).catch((error: unknown) => {
      if (controller.signal.aborted || (error as { name?: string })?.name === "AbortError") return [];
      node.treeLoadError = error;
      node.treeChildrenLoaded = false;
      this.core.reportError(error, "treeData.loadChildren", { rowId: id });
      this.core.emit("treeChildrenLoadFailed", { rowId: id, rowNode: node, error });
      throw error;
    }).finally(() => {
      if (this.treeLoadControllers.get(id) === controller) {
        this.treeLoadControllers.delete(id);
        this.treeLoadPromises.delete(id);
        node.treeLoading = false;
        this.core.requestUpdate({ data: true });
      }
    });
    this.treeLoadPromises.set(id, request);
    return request;
  }

  private replaceTreeChildren(parent: RowNode<TData>, children: readonly TData[]): void {
    const removed = new Set<string>();
    const stack = [...this.getChildrenIds(parent.id)];
    while (stack.length > 0) {
      const childId = stack.pop()!;
      if (removed.has(childId)) continue;
      removed.add(childId);
      stack.push(...this.getChildrenIds(childId));
    }
    this.validateTreeChildren(children, removed);
    for (const childId of removed) {
      this.treeLoadControllers.get(childId)?.abort();
      this.treeLoadControllers.delete(childId);
      this.treeLoadPromises.delete(childId);
      this.childIds.delete(childId);
      this.nodesById.delete(childId);
      this.expandedIds.delete(childId);
    }
    this.childIds.delete(parent.id);
    const depth = this.getTreeDepth(parent) + 1;
    for (const child of children) {
      if (child != null) this.buildChildNodes(parent, child, depth);
    }
    this.reindexAll();
    this.core.selectionService.onRowsRebuilt(this.core.options.getRowId != null);
    this.refreshPipeline();
    this.core.requestUpdate({ data: true });
  }

  private validateTreeChildren(children: readonly TData[], replacedIds: ReadonlySet<string>): void {
    const getRowId = this.core.options.getRowId;
    const reserved = getRowId
      ? new Set([...this.nodesById.keys()].filter((id) => !replacedIds.has(id)))
      : null;
    const seenObjects = new WeakSet<object>();
    const stack = [...children];
    let index = 0;
    while (stack.length > 0) {
      const data = stack.pop()!;
      if (data == null) continue;
      if (typeof data === "object") {
        if (seenObjects.has(data)) throw new TypeError("[MachTable] Lazy tree children contain a cyclic object graph.");
        seenObjects.add(data);
      }
      if (getRowId && reserved) {
        const id = getRowId({ data, index: index++, api: this.core.getApi() });
        if (typeof id !== "string" || id.length === 0) {
          throw new TypeError("[MachTable] getRowId must return a non-empty string for lazy tree children.");
        }
        if (reserved.has(id)) throw new Error(`Duplicate row id: ${id}`);
        reserved.add(id);
      }
      const nested = readChildren(data, this.core.options.childrenKey);
      if (nested) stack.push(...nested as TData[]);
    }
  }

  applyTransaction(transaction: RowTransaction<TData>, refresh = true): void {
    const getRowId = this.core.options.getRowId;
    const touched: RowNode<TData>[] = [];
    const externallyReplacedIds: string[] = [];

    if (transaction.remove?.length) {
      const removeIds = new Set<string>();
      const removeRefs = new Set<TData>();
      const collect = (data: TData) => {
        if (getRowId) {
          const id = this.resolveRowId(data, -1, `__missing_remove_${this.core.nextId()}`);
          const stack = [id];
          while (stack.length > 0) {
            const cur = stack.pop()!;
            if (removeIds.has(cur)) continue;
            removeIds.add(cur);
            for (const childId of this.childIds.get(cur) ?? []) stack.push(childId);
          }
        } else {
          const stack: TData[] = [data];
          while (stack.length > 0) {
            const cur = stack.pop()!;
            removeRefs.add(cur);
            const kids = this.isTree ? readChildren(cur, this.core.options.childrenKey) : undefined;
            if (kids) {
              for (const kid of kids) stack.push(kid as TData);
            }
          }
        }
      };
      transaction.remove.forEach(collect);
      this.all = this.all.filter((node) => {
        const drop = removeIds.has(node.id) || (node.data != null && removeRefs.has(node.data));
        if (drop) {
          externallyReplacedIds.push(node.id);
          this.nodesById.delete(node.id);
          this.childIds.delete(node.id);
        }
        return !drop;
      });
      const remaining = new Set(this.all);
      this.roots = this.roots.filter((node) => remaining.has(node));
    }

    if (transaction.update?.length) {
      for (const data of transaction.update) {
        let node: RowNode<TData> | undefined;
        if (getRowId) {
          node = this.nodesById.get(this.resolveRowId(data, -1, `__missing_update_${this.core.nextId()}`));
        } else {
          node = this.all.find((n) => n.data === data);
        }
        if (node) {
          node.data = data;
          externallyReplacedIds.push(node.id);
          this.core.bodyRenderer.invalidateRowHeight(node);
          touched.push(node);
        }
      }
    }

    if (transaction.add?.length) {
      const startIndex = transaction.addIndex != null ? Math.max(0, Math.min(transaction.addIndex, this.roots.length)) : this.roots.length;
      const added: RowNode<TData>[] = [];
      transaction.add.forEach((data, i) => {
        const id = this.resolveRowId(data, startIndex + i, `add-${this.core.nextId()}`);
        if (this.nodesById.has(id)) {
          this.core.reportError(new Error(`Duplicate row id: ${id}`), "transaction.add", { rowId: id });
          return;
        }
        const node: RowNode<TData> = { id, data, rowIndex: -1, selected: false };
        this.nodesById.set(id, node);
        this.treeDepth.set(node, 0);
        const children = this.isTree ? readChildren(data, this.core.options.childrenKey) : undefined;
        if (children) {
          for (const child of children) {
            if (child != null) this.buildChildNodes(node, child as TData, 1);
          }
        }
        added.push(node);
      });
      this.roots.splice(startIndex, 0, ...added);
      this.reindexAll();
    }

    if (refresh) {
      this.refreshPipeline();
      for (const node of touched) {
        if (node.rowIndex >= 0) this.core.bodyRenderer.refreshRows([node.rowIndex]);
      }
    }
    this.core.changeTracker.clearRows(externallyReplacedIds);
  }

  applyTransactions(transactions: readonly RowTransaction<TData>[]): void {
    if (transactions.length === 0) return;
    for (const transaction of transactions) this.applyTransaction(transaction, false);
    this.refreshPipeline();
  }

  private buildChildNodes(parent: RowNode<TData>, data: TData, depth: number): void {
    const id = this.resolveRowId(data, -1, `add-${this.core.nextId()}`);
    if (this.nodesById.has(id)) {
      this.core.reportError(new Error(`Duplicate row id: ${id}`), "transaction.add", { rowId: id });
      return;
    }
    const children = readChildren(data, this.core.options.childrenKey);
    const child: RowNode<TData> = {
      id,
      data,
      rowIndex: -1,
      selected: false,
      treeChildrenLoaded: Array.isArray(children)
    };
    this.nodesById.set(id, child);
    this.treeDepth.set(child, depth);
    const list = this.childIds.get(parent.id) ?? [];
    list.push(child.id);
    this.childIds.set(parent.id, list);
    if (!children) return;
    for (const nested of children) {
      if (nested != null) this.buildChildNodes(child, nested as TData, depth + 1);
    }
  }

  private reindexAll(): void {
    this.all = [];
    const walk = (node: RowNode<TData>) => {
      this.all.push(node);
      if (!this.nodesById.has(node.id)) this.nodesById.set(node.id, node);
      for (const childId of this.childIds.get(node.id) ?? []) {
        const child = this.nodesById.get(childId);
        if (child) walk(child);
      }
    };
    for (const root of this.roots) walk(root);
  }

  setFilterModel(filterModel: FilterModel | null): boolean {
    const before = JSON.stringify(this.filterModel);
    const columns = new Set(this.core.columnModel.getColumns().map((column) => column.id));
    this.filterModel = normalizeFilterModel(filterModel, columns);
    return JSON.stringify(this.filterModel) !== before;
  }

  getFilterModel(): FilterModel {
    return { ...this.filterModel };
  }

  setAdvancedFilterModel(model: AdvancedFilterModel | null | undefined): boolean {
    const columns = new Set(this.core.columnModel.getColumns().map((column) => column.id));
    const next = normalizeAdvancedFilterModel(model, columns);
    const before = JSON.stringify(this.advancedFilterModel);
    this.advancedFilterModel = next;
    this.core.options.advancedFilterModel = next;
    return JSON.stringify(next) !== before;
  }

  getAdvancedFilterModel(): AdvancedFilterModel | null {
    return normalizeAdvancedFilterModel(this.advancedFilterModel);
  }

  setQuickFilter(text: string | null | undefined): boolean {
    const next = text != null && text.trim() !== "" ? text : null;
    if (next === this.quickFilter) return false;
    this.quickFilter = next;
    return true;
  }

  getQuickFilter(): string | null {
    return this.quickFilter;
  }

  isFilterPresent(): boolean {
    return Object.keys(this.filterModel).length > 0 || this.advancedFilterModel != null || this.quickFilter != null;
  }

  refreshPipeline(): void {
    const startedAt = this.core.performanceMonitor.start();
    const columns = this.core.columnModel.getOrderedVisible();
    const getCellValue = (node: RowNode<any>, column: ColumnLike) => this.core.getCellValue(node, column);

    if (this.isInfinite) {
      this.refreshInfinitePipeline(startedAt);
      return;
    }

    if (this.startDataProcessorIfNeeded(startedAt)) return;

    let rows: RowNode<TData>[];

    if (this.isTree) {
      rows = this.buildTreeDisplay(columns, getCellValue);
    } else {
      rows = this.all;
      const filteringLocally = this.isFilterPresent() && !this.core.options.manualFiltering;
      if (filteringLocally) {
        rows = rows.filter((node) => doesNodePassFilters(
          node, columns, this.filterModel, this.advancedFilterModel, this.quickFilter, getCellValue
        ));
      }
      const sortModel = this.core.columnModel.getSortModel();
      if (sortModel.length > 0 && !this.core.options.manualSorting) {
        try {
          rows = sortNodes(rows, sortModel, columns, getCellValue);
        } catch (error) {
          this.core.reportError(error, "comparator", { sortModel });
        }
      }

      const groupCols = this.core.columnModel.getRowGroupColumns();
      if (groupCols.length > 0) {
        rows = this.buildGrouped(rows, groupCols);
      } else if (this.core.options.masterDetail) {
        const withDetails: RowNode<TData>[] = [];
        for (const node of rows) {
          withDetails.push(node);
          if (this.expandedIds.has(node.id) && this.isRowExpandable(node)) {
            withDetails.push({
              id: `__detail__${node.id}`,
              data: node.data,
              rowIndex: -1,
              selected: false,
              isDetail: true,
              masterId: node.id
            });
          }
        }
        rows = withDetails;
      }
    }

    for (const node of this.all) node.rowIndex = -1;

    let seq = 0;
    rows.forEach((node, index) => {
      node.rowIndex = index;
      if (!node.isDetail && !node.isGroup) {
        seq++;
        this.rowSequence.set(node, seq);
      }
    });
    this.pipelineRows = rows;
    this.applyPagination();

    this.computeSpans(getCellValue);
    this.core.emit("modelUpdated", { rowCount: rows.length });
    this.core.performanceMonitor.recordModel(startedAt);
  }

  private refreshInfinitePipeline(startedAt: number): void {
    this.all.forEach((node, index) => {
      if (!this.isBlockDatasource) node.rowIndex = index;
      this.rowSequence.set(node, this.isBlockDatasource ? node.rowIndex + 1 : index + 1);
    });
    this.displayed = this.all;
    this.pipelineRows = this.all;
    this.spanInfo.clear();
    this.displayRevision++;
    this.core.emit("modelUpdated", { rowCount: this.all.length });
    this.core.performanceMonitor.recordModel(startedAt);
  }

  private startDataProcessorIfNeeded(startedAt: number): boolean {
    const skipProcessor = this.skipDataProcessorOnce;
    this.skipDataProcessorOnce = false;
    if (!skipProcessor && this.shouldUseDataProcessor()) {
      this.refreshWithDataProcessor(startedAt);
      return true;
    }
    this.cancelDataProcessor();
    return false;
  }

  private shouldUseDataProcessor(): boolean {
    if (!this.core.options.dataProcessor || this.all.length < this.core.options.dataProcessorMinRows) return false;
    if (this.isTree || this.core.options.masterDetail || this.core.columnModel.getRowGroupColumns().length > 0) {
      return false;
    }
    const hasFilter = !this.core.options.manualFiltering && this.isFilterPresent();
    const hasSort = !this.core.options.manualSorting && this.core.columnModel.getSortModel().length > 0;
    return hasFilter || hasSort;
  }

  private refreshWithDataProcessor(startedAt: number): void {
    this.cancelDataProcessor();
    const processor = this.core.options.dataProcessor;
    if (!processor) return;
    const seq = ++this.dataProcessorSeq;
    const controller = new AbortController();
    this.dataProcessorAbort = controller;
    const columns = this.core.columnModel.getOrderedVisible();
    const rows = this.all.flatMap((node) => node.data == null ? [] : [{ id: node.id, data: node.data }]);
    const filterLocally = !this.core.options.manualFiltering;
    const sortLocally = !this.core.options.manualSorting;
    void Promise.resolve().then(() => processor.process({
      rows,
      columns: columns.map((column) => ({
        colId: column.id,
        ...(column.colDef.field ? { field: column.colDef.field } : {})
      })),
      sortModel: sortLocally ? this.core.columnModel.getSortModel() : [],
      filterModel: filterLocally ? this.getFilterModel() : {},
      advancedFilterModel: filterLocally ? this.getAdvancedFilterModel() : null,
      quickFilterText: filterLocally ? this.quickFilter : null,
      signal: controller.signal
    })).then((result) => {
      if (seq !== this.dataProcessorSeq || controller.signal.aborted || this.core.isDestroyed()) return;
      const seen = new Set<string>();
      const next: RowNode<TData>[] = [];
      for (const id of result.rowIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        const node = this.nodesById.get(id);
        if (node && !node.isDetail && !node.isGroup) next.push(node);
      }
      for (const node of this.all) node.rowIndex = -1;
      next.forEach((node, index) => {
        node.rowIndex = index;
        this.rowSequence.set(node, index + 1);
      });
      this.pipelineRows = next;
      this.applyPagination();
      const getCellValue = (node: RowNode<any>, column: ColumnLike) => this.core.getCellValue(node, column);
      this.computeSpans(getCellValue);
      this.core.emit("modelUpdated", { rowCount: next.length });
      this.core.performanceMonitor.recordModel(startedAt);
      this.core.requestUpdate({ data: true });
    }).catch((error) => {
      if (seq !== this.dataProcessorSeq || controller.signal.aborted || this.core.isDestroyed()) return;
      this.core.reportError(error, "dataProcessor.process");
      this.skipDataProcessorOnce = true;
      this.refreshPipeline();
      this.core.requestUpdate({ data: true });
    }).finally(() => {
      if (seq === this.dataProcessorSeq) this.dataProcessorAbort = null;
    });
  }

  private cancelDataProcessor(): void {
    this.dataProcessorSeq++;
    this.dataProcessorAbort?.abort();
    this.dataProcessorAbort = null;
  }

  private pipelineRows: RowNode<TData>[] = [];
  private page = 1;
  private pageSize = 20;

  get paginationActive(): boolean {
    return this.core.options.paginationEnabled && !this.isInfinite;
  }

  private applyPagination(): void {
    if (!this.paginationActive) {
      this.displayed = this.pipelineRows;
      this.displayRevision++;
      return;
    }
    const size = this.effectivePageSize();
    const pageCount = this.getPageCount();
    if (this.page > pageCount) this.page = pageCount;
    if (this.page < 1) this.page = 1;
    this.core.options.paginationPage = this.page;
    if (this.core.options.paginationMode === "server") {
      this.pipelineRows.forEach((node, index) => {
        node.rowIndex = index;
      });
      this.displayed = this.pipelineRows;
      this.displayRevision++;
      return;
    }
    const start = (this.page - 1) * size;
    const slice = this.pipelineRows.slice(start, start + size);
    slice.forEach((node, index) => {
      node.rowIndex = index;
    });
    this.displayed = slice;
    this.displayRevision++;
  }

  private effectivePageSize(): number {
    this.pageSize = this.core.options.paginationPageSize;
    return Math.max(1, this.pageSize);
  }

  getCurrentPage(): number {
    return this.paginationActive ? this.page : 1;
  }

  getTotalRowCount(): number {
    if (this.isInfinite) return this.getDisplayTotalCount();
    if (this.paginationActive && this.core.options.paginationMode === "server") {
      return this.core.options.paginationTotal;
    }
    return this.pipelineRows.length;
  }

  getPageCount(): number {
    if (!this.paginationActive) return 1;
    return Math.max(1, Math.ceil(this.getTotalRowCount() / this.effectivePageSize()));
  }

  getPipelineRows(): RowNode<TData>[] {
    return this.pipelineRows;
  }

  setPage(page: number, silent = false): void {
    if (!this.paginationActive) return;
    const pageCount = this.getPageCount();
    const next = Math.max(1, Math.min(Math.round(page) || 1, pageCount));
    if (next === this.page) return;
    this.page = next;
    this.core.options.paginationPage = next;
    this.applyPagination();
    this.core.requestUpdate({ data: true });
    this.core.bodyRenderer.scrollToIndex(0, "top");
    if (!silent) this.emitPaginationChanged();
  }

  setPageSize(size: number): void {
    if (!this.paginationActive) return;
    const next = Math.max(1, Math.round(size) || this.effectivePageSize());
    const firstVisible = (this.page - 1) * this.effectivePageSize();
    this.core.options.paginationPageSize = next;
    this.pageSize = next;
    this.page = Math.floor(firstVisible / next) + 1;
    this.core.options.paginationPage = this.page;
    this.applyPagination();
    this.core.requestUpdate({ data: true });
    this.emitPaginationChanged();
  }

  restorePagination(page: number, pageSize: number): void {
    this.pageSize = Math.max(1, Math.round(pageSize) || 1);
    this.core.options.paginationPageSize = this.pageSize;
    this.page = Math.max(1, Math.round(page) || 1);
    this.core.options.paginationPage = this.page;
  }

  setPaginationEnabled(enabled: boolean): void {
    if (this.core.options.paginationEnabled === enabled) return;
    this.core.options.paginationEnabled = enabled && !this.isInfinite;
    if (this.core.options.paginationEnabled) this.page = 1;
    this.applyPagination();
    this.core.requestUpdate({ data: true });
    this.emitPaginationChanged();
  }

  onPaginationOptionsChanged(): void {
    if (!this.paginationActive) return;
    this.page = this.core.options.paginationMode === "server"
      ? this.core.options.paginationPage
      : 1;
    this.applyPagination();
    this.core.requestUpdate({ data: true });
    this.emitPaginationChanged();
  }

  private emitPaginationChanged(): void {
    this.core.emit("paginationChanged", {
      page: this.getCurrentPage(),
      pageSize: this.effectivePageSize(),
      pageCount: this.getPageCount(),
      total: this.getTotalRowCount()
    });
  }

  private buildTreeDisplay(
    columns: ColumnLike[],
    getCellValue: (node: RowNode<any>, column: ColumnLike) => any
  ): RowNode<TData>[] {
    const sortModel = this.core.options.manualSorting ? [] : this.core.columnModel.getSortModel();
    const passCache = new Map<string, boolean>();
    const filterPresent = this.isFilterPresent() && !this.core.options.manualFiltering;

    const nodePasses = (node: RowNode<TData>): boolean => {
      const cached = passCache.get(node.id);
      if (cached !== undefined) return cached;
      let pass = true;
      if (filterPresent) {
        pass = doesNodePassFilters(
          node, columns, this.filterModel, this.advancedFilterModel, this.quickFilter, getCellValue
        );
        for (const childId of this.childIds.get(node.id) ?? []) {
          const child = this.nodesById.get(childId);
          if (child && nodePasses(child)) pass = true;
        }
      }
      passCache.set(node.id, pass);
      return pass;
    };

    const out: RowNode<TData>[] = [];
    const walk = (nodes: RowNode<TData>[]) => {
      let ordered = nodes;
      if (sortModel.length > 0) {
        ordered = sortNodes(nodes, sortModel, columns, getCellValue);
      }
      for (const node of ordered) {
        if (!nodePasses(node)) continue;
        out.push(node);
        if (this.expandedIds.has(node.id)) {
          const childNodes = (this.childIds.get(node.id) ?? [])
            .map((id) => this.nodesById.get(id))
            .filter((n): n is RowNode<TData> => n != null);
          walk(childNodes);
        }
      }
    };
    walk(this.roots);
    return out;
  }

  private computeSpans(getCellValue: (node: RowNode<any>, column: ColumnLike) => any): void {
    this.spanInfo.clear();
    if (this.isTree) return;
    if (this.core.options.masterDetail) return;
    if (this.core.columnModel.getRowGroupColumns().length > 0) return;

    const spanColumns = this.core.columnModel.getOrderedVisible().filter(
      (c) => c.colDef.rowSpan != null || c.colDef.autoRowSpan === true
    );
    if (spanColumns.length === 0) return;

    const masters = this.mastersBuf;
    let m = 0;
    for (const node of this.displayed) {
      if (!node.isDetail && !node.isGroup) masters[m++] = node;
    }
    masters.length = m;
    const n = m;
    if (n === 0) return;

    for (const col of spanColumns) {
      const arr = new Int32Array(n);
      let i = 0;
      while (i < n) {
        const node = masters[i];
        const value = getCellValue(node, col);
        let span = 1;
        if (col.colDef.rowSpan) {
          try {
            const out = col.colDef.rowSpan({
              api: this.core.getApi(),
              colDef: col.colDef,
              column: col,
              node,
              data: node.data,
              value,
              rowIndex: node.rowIndex
            });
            span = Math.max(1, Math.min(Math.round(out) || 1, n - i));
          } catch (error) {
            this.core.reportError(error, "rowSpan", { colId: col.id, rowId: node.id });
          }
        } else if (col.colDef.autoRowSpan) {
          while (
            i + span < n &&
            value != null &&
            value !== "" &&
            defaultComparator(value, getCellValue(masters[i + span], col)) === 0
          ) {
            span++;
          }
        }
        arr[i] = span;
        for (let k = 1; k < span; k++) arr[i + k] = -1;
        i += span;
      }
      this.spanInfo.set(col.id, arr);
    }
  }

  getSpanInfo(colId: string): Int32Array | undefined {
    return this.spanInfo.get(colId);
  }

  getRowSeq(node: RowNode<TData>): number {
    return this.rowSequence.get(node) ?? 0;
  }

  getTreeDepth(node: RowNode<TData>): number {
    return this.treeDepth.get(node) ?? 0;
  }

  private buildGrouped(rows: RowNode<TData>[], groupCols: ColumnLike[]): RowNode<TData>[] {
    const aggResolve = createAggResolver(this.core.options.aggFuncs);
    const aggCols = this.core.columnModel.getAggColumns();
    this.knownGroupIds = [];

    const computeAgg = (leaves: RowNode<TData>[]): Record<string, any> => {
      const values: Record<string, any> = {};
      for (const col of aggCols) {
        const fn = aggResolve(col.colDef.aggFunc!);
        if (!fn) continue;
        try {
          values[col.id] = fn(leaves.map((leaf) => this.core.getCellValue(leaf, col)));
        } catch (error) {
          this.core.reportError(error, "aggFunc", { colId: col.id, aggFunc: col.colDef.aggFunc });
          values[col.id] = null;
        }
      }
      return values;
    };

    const build = (
      nodes: RowNode<TData>[],
      level: number,
      parentPath: string
    ): { display: RowNode<TData>[]; leaves: RowNode<TData>[] } => {
      if (level >= groupCols.length) {
        return { display: nodes, leaves: nodes };
      }
      const col = groupCols[level];
      const groups = new Map<string, RowNode<TData>[]>();
      const order: string[] = [];
      for (const node of nodes) {
        const raw = this.core.getCellValue(node, col);
        const key = raw == null ? "(空)" : String(raw);
        let bucket = groups.get(key);
        if (!bucket) {
          bucket = [];
          groups.set(key, bucket);
          order.push(key);
        }
        bucket.push(node);
      }
      order.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

      const display: RowNode<TData>[] = [];
      const leaves: RowNode<TData>[] = [];
      for (const key of order) {
        const children = groups.get(key)!;
        const groupId = `${parentPath}/g${level}:${key}`;
        this.knownGroupIds.push(groupId);
        const child = build(children, level + 1, groupId);
        const groupNode: RowNode<TData> = {
          id: groupId,
          data: null,
          rowIndex: -1,
          selected: false,
          isGroup: true,
          groupLevel: level,
          groupKey: key,
          leafNodes: child.leaves,
          aggValues: computeAgg(child.leaves)
        };
        display.push(groupNode);
        if (this.groupExpandedIds.has(groupId)) {
          display.push(...child.display);
        }
        leaves.push(...child.leaves);
      }
      return { display, leaves };
    };

    return build(rows, 0, "").display;
  }

  isRowExpandable(node: RowNode<TData>): boolean {
    if (this.isTree) {
      if (this.hasChildren(node.id)) return true;
      if (node.treeLoading) return true;
      if (node.treeChildrenLoaded || !node.data || !this.core.options.loadTreeChildren) return false;
      const checkTree = this.core.options.isTreeRowExpandable;
      if (!checkTree) return false;
      try {
        return checkTree({ data: node.data, node, api: this.core.getApi() });
      } catch (error) {
        this.core.reportError(error, "isTreeRowExpandable", { rowId: node.id });
        return false;
      }
    }
    if (!this.core.options.masterDetail) return false;
    const check = this.core.options.isRowExpandable;
    if (check) {
      try {
        return check({ data: node.data, node, api: this.core.getApi() });
      } catch (error) {
        this.core.reportError(error, "isRowExpandable", { rowId: node.id });
        return false;
      }
    }
    return true;
  }

  isRowExpanded(id: string): boolean {
    return this.expandedIds.has(id);
  }

  getExpandedRowIds(): string[] {
    return [...this.expandedIds];
  }

  getExpandedGroupIds(): string[] {
    return [...this.groupExpandedIds];
  }

  restoreExpansion(rowIds: readonly string[], groupIds: readonly string[]): void {
    this.expandedIds = new Set(rowIds.filter((id) => this.nodesById.has(id)));
    this.groupExpandedIds = new Set(groupIds);
  }

  expandRow(id: string): boolean {
    return this.setDetailExpanded(id, true);
  }

  collapseRow(id: string): boolean {
    return this.setDetailExpanded(id, false);
  }

  toggleDetail(id: string): boolean {
    return this.setDetailExpanded(id, !this.expandedIds.has(id));
  }

  private setDetailExpanded(id: string, expanded: boolean): boolean {
    const node = this.nodesById.get(id);
    if (!node || (expanded && !this.isRowExpandable(node))) return false;
    if (expanded === this.expandedIds.has(id)) return expanded;
    if (expanded) this.expandedIds.add(id);
    else this.expandedIds.delete(id);
    this.refreshPipeline();
    this.core.requestUpdate({ data: true });
    this.core.emit("detailToggled", { rowId: id, rowNode: node, expanded });
    if (expanded && this.isTree && !this.hasChildren(id) && !node.treeLoading) {
      void this.loadTreeChildren(id).catch(() => undefined);
    }
    return expanded;
  }

  expandAllDetails(): void {
    let changed = false;
    for (const node of this.all) {
      if (!this.expandedIds.has(node.id) && this.isRowExpandable(node)) {
        this.expandedIds.add(node.id);
        changed = true;
      }
    }
    if (changed) {
      this.refreshPipeline();
      this.core.requestUpdate({ data: true });
    }
  }

  collapseAllDetails(): void {
    if (this.expandedIds.size === 0) return;
    this.expandedIds.clear();
    this.refreshPipeline();
    this.core.requestUpdate({ data: true });
  }

  toggleGroup(groupId: string): boolean {
    return this.setGroupExpanded(groupId, !this.groupExpandedIds.has(groupId));
  }

  isGroupExpanded(groupId: string): boolean {
    return this.groupExpandedIds.has(groupId);
  }

  getGroupNode(groupId: string): RowNode<TData> | undefined {
    return this.displayed.find((n) => n.isGroup && n.id === groupId);
  }

  expandAllGroups(): void {
    if (this.knownGroupIds.length === 0) return;
    let changed = false;
    for (const id of this.knownGroupIds) {
      if (!this.groupExpandedIds.has(id)) {
        this.groupExpandedIds.add(id);
        changed = true;
      }
    }
    if (changed) {
      this.refreshPipeline();
      this.core.requestUpdate({ data: true });
    }
  }

  collapseAllGroups(): void {
    if (this.groupExpandedIds.size === 0) return;
    this.groupExpandedIds.clear();
    this.refreshPipeline();
    this.core.requestUpdate({ data: true });
  }

  private setGroupExpanded(groupId: string, expanded: boolean): boolean {
    if (!this.knownGroupIds.includes(groupId)) return expanded;
    if (expanded === this.groupExpandedIds.has(groupId)) return expanded;
    if (expanded) this.groupExpandedIds.add(groupId);
    else this.groupExpandedIds.delete(groupId);
    this.refreshPipeline();
    this.core.requestUpdate({ data: true });
    return expanded;
  }

  reorderRowsByDisplayed(fromIndex: number, toIndex: number): boolean {
    if (this.isTree) return false;
    const fromNode = this.getDisplayedRow(fromIndex);
    const toNode = this.getDisplayedRow(toIndex);
    if (!fromNode || !toNode || fromNode.isDetail || toNode.isDetail || fromNode.isGroup || toNode.isGroup) return false;

    const fromAllIdx = this.all.indexOf(fromNode);
    let toAllIdx = this.all.indexOf(toNode);
    if (fromAllIdx < 0 || toAllIdx < 0) return false;
    if (toAllIdx > fromAllIdx) {
      let idx = toAllIdx;
      while (idx + 1 < this.all.length && this.all[idx + 1].isDetail) idx++;
      toAllIdx = idx;
    }
    if (fromAllIdx === toAllIdx) return false;

    this.all.splice(fromAllIdx, 1);
    const insertAt = this.all.indexOf(toNode);
    this.all.splice(toAllIdx > fromAllIdx ? insertAt + 1 : insertAt, 0, fromNode);
    this.refreshPipeline();
    this.core.requestUpdate({ data: true });
    return true;
  }

  getAllNodes(): RowNode<TData>[] {
    return this.all;
  }

  getRootNodes(): RowNode<TData>[] {
    return this.roots;
  }

  getDisplayedRows(): RowNode<TData>[] {
    return this.displayed;
  }

  getDisplayedRowCount(): number {
    return this.isBlockDatasource ? this.resolveBlockRowCount() : this.displayed.length;
  }

  getDisplayedRow(index: number): RowNode<TData> | undefined {
    if (this.isBlockDatasource) {
      if (index < 0 || index >= this.resolveBlockRowCount()) return undefined;
      return this.blockNodes.get(index) ?? this.blockPlaceholder(index);
    }
    return this.displayed[index];
  }

  getNodeById(id: string): RowNode<TData> | undefined {
    return this.nodesById.get(id);
  }

  forEachNode(callback: (node: RowNode<TData>, index: number) => void): void {
    this.all.forEach(callback);
  }

  forEachNodeAfterFilterAndSort(callback: (node: RowNode<TData>, index: number) => void): void {
    let index = 0;
    for (const node of this.pipelineRows) {
      if (node.isDetail || node.isGroup) continue;
      callback(node, index++);
    }
  }
}
