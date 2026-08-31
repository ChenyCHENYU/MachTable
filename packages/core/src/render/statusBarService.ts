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

  refresh(): void {
    if (!this.barEl || this.core.isDestroyed()) return;
    const options = this.core.options;
    this.barEl.style.display = options.statusBarEnabled ? "" : "none";
    if (!options.statusBarEnabled) return;

    const locale: AnyLocale = { ...DEFAULT_LOCALE, ...options.locale };
    const text = (key: MachTableLocaleKey, value?: number | string): string => {
      const template = locale[key] ?? DEFAULT_LOCALE[key];
      return value === undefined ? template : formatText(template, typeof value === "number" ? value : parseFloat(String(value)) || 0);
    };

    if (this.items.rowCount) {
      const rm = this.core.rowModel;
      const total = rm.getDisplayTotalCount();
      const loaded = rm.paginationActive ? rm.getTotalRowCount() : rm.getDisplayedRowCount();
      const value =
        rm.isInfinite && total > loaded
          ? `${formatText(text("totalRowsLabel"), loaded)} / ${total}`
          : formatText(text("totalRowsLabel"), loaded);
      if (this.items.rowCount.textContent !== value) this.items.rowCount.textContent = value;
    }

    if (this.items.selectedRowCount) {
      const count = this.core.selectionService.getSelectedNodes().length;
      const value = formatText(text("statusSelected"), count);
      if (this.items.selectedRowCount.textContent !== value) {
        this.items.selectedRowCount.textContent = value;
      }
    }

    if (this.items.rangeAggregate) {
      const range = this.core.bodyRenderer.normalizedRange();
      let value = "";
      if (range) {
        const flat = this.core.columnModel.getOrderedVisible();
        let sum = 0;
        let count = 0;
        for (let r = range.r1; r <= range.r2; r++) {
          const node = this.core.rowModel.getDisplayedRow(r);
          if (!node || node.isDetail || node.isGroup) continue;
          for (let c = range.c1; c <= range.c2; c++) {
            const col = flat[c];
            if (!col) continue;
            const v = this.core.getCellValue(node, col);
            if (typeof v === "number" && !isNaN(v)) {
              sum += v;
              count++;
            }
          }
        }
        if (count > 0) {
          const avg = Math.round((sum / count) * 100) / 100;
          const sumText = Number.isInteger(sum) ? String(sum) : String(Math.round(sum * 100) / 100);
          value = `${text("statusSum", sumText)} · ${text("statusAvg", String(avg))} · ${text("statusCount", String(count))}`;
        }
      }
      if (this.items.rangeAggregate.textContent !== value) this.items.rangeAggregate.textContent = value;
    }
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.barEl?.remove();
    this.barEl = null;
  }
}
