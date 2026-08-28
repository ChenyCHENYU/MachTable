import type { GridCore } from "../core/gridCore";
import type { GridSize, OverlayTemplate, ResolvedGridOptions, ThemeMode } from "../types/options";
import type { PaneType } from "../services/columnModel";
import { el } from "../lib/dom";

const SIZE_CLASSES: GridSize[] = ["compact", "normal", "large"];
type SkeletonContext = Pick<GridCore<any>, "options" | "relayout" | "reportError">;

export class GridSkeleton {
  root!: HTMLElement;
  headerEl!: HTMLElement;
  bodyEl!: HTMLElement;
  pinnedTopEl!: HTMLElement;
  pinnedBottomEl!: HTMLElement;
  headerRows: Record<PaneType, HTMLElement[]> = { left: [], center: [], right: [] };
  headerRowContainers: Record<PaneType, HTMLElement> = {} as Record<PaneType, HTMLElement>;
  bodyViewports!: Record<PaneType, HTMLElement>;
  rowContainers!: Record<PaneType, HTMLElement>;

  private headerPanes!: Record<PaneType, HTMLElement>;
  private bodyPanes!: Record<PaneType, HTMLElement>;
  private overlayWrapper!: HTMLElement;
  private overlayContent!: HTMLElement;
  private infiniteLoadingEl!: HTMLElement;
  private infiniteLoadingText!: HTMLElement;
  private currentOverlay: "loading" | "noRows" | null = null;
  private currentOverlayContent: OverlayTemplate | null = null;
  private currentOverlayAllowsHtml = false;
  private customClassTokens: string[] = [];
  private resizeObserver: ResizeObserver | null = null;
  private headerDepth = 1;

  constructor(private core: SkeletonContext) {}

