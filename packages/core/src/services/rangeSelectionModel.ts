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
/** @internal The selection facade exposes plain cell ranges rather than this model. */
export class RangeSelectionModel {
  private rangeAnchorCell: GridPoint | null = null;
  private rangeEndCell: GridPoint | null = null;
  private rangeValueCache: NormalizedRange | null | false = false;
  private cacheRowCount = -1;
  private cacheColCount = -1;

  getAnchor(): GridPoint | null {
    return this.rangeAnchorCell;
  }

  getEnd(): GridPoint | null {
    return this.rangeEndCell;
  }

  hasAnchor(): boolean {
    return this.rangeAnchorCell != null;
  }

  start(point: GridPoint, extend: boolean): void {
    if (!extend || !this.rangeAnchorCell) this.rangeAnchorCell = { ...point };
    this.rangeEndCell = { ...point };
    this.invalidate();
  }

  ensureAnchor(point: GridPoint): boolean {
    if (this.rangeAnchorCell) return true;
    if (point.colIdx < 0) return false;
    this.rangeAnchorCell = { ...point };
    this.invalidate();
    return true;
  }

  setEnd(point: GridPoint): void {
    this.rangeEndCell = { ...point };
    this.invalidate();
  }

  clear(): void {
    this.rangeAnchorCell = null;
    this.rangeEndCell = null;
    this.invalidate();
  }

  invalidate(): void {
    this.rangeValueCache = false;
    this.cacheRowCount = -1;
    this.cacheColCount = -1;
  }

  normalize(rowCount: number, colCount: number): NormalizedRange | null {
    if (
      this.rangeValueCache !== false &&
      this.cacheRowCount === rowCount &&
      this.cacheColCount === colCount
    ) return this.rangeValueCache;
    this.cacheRowCount = rowCount;
    this.cacheColCount = colCount;
    if (!this.rangeAnchorCell || !this.rangeEndCell || rowCount <= 0 || colCount <= 0) {
      this.rangeValueCache = null;
      return null;
    }
    this.rangeValueCache = {
      r1: Math.max(0, Math.min(this.rangeAnchorCell.row, this.rangeEndCell.row, rowCount - 1)),
      r2: Math.max(0, Math.min(Math.max(this.rangeAnchorCell.row, this.rangeEndCell.row), rowCount - 1)),
      c1: Math.max(0, Math.min(this.rangeAnchorCell.colIdx, this.rangeEndCell.colIdx, colCount - 1)),
      c2: Math.max(0, Math.min(Math.max(this.rangeAnchorCell.colIdx, this.rangeEndCell.colIdx), colCount - 1))
    };
    return this.rangeValueCache;
  }
}
