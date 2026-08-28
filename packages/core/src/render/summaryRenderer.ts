import type { GridCore } from "../core/gridCore";
import type { PaneType } from "../services/columnModel";
import { el } from "../lib/dom";
import { DEFAULT_LOCALE, formatText } from "../lib/locale";

type SummaryContext = Pick<
  GridCore<any>,
  "columnModel" | "getCellValue" | "isDestroyed" | "options" | "reportError" | "rowModel" | "skeleton"
>;

export class SummaryRenderer {
  private footerEl: HTMLElement | null = null;
  private rows: Record<PaneType, HTMLElement> = { left: undefined!, center: undefined!, right: undefined! };
  private cellsByPane: Record<PaneType, HTMLElement[]> = { left: [], center: [], right: [] };

  constructor(private core: SummaryContext) {}

  init(): void {
    this.footerEl = el("div", "mach-footer");
    this.footerEl.style.display = "none";
    this.footerEl.setAttribute("role", "row");
    this.core.skeleton.root.appendChild(this.footerEl);
    for (const pane of ["left", "center", "right"] as PaneType[]) {
      const row = el("div", `mach-footer-row mach-footer-row--${pane}`);
      row.style.height = `${this.core.options.rowHeight}px`;
      this.footerEl.appendChild(row);
      this.rows[pane] = row;
    }
  }

  setVisible(visible: boolean): void {
    if (!this.footerEl) return;
    this.footerEl.style.display = visible ? "" : "none";
  }

  refresh(): void {
    if (!this.footerEl || this.core.isDestroyed()) return;
    const show = this.core.options.showSummary;
    this.setVisible(show);
    if (!show) return;

    const method = this.core.options.summaryMethod;
    const masterRows = this.core.rowModel.getDisplayedRows().filter((n) => !n.isDetail && !n.isGroup);
    const locale = { ...DEFAULT_LOCALE, ...this.core.options.locale };

    for (const pane of ["left", "center", "right"] as PaneType[]) {
      const cols = this.core.columnModel.getPaneColumns(pane);
      const row = this.rows[pane];
      if (this.cellsByPane[pane].length !== cols.length) {
        row.textContent = "";
        this.cellsByPane[pane] = cols.map(() => {
          const cell = el("div", "mach-footer-cell");
          cell.setAttribute("role", "cell");
          row.appendChild(cell);
          return cell;
        });
      }
      let x = 0;
      cols.forEach((col, i) => {
        const cell = this.cellsByPane[pane][i];
        cell.style.left = `${x}px`;
        cell.style.width = `${col.currentWidth}px`;
        x += col.currentWidth;

        if (col.hasCheckbox || col.isDetailToggle || col.colDef.rowDrag) {
          cell.textContent = "";
          return;
        }
        if (method) {
          try {
            cell.textContent = method({
              colId: col.id,
              column: col,
              values: masterRows.map((node) => this.core.getCellValue(node, col))
            });
          } catch (error) {
            this.core.reportError(error, "summaryMethod", { colId: col.id });
            cell.textContent = "";
          }
        } else if (i === 0 && pane === "left") {
          cell.textContent = formatText(locale.totalRowsLabel, masterRows.length);
        } else {
          cell.textContent = "";
        }
      });
    }
  }

  destroy(): void {
    this.footerEl?.remove();
    this.footerEl = null;
  }
}