  init(container: HTMLElement, options: ResolvedGridOptions): void {
    const classes = ["mach-root", `mach-size--${options.size}`];
    if (options.stripedRows) classes.push("mach-striped");
    if (options.showCellBorders) classes.push("mach-cell-borders");
    this.root = el("div", classes.join(" "));
    this.setCustomClass(options.className);
    this.root.style.setProperty("--mach-row-h", `${options.rowHeight}px`);
    this.root.style.setProperty("--mach-header-h", `${options.headerHeight}px`);
    this.root.setAttribute("role", "grid");
    this.root.tabIndex = 0;
    this.applyAriaLabels(options);

    this.headerEl = el("div", "mach-header");
    this.headerEl.setAttribute("role", "rowgroup");
    this.headerRows = { left: [], center: [], right: [] };
    this.headerPanes = {} as Record<PaneType, HTMLElement>;
    this.headerRowContainers = {} as Record<PaneType, HTMLElement>;

    for (const pane of ["left", "center", "right"] as PaneType[]) {
      const paneEl = el("div", `mach-pane mach-pane--${pane} mach-header-pane`);
      const rowsContainer = el("div", "mach-header-rows");
      if (pane === "center") {
        const viewport = el("div", "mach-header-viewport");
        viewport.appendChild(rowsContainer);
        paneEl.appendChild(viewport);
      } else {
        paneEl.appendChild(rowsContainer);
      }
      this.headerEl.appendChild(paneEl);
      this.headerPanes[pane] = paneEl;
      this.headerRowContainers[pane] = rowsContainer;
    }

    this.setHeaderRowCount(1);

    this.bodyEl = el("div", "mach-body");
    this.pinnedTopEl = el("div", "mach-pinned-rows mach-pinned-rows--top");
    this.pinnedTopEl.style.display = "none";
    this.pinnedBottomEl = el("div", "mach-pinned-rows mach-pinned-rows--bottom");
    this.pinnedBottomEl.style.display = "none";
    this.bodyViewports = {} as Record<PaneType, HTMLElement>;
    this.rowContainers = {} as Record<PaneType, HTMLElement>;
    this.bodyPanes = {} as Record<PaneType, HTMLElement>;

    for (const pane of ["left", "center", "right"] as PaneType[]) {
      const paneEl = el("div", `mach-pane mach-pane--${pane} mach-body-pane`);
      const viewport = el("div", `mach-body-viewport${pane === "center" ? " mach-body-viewport--scroll" : ""}`);
      const container = el("div", "mach-row-container");
      viewport.appendChild(container);
      paneEl.appendChild(viewport);
      this.bodyEl.appendChild(paneEl);
      this.bodyPanes[pane] = paneEl;
      this.bodyViewports[pane] = viewport;
      this.rowContainers[pane] = container;
    }

    this.overlayWrapper = el("div", "mach-overlay");
    this.overlayWrapper.style.display = "none";
    this.overlayWrapper.setAttribute("role", "status");
    this.overlayWrapper.setAttribute("aria-live", "polite");
    this.overlayContent = el("div", "mach-overlay-content");
    this.overlayWrapper.appendChild(this.overlayContent);

    this.infiniteLoadingEl = el("div", "mach-infinite-loading");
    this.infiniteLoadingEl.style.display = "none";
    this.infiniteLoadingEl.appendChild(el("div", "mach-spinner"));
    this.infiniteLoadingText = el("span");
    this.infiniteLoadingEl.appendChild(this.infiniteLoadingText);

    this.root.append(
      this.headerEl,
      this.pinnedTopEl,
      this.bodyEl,
      this.pinnedBottomEl,
      this.overlayWrapper,
      this.infiniteLoadingEl
    );
    container.appendChild(this.root);

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.core.relayout());
      this.resizeObserver.observe(this.root);
    }

    this.applyTheme(options.theme);
  }

  applyAriaLabels(options: Pick<ResolvedGridOptions, "ariaLabel" | "ariaLabelledBy" | "ariaDescribedBy">): void {
    if (options.ariaLabelledBy) {
      this.root.setAttribute("aria-labelledby", options.ariaLabelledBy);
      this.root.removeAttribute("aria-label");
    } else {
      this.root.removeAttribute("aria-labelledby");
      this.root.setAttribute("aria-label", options.ariaLabel);
    }
    if (options.ariaDescribedBy) this.root.setAttribute("aria-describedby", options.ariaDescribedBy);
    else this.root.removeAttribute("aria-describedby");
  }

  setHeaderRowCount(depth: number): void {
    this.headerDepth = depth;
    for (const pane of ["left", "center", "right"] as PaneType[]) {
      const container = this.headerRowContainers[pane];
      const rows = this.headerRows[pane];
      while (rows.length < depth) {
        const row = el("div", "mach-header-row");
        row.setAttribute("role", "row");
        row.setAttribute("aria-rowindex", String(rows.length + 1));
        row.style.top = `${rows.length * this.core.options.headerHeight}px`;
        row.style.height = `${this.core.options.headerHeight}px`;
        container.appendChild(row);
        rows.push(row);
      }
      while (rows.length > depth) {
        rows.pop()!.remove();
      }
    }
    this.applyHeaderHeight();
  }

  getHeaderRowCount(): number {
    return this.headerDepth;
  }

  private applyHeaderHeight(): void {
    this.headerEl.style.height = `${this.headerDepth * this.core.options.headerHeight}px`;
    for (const pane of ["left", "center", "right"] as PaneType[]) {
      const rows = this.headerRows[pane];
      rows.forEach((row, i) => {
        row.style.top = `${i * this.core.options.headerHeight}px`;
        row.style.height = `${this.core.options.headerHeight}px`;
      });
    }
  }

  setPaneWidths(left: number, right: number): void {
    this.applyPaneWidth("left", left);
    this.applyPaneWidth("right", right);
  }

  private applyPaneWidth(pane: PaneType, width: number): void {
    const hp = this.headerPanes[pane];
    const bp = this.bodyPanes[pane];
    hp.style.width = `${width}px`;
    bp.style.width = `${width}px`;
    const hidden = width <= 0;
    hp.classList.toggle("mach-pane--hidden", hidden);
    bp.classList.toggle("mach-pane--hidden", hidden);
  }

  measureViewportWidth(): number {
    return this.bodyViewports.center.clientWidth;
  }

  updateHeights(rowHeight: number, headerHeight: number): void {
    this.root.style.setProperty("--mach-row-h", `${rowHeight}px`);
    this.root.style.setProperty("--mach-header-h", `${headerHeight}px`);
    this.applyHeaderHeight();
  }

  applySize(size: GridSize): void {
    for (const s of SIZE_CLASSES) {
      this.root.classList.toggle(`mach-size--${s}`, s === size);
    }
  }

  private themeUnsub: (() => void) | null = null;

  applyTheme(theme: ThemeMode): void {
    if (!this.root) return;
    this.themeUnsub?.();
    this.themeUnsub = null;
    const dark = theme === "dark" || (theme === "auto" && this.systemPrefersDark());
    this.root.classList.toggle("mach-theme-dark", dark);

    if (theme === "auto" && typeof window !== "undefined" && typeof window.matchMedia === "function") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => this.root.classList.toggle("mach-theme-dark", mq.matches);
      if (typeof mq.addEventListener === "function") {
        mq.addEventListener("change", handler);
        this.themeUnsub = () => mq.removeEventListener("change", handler);
      } else if (typeof mq.addListener === "function") {
        mq.addListener(handler);
        this.themeUnsub = () => mq.removeListener(handler);
      }
    }
  }

  private systemPrefersDark(): boolean {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  setStriped(on: boolean): void {
    this.root.classList.toggle("mach-striped", on);
  }

  setCellBorders(on: boolean): void {
    this.root.classList.toggle("mach-cell-borders", on);
  }

  setCustomClass(className: string | null | undefined): void {
    for (const token of this.customClassTokens) this.root.classList.remove(token);
    this.customClassTokens = [];
    for (const token of String(className ?? "").split(/\s+/).filter(Boolean)) {
      if (this.root.classList.contains(token)) continue;
      this.root.classList.add(token);
      this.customClassTokens.push(token);
    }
  }

  showOverlay(type: "loading" | "noRows", content: OverlayTemplate, allowUnsafeHtml = false): void {
    if (
      this.currentOverlay === type &&
      this.currentOverlayContent === content &&
      this.currentOverlayAllowsHtml === allowUnsafeHtml
    ) return;
    this.currentOverlay = type;
    this.currentOverlayContent = content;
    this.currentOverlayAllowsHtml = allowUnsafeHtml;
    this.overlayContent.replaceChildren();

    let resolved: string | HTMLElement;
    try {
      resolved = typeof content === "function" ? content() : content;
    } catch (error) {
      this.core.reportError(error, "overlayTemplate");
      resolved = "";
    }

    if (resolved instanceof HTMLElement) {
      this.overlayContent.appendChild(resolved);
    } else if (resolved && allowUnsafeHtml) {
      this.overlayContent.innerHTML = resolved;
    } else if (resolved) {
      this.overlayContent.textContent = resolved;
    } else if (type === "loading") {
      const spinner = el("div", "mach-spinner");
      spinner.setAttribute("aria-label", "loading");
      this.overlayContent.appendChild(spinner);
    }
    this.overlayWrapper.style.display = "";
    this.root.setAttribute("aria-busy", type === "loading" ? "true" : "false");
  }

  hideOverlay(): void {
    if (!this.currentOverlay) return;
    this.currentOverlay = null;
    this.currentOverlayContent = null;
    this.currentOverlayAllowsHtml = false;
    this.overlayWrapper.style.display = "none";
    this.overlayContent.replaceChildren();
    this.root.setAttribute("aria-busy", "false");
  }

  setInfiniteLoading(active: boolean, text: string): void {
    if (!this.infiniteLoadingEl) return;
    if (active) {
      if (this.infiniteLoadingText.textContent !== text) this.infiniteLoadingText.textContent = text;
      this.infiniteLoadingEl.style.display = "";
      this.root.setAttribute("aria-busy", "true");
    } else {
      this.infiniteLoadingEl.style.display = "none";
      if (this.currentOverlay !== "loading") this.root.setAttribute("aria-busy", "false");
    }
  }

  destroy(): void {
    this.themeUnsub?.();
    this.themeUnsub = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.root.remove();
  }

}
