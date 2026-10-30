import type { RefreshCellsParams } from "../types/api";

export interface GridUpdateRequest {
  columns?: boolean;
  header?: boolean;
  pool?: boolean;
  data?: boolean;
  layout?: boolean;
  cells?: true | RefreshCellsParams;
  pinned?: boolean;
  summary?: boolean;
  overlays?: boolean;
}

export interface GridUpdateSchedulerSnapshot {
  batchDepth: number;
  flushCount: number;
  requestCount: number;
  coalescedRequestCount: number;
  pending: boolean;
}

function mergeValues(left?: readonly string[], right?: readonly string[]): string[] | undefined {
  if (left == null || right == null) return undefined;
  return [...new Set([...left, ...right])];
}

function mergeCellRequests(
  current: true | RefreshCellsParams | undefined,
  next: true | RefreshCellsParams | undefined
): true | RefreshCellsParams | undefined {
  if (current === true || next === true) return true;
  if (!current) return next;
  if (!next) return current;
  return {
    rowIds: mergeValues(current.rowIds, next.rowIds),
    rowIndexes: current.rowIndexes == null || next.rowIndexes == null
      ? undefined
      : [...new Set([...current.rowIndexes, ...next.rowIndexes])],
    columns: mergeValues(current.columns, next.columns),
    force: current.force === true || next.force === true,
    includePinned: current.includePinned === true || next.includePinned === true
  };
}

function mergeRequests(current: GridUpdateRequest, next: GridUpdateRequest): GridUpdateRequest {
  return {
    columns: current.columns === true || next.columns === true,
    header: current.header === true || next.header === true,
    pool: current.pool === true || next.pool === true,
    data: current.data === true || next.data === true,
    layout: current.layout === true || next.layout === true,
    cells: mergeCellRequests(current.cells, next.cells),
    pinned: current.pinned === true || next.pinned === true,
    summary: current.summary === true || next.summary === true,
    overlays: current.overlays === true || next.overlays === true
  };
}

/** Coalesces explicit API batches while preserving synchronous behavior outside a batch. */
/** @internal The scheduler exposes plain diagnostic snapshots through the API. */
export class GridUpdateScheduler {
  private updateBatchDepth = 0;
  private scheduledRequest: GridUpdateRequest | null = null;
  private totalUpdateFlushes = 0;
  private totalUpdateRequests = 0;
  private totalCoalescedRequests = 0;
  private schedulerDisposed = false;

  constructor(private readonly apply: (request: GridUpdateRequest) => void) {}

  batch<T>(callback: () => T): T {
    if (this.schedulerDisposed) return callback();
    this.updateBatchDepth++;
    try {
      return callback();
    } finally {
      this.updateBatchDepth--;
      if (this.updateBatchDepth === 0) this.flush();
    }
  }

  schedule(request: GridUpdateRequest): void {
    if (this.schedulerDisposed) return;
    this.totalUpdateRequests++;
    if (this.scheduledRequest) this.totalCoalescedRequests++;
    this.scheduledRequest = mergeRequests(this.scheduledRequest ?? {}, request);
    if (this.updateBatchDepth === 0) this.flush();
  }

  flush(): void {
    if (this.schedulerDisposed || this.updateBatchDepth > 0 || !this.scheduledRequest) return;
    const request = this.scheduledRequest;
    this.scheduledRequest = null;
    this.totalUpdateFlushes++;
    this.apply(request);
  }

  snapshot(): GridUpdateSchedulerSnapshot {
    return {
      batchDepth: this.updateBatchDepth,
      flushCount: this.totalUpdateFlushes,
      requestCount: this.totalUpdateRequests,
      coalescedRequestCount: this.totalCoalescedRequests,
      pending: this.scheduledRequest != null
    };
  }

  destroy(): void {
    this.schedulerDisposed = true;
    this.scheduledRequest = null;
    this.updateBatchDepth = 0;
  }
}
