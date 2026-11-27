import type { GridCore } from "../core/gridCore";
import { el, textButton } from "../lib/dom";
import { formatText, formatTwo } from "../lib/locale";
import { createSelectControl, type SelectControl } from "../lib/selectControl";

type PaginationContext = Pick<
  GridCore<any>,
  "eventBus" | "getLocaleText" | "isDisposed" | "gridOptions" | "rowModel" | "skeleton"
>;

function navigationButton(label: string, text: string, action: () => void, kind: string): HTMLButtonElement {
  const button = textButton(`mach-pagination-btn mach-pagination-${kind}`, text, action);
  button.title = label;
  button.setAttribute("aria-label", label);
  return button;
}

/** @internal Pagination DOM ownership stays in Core; the public API delegates through closures. */
export class PaginationBar {
  private barEl: HTMLElement | null = null;
  private totalEl: HTMLElement | null = null;
  private pageEl: HTMLElement | null = null;
  private sizeControl: SelectControl | null = null;
  private navigation: readonly [HTMLButtonElement, HTMLButtonElement, HTMLButtonElement, HTMLButtonElement] | null = null;
  private jumpInput: HTMLInputElement | null = null;
  private offs: (() => void)[] = [];

  constructor(private core: PaginationContext) {}

  init(): void {
    this.barEl = el("div", "mach-pagination");
    this.barEl.style.display = "none";
    this.barEl.setAttribute("role", "navigation");

    this.totalEl = el("span", "mach-pagination-total");
    this.pageEl = el("span", "mach-pagination-page");
    const rm = this.core.rowModel;
    const first = navigationButton(this.core.getLocaleText("pageFirst"), "«", () => rm.setPage(1), "first");
    const prev = navigationButton(this.core.getLocaleText("pagePrev"), "‹", () => rm.setPage(rm.getCurrentPage() - 1), "prev");
    const next = navigationButton(this.core.getLocaleText("pageNext"), "›", () => rm.setPage(rm.getCurrentPage() + 1), "next");
    const last = navigationButton(this.core.getLocaleText("pageLast"), "»", () => rm.setPage(rm.getPageCount()), "last");
    this.navigation = [first, prev, next, last];
    this.barEl.append(this.totalEl, first, prev, this.pageEl, next, last);

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
      this.barEl.appendChild(this.sizeControl.el);
    }

    this.core.skeleton.root.appendChild(this.barEl);
    this.offs.push(
      this.core.eventBus.on("modelUpdated", () => this.refresh()),
      this.core.eventBus.on("paginationChanged", () => this.refresh())
    );
    this.rebuild();
  }

  private createJumpInput(): HTMLInputElement {
    const control = el("span", "mach-pagination-jump");
    const label = this.core.getLocaleText("pageJump");
    const input = el("input", undefined, { inputmode: "numeric", "aria-label": label });
    const submit = () => {
      if (this.jumpInput !== input) return;
      const value = input.value.trim();
      if (/^\d+$/.test(value)) this.core.rowModel.setPage(Number(value));
      input.value = String(this.core.rowModel.getCurrentPage());
    };
    input.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      } else if (event.key === "Escape" && input.value !== input.defaultValue) {
        event.stopPropagation();
        input.value = input.defaultValue;
      }
    });
    control.append(input, navigationButton(label, "↵", submit, "go"));
    this.barEl?.appendChild(control);
    return input;
  }

  private refreshJumpInput(page: number, enabled: boolean): void {
    if (!enabled) {
      this.jumpInput?.parentElement?.remove();
      this.jumpInput = null;
      return;
    }
    const input = this.jumpInput ??= this.createJumpInput();
    const current = String(page);
    // Keep a draft while an unrelated render refreshes the pager.
    if (input.defaultValue !== current) input.value = input.defaultValue = current;
  }

  private buildSizeOptions(): void {
    if (!this.sizeControl) return;
    const options = this.core.gridOptions.paginationPageSizeOptions;
    const current = this.core.gridOptions.paginationPageSize;
    if (!options.includes(current)) {
      options.push(current);
      options.sort((a, b) => a - b);
    }
    this.sizeControl.setOptions(
      options.map((size) => ({ value: String(size), label: formatText(this.core.getLocaleText("perPage"), size) })),
      String(current)
    );
  }

  rebuild(): void {
    if (!this.barEl) return;
    if (this.core.gridOptions.paginationShowSizeSelector) {
      this.buildSizeOptions();
    }
    this.refresh();
  }

  private setText(element: HTMLElement | null, text: string): void {
    if (element && element.textContent !== text) element.textContent = text;
  }

  private refreshNavigation(page: number, pageCount: number): void {
    if (this.navigation) {
      const [first, prev, next, last] = this.navigation;
      first.disabled = prev.disabled = page <= 1;
      next.disabled = last.disabled = page >= pageCount;
    }
  }

  refresh(): void {
    if (!this.barEl || this.core.isDisposed()) return;
    const rm = this.core.rowModel;
    const active = rm.paginationActive;
    const total = rm.getTotalRowCount();
    const visible = active && total > 0;
    this.barEl.style.display = visible ? "" : "none";
    const page = rm.getCurrentPage();
    const pageCount = visible ? rm.getPageCount() : 1;
    const showJump = pageCount > 1 && this.core.gridOptions.paginationShowPageJump;
    if (showJump || this.jumpInput) this.refreshJumpInput(page, showJump);
    if (!visible) return;

    if (this.totalEl && this.core.gridOptions.paginationShowTotal) {
      this.setText(this.totalEl, formatText(this.core.getLocaleText("paginationTotal"), total));
    }
    this.setText(this.pageEl, formatTwo(this.core.getLocaleText("paginationPage"), page, pageCount));
    this.refreshNavigation(page, pageCount);
    const sizeControl = this.sizeControl;
    if (sizeControl && Number(sizeControl.native.value) !== this.core.gridOptions.paginationPageSize) {
      sizeControl.setValue(String(this.core.gridOptions.paginationPageSize));
    }
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.sizeControl?.destroy();
    this.sizeControl = null;
    this.navigation = null;
    this.jumpInput = null;
    this.barEl?.remove();
    this.barEl = null;
  }
}
