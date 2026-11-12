import { normalizePositive } from "../lib/optionValues";
import type { GridCore } from "../core/gridCore";
import type { Column } from "./column";
import type { RefreshCellsParams } from "../types/api";
import { formatCellValueWith } from "../render/cellContent";
import { statusEntry } from "../lib/columnStatus";
import { el } from "../lib/dom";

/** @internal 每表实例缓存测量结果；只取已加载数据，绝不为测宽请求远程行或挂载 renderer。 */
export class ColumnSizing {
  private textMeasureContext?: CanvasRenderingContext2D | null;
  private measurementFont = "";
  private fontFaces: FontFace[] = [];
  fontRevision = 0;
  needsContentMeasure = true;

  constructor(private core: GridCore) {}

  updateContentWidths(scope?: RefreshCellsParams): boolean {
    if (this.syncFontMetrics()) {
      this.needsContentMeasure = true;
      scope = undefined;
    }
    const rows = this.needsContentMeasure ? this.sampleRows() : undefined;
    const sampleChanged = rows && sampleIntersects(rows, scope);
    const columns = scope?.columns && new Set(scope.columns);
    let changed = false;
    for (const column of this.core.columnModel.getOrderedVisible()) {
      if (column.minWidth != null && (!sampleChanged || (columns && !columns.has(column.id)))) continue;
      // 所有布局入口共享完整表头下限；数据测宽上限不作用于标题。
      const minWidth = this.headerWidth(column);
      changed = column.minWidth !== minWidth || changed;
      column.minWidth = minWidth;
      if (isContentSized(column)) {
        const width = this.measureColumnWidth(column, rows);
        changed = width !== column.contentWidth || changed;
        column.contentWidth = width;
      }
    }
    this.needsContentMeasure = false;
    return changed;
  }

  /** Loaded glyphs can change while the CSS font-family string stays identical. */
  private syncFontMetrics(): boolean {
    const faces = Array.from(document.fonts ?? []).filter(face => face.status === "loaded");
    const facesChanged = faces.length !== this.fontFaces.length || faces.some((face, index) => face !== this.fontFaces[index]);
    if (facesChanged) {
      this.fontFaces = faces;
      this.fontRevision++;
    }
    const style = getComputedStyle(this.core.skeleton.root);
    const font = `${style.getPropertyValue("--mach-header-font-weight") || 650} ${style.fontSize} ${style.fontFamily}`;
    const changed = font !== this.measurementFont || facesChanged;
    this.measurementFont = font;
    return changed;
  }

  private sampleRows() {
    const nodes = this.core.rowModel.getAllNodes();
    const count = Math.min(nodes.length, 100);
    return Array.from({ length: count }, (_, index) =>
      nodes[Math.floor(index * (nodes.length - 1) / Math.max(count - 1, 1))]);
  }

  textWidth(value: string, font?: string): number {
    if (this.textMeasureContext === undefined) this.textMeasureContext = el("canvas").getContext("2d");
    if (!this.textMeasureContext) return font ? Infinity : value.replace(/[^\x00-\xff]/g, "mm").length * 7;
    this.textMeasureContext.font = font ?? this.measurementFont;
    return this.textMeasureContext.measureText(value).width;
  }

  private headerWidth(column: Column): number {
    const def = column.colDef;
    const label = def.headerName ?? def.field ?? column.id;
    return Math.ceil(Math.max(def.minWidth ?? 0,
      this.textWidth(label) + label.length * 0.15 + 28 +
      (column.sortable ? 20 : 0) + (column.filterable ? 28 : 0) +
      (this.core.gridOptions.columnMenu && !column.hasCheckbox && !def.suppressColumnMenu ? 22 : 0)));

  }

  measureColumnWidth(column: Column, rows = this.sampleRows()): number {
    let width = 28;
    for (const node of rows) {
      const value = this.core.readCellValue(node, column);
      const label = statusEntry(value, column.colDef.status)?.label ??
        formatCellValueWith(this.core, node, column, value);
      width = Math.max(width, this.textWidth(label.slice(0, 128)) + (column.colDef.status ? 44 : 28));
    }
    return Math.ceil(Math.min(normalizePositive(column.colDef.maxWidth) ?? 360, width));
  }
}

function isContentSized(column: Column): boolean {
  const { width, autoWidth } = column.colDef;
  return column.manualWidth == null && width == null && autoWidth !== false && !column.hasCheckbox && !column.isDetailToggle;
}

function sampleIntersects(rows: { id: string; rowIndex: number }[], scope?: RefreshCellsParams): boolean {
  if (!scope?.rowIds && !scope?.rowIndexes) return true;
  const ids = new Set(scope.rowIds);
  const indexes = new Set(scope.rowIndexes);
  return rows.some(node => ids.has(node.id) || indexes.has(node.rowIndex));
}
