import type { GridCore } from "../core/gridCore";
import type { Column } from "./column";

type ResizeContext = Pick<
  GridCore<any>,
  | "columnModel"
  | "commitColumnWidths"
  | "emitColumnResize"
  | "options"
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
  startWidth: number;
  startX: number;
}

export class ResizeService {
  private active: ActiveResize | null = null;
  private rafId = 0;
  private pendingWidth = 0;

  constructor(private core: ResizeContext) {}

  startResize(event: PointerEvent, column: Column): void {
    if (!this.core.options.enableColumnResize || !column.resizable || event.isPrimary === false) return;
    this.cancelResize();

    const handle = event.currentTarget as HTMLElement;
    const startWidth = column.currentWidth;
    this.pendingWidth = startWidth;
    this.active = {
      column,
      didResize: false,
      handle,
      pointerId: event.pointerId,
      startFlex: column.flex,
      startManualWidth: column.manualWidth,
      startWidth,
      startX: event.clientX
    };

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
  }

  cancelResize(restore = true): void {
    const active = this.active;
    if (!active) return;
    this.active = null;
    this.clearFrame();
    this.removeListeners(active);
    if (restore) {
      active.column.manualWidth = active.startManualWidth;
      active.column.flex = active.startFlex;
      this.core.relayoutColumns();
    }
    this.core.skeleton.root.classList.remove("mach-root--resizing");
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
    this.active = null;
    this.clearFrame();
    if (active.didResize) {
      if (Math.abs(this.pendingWidth - active.startWidth) < 0.5) {
        active.column.manualWidth = active.startManualWidth;
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
    if (active.didResize) this.core.commitColumnWidths([active.column]);
  }

  private applyPendingWidth(): void {
    const active = this.active;
    if (!active || !this.core.columnModel.setColumnWidth(active.column, this.pendingWidth)) return;
    this.core.relayoutColumns();
    this.core.emitColumnResize(active.column, false);
  }

  private widthFromPointer(active: ActiveResize, clientX: number): number {
    const pointerX = Number.isFinite(clientX) ? clientX : active.startX;
    return active.startWidth + pointerX - active.startX;
  }

  private matchActivePointer(event: PointerEvent): ActiveResize | null {
    const active = this.active;
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
