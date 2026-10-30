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
    const style = getComputedStyle(this.core.skeleton.root);
    const font = `${style.getPropertyValue("--mach-header-font-weight") || 650} ${style.fontSize} ${style.fontFamily}`;
    this.needsContentMeasure ||= font !== this.measurementFont;
    this.measurementFont = font;
    let changed = false;
    for (const column of this.core.columnModel.getOrderedVisible()) {
      if (!this.needsContentMeasure && column.minWidth != null) continue;
      // 所有布局入口共享完整表头下限；数据测宽上限不作用于标题。
      const def = column.colDef;
      column.minWidth = this.headerWidth(column);
      if (column.manualWidth == null && def.width == null && def.autoWidth !== false && !column.hasCheckbox && !column.isDetailToggle) {
        const width = this.measureColumnWidth(column);
        changed = width !== column.contentWidth || changed;
        column.contentWidth = width;
      }
    }
    this.needsContentMeasure = false;
    return changed;
  }

  private textWidth(value: string): number {
    if (this.textMeasureContext === undefined) this.textMeasureContext = document.createElement("canvas").getContext("2d");
    if (!this.textMeasureContext) return value.replace(/[^\x00-\xff]/g, "mm").length * 7;
    this.textMeasureContext.font = this.measurementFont;
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

  measureColumnWidth(column: Column): number {
    let width = 28;
    const nodes = this.core.rowModel.getAllNodes();
    const count = Math.min(nodes.length, 100);
    for (let i = 0; i < count; i++) {
      const node = nodes[count === 1 ? 0 : Math.floor(i * (nodes.length - 1) / (count - 1))];
      const value = this.core.readCellValue(node, column);
      const label = statusEntry(value, column.colDef.status)?.label ??
        formatCellValueWith(this.core, node, column, value);
      width = Math.max(width, this.textWidth(label.slice(0, 128)) + (column.colDef.status ? 44 : 28));
    }
    return Math.ceil(Math.min(normalizePositive(column.colDef.maxWidth) ?? 360, width));
  }
}
