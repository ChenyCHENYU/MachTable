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
export class ColumnViewportIndex {
  private offsets = new Float64Array(1);
  private signature = "";

  update(columns: readonly Column[]): boolean {
    const signature = columns.map((column) => `${column.id}:${column.currentWidth}`).join("|");
    if (signature === this.signature) return false;
    this.signature = signature;
    this.offsets = new Float64Array(columns.length + 1);
    for (let index = 0; index < columns.length; index++) {
      this.offsets[index + 1] = this.offsets[index] + columns[index].currentWidth;
    }
    return true;
  }

  totalWidth(): number {
    return this.offsets[this.offsets.length - 1] ?? 0;
  }

  offsetAt(index: number): number {
    const safe = Math.max(0, Math.min(Math.trunc(index), this.offsets.length - 1));
    return this.offsets[safe] ?? 0;
  }

  indexAt(offset: number): number {
    const count = Math.max(0, this.offsets.length - 1);
    if (count === 0) return -1;
    return Math.min(count - 1, Math.max(0, upperBound(this.offsets, Math.max(0, offset)) - 1));
  }

  visibleRange(scrollLeft: number, viewportWidth: number, overscan = 2): { first: number; lastExcl: number } {
    const count = Math.max(0, this.offsets.length - 1);
    if (count === 0 || viewportWidth <= 0 || this.totalWidth() <= viewportWidth) {
      return { first: 0, lastExcl: count };
    }
    const left = Math.max(0, scrollLeft);
    const right = left + viewportWidth;
    const firstVisible = Math.max(0, upperBound(this.offsets, left) - 1);
    const lastVisible = Math.min(count, lowerBound(this.offsets, right));
    return {
      first: Math.max(0, firstVisible - overscan),
      lastExcl: Math.min(count, lastVisible + overscan)
    };
  }
}
