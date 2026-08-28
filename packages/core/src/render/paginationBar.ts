import type { GridCore } from "../core/gridCore";
import { el } from "../lib/dom";
import { DEFAULT_LOCALE, formatText, formatTwo } from "../lib/locale";

type PaginationContext = Pick<
  GridCore<any>,
  "eventBus" | "isDestroyed" | "options" | "rowModel" | "skeleton"
>;

export class PaginationBar {
  private barEl: HTMLElement | null = null;
  private totalEl: HTMLElement | null = null;
  private pageEl: HTMLElement | null = null;
  private sizeSelect: HTMLSelectElement | null = null;
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

    const mkBtn = (cls: string, label: string, text: string): HTMLButtonElement => {
      const btn = el("button", `mach-pagination-btn ${cls}`) as HTMLButtonElement;
      btn.type = "button";
      btn.title = label;
      btn.setAttribute("aria-label", label);
      btn.textContent = text;
      return btn;
    };

    this.totalEl = el("span", "mach-pagination-total");
    this.firstBtn = mkBtn("mach-pagination-first", this.t("pageFirst"), "«");
    this.prevBtn = mkBtn("mach-pagination-prev", this.t("pagePrev"), "‹");
    this.pageEl = el("span", "mach-pagination-page");
    this.nextBtn = mkBtn("mach-pagination-next", this.t("pageNext"), "›");
    this.lastBtn = mkBtn("mach-pagination-last", this.t("pageLast"), "»");

    this.firstBtn.addEventListener("click", () => this.core.rowModel.setPage(1));
    this.prevBtn.addEventListener("click", () => this.core.rowModel.setPage(this.core.rowModel.getCurrentPage() - 1));
    this.nextBtn.addEventListener("click", () => this.core.rowModel.setPage(this.core.rowModel.getCurrentPage() + 1));
    this.lastBtn.addEventListener("click", () => this.core.rowModel.setPage(this.core.rowModel.getPageCount()));

    this.barEl.append(this.totalEl, this.firstBtn, this.prevBtn, this.pageEl, this.nextBtn, this.lastBtn);

    if (this.core.options.paginationShowSizeSelector) {
      this.sizeSelect = document.createElement("select");
      this.sizeSelect.className = "mach-pagination-size";
      this.sizeSelect.setAttribute("aria-label", "page size");
      this.buildSizeOptions();
      this.sizeSelect.addEventListener("change", () => {
        const size = Number(this.sizeSelect!.value);
        if (!Number.isNaN(size)) this.core.rowModel.setPageSize(size);
      });
      this.barEl.appendChild(this.sizeSelect);
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
    const options = this.core.options.paginationPageSizeOptions;
    const current = this.core.options.paginationPageSize;
    if (!options.includes(current)) {
      options.push(current);
      options.sort((a, b) => a - b);
    }
    this.sizeSelect.textContent = "";
    for (const size of options) {
      const option = document.createElement("option");
      option.value = String(size);
      option.textContent = formatText(this.t("perPage"), size);
      if (size === current) option.selected = true;
      this.sizeSelect.appendChild(option);
    }
  }

  private t(key: Parameters<GridCore<any>["getLocaleText"]>[0]): string {
    return this.core.options.locale?.[key] ?? DEFAULT_LOCALE[key];
  }

  rebuild(): void {
    if (!this.barEl) return;
    if (this.sizeSelect && this.core.options.paginationShowSizeSelector) {
      this.buildSizeOptions();
    }
    this.refresh();
  }

  refresh(): void {
    if (!this.barEl || this.core.isDestroyed()) return;
    const rm = this.core.rowModel;
    const active = rm.paginationActive;
    const total = rm.getTotalRowCount();
    const visible = active && total > 0;
    this.barEl.style.display = visible ? "" : "none";
    if (!visible) return;

    const page = rm.getCurrentPage();
    const pageCount = rm.getPageCount();

    if (this.totalEl && this.core.options.paginationShowTotal) {
      const text = formatText(this.t("paginationTotal"), total);
      if (this.totalEl.textContent !== text) this.totalEl.textContent = text;
    }
    if (this.pageEl) {
      const text = formatTwo(this.t("paginationPage"), page, pageCount);
      if (this.pageEl.textContent !== text) this.pageEl.textContent = text;
    }
    if (this.firstBtn) this.firstBtn.disabled = page <= 1;
    if (this.prevBtn) this.prevBtn.disabled = page <= 1;
    if (this.nextBtn) this.nextBtn.disabled = page >= pageCount;
    if (this.lastBtn) this.lastBtn.disabled = page >= pageCount;
    if (this.sizeSelect && Number(this.sizeSelect.value) !== this.core.options.paginationPageSize) {
      this.sizeSelect.value = String(this.core.options.paginationPageSize);
    }
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.barEl?.remove();
    this.barEl = null;
  }
}
