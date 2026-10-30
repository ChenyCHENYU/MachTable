import type { GridCore } from "../core/gridCore";
import { createAbortError } from "../lib/abortable";
import type { RowNode } from "../types/row";
import type { FilterModel } from "../types/colDef";
import type { AdvancedFilterModel } from "../types/advancedFilter";
import type { RowTransaction } from "../types/api";
import { createRowFilter } from "./filterService";
import { sortNodes } from "./sortService";
import { aggregateItems, createAggResolver } from "../lib/aggregate";
import { buildRowGroups, migrateGroupExpansion } from "../lib/rowGrouping";
import { captureProjectionValues, projectionFields, projectionFieldsChanged } from "../lib/projectionDependencies";
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
  | "cancelPendingInput"
  | "changeTracker"
  | "columnModel"
  | "editingService"
  | "emit"
  | "api"
  | "readCellValue"
  | "getLocaleText"
  | "headerRenderer"
  | "isDisposed"
  | "nextId"
  | "gridOptions"
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

export interface RowTransactionImpact {
  /** True when ordering, membership, grouping, spans or row geometry may have changed. */
  pipelineChanged: boolean;
  /** Stable IDs whose data references were replaced. */
  updatedRowIds: readonly string[];
}

interface RowReplacement<T> { node: RowNode<T>; before: T | null; after: T }

/** @internal Consumers receive plain RowNode records, not this model service. */
export class RowModel<TData = any> {
  private loadedRowNodes: RowNode<TData>[] = [];
  private roots: RowNode<TData>[] = [];
  private childIds = new Map<string, string[]>();
  private displayedRowNodes: RowNode<TData>[] = [];
  private nodesById = new Map<string, RowNode<TData>>();
  private activeColumnFilters: FilterModel = {};
  private activeAdvancedFilters: AdvancedFilterModel | null = null;
  private activeQuickFilterText: string | null = null;
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
  private infinitePendingResolve: (() => void) | null = null;
  private treeDepth = new WeakMap<RowNode<TData>, number>();
  private rowSequence = new WeakMap<RowNode<TData>, number>();
  private treeLoadControllers = new Map<string, AbortController>();
  private treeLoadPromises = new Map<string, Promise<readonly TData[]>>();
  private displayRevision = 0;
  private dataRevision = 0;
  /** Scalar dependencies of the last completed projection, never snapshots of application records/getters. */
  private projectionBaseline: { fields: readonly string[]; values: WeakMap<RowNode<TData>, readonly unknown[]> } | null = null;
  private blockNodes = new Map<number, RowNode<TData>>();
  private blockPlaceholders = new Map<number, RowNode<TData>>();
  private installedBlocks = new Set<number>();
  /** Sparse user changes survive block eviction without pinning whole blocks. */
  private retainedBlockNodes = new Map<string, RowNode<TData>>();
  private blockCache = new RemoteBlockCache<TData>(12, (blockIndex) => this.evictBlock(blockIndex));
  private dataProcessorSeq = 0;
  private dataProcessorAbort: AbortController | null = null;
  private skipDataProcessorOnce = false;
  private lastRequestedBlock = 0;

  constructor(private core: RowModelContext) {
    this.activeAdvancedFilters = normalizeAdvancedFilterModel(core.gridOptions.advancedFilterModel);
  }

  resolveRowId(data: TData, index: number, fallback: string): string {
    const resolveRowId = this.core.gridOptions.resolveRowId;
    if (!resolveRowId) return fallback;
    try {
      const id = resolveRowId({ data, index, api: this.core.api });
      if (typeof id === "string" && id.length > 0) return id;
      this.core.reportError(new Error("rowKey must resolve to a non-empty identifier"), "rowKey", { index });
    } catch (error) {
      this.core.reportError(error, "rowKey", { index });
    }
    return fallback;
  }

  get isTree(): boolean {
    return this.core.gridOptions.treeData;
  }

  get isInfinite(): boolean {
    return this.core.gridOptions.datasource != null;
  }

  get isBlockDatasource(): boolean {
    return this.isInfinite && this.core.gridOptions.datasourceMode === "block";
  }

  getDisplayTotalCount(): number {
    if (this.isInfinite) {
      if (this.isBlockDatasource) return this.resolveBlockRowCount();
      const detailRows = Math.max(0, this.displayedRowNodes.length - this.loadedRowNodes.length);
      return (this.infiniteLastRow ?? this.loadedRowNodes.length) + detailRows;
    }
    return this.displayedRowNodes.length;
  }

  getDisplayRevision(): number { return this.displayRevision; }

  /** Full data replacements invalidate asynchronous saves, not ordinary cache churn. */
  getDataRevision(): number { return this.dataRevision; }

  isLoadingInfinite(): boolean {
    return this.infiniteLoading;
  }

  startInfinite(signal?: AbortSignal): Promise<void> {
    if (!this.isInfinite) return Promise.resolve();
    if (signal?.aborted) return Promise.resolve();
    this.dataRevision++;
    // Reload/filter/sort replace the datasource scope, just like setRowData.
    this.core.cancelPendingInput();
    void this.core.api.editing.stop({ cancel: true });
    this.core.changeTracker.clear();
    this.cancelInfiniteRequest();
    this.infiniteLastRow = null;
    this.infiniteRequested = false;
    this.loadedRowNodes = [];
    this.roots = [];
    this.nodesById.clear();
    this.expandedIds.clear();
    this.core.undoService.clear();
    this.refreshPipeline();
    this.core.requestUpdate({ data: true });
    if (this.isBlockDatasource) {
      this.blockCache.configure(
        this.core.gridOptions.maxBlocksInCache,
        this.core.gridOptions.datasourceMaxConcurrentRequests
      );
      return this.loadRandomBlock(0, signal);
    }
    return this.loadBlock(0, undefined, signal);
  }

  private setInfiniteLoading(v: boolean): void {
    this.infiniteLoading = v;
    this.core.skeleton.setInfiniteLoading(v, this.core.getLocaleText("loading"));
  }

