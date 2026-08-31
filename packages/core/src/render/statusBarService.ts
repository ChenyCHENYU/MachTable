import type { GridCore } from "../core/gridCore";
import { el } from "../lib/dom";
import { DEFAULT_LOCALE, formatText, type MachTableLocaleKey } from "../lib/locale";
import type { StatusBarPanel } from "../types/options";

type AnyLocale = Record<string, string | undefined>;
type StatusBarContext = Pick<
  GridCore<any>,
  | "bodyRenderer"
  | "columnModel"
  | "eventBus"
  | "getCellValue"
  | "isDestroyed"
  | "options"
  | "rowModel"
  | "selectionService"
  | "skeleton"
>;

export class StatusBarService {
  private barEl: HTMLElement | null = null;
  private items: Partial<Record<StatusBarPanel, HTMLElement>> = {};
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
    this.items = {};
    const options = this.core.options;
    if (!options.statusBarEnabled) {
      this.barEl.style.display = "none";
      return;
    }
    for (const panel of options.statusBarPanels) {
      const item = el("span", `mach-statusbar-item mach-statusbar-item--${panel}`);
      this.barEl.appendChild(item);
      this.items[panel] = item;
    }
    this.refresh();
  }

  private text(locale: AnyLocale, key: MachTableLocaleKey, value?: number | string): string {
    const template = locale[key] ?? DEFAULT_LOCALE[key];
    if (value === undefined) return template;
    const numeric = typeof value === "number" ? value : parseFloat(String(value)) || 0;
    return formatText(template, numeric);
  }

  private updateItem(panel: StatusBarPanel, value: string): void {
    const item = this.items[panel];
    if (item && item.textContent !== value) item.textContent = value;
  }

  private rowCountText(locale: AnyLocale): string {
    const rm = this.core.rowModel;
    const total = rm.getDisplayTotalCount();
    const loaded = rm.paginationActive ? rm.getTotalRowCount() : rm.getDisplayedRowCount();
    const loadedText = formatText(this.text(locale, "totalRowsLabel"), loaded);
    return rm.isInfinite && total > loaded ? `${loadedText} / ${total}` : loadedText;
  }

  private rangeAggregateText(locale: AnyLocale): string {
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
        const value = this.core.getCellValue(node, column);
        if (typeof value !== "number" || Number.isNaN(value)) continue;
        sum += value;
        count++;
      }
    }
    if (count === 0) return "";
    const average = Math.round((sum / count) * 100) / 100;
    const sumText = Number.isInteger(sum) ? String(sum) : String(Math.round(sum * 100) / 100);
    return `${this.text(locale, "statusSum", sumText)} · ${this.text(locale, "statusAvg", String(average))} · ${this.text(locale, "statusCount", String(count))}`;
  }

  refresh(): void {
    if (!this.barEl || this.core.isDestroyed()) return;
    const options = this.core.options;
    this.barEl.style.display = options.statusBarEnabled ? "" : "none";
    if (!options.statusBarEnabled) return;

    const locale: AnyLocale = { ...DEFAULT_LOCALE, ...options.locale };
    if (this.items.rowCount) this.updateItem("rowCount", this.rowCountText(locale));
    if (this.items.selectedRowCount) {
      const count = this.core.selectionService.getSelectedNodes().length;
      this.updateItem("selectedRowCount", formatText(this.text(locale, "statusSelected"), count));
    }
    if (this.items.rangeAggregate) this.updateItem("rangeAggregate", this.rangeAggregateText(locale));
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.barEl?.remove();
    this.barEl = null;
  }
}
