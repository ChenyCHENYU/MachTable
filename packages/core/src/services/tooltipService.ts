import type { GridCore } from "../core/gridCore";
import type { Column } from "./column";
import type { TooltipParams } from "../types/params";
import { el, clamp } from "../lib/dom";
import { formatCellValue } from "../render/cellContent";

type TooltipContext = Pick<
  GridCore<any>,
  | "columnModel"
  | "getApi"
  | "getCellValue"
  | "isDestroyed"
  | "options"
  | "reportError"
  | "rowModel"
  | "skeleton"
>;

export class TooltipService {
  private panel: HTMLElement | null = null;
  private showTimer = 0;
  private hideTimer = 0;
  private currentCell: HTMLElement | null = null;

  constructor(private core: TooltipContext) {}

  init(): void {
    const body = this.core.skeleton.bodyEl;
    body.addEventListener("mouseover", this.onMouseOver);
    body.addEventListener("mouseleave", this.onBodyLeave);
  }

  destroy(): void {
    this.clearTimers();
    this.removePanel();
    const body = this.core.skeleton.bodyEl;
    body.removeEventListener("mouseover", this.onMouseOver);
    body.removeEventListener("mouseleave", this.onBodyLeave);
    this.currentCell = null;
  }

  hide(): void {
    this.clearTimers();
    this.removePanel();
    this.currentCell = null;
  }

  private clearTimers(): void {
    if (this.showTimer) {
      clearTimeout(this.showTimer);
      this.showTimer = 0;
    }
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = 0;
    }
  }

  private removePanel(): void {
    if (!this.panel) return;
    this.panel.remove();
    this.panel = null;
  }

  private onMouseOver = (e: MouseEvent): void => {
    if (this.core.isDestroyed()) return;
    if (!this.core.options.tooltipComponent) return;
    const target = e.target as HTMLElement;
    const cell = target.closest<HTMLElement>(".mach-cell");
    if (!cell || cell === this.currentCell) return;

    this.clearTimers();
    this.removePanel();
    this.currentCell = cell;

    const colId = cell.dataset.colId ?? "";
    const rowEl = cell.closest<HTMLElement>(".mach-row");
    const index = Number(rowEl?.dataset.index);
    const node = Number.isNaN(index) ? undefined : this.core.rowModel.getDisplayedRow(index);
    const column: Column | undefined = colId ? this.core.columnModel.getColumn(colId) : undefined;
    if (!node || !column || node.isDetail || node.isGroup) return;
    if (cell.classList.contains("mach-cell--editing")) return;

    const value = this.core.getCellValue(node, column);
    const params: TooltipParams<any> = {
      data: node.data,
      node,
      api: this.core.getApi(),
      colId: column.id,
      value,
      formatted: formatCellValue(this.core, node, column),
      rowIndex: index
    };

    const getter = column.colDef.tooltipValueGetter;
    let fallback = params.formatted;
    if (getter) {
      try {
        fallback = getter({ ...params, colDef: column.colDef, column }) ?? params.formatted;
      } catch (error) {
        this.core.reportError(error, "tooltipValueGetter", { colId: column.id, rowId: node.id });
      }
    }
    if (!fallback && !column.colDef.tooltipValueGetter) return;

    this.showTimer = setTimeout(() => {
      if (this.core.isDestroyed() || this.currentCell !== cell) return;
      this.showPanel(cell, params);
    }, Math.max(0, this.core.options.tooltipShowDelay)) as unknown as number;
  };

  private onBodyLeave = (): void => {
    this.hide();
  };

  private showPanel(cell: HTMLElement, params: TooltipParams<any>): void {
    this.removePanel();
    const component = this.core.options.tooltipComponent;
    if (!component) return;

    const panel = el("div", "mach-tooltip");
    panel.setAttribute("role", "tooltip");
    let content: string | HTMLElement;
    try {
      content = component(params);
    } catch (err) {
      this.core.reportError(err, "tooltipComponent", { colId: params.colId, rowIndex: params.rowIndex });
      return;
    }
    if (typeof content === "string") {
      panel.textContent = content;
    } else {
      panel.appendChild(content);
    }

    document.body.appendChild(panel);
    this.panel = panel;
    const rect = cell.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const left = clamp(rect.left, 8, Math.max(8, window.innerWidth - panelRect.width - 8));
    let top = rect.bottom + 6;
    if (top + panelRect.height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - panelRect.height - 6);
    }
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }
}
