import type { GridCore } from "../core/gridCore";
import { el } from "../lib/dom";
import { formatText, type MachTableLocaleKey } from "../lib/locale";
import type { StatusBarPanel } from "../types/options";

type StatusBarContext = Pick<
  GridCore<any>,
  | "bodyRenderer"
  | "columnModel"
  | "eventBus"
  | "getLocaleText"
  | "readCellValue"
  | "isDisposed"
  | "gridOptions"
  | "rowModel"
  | "selectionService"
  | "skeleton"
>;

/** @internal Status consumers receive snapshots rather than the rendering service. */
export class StatusBarService {
  private barEl: HTMLElement | null = null;
  private statusPanelItems: Partial<Record<StatusBarPanel, HTMLElement>> = {};
  private offs: (() => void)[] = [];

  constructor(private core: StatusBarContext) {}

  init(): void {
    this.barEl = el("div", "mach-statusbar");
    this.barEl.style.display = "none";
    this.barEl.setAttribute("role", "status");
    this.core.skeleton.root.appendChild(this.barEl);
    this.rebuild();

    this.offs.push(
      this.core.eventBus.on("modelUpdated", () => this.refresh()),
      this.core.eventBus.on("selectionChanged", () => this.refresh()),
      this.core.eventBus.on("rangeSelectionChanged", () => this.refresh()),
      this.core.eventBus.on("cellValueChanged", () => this.refresh())
    );
  }

  rebuild(): void {
    if (!this.barEl) return;
    this.barEl.textContent = "";
    this.statusPanelItems = {};
    const options = this.core.gridOptions;
    if (!options.statusBarEnabled) {
      this.barEl.style.display = "none";
      return;
    }
    for (const panel of options.statusBarPanels) {
      const item = el("span", `mach-statusbar-item mach-statusbar-item--${panel}`);
      this.barEl.appendChild(item);
      this.statusPanelItems[panel] = item;
    }
    this.refresh();
  }

  private aggregateText(key: MachTableLocaleKey, value: number): string {
    return formatText(this.core.getLocaleText(key), value || 0);
  }

  private updateItem(panel: StatusBarPanel, value: string): void {
    const item = this.statusPanelItems[panel];
    if (item && item.textContent !== value) item.textContent = value;
  }

  private rowCountText(): string {
    const rm = this.core.rowModel;
    const total = rm.getDisplayTotalCount();
    const loaded = rm.paginationActive ? rm.getTotalRowCount() : rm.getDisplayedRowCount();
    const loadedText = formatText(this.core.getLocaleText("totalRowsLabel"), loaded);
    return rm.isInfinite && total > loaded ? `${loadedText} / ${total}` : loadedText;
  }

  private rangeAggregateText(): string {
    const range = this.core.bodyRenderer.normalizedRange();
    if (!range) return "";
    const flat = this.core.columnModel.getOrderedVisible();
    let sum = 0;
    let count = 0;
    for (let rowIndex = range.r1; rowIndex <= range.r2; rowIndex++) {
      const node = this.core.rowModel.getDisplayedRow(rowIndex);
      if (!node || node.isDetail || node.isGroup) continue;
      for (let columnIndex = range.c1; columnIndex <= range.c2; columnIndex++) {
        const column = flat[columnIndex];
        if (!column) continue;
        const value = this.core.readCellValue(node, column);
        if (typeof value !== "number" || Number.isNaN(value)) continue;
        sum += value;
        count++;
      }
    }
    if (count === 0) return "";
    const average = Math.round((sum / count) * 100) / 100;
    const displayedSum = Number.isInteger(sum) ? sum : Math.round(sum * 100) / 100;
    return `${this.aggregateText("statusSum", displayedSum)} · ${this.aggregateText("statusAvg", average)} · ${this.aggregateText("statusCount", count)}`;
  }

  refresh(): void {
    if (!this.barEl || this.core.isDisposed()) return;
    const options = this.core.gridOptions;
    this.barEl.style.display = options.statusBarEnabled ? "" : "none";
    if (!options.statusBarEnabled) return;

    if (this.statusPanelItems.rowCount) this.updateItem("rowCount", this.rowCountText());
    if (this.statusPanelItems.selectedRowCount) {
      const count = this.core.selectionService.getSelectedNodes().length;
      this.updateItem("selectedRowCount", formatText(this.core.getLocaleText("statusSelected"), count));
    }
    if (this.statusPanelItems.rangeAggregate) this.updateItem("rangeAggregate", this.rangeAggregateText());
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.barEl?.remove();
    this.barEl = null;
  }
}