  private loadBlock(start: number, end?: number, externalSignal?: AbortSignal): Promise<void> {
    if (!this.isInfinite || this.infiniteRequested) return Promise.resolve();
    if (this.infiniteLastRow != null && start >= this.infiniteLastRow) return Promise.resolve();
    const blockSize = this.core.gridOptions.blockSize;
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

      this.runDatasourceRequest(start, stop, controller.signal, (received, lastRow) => {
        if (seq !== this.infiniteSeq || this.core.isDisposed() || controller.signal.aborted) {
          done();
          return;
        }
        if (typeof lastRow === "number" && lastRow >= 0) {
          this.infiniteLastRow = lastRow;
        } else if (received.length < stop - start) {
          this.infiniteLastRow = start + received.length;
        }
        const wasEmpty = this.loadedRowNodes.length === 0;
        this.appendInfiniteRows(received);
        done();
        this.refreshPipeline();
        this.core.requestUpdate({ data: true });
        if (wasEmpty) this.core.relayout();
        this.core.headerRenderer.refreshSelectAllCheckbox();
      }, reason => done(controller.signal.aborted || this.core.isDisposed()
        ? undefined : reason ?? new Error("Datasource request failed")));
    });
  }

  private cancelInfiniteRequest(): void {
    this.infiniteSeq++;
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
    for (const [id, node] of this.retainedBlockNodes) {
      if (this.nodesById.get(id) === node) this.nodesById.delete(id);
    }
    this.retainedBlockNodes.clear();
  }

  private appendInfiniteRows(rows: TData[]): void {
    for (const data of rows) {
      if (data == null) continue;
      const index = this.loadedRowNodes.length;
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
      this.loadedRowNodes.push(node);
      this.nodesById.set(id, node);
      this.roots.push(node);
    }
  }

  private loadRandomBlock(blockIndex: number, externalSignal?: AbortSignal, priority = 0): Promise<void> {
    if (!this.isBlockDatasource || blockIndex < 0) return Promise.resolve();
    if (externalSignal?.aborted) return Promise.reject(this.abortError(externalSignal.reason));
    const blockSize = this.core.gridOptions.blockSize;
    const seq = this.infiniteSeq;
    const start = blockIndex * blockSize;
    if (start >= this.resolveBlockRowCount()) return Promise.resolve();
    const stop = this.infiniteLastRow == null
      ? start + blockSize
      : Math.min(this.infiniteLastRow, start + blockSize);
    const request = this.blockCache.load(
      blockIndex,
      (signal) => this.requestDatasourceRange(start, stop, signal),
      externalSignal,
      priority
    );
    this.setInfiniteLoading(this.loadedRowNodes.length === 0 && this.blockCache.snapshot().loadingBlockCount > 0);
    return request.then((result) => {
      if (seq !== this.infiniteSeq || externalSignal?.aborted || this.core.isDisposed() ||
        !this.isBlockDatasource || !this.blockCache.has(blockIndex)) return;
      if (this.installedBlocks.has(blockIndex)) return;
      this.installBlock(blockIndex, result);
      this.refreshPipeline();
      this.core.requestUpdate({ data: true });
      this.core.headerRenderer.refreshSelectAllCheckbox();
      // A small block may not fill the first viewport; seed its remaining
      // visible blocks without requiring an initial user scroll.
      if (seq === this.infiniteSeq && !this.core.isDisposed()) {
        this.prefetchVisibleBlocks(this.core.bodyRenderer.getRenderedRowRange().lastExcl - 1);
      }
    }).catch((error) => {
      if ((error as { name?: string })?.name !== "AbortError") {
        this.core.reportError(error, "datasource.getRows", { startRow: start, endRow: stop });
      }
      throw error;
    }).finally(() => {
      if (seq === this.infiniteSeq) {
        this.setInfiniteLoading(this.loadedRowNodes.length === 0 && this.blockCache.snapshot().loadingBlockCount > 0);
      }
    });
  }

  private requestDatasourceRange(
    startRow: number,
    endRow: number,
    signal: AbortSignal
  ): Promise<RemoteBlockResult<TData>> {
    return new Promise((resolve, reject) => {
      this.runDatasourceRequest(startRow, endRow, signal, (rows, lastRow) => resolve({
        rows,
        ...(typeof lastRow === "number" && lastRow >= 0 ? { lastRow } : {})
      }), reason => reject(reason instanceof Error ? reason : new Error(
        typeof reason === "string" ? reason : "Datasource request failed"
      )));
    });
  }

  /** Callback delivery keeps sequential synchronous installation in the current stack. */
  private runDatasourceRequest(
    startRow: number,
    endRow: number,
    signal: AbortSignal,
    onSuccess: (rows: TData[], lastRow?: number) => void,
    onFailure: (reason?: unknown) => void
  ): void {
    const datasource = this.core.gridOptions.datasource!;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (retryTimer != null) clearTimeout(retryTimer);
      signal.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => finish(() => onFailure(this.abortError(signal.reason)));
    signal.addEventListener("abort", abort, { once: true });

    const runAttempt = () => {
      if (settled) return;
      if (signal.aborted || this.core.isDisposed()) {
        abort();
        return;
      }
      attempt++;
      let attemptSettled = false;
      const failAttempt = (reason?: unknown) => {
        if (attemptSettled || settled) return;
        attemptSettled = true;
        if (signal.aborted || this.core.isDisposed()) {
          abort();
          return;
        }
        if (attempt <= this.core.gridOptions.datasourceRetryCount) {
          retryTimer = setTimeout(runAttempt, this.retryDelay(attempt));
        } else {
          finish(() => onFailure(reason));
        }
      };
      try {
        const response = datasource.getRows({
          startRow,
          endRow,
          sortModel: this.core.columnModel.getSortModel(),
          filterModel: this.getFilterModel(),
          advancedFilterModel: this.getAdvancedFilterModel(),
          quickFilterText: this.activeQuickFilterText,
          signal,
          onSuccess: (rows, lastRow) => {
            if (attemptSettled || settled) return;
            attemptSettled = true;
            finish(() => onSuccess(rows ?? [], lastRow));
          },
          fail: failAttempt
        });
        if (response && typeof response.catch === "function") void response.catch(failAttempt);
      } catch (error) {
        failAttempt(error);
      }
    };
    runAttempt();
  }

  private installBlock(blockIndex: number, result: RemoteBlockResult<TData>): void {
    const blockSize = this.core.gridOptions.blockSize;
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
      const retained = this.retainedBlockNodes.get(id);
      const duplicate = this.nodesById.get(id);
      if (duplicate && duplicate !== retained && duplicate.rowIndex !== absoluteIndex) {
        this.core.reportError(new Error(`Duplicate row id: ${id}`), "datasource.getRows", { rowId: id });
        return;
      }
      const node: RowNode<TData> = retained ?? {
        id,
        data,
        rowIndex: absoluteIndex,
        selected: this.core.selectionService.isSelected(id)
      };
      node.rowIndex = absoluteIndex;
      node.selected = this.core.selectionService.isSelected(id);
      this.retainedBlockNodes.delete(id);
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
    const blockSize = this.core.gridOptions.blockSize;
    const start = blockIndex * blockSize;
    let dirty: Set<string> | undefined;
    for (let index = start; index < start + blockSize; index++) {
      const node = this.blockNodes.get(index);
      if (!node) continue;
      dirty ??= new Set(this.core.changeTracker.getDirtyRowIds());
      this.blockNodes.delete(index);
      if (dirty.has(node.id)) this.retainedBlockNodes.set(node.id, node);
      else if (this.nodesById.get(node.id) === node) this.nodesById.delete(node.id);
    }
    this.rebuildLoadedBlockRows();
  }

  private rebuildLoadedBlockRows(): void {
    this.loadedRowNodes = [...this.blockNodes.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, node]) => node);
    this.roots = this.loadedRowNodes;
  }

  private resolveBlockRowCount(): number {
    if (this.infiniteLastRow != null) return this.infiniteLastRow;
    if (this.core.gridOptions.datasourceRowCount != null) return this.core.gridOptions.datasourceRowCount;
    if (this.blockNodes.size === 0) return this.core.gridOptions.blockSize;
    let greatest = 0;
    for (const index of this.blockNodes.keys()) greatest = Math.max(greatest, index + 1);
    return greatest + this.core.gridOptions.blockSize;
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
    return createAbortError(reason, "Operation aborted");
  }

  private retryDelay(attempt: number): number {
    const base = Math.min(
      this.core.gridOptions.datasourceRetryDelay * 2 ** Math.max(0, attempt - 1),
      30_000
    );
    const jitter = this.core.gridOptions.datasourceRetryJitter;
    return Math.max(0, Math.round(base * (1 + (Math.random() * 2 - 1) * jitter)));
  }

  checkInfiniteScroll(lastVisibleIndex: number): void {
    if (this.isBlockDatasource) {
      this.prefetchVisibleBlocks(lastVisibleIndex);
      return;
    }
    if (!this.isInfinite || this.infiniteRequested) return;
    const loaded = this.loadedRowNodes.length;
    if (this.infiniteLastRow != null && loaded >= this.infiniteLastRow) return;
    const buffer = this.core.gridOptions.infiniteBufferRows;
    if (lastVisibleIndex + buffer < loaded && lastVisibleIndex < loaded) return;
    const blockSize = this.core.gridOptions.blockSize;
    const stop = this.infiniteLastRow == null
      ? loaded + blockSize
      : Math.min(this.infiniteLastRow, loaded + blockSize);
    void this.loadBlock(loaded, stop);
  }

  private prefetchVisibleBlocks(lastVisibleIndex: number): void {
    if (lastVisibleIndex < 0) return;
    this.maintainBlockCache();
    const blockSize = this.core.gridOptions.blockSize;
    const target = Math.floor(lastVisibleIndex / blockSize);
    const first = Math.floor(this.core.bodyRenderer.getRenderedRowRange().first / blockSize);
    const radius = this.core.gridOptions.blockPrefetch;
    const direction = target < this.lastRequestedBlock ? -1 : 1;
    this.lastRequestedBlock = target;
    for (let block = first; block < target; block++) {
      void this.loadRandomBlock(block, undefined, radius + 2).catch(() => undefined);
    }
    for (let distance = 0; distance <= radius; distance++) {
      const candidates = distance === 0
        ? [target]
        : [target + direction * distance, target - direction * distance];
      for (const blockIndex of candidates) {
        if (blockIndex < 0 || blockIndex * blockSize >= this.resolveBlockRowCount()) continue;
        void this.loadRandomBlock(blockIndex, undefined, radius - distance + 1).catch(() => undefined);
      }
    }
  }

  onServerParamsChanged(): Promise<void> {
    return this.startInfinite().catch(() => undefined);
  }

  onDatasourceChanged(): Promise<void> {
    this.cancelInfiniteRequest();
    if (this.isInfinite) return this.startInfinite().catch(() => undefined);
    this.infiniteLastRow = null;
    this.setRowData(this.core.gridOptions.rowData);
    this.core.requestUpdate({ data: true });
    return Promise.resolve();
  }

  destroy(): void {
    this.projectionBaseline = null;
    this.cancelInfiniteRequest();
    this.cancelTreeLoads();
    this.cancelDataProcessor();
    this.loadedRowNodes = this.roots = this.displayedRowNodes = this.pipelineRows = [];
    this.nodesById.clear();
    this.childIds.clear();
    this.spanInfo.clear();
    this.mastersBuf = [];
    this.expandedIds.clear();
    this.groupExpandedIds.clear();
    this.knownGroupIds = [];
  }

  ensureRowsLoaded(startRow: number, endRow: number, signal?: AbortSignal): Promise<void> {
    if (!this.isBlockDatasource) return Promise.resolve();
    this.maintainBlockCache();
    const blockSize = this.core.gridOptions.blockSize;
    const start = Math.max(0, Math.trunc(startRow));
    const end = Math.min(this.resolveBlockRowCount(), Math.max(start, Math.trunc(endRow)));
    const firstBlock = Math.floor(start / blockSize);
    const lastBlock = Math.max(firstBlock, Math.floor(Math.max(start, end - 1) / blockSize));
    const requests: Promise<void>[] = [];
    for (let block = firstBlock; block <= lastBlock; block++) {
      requests.push(this.loadRandomBlock(block, signal, 100));
    }
    return Promise.all(requests).then(() => undefined);
  }

  purgeDatasourceCache(): void {
    if (!this.isBlockDatasource) return;
    this.dataRevision++;
    this.core.cancelPendingInput();
    void this.core.api.editing.stop({ cancel: true });
    this.core.changeTracker.clear();
    this.cancelInfiniteRequest();
    this.core.undoService.clear();
    this.loadedRowNodes = [];
    this.roots = [];
    this.nodesById.clear();
    this.refreshPipeline();
    this.core.requestUpdate({ data: true });
  }

  getDatasourceCacheSnapshot(): RemoteBlockCacheSnapshot {
    return this.blockCache.snapshot();
  }

  /** Keep operation state bounded by the render window, not by query history. */
  private maintainBlockCache(): void {
    const dirty = new Set(this.core.changeTracker.getDirtyRowIds());
    for (const [id, node] of this.retainedBlockNodes) {
      if (dirty.has(id)) continue;
      this.retainedBlockNodes.delete(id);
      if (this.nodesById.get(id) === node) this.nodesById.delete(id);
    }
    const blockSize = this.core.gridOptions.blockSize;
    const retained = new Set<number>();
    const { first, lastExcl } = this.core.bodyRenderer.getRenderedRowRange();
    for (let row = first; row < lastExcl; row += blockSize) retained.add(Math.floor(row / blockSize));
    if (lastExcl > first) retained.add(Math.floor((lastExcl - 1) / blockSize));
    const focus = this.core.bodyRenderer.focusedCell;
    if (focus) retained.add(Math.floor(focus.rowIndex / blockSize));
    const editingRow = this.core.editingService.getEditingRowIndex();
    if (editingRow != null) retained.add(Math.floor(editingRow / blockSize));
    this.blockCache.retain(retained);
  }

  setRowData(rows: TData[] | null | undefined): void {
    this.dataRevision++;
    this.core.cancelPendingInput();
    void this.core.api.editing.stop({ cancel: true });
    this.cancelTreeLoads();
    this.core.changeTracker.clear();
    const resolveRowId = this.core.gridOptions.resolveRowId;
    const childrenKey = this.core.gridOptions.childrenKey;
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

    this.loadedRowNodes = next;
    this.roots = roots;
    this.childIds = childIds;
    this.nodesById = byId;
    this.core.undoService.clear();
    for (const id of [...this.expandedIds]) {
      if (!byId.has(id)) this.expandedIds.delete(id);
    }
    if (this.core.gridOptions.defaultExpandAll) {
      for (const node of next) {
        if (this.getChildrenCount(node.id) > 0) this.expandedIds.add(node.id);
      }
    }

    this.core.selectionService.onRowsRebuilt(resolveRowId != null);
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
    const loader = this.core.gridOptions.loadTreeChildren;
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
      api: this.core.api,
      signal: controller.signal
    })).then((children) => {
      if (controller.signal.aborted || this.core.isDisposed()) return [];
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
    this.core.selectionService.onRowsRebuilt(this.core.gridOptions.resolveRowId != null);
    this.refreshPipeline();
    this.core.requestUpdate({ data: true });
  }

  private validateTreeChildren(children: readonly TData[], replacedIds: ReadonlySet<string>): void {
    const resolveRowId = this.core.gridOptions.resolveRowId;
    const reserved = resolveRowId
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
      if (resolveRowId && reserved) {
        const id = resolveRowId({ data, index: index++, api: this.core.api });
        if (typeof id !== "string" || id.length === 0) {
          throw new TypeError("[MachTable] rowKey must resolve to a non-empty identifier for lazy tree children.");
        }
        if (reserved.has(id)) throw new Error(`Duplicate row id: ${id}`);
        reserved.add(id);
      }
      const nested = readChildren(data, this.core.gridOptions.childrenKey);
      if (nested) stack.push(...nested as TData[]);
    }
  }

  applyTransaction(transaction: RowTransaction<TData>, refresh = true): RowTransactionImpact {
    const resolveRowId = this.core.gridOptions.resolveRowId;
    const touched: RowNode<TData>[] = [];
    const replacements: RowReplacement<TData>[] = [];
    const externallyReplacedIds: string[] = [];

    if (transaction.remove?.length) {
      const removeIds = new Set<string>();
      const removeRefs = new Set<TData>();
      const collect = (data: TData) => {
        if (resolveRowId) {
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
            const kids = this.isTree ? readChildren(cur, this.core.gridOptions.childrenKey) : undefined;
            if (kids) {
              for (const kid of kids) stack.push(kid as TData);
            }
          }
        }
      };
      transaction.remove.forEach(collect);
      this.loadedRowNodes = this.loadedRowNodes.filter((node) => {
        const drop = removeIds.has(node.id) || (node.data != null && removeRefs.has(node.data));
        if (drop) {
          externallyReplacedIds.push(node.id);
          this.nodesById.delete(node.id);
          this.childIds.delete(node.id);
        }
        return !drop;
      });
      const remaining = new Set(this.loadedRowNodes);
      this.roots = this.roots.filter((node) => remaining.has(node));
    }

    if (transaction.update?.length) {
      for (const data of transaction.update) {
        let node: RowNode<TData> | undefined;
        if (resolveRowId) {
          node = this.nodesById.get(this.resolveRowId(data, -1, `__missing_update_${this.core.nextId()}`));
        } else {
          node = this.loadedRowNodes.find((n) => n.data === data);
        }
        if (node) {
          replacements.push({ node, before: node.data, after: data });
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
        const children = this.isTree ? readChildren(data, this.core.gridOptions.childrenKey) : undefined;
        if (children) {
          for (const child of children) {
            if (child != null) this.buildChildNodes(node, child as TData, 1);
          }
        }
        added.push(node);
      });
      this.roots = this.roots.slice(0, startIndex).concat(added, this.roots.slice(startIndex));
      this.reindexAll();
    }

    const impact = { pipelineChanged: this.transactionNeedsPipeline(transaction, replacements), updatedRowIds: touched.map((node) => node.id) };
    this.refreshTransaction(impact, refresh);
    this.core.changeTracker.clearRows(externallyReplacedIds);
    return impact;
  }

  private refreshTransaction(impact: RowTransactionImpact, refresh: boolean): void {
    if (impact.pipelineChanged) this.projectionBaseline = null;
    if (!refresh) return;
    if (impact.pipelineChanged) this.refreshPipeline();
    else if (impact.updatedRowIds.length) this.emitIncrementalModelUpdate();
  }

  applyTransactions(transactions: readonly RowTransaction<TData>[]): RowTransactionImpact {
    if (transactions.length === 0) return { pipelineChanged: false, updatedRowIds: [] };
    let pipelineChanged = false;
    const updatedRowIds = new Set<string>();
    for (const transaction of transactions) {
      const impact = this.applyTransaction(transaction, false);
      pipelineChanged ||= impact.pipelineChanged;
      for (const id of impact.updatedRowIds) updatedRowIds.add(id);
    }
    if (pipelineChanged) this.refreshPipeline();
    else if (updatedRowIds.size > 0) this.emitIncrementalModelUpdate();
    return { pipelineChanged, updatedRowIds: [...updatedRowIds] };
  }

  private transactionNeedsPipeline(transaction: RowTransaction<TData>, replacements: readonly RowReplacement<TData>[]): boolean {
    if (transaction.add?.length || transaction.remove?.length) return true;
    if (!replacements.length) return false;
    const fields = this.getProjectionFields();
    if (fields === null) return true;
    if (!fields.length) return false;
    const baseline = this.projectionBaseline;
    if (!baseline || fields.length !== baseline.fields.length || fields.some((field, index) => field !== baseline.fields[index])) return true;
    return replacements.some(({ node, before, after }) => projectionFieldsChanged(before, after, fields, baseline.values.get(node)));
  }

  private getProjectionFields(): string[] | null {
    if (this.isTree || this.core.gridOptions.masterDetail || this.core.gridOptions.getRowHeight || this.shouldUseDataProcessor()) return null;
    const columns = this.core.columnModel.getOrderedVisible();
    if (columns.some((column) =>
      column.colDef.autoHeight === true || column.colDef.autoRowSpan === true || column.colDef.rowSpan != null
    )) return null;
    const filtering = !this.core.gridOptions.manualFiltering;
    return projectionFields({ columns, customAggregates: this.core.gridOptions.aggFuncs,
      sortModel: this.core.gridOptions.manualSorting ? [] : this.core.columnModel.getSortModel(),
      filterModel: filtering ? this.activeColumnFilters : {}, advancedFilter: filtering ? this.activeAdvancedFilters : null,
      quickFilter: filtering ? this.activeQuickFilterText : null });
  }

  private captureProjectionBaseline(): void {
    const fields = this.getProjectionFields();
    this.projectionBaseline = fields?.length ? { fields, values: captureProjectionValues(this.loadedRowNodes, fields) } : null;
  }

  private emitIncrementalModelUpdate(): void {
    this.core.emit("modelUpdated", { rowCount: this.pipelineRows.length });
  }

  private buildChildNodes(parent: RowNode<TData>, data: TData, depth: number): void {
    const id = this.resolveRowId(data, -1, `add-${this.core.nextId()}`);
    if (this.nodesById.has(id)) {
      this.core.reportError(new Error(`Duplicate row id: ${id}`), "transaction.add", { rowId: id });
      return;
    }
    const children = readChildren(data, this.core.gridOptions.childrenKey);
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
    this.loadedRowNodes = [];
    const walk = (node: RowNode<TData>) => {
      this.loadedRowNodes.push(node);
      if (!this.nodesById.has(node.id)) this.nodesById.set(node.id, node);
      for (const childId of this.childIds.get(node.id) ?? []) {
        const child = this.nodesById.get(childId);
        if (child) walk(child);
      }
    };
    for (const root of this.roots) walk(root);
  }

  setFilterModel(filterModel: FilterModel | null): boolean {
    const before = JSON.stringify(this.activeColumnFilters);
    const columns = new Set(this.core.columnModel.getColumns().map((column) => column.id));
    this.activeColumnFilters = normalizeFilterModel(filterModel, columns);
    const changed = JSON.stringify(this.activeColumnFilters) !== before;
    if (changed) this.projectionBaseline = null;
    return changed;
  }

  getFilterModel(): FilterModel {
    return { ...this.activeColumnFilters };
  }

  setAdvancedFilterModel(model: AdvancedFilterModel | null | undefined): boolean {
    const columns = new Set(this.core.columnModel.getColumns().map((column) => column.id));
    const next = normalizeAdvancedFilterModel(model, columns);
    const before = JSON.stringify(this.activeAdvancedFilters);
    this.activeAdvancedFilters = next;
    this.core.gridOptions.advancedFilterModel = next;
    const changed = JSON.stringify(next) !== before;
    if (changed) this.projectionBaseline = null;
    return changed;
  }

  getAdvancedFilterModel(): AdvancedFilterModel | null {
    return normalizeAdvancedFilterModel(this.activeAdvancedFilters);
  }

  setQuickFilter(text: string | null | undefined): boolean {
    const next = text != null && text.trim() !== "" ? text : null;
    if (next === this.activeQuickFilterText) return false;
    this.activeQuickFilterText = next;
    this.projectionBaseline = null;
    return true;
  }

  getQuickFilter(): string | null {
    return this.activeQuickFilterText;
  }

  isFilterPresent(): boolean {
    return Object.keys(this.activeColumnFilters).length > 0 || this.activeAdvancedFilters != null || this.activeQuickFilterText != null;
  }

  refreshPipeline(): void {
    this.projectionBaseline = null;
    const startedAt = this.core.performanceMonitor.start();
    const columns = this.core.columnModel.getOrderedVisible();
    const getCellValue = (node: RowNode<any>, column: ColumnLike) => this.core.readCellValue(node, column);

    if (this.isInfinite) {
      this.refreshInfinitePipeline(startedAt);
      return;
    }

    if (this.startDataProcessorIfNeeded(startedAt)) return;

    let rows: RowNode<TData>[];
    let ambiguousExpansions: string[] = [];

    if (this.isTree) {
      rows = this.buildTreeDisplay(columns, getCellValue);
    } else {
      rows = this.loadedRowNodes;
      const filteringLocally = this.isFilterPresent() && !this.core.gridOptions.manualFiltering;
      if (filteringLocally) {
        rows = rows.filter(createRowFilter(
          columns, this.activeColumnFilters, this.activeAdvancedFilters, this.activeQuickFilterText, getCellValue
        ));
      }
      const sortModel = this.core.columnModel.getSortModel();
      if (sortModel.length > 0 && !this.core.gridOptions.manualSorting) {
        try {
          rows = sortNodes(rows, sortModel, columns, getCellValue);
        } catch (error) {
          this.core.reportError(error, "comparator", { sortModel });
        }
      }

      const groupCols = this.core.columnModel.getRowGroupColumns();
      if (groupCols.length > 0) {
        const grouped = this.buildGrouped(rows, groupCols);
        rows = grouped.rows;
        ambiguousExpansions = grouped.ambiguousExpansions;
      } else if (this.core.gridOptions.masterDetail) {
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

    for (const node of this.loadedRowNodes) node.rowIndex = -1;

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
    this.captureProjectionBaseline();

    this.computeSpans(getCellValue);
    this.core.emit("modelUpdated", { rowCount: rows.length });
    this.core.performanceMonitor.recordModel(startedAt);
    this.reportAmbiguousExpansions(ambiguousExpansions);
  }

  private refreshInfinitePipeline(startedAt: number): void {
    this.loadedRowNodes.forEach((node, index) => {
      if (!this.isBlockDatasource) node.rowIndex = index;
      this.rowSequence.set(node, this.isBlockDatasource ? node.rowIndex + 1 : index + 1);
    });
    this.displayedRowNodes = this.loadedRowNodes;
    this.pipelineRows = this.loadedRowNodes;
    this.spanInfo.clear();
    this.displayRevision++;
    this.core.emit("modelUpdated", { rowCount: this.loadedRowNodes.length });
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
    if (!this.core.gridOptions.dataProcessor || this.loadedRowNodes.length < this.core.gridOptions.dataProcessorMinRows) return false;
    if (this.isTree || this.core.gridOptions.masterDetail || this.core.columnModel.getRowGroupColumns().length > 0) {
      return false;
    }
    const hasFilter = !this.core.gridOptions.manualFiltering && this.isFilterPresent();
    const hasSort = !this.core.gridOptions.manualSorting && this.core.columnModel.getSortModel().length > 0;
    return hasFilter || hasSort;
  }

  private refreshWithDataProcessor(startedAt: number): void {
    this.cancelDataProcessor();
    const processor = this.core.gridOptions.dataProcessor;
    if (!processor) return;
    const seq = ++this.dataProcessorSeq;
    const controller = new AbortController();
    this.dataProcessorAbort = controller;
    const columns = this.core.columnModel.getOrderedVisible();
    const rows = this.loadedRowNodes.flatMap((node) => node.data == null ? [] : [{ id: node.id, data: node.data }]);
    const filterLocally = !this.core.gridOptions.manualFiltering;
    const sortLocally = !this.core.gridOptions.manualSorting;
    void Promise.resolve().then(() => processor.process({
      rows,
      columns: columns.map((column) => ({
        colId: column.id,
        ...(column.colDef.field ? { field: column.colDef.field } : {})
      })),
      sortModel: sortLocally ? this.core.columnModel.getSortModel() : [],
      filterModel: filterLocally ? this.getFilterModel() : {},
      advancedFilterModel: filterLocally ? this.getAdvancedFilterModel() : null,
      quickFilterText: filterLocally ? this.activeQuickFilterText : null,
      signal: controller.signal
    })).then((result) => {
      if (seq !== this.dataProcessorSeq || controller.signal.aborted || this.core.isDisposed()) return;
      const seen = new Set<string>();
      const next: RowNode<TData>[] = [];
      for (const id of result.rowIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        const node = this.nodesById.get(id);
        if (node && !node.isDetail && !node.isGroup) next.push(node);
      }
      for (const node of this.loadedRowNodes) node.rowIndex = -1;
      next.forEach((node, index) => {
        node.rowIndex = index;
        this.rowSequence.set(node, index + 1);
      });
      this.pipelineRows = next;
      this.applyPagination();
      const getCellValue = (node: RowNode<any>, column: ColumnLike) => this.core.readCellValue(node, column);
      this.computeSpans(getCellValue);
      this.core.emit("modelUpdated", { rowCount: next.length });
      this.core.performanceMonitor.recordModel(startedAt);
      this.core.requestUpdate({ data: true });
    }).catch((error) => {
      if (seq !== this.dataProcessorSeq || controller.signal.aborted || this.core.isDisposed()) return;
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
  private activePageNumber = 1;
  private activePageSize = 20;

  get paginationActive(): boolean {
    return this.core.gridOptions.paginationEnabled && !this.isInfinite;
  }

  private applyPagination(): void {
    if (!this.paginationActive) {
      this.displayedRowNodes = this.pipelineRows;
      this.displayRevision++;
      return;
    }
    const size = this.effectivePageSize();
    const pageCount = this.getPageCount();
    if (this.activePageNumber > pageCount) this.activePageNumber = pageCount;
    if (this.activePageNumber < 1) this.activePageNumber = 1;
    this.core.gridOptions.paginationPage = this.activePageNumber;
    if (this.core.gridOptions.paginationMode === "server") {
      this.pipelineRows.forEach((node, index) => {
        node.rowIndex = index;
      });
      this.displayedRowNodes = this.pipelineRows;
      this.displayRevision++;
      return;
    }
    const start = (this.activePageNumber - 1) * size;
    const slice = this.pipelineRows.slice(start, start + size);
    slice.forEach((node, index) => {
      node.rowIndex = index;
    });
    this.displayedRowNodes = slice;
    this.displayRevision++;
  }

  private effectivePageSize(): number {
    this.activePageSize = this.core.gridOptions.paginationPageSize;
    return Math.max(1, this.activePageSize);
  }

  getCurrentPage(): number {
    return this.paginationActive ? this.activePageNumber : 1;
  }

  getTotalRowCount(): number {
    if (this.isInfinite) return this.getDisplayTotalCount();
    if (this.paginationActive && this.core.gridOptions.paginationMode === "server") {
      return this.core.gridOptions.paginationTotal;
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
    if (next === this.activePageNumber) return;
    this.activePageNumber = next;
    this.core.gridOptions.paginationPage = next;
    this.applyPagination();
    this.core.requestUpdate({ data: true });
    this.core.bodyRenderer.scrollToIndex(0, "top");
    if (!silent) this.emitPaginationChanged();
  }

  setPageSize(size: number): void {
    if (!this.paginationActive) return;
    const next = Math.max(1, Math.round(size) || this.effectivePageSize());
    const firstVisible = (this.activePageNumber - 1) * this.effectivePageSize();
    this.core.gridOptions.paginationPageSize = next;
    this.activePageSize = next;
    this.activePageNumber = Math.floor(firstVisible / next) + 1;
    this.core.gridOptions.paginationPage = this.activePageNumber;
    this.applyPagination();
    this.core.requestUpdate({ data: true });
    this.emitPaginationChanged();
  }

  restorePagination(page: number, pageSize: number): void {
    this.activePageSize = Math.max(1, Math.round(pageSize) || 1);
    this.core.gridOptions.paginationPageSize = this.activePageSize;
    this.activePageNumber = Math.max(1, Math.round(page) || 1);
    this.core.gridOptions.paginationPage = this.activePageNumber;
  }

  setPaginationEnabled(enabled: boolean): void {
    if (this.core.gridOptions.paginationEnabled === enabled) return;
    this.core.gridOptions.paginationEnabled = enabled && !this.isInfinite;
    if (this.core.gridOptions.paginationEnabled) this.activePageNumber = 1;
    this.applyPagination();
    this.core.requestUpdate({ data: true });
    this.emitPaginationChanged();
  }

  onPaginationOptionsChanged(): void {
    if (!this.paginationActive) return;
    this.activePageNumber = this.core.gridOptions.paginationMode === "server"
      ? this.core.gridOptions.paginationPage
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
    const sortModel = this.core.gridOptions.manualSorting ? [] : this.core.columnModel.getSortModel();
    const passCache = new Map<string, boolean>();
    const filterPresent = this.isFilterPresent() && !this.core.gridOptions.manualFiltering;
    const filter = createRowFilter(
      columns, this.activeColumnFilters, this.activeAdvancedFilters, this.activeQuickFilterText, getCellValue
    );

    const nodePasses = (node: RowNode<TData>): boolean => {
      const cached = passCache.get(node.id);
      if (cached !== undefined) return cached;
      let pass = true;
      if (filterPresent) {
        pass = filter(node);
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

  private collectSpanMasters(): RowNode<TData>[] {
    const masters = this.mastersBuf;
    let count = 0;
    for (const node of this.displayedRowNodes) {
      if (!node.isDetail && !node.isGroup) masters[count++] = node;
    }
    masters.length = count;
    return masters;
  }

  private explicitRowSpan(node: RowNode<TData>, column: ColumnLike, value: any, remaining: number): number {
    const rowSpan = column.colDef.rowSpan;
    if (!rowSpan) return 1;
    try {
      const requested = rowSpan({
        api: this.core.api, colDef: column.colDef, column, node,
        data: node.data, value, rowIndex: node.rowIndex
      });
      return Math.max(1, Math.min(Math.round(requested) || 1, remaining));
    } catch (error) {
      this.core.reportError(error, "rowSpan", { colId: column.id, rowId: node.id });
      return 1;
    }
  }

  private automaticRowSpan(
    masters: RowNode<TData>[],
    index: number,
    column: ColumnLike,
    value: any,
    getCellValue: (node: RowNode<any>, column: ColumnLike) => any
  ): number {
    if (!column.colDef.autoRowSpan || value == null || value === "") return 1;
    let span = 1;
    while (
      index + span < masters.length &&
      defaultComparator(value, getCellValue(masters[index + span], column)) === 0
    ) span++;
    return span;
  }

  private computeColumnSpans(
    masters: RowNode<TData>[],
    column: ColumnLike,
    getCellValue: (node: RowNode<any>, column: ColumnLike) => any
  ): Int32Array {
    const spans = new Int32Array(masters.length);
    let index = 0;
    while (index < masters.length) {
      const node = masters[index];
      const value = getCellValue(node, column);
      const span = column.colDef.rowSpan
        ? this.explicitRowSpan(node, column, value, masters.length - index)
        : this.automaticRowSpan(masters, index, column, value, getCellValue);
      spans[index] = span;
      for (let offset = 1; offset < span; offset++) spans[index + offset] = -1;
      index += span;
    }
    return spans;
  }

  private computeSpans(getCellValue: (node: RowNode<any>, column: ColumnLike) => any): void {
    this.spanInfo.clear();
    if (this.isTree || this.core.gridOptions.masterDetail) return;
    if (this.core.columnModel.getRowGroupColumns().length > 0) return;
    const columns = this.core.columnModel.getOrderedVisible().filter(
      (column) => column.colDef.rowSpan != null || column.colDef.autoRowSpan === true
    );
    if (columns.length === 0) return;
    const masters = this.collectSpanMasters();
    if (masters.length === 0) return;
    for (const column of columns) {
      this.spanInfo.set(column.id, this.computeColumnSpans(masters, column, getCellValue));
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

  private buildGrouped(rows: RowNode<TData>[], groupCols: ColumnLike[]): { rows: RowNode<TData>[]; ambiguousExpansions: string[] } {
    const aggResolve = createAggResolver(this.core.gridOptions.aggFuncs);
    const aggCols = this.core.columnModel.getAggColumns();
    this.knownGroupIds = [];

    const computeAgg = (leaves: RowNode<TData>[]): Record<string, any> => {
      const values: Record<string, any> = {};
      for (const col of aggCols) {
        const fn = aggResolve(col.colDef.aggFunc!);
        if (!fn) continue;
        try {
          values[col.id] = aggregateItems(leaves, fn, (leaf) => this.core.readCellValue(leaf, col));
        } catch (error) {
          this.core.reportError(error, "aggFunc", { colId: col.id, aggFunc: col.colDef.aggFunc });
          values[col.id] = null;
        }
      }
      return values;
    };

    const migration = migrateGroupExpansion(
      this.groupExpandedIds, this.loadedRowNodes, groupCols, (node, column) => this.core.readCellValue(node, column)
    );
    this.groupExpandedIds = migration.expanded;
    const grouped = buildRowGroups(rows, groupCols, (node, column) => this.core.readCellValue(node, column), computeAgg, this.groupExpandedIds);
    this.knownGroupIds = grouped.ids;
    return { rows: grouped.rows, ambiguousExpansions: migration.ambiguous };
  }

  private reportAmbiguousExpansions(ids: readonly string[]): void {
    // Publish the completed projection/state first: an error listener may synchronously replace data or restore state.
    for (const groupId of ids) {
      if (this.core.isDisposed()) return;
      this.core.reportError(new Error(`Ambiguous legacy group expansion: ${groupId}`), "gridState.groupExpansion", { groupId });
    }
  }

  isRowExpandable(node: RowNode<TData>): boolean {
    if (this.isTree) {
      if (this.hasChildren(node.id)) return true;
      if (node.treeLoading) return true;
      if (node.treeChildrenLoaded || !node.data || !this.core.gridOptions.loadTreeChildren) return false;
      const checkTree = this.core.gridOptions.isTreeRowExpandable;
      if (!checkTree) return false;
      try {
        return checkTree({ data: node.data, node, api: this.core.api });
      } catch (error) {
        this.core.reportError(error, "isTreeRowExpandable", { rowId: node.id });
        return false;
      }
    }
    if (!this.core.gridOptions.masterDetail) return false;
    const check = this.core.gridOptions.isRowExpandable;
    if (check) {
      try {
        return check({ data: node.data, node, api: this.core.api });
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
    for (const node of this.loadedRowNodes) {
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

  canReorderRows(): boolean {
    return !this.isTree && !this.isInfinite && !this.core.gridOptions.dataProcessor &&
      this.core.gridOptions.paginationMode !== "server" &&
      this.core.columnModel.getSortModel().length === 0 &&
      this.core.columnModel.getRowGroupColumns().length === 0;
  }

  reorderRowsByDisplayed(fromIndex: number, toIndex: number): boolean {
    if (!this.canReorderRows() || !Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return false;
    const fromNode = this.getDisplayedRow(fromIndex);
    const toNode = this.getDisplayedRow(toIndex);
    if (!fromNode || !toNode || fromNode.isDetail || toNode.isDetail || fromNode.isGroup || toNode.isGroup) return false;

    const fromAllIdx = this.loadedRowNodes.indexOf(fromNode);
    const toAllIdx = this.loadedRowNodes.indexOf(toNode);
    if (fromAllIdx < 0 || toAllIdx < 0) return false;
    if (fromAllIdx === toAllIdx) return false;

    this.loadedRowNodes.splice(fromAllIdx, 1);
    this.loadedRowNodes.splice(toAllIdx, 0, fromNode);
    this.refreshPipeline();
    this.core.requestUpdate({ data: true });
    return true;
  }

  getAllNodes(): RowNode<TData>[] {
    return this.loadedRowNodes;
  }

  getRootNodes(): RowNode<TData>[] {
    return this.roots;
  }

  getDisplayedRows(): RowNode<TData>[] {
    return this.displayedRowNodes;
  }

  getDisplayedRowCount(): number {
    return this.isBlockDatasource ? this.resolveBlockRowCount() : this.displayedRowNodes.length;
  }

  getDisplayedRow(index: number): RowNode<TData> | undefined {
    if (this.isBlockDatasource) {
      if (index < 0 || index >= this.resolveBlockRowCount()) return undefined;
      return this.blockNodes.get(index) ?? this.blockPlaceholder(index);
    }
    return this.displayedRowNodes[index];
  }

  getNodeById(id: string): RowNode<TData> | undefined {
    return this.nodesById.get(id);
  }

  forEachNode(callback: (node: RowNode<TData>, index: number) => void): void {
    this.loadedRowNodes.forEach(callback);
  }

  forEachNodeAfterFilterAndSort(callback: (node: RowNode<TData>, index: number) => void): void {
    let index = 0;
    for (const node of this.pipelineRows) {
      if (node.isDetail || node.isGroup) continue;
      callback(node, index++);
    }
  }
}
