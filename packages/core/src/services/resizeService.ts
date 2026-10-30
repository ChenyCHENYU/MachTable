import type { GridCore } from "../core/gridCore";
import type { Column } from "./column";

type ResizeContext = Pick<
  GridCore<any>,
  | "columnModel"
  | "columnSizing"
  | "commitColumnWidths"
  | "emitColumnResize"
  | "gridOptions"
  | "relayoutColumns"
  | "skeleton"
>;

interface ActiveResize {
  column: Column;
  didResize: boolean;
  handle: HTMLElement;
  pointerId: number;
  startFlex: number | null;
  startManualWidth: number | null;
  startMinWidth: number | undefined;
  startWidth: number;
  startX: number;
}

/** @internal Resize interaction ownership stays with Core. */
export class ResizeService {
  private activeColumnResize: ActiveResize | null = null;
  private rafId = 0;
  private pendingWidth = 0;
  private guide: HTMLElement | null = null;
  private widthLabel: HTMLElement | null = null;

  constructor(private core: ResizeContext) {}

  startResize(event: PointerEvent, column: Column): void {
    if (!this.core.gridOptions.enableColumnResize || !column.resizable || event.isPrimary === false) return;
    this.cancelResize();

    const handle = event.currentTarget as HTMLElement;
    const startWidth = column.currentWidth;
    this.pendingWidth = startWidth;
    this.activeColumnResize = {
      column,
      didResize: false,
      handle,
      pointerId: event.pointerId,
      startFlex: column.flex,
      startManualWidth: column.manualWidth,
      startMinWidth: column.minWidth,
      startWidth,
      startX: event.clientX
    };

    this.core.columnSizing.prepareResize(column);
    window.addEventListener("pointermove", this.onMove);
    // Capture phase finalizes before the browser's normal lostpointercapture event.
    window.addEventListener("pointerup", this.onUp, true);
    window.addEventListener("pointercancel", this.onCancel, true);
    handle.addEventListener("lostpointercapture", this.onLostPointerCapture);
    try {
      handle.setPointerCapture?.(event.pointerId);
    } catch {
      // Window listeners keep resizing functional when pointer capture is unavailable.
    }
    this.core.skeleton.root.classList.add("mach-root--resizing");
    handle.classList.add("mach-header-resize--active");
    this.showFeedback(this.activeColumnResize);
  }

  cancelResize(restore = true): void {
    const active = this.activeColumnResize;
    if (!active) return;
    this.activeColumnResize = null;
    this.clearFrame();
    this.removeListeners(active);
    if (restore) {
      active.column.manualWidth = active.startManualWidth;
      active.column.minWidth = active.startMinWidth;
      active.column.flex = active.startFlex;
      this.core.relayoutColumns();
    }
    this.core.skeleton.root.classList.remove("mach-root--resizing");
    this.removeFeedback(active);
  }

  private onMove = (event: PointerEvent): void => {
    const active = this.matchActivePointer(event);
    if (!active) return;
    this.pendingWidth = this.widthFromPointer(active, event.clientX);
    active.didResize ||= Math.abs(this.pendingWidth - active.startWidth) >= 0.5;
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      this.applyPendingWidth();
    });
  };

  private onUp = (event: PointerEvent): void => {
    const active = this.matchActivePointer(event);
    if (!active) return;
    this.pendingWidth = this.widthFromPointer(active, event.clientX);
    active.didResize ||= Math.abs(this.pendingWidth - active.startWidth) >= 0.5;
    this.finishResize(active);
  };

  private onCancel = (event: PointerEvent): void => {
    if (!this.matchActivePointer(event)) return;
    this.cancelResize();
  };

  private onLostPointerCapture = (): void => {
    this.cancelResize();
  };

  private finishResize(active: ActiveResize): void {
    this.activeColumnResize = null;
    this.clearFrame();
    if (active.didResize) {
      if (Math.abs(this.pendingWidth - active.startWidth) < 0.5) {
        active.column.manualWidth = active.startManualWidth;
      active.column.minWidth = active.startMinWidth;
        active.column.flex = active.startFlex;
      } else {
        this.core.columnModel.setColumnWidth(active.column, this.pendingWidth);
      }
      this.core.relayoutColumns();
    }
    this.removeListeners(active);
    try {
      active.handle.releasePointerCapture?.(active.pointerId);
    } catch {
      // The capture can already be released by the browser.
    }
    this.core.skeleton.root.classList.remove("mach-root--resizing");
    this.removeFeedback(active);
    if (active.didResize) this.core.commitColumnWidths([active.column]);
  }

  private applyPendingWidth(): void {
    const active = this.activeColumnResize;
    if (!active || !this.core.columnModel.setColumnWidth(active.column, this.pendingWidth)) return;
    this.core.relayoutColumns();
    this.updateFeedback(active);
    this.core.emitColumnResize(active.column, false);
  }

  private showFeedback(active: ActiveResize): void {
    this.guide = document.createElement("div");
    this.guide.className = "mach-column-resize-guide";
    this.guide.setAttribute("aria-hidden", "true");
    this.widthLabel = document.createElement("span");
    this.widthLabel.className = "mach-column-resize-label";
    this.guide.appendChild(this.widthLabel);
    this.core.skeleton.root.appendChild(this.guide);
    this.updateFeedback(active);
  }

  private updateFeedback(active: ActiveResize): void {
    if (!this.guide || !this.widthLabel) return;
    const root = this.core.skeleton.root;
    const rootRect = root.getBoundingClientRect();
    const headerRect = active.handle.parentElement!.getBoundingClientRect();
    const boundary = Math.max(0, Math.min(root.clientWidth, headerRect.right - rootRect.left - root.clientLeft));
    const labelCenter = Math.max(32, Math.min(root.clientWidth - 32, boundary));
    this.guide.style.left = `${boundary}px`;
    this.guide.style.top = `${Math.max(0, headerRect.top - rootRect.top - root.clientTop)}px`;
    this.widthLabel.style.left = `${labelCenter - boundary}px`;
    this.widthLabel.textContent = `${Math.round(active.column.currentWidth)} px`;
  }

  private removeFeedback(active: ActiveResize): void {
    active.handle.classList.remove("mach-header-resize--active");
    this.guide?.remove();
    this.guide = null;
    this.widthLabel = null;
  }

  private widthFromPointer(active: ActiveResize, clientX: number): number {
    const pointerX = Number.isFinite(clientX) ? clientX : active.startX;
    return Math.max(1, active.startWidth + pointerX - active.startX);
  }

  private matchActivePointer(event: PointerEvent): ActiveResize | null {
    const active = this.activeColumnResize;
    return active && event.pointerId === active.pointerId ? active : null;
  }

  private clearFrame(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  private removeListeners(active: ActiveResize): void {
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp, true);
    window.removeEventListener("pointercancel", this.onCancel, true);
    active.handle.removeEventListener("lostpointercapture", this.onLostPointerCapture);
  }

  destroy(): void {
    this.cancelResize(false);
    this.clearFrame();
    this.core.skeleton.root?.classList.remove("mach-root--resizing");
  }
}
