import type { Column } from "./column";

function upperBound(values: Float64Array, target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (values[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function lowerBound(values: Float64Array, target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Prefix-width index used by horizontal virtualization and layout. */
/** @internal The column window index stays in the rendering owner. */
export class ColumnViewportIndex {
  private columnStartOffsets = new Float64Array(1);

  update(columns: readonly Column[]): boolean {
    let total = 0;
    let changed = this.columnStartOffsets.length !== columns.length + 1;
    for (let index = 0; index < columns.length; index++) {
      total += columns[index].currentWidth;
      if (!changed && this.columnStartOffsets[index + 1] !== total) changed = true;
    }
    if (!changed) return false;

    const offsets = new Float64Array(columns.length + 1);
    for (let index = 0; index < columns.length; index++) {
      offsets[index + 1] = offsets[index] + columns[index].currentWidth;
    }
    this.columnStartOffsets = offsets;
    return true;
  }

  totalWidth(): number {
    return this.columnStartOffsets[this.columnStartOffsets.length - 1] ?? 0;
  }

  offsetAt(index: number): number {
    const safe = Math.max(0, Math.min(Math.trunc(index), this.columnStartOffsets.length - 1));
    return this.columnStartOffsets[safe] ?? 0;
  }

  indexAt(offset: number): number {
    const count = Math.max(0, this.columnStartOffsets.length - 1);
    if (count === 0) return -1;
    return Math.min(count - 1, Math.max(0, upperBound(this.columnStartOffsets, Math.max(0, offset)) - 1));
  }

  visibleRange(scrollLeft: number, viewportWidth: number, overscan = 2): { first: number; lastExcl: number } {
    const count = Math.max(0, this.columnStartOffsets.length - 1);
    if (count === 0 || viewportWidth <= 0 || this.totalWidth() <= viewportWidth) {
      return { first: 0, lastExcl: count };
    }
    const left = Math.max(0, scrollLeft);
    const right = left + viewportWidth;
    const firstVisible = Math.max(0, upperBound(this.columnStartOffsets, left) - 1);
    const lastVisible = Math.min(count, lowerBound(this.columnStartOffsets, right));
    return {
      first: Math.max(0, firstVisible - overscan),
      lastExcl: Math.min(count, lastVisible + overscan)
    };
  }
}
