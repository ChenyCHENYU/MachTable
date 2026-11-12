import type { GridCore } from "../core/gridCore";
import { el, textButton } from "../lib/dom";
import { formatText, formatTwo } from "../lib/locale";
import { createSelectControl, type SelectControl } from "../lib/selectControl";

type PaginationContext = Pick<
  GridCore<any>,
  "eventBus" | "getLocaleText" | "isDisposed" | "gridOptions" | "rowModel" | "skeleton"
>;

/** @internal Pagination DOM ownership stays in Core; the public API delegates through closures. */
export class PaginationBar {
  private barEl: HTMLElement | null = null;
  private totalEl: HTMLElement | null = null;
  private pageEl: HTMLElement | null = null;
  private sizeSelect: HTMLSelectElement | null = null;
  private sizeControl: SelectControl | null = null;
  private firstBtn: HTMLButtonElement | null = null;
  private prevBtn: HTMLButtonElement | null = null;
  private nextBtn: HTMLButtonElement | null = null;
  private lastBtn: HTMLButtonElement | null = null;
  private offs: (() => void)[] = [];

  constructor(private core: PaginationContext) {}

  init(): void {
    this.barEl = el("div", "mach-pagination");
    this.barEl.style.display = "none";
    this.barEl.setAttribute("role", "navigation");

    const mkBtn = (cls: string, label: string, text: string, action: () => void): HTMLButtonElement => {
      const btn = textButton(`mach-pagination-btn ${cls}`, text, action);
      btn.title = label;
      btn.setAttribute("aria-label", label);
      return btn;
    };

    this.totalEl = el("span", "mach-pagination-total");
    this.firstBtn = mkBtn("mach-pagination-first", this.core.getLocaleText("pageFirst"), "«", () => this.core.rowModel.setPage(1));
    this.prevBtn = mkBtn("mach-pagination-prev", this.core.getLocaleText("pagePrev"), "‹", () => this.core.rowModel.setPage(this.core.rowModel.getCurrentPage() - 1));
    this.pageEl = el("span", "mach-pagination-page");
    this.nextBtn = mkBtn("mach-pagination-next", this.core.getLocaleText("pageNext"), "›", () => this.core.rowModel.setPage(this.core.rowModel.getCurrentPage() + 1));
    this.lastBtn = mkBtn("mach-pagination-last", this.core.getLocaleText("pageLast"), "»", () => this.core.rowModel.setPage(this.core.rowModel.getPageCount()));

    this.barEl.append(this.totalEl, this.firstBtn, this.prevBtn, this.pageEl, this.nextBtn, this.lastBtn);

    if (this.core.gridOptions.paginationShowSizeSelector) {
      this.sizeControl = createSelectControl({
        ariaLabel: "page size",
        options: [],
        classNames: {
          root: "mach-pagination-size-control",
          native: "mach-pagination-size"
        },
        themeSource: this.core.skeleton.root,
        onChange: (value) => {
          const size = Number(value);
          if (!Number.isNaN(size)) this.core.rowModel.setPageSize(size);
        }
      });
      this.sizeSelect = this.sizeControl.native;
      this.buildSizeOptions();
      this.barEl.appendChild(this.sizeControl.el);
    }

    this.core.skeleton.root.appendChild(this.barEl);

    this.offs.push(
      this.core.eventBus.on("modelUpdated", () => this.refresh()),
      this.core.eventBus.on("paginationChanged", () => this.refresh())
    );
    this.refresh();
  }

  private buildSizeOptions(): void {
    if (!this.sizeSelect) return;
    const options = this.core.gridOptions.paginationPageSizeOptions;
    const current = this.core.gridOptions.paginationPageSize;
    if (!options.includes(current)) {
      options.push(current);
      options.sort((a, b) => a - b);
    }
    this.sizeControl?.setOptions(
      options.map((size) => ({ value: String(size), label: formatText(this.core.getLocaleText("perPage"), size) })),
      String(current)
    );
  }

  rebuild(): void {
    if (!this.barEl) return;
    if (this.sizeSelect && this.core.gridOptions.paginationShowSizeSelector) {
      this.buildSizeOptions();
    }
    this.refresh();
  }

  private setText(element: HTMLElement | null, text: string): void {
    if (element && element.textContent !== text) element.textContent = text;
  }

  private refreshNavigation(page: number, pageCount: number): void {
    const atStart = page <= 1;
    const atEnd = page >= pageCount;
    if (this.firstBtn) this.firstBtn.disabled = atStart;
    if (this.prevBtn) this.prevBtn.disabled = atStart;
    if (this.nextBtn) this.nextBtn.disabled = atEnd;
    if (this.lastBtn) this.lastBtn.disabled = atEnd;
  }

  refresh(): void {
    if (!this.barEl || this.core.isDisposed()) return;
    const rm = this.core.rowModel;
    const active = rm.paginationActive;
    const total = rm.getTotalRowCount();
    const visible = active && total > 0;
    this.barEl.style.display = visible ? "" : "none";
    if (!visible) return;

    const page = rm.getCurrentPage();
    const pageCount = rm.getPageCount();

    if (this.totalEl && this.core.gridOptions.paginationShowTotal) {
      this.setText(this.totalEl, formatText(this.core.getLocaleText("paginationTotal"), total));
    }
    this.setText(this.pageEl, formatTwo(this.core.getLocaleText("paginationPage"), page, pageCount));
    this.refreshNavigation(page, pageCount);
    if (this.sizeSelect && Number(this.sizeSelect.value) !== this.core.gridOptions.paginationPageSize) {
      this.sizeControl?.setValue(String(this.core.gridOptions.paginationPageSize));
    }
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.sizeControl?.destroy();
    this.sizeControl = null;
    this.sizeSelect = null;
    this.barEl?.remove();
    this.barEl = null;
  }
}
