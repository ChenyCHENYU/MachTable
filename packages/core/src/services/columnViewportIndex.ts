import type { Column } from "./column";

function findBoundary(values: Float64Array, target: number, afterEqual = false): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (values[middle] < target || (afterEqual && values[middle] === target)) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Prefix-width index used by horizontal virtualization and layout. */
/** @internal The column window index stays in the rendering owner. */
export class ColumnViewportIndex {
  private columnStartOffsets = new Float64Array(1);

  update(columns: readonly Column[]): boolean {
    let changed = this.columnStartOffsets.length !== columns.length + 1;
    if (changed) this.columnStartOffsets = new Float64Array(columns.length + 1);
    // Width-only updates reuse storage and refresh changed prefixes in one pass.
    let total = 0;
    for (let index = 0; index < columns.length; index++) {
      total += columns[index].currentWidth;
      if (this.columnStartOffsets[index + 1] === total) continue;
      this.columnStartOffsets[index + 1] = total;
      changed = true;
    }
    return changed;
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
    return Math.min(count - 1, Math.max(0, findBoundary(this.columnStartOffsets, Math.max(0, offset), true) - 1));
  }

  visibleRange(scrollLeft: number, viewportWidth: number, overscan = 2): { first: number; lastExcl: number } {
    const count = Math.max(0, this.columnStartOffsets.length - 1);
    if (count === 0 || viewportWidth <= 0 || this.totalWidth() <= viewportWidth) {
      return { first: 0, lastExcl: count };
    }
    const left = Math.max(0, scrollLeft);
    const right = left + viewportWidth;
    const firstVisible = Math.max(0, findBoundary(this.columnStartOffsets, left, true) - 1);
    const lastVisible = Math.min(count, findBoundary(this.columnStartOffsets, right));
    return {
      first: Math.max(0, firstVisible - overscan),
      lastExcl: Math.min(count, lastVisible + overscan)
    };
  }

  scrollColumnIntoView(viewport: HTMLElement, columns: readonly Column[], column: Column): void {
    const index = columns.indexOf(column);
    if (index < 0) return;
    this.update(columns);
    const left = this.offsetAt(index);
    const right = left + column.currentWidth;
    if (left < viewport.scrollLeft) viewport.scrollLeft = left;
    else if (right > viewport.scrollLeft + viewport.clientWidth) viewport.scrollLeft = right - viewport.clientWidth;
  }
}
