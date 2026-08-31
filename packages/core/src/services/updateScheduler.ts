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
export class GridUpdateScheduler {
  private depth = 0;
  private pending: GridUpdateRequest | null = null;
  private flushCount = 0;
  private requestCount = 0;
  private coalescedRequestCount = 0;
  private destroyed = false;

  constructor(private readonly apply: (request: GridUpdateRequest) => void) {}

  batch<T>(callback: () => T): T {
    if (this.destroyed) return callback();
    this.depth++;
    try {
      return callback();
    } finally {
      this.depth--;
      if (this.depth === 0) this.flush();
    }
  }

  schedule(request: GridUpdateRequest): void {
    if (this.destroyed) return;
    this.requestCount++;
    if (this.pending) this.coalescedRequestCount++;
    this.pending = mergeRequests(this.pending ?? {}, request);
    if (this.depth === 0) this.flush();
  }

  flush(): void {
    if (this.destroyed || this.depth > 0 || !this.pending) return;
    const request = this.pending;
    this.pending = null;
    this.flushCount++;
    this.apply(request);
  }

  snapshot(): GridUpdateSchedulerSnapshot {
    return {
      batchDepth: this.depth,
      flushCount: this.flushCount,
      requestCount: this.requestCount,
      coalescedRequestCount: this.coalescedRequestCount,
      pending: this.pending != null
    };
  }

  destroy(): void {
    this.destroyed = true;
    this.pending = null;
    this.depth = 0;
  }
}
