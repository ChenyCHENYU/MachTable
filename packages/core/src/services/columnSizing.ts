import { normalizePositive } from "../lib/optionValues";
import type { GridCore } from "../core/gridCore";
import type { Column } from "./column";
import { formatCellValueWith } from "../render/cellContent";
import { statusEntry } from "../lib/columnStatus";

/** @internal 每表实例缓存测量结果；只取已加载数据，绝不为测宽请求远程行或挂载 renderer。 */
export class ColumnSizing {
  private textMeasureContext?: CanvasRenderingContext2D | null;
  private measurementFont = "";
  needsContentMeasure = true;

  constructor(private core: GridCore) {}

  updateContentWidths(): boolean {
    const font = getComputedStyle(this.core.skeleton.root).font || "13px sans-serif";
    this.needsContentMeasure ||= font !== this.measurementFont;
    this.measurementFont = font;
    let changed = false;
    for (const column of this.core.columnModel.getOrderedVisible()) {
      if ((this.needsContentMeasure || column.contentWidth == null) && column.manualWidth == null &&
          column.colDef.width == null && column.colDef.autoWidth !== false && !column.hasCheckbox && !column.isDetailToggle) {
        const width = this.measureColumnWidth(column);
        changed ||= width !== column.contentWidth;
        column.contentWidth = width;
      }
    }
    this.needsContentMeasure = false;
    return changed;
  }

  private textWidth(value: string): number {
    if (this.textMeasureContext === undefined) this.textMeasureContext = document.createElement("canvas").getContext("2d");
    const text = value.slice(0, 128);
    if (!this.textMeasureContext) return text.replace(/[^\x00-\xff]/g, "mm").length * 7;
    this.textMeasureContext.font = this.measurementFont;
    return this.textMeasureContext.measureText(text).width;
  }

  private headerWidth(column: Column): number {
    return this.textWidth(column.colDef.headerName ?? column.colDef.field ?? column.id) + 28 +
      (column.sortable ? 20 : 0) + (column.filterable ? 28 : 0) + (this.core.gridOptions.columnMenu ? 22 : 0);
  }

  prepareResize(column: Column): void {
    column.minWidth = Math.max(column.colDef.minWidth ?? 0, Math.ceil(Math.min(360, this.headerWidth(column))));
  }

  measureColumnWidth(column: Column, skipHeader = false): number {
    let width = skipHeader ? 28 : this.headerWidth(column);
    const nodes = this.core.rowModel.getAllNodes();
    const count = Math.min(nodes.length, 100);
    for (let i = 0; i < count; i++) {
      const node = nodes[count === 1 ? 0 : Math.floor(i * (nodes.length - 1) / (count - 1))];
      const value = this.core.readCellValue(node, column);
      const label = statusEntry(value, column.colDef.status)?.label ??
        formatCellValueWith(this.core, node, column, value);
      width = Math.max(width, this.textWidth(label) + (column.colDef.status ? 44 : 28));
    }
    return Math.ceil(Math.min(normalizePositive(column.colDef.maxWidth) ?? 360, width));
  }
}
