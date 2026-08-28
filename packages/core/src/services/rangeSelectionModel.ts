export interface GridPoint {
  row: number;
  colIdx: number;
}

export interface NormalizedRange {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

/** Pure state model for range selection; DOM painting stays in BodyRenderer. */
export class RangeSelectionModel {
  private anchor: GridPoint | null = null;
  private end: GridPoint | null = null;
  private cache: NormalizedRange | null | false = false;
  private cacheRowCount = -1;
  private cacheColCount = -1;

  getAnchor(): GridPoint | null {
    return this.anchor;
  }

  getEnd(): GridPoint | null {
    return this.end;
  }

  hasAnchor(): boolean {
    return this.anchor != null;
  }

  start(point: GridPoint, extend: boolean): void {
    if (!extend || !this.anchor) this.anchor = { ...point };
    this.end = { ...point };
    this.invalidate();
  }

  ensureAnchor(point: GridPoint): boolean {
    if (this.anchor) return true;
    if (point.colIdx < 0) return false;
    this.anchor = { ...point };
    this.invalidate();
    return true;
  }

  setEnd(point: GridPoint): void {
    this.end = { ...point };
    this.invalidate();
  }

  clear(): void {
    this.anchor = null;
    this.end = null;
    this.invalidate();
  }

  invalidate(): void {
    this.cache = false;
    this.cacheRowCount = -1;
    this.cacheColCount = -1;
  }

  normalize(rowCount: number, colCount: number): NormalizedRange | null {
    if (
      this.cache !== false &&
      this.cacheRowCount === rowCount &&
      this.cacheColCount === colCount
    ) return this.cache;
    this.cacheRowCount = rowCount;
    this.cacheColCount = colCount;
    if (!this.anchor || !this.end || rowCount <= 0 || colCount <= 0) {
      this.cache = null;
      return null;
    }
    this.cache = {
      r1: Math.max(0, Math.min(this.anchor.row, this.end.row, rowCount - 1)),
      r2: Math.max(0, Math.min(Math.max(this.anchor.row, this.end.row), rowCount - 1)),
      c1: Math.max(0, Math.min(this.anchor.colIdx, this.end.colIdx, colCount - 1)),
      c2: Math.max(0, Math.min(Math.max(this.anchor.colIdx, this.end.colIdx), colCount - 1))
    };
    return this.cache;
  }
}
