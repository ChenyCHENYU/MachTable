import type { GridCore } from "../core/gridCore";
import type { Column } from "./column";
import { clamp } from "../lib/dom";

type ResizeContext = Pick<
  GridCore<any>,
  "columnModel" | "emit" | "persistColumnState" | "relayoutColumns" | "skeleton"
>;

export class ResizeService {
  private active: {
    column: Column;
    startX: number;
    startWidth: number;
    pointerId: number;
    handle: HTMLElement;
  } | null = null;
  private rafId = 0;
  private pendingWidth = 0;

  constructor(private core: ResizeContext) {}

  startResize(e: PointerEvent, column: Column): void {
    const handle = e.currentTarget as HTMLElement;
    const def = column.colDef;
    const startWidth = column.manualWidth ?? column.currentWidth;
    const minWidth = def.minWidth ?? 80;
    if (startWidth < minWidth && def.width == null) {
      column.manualWidth = startWidth;
    }
    this.active = { column, startX: e.clientX, startWidth: column.manualWidth ?? startWidth, pointerId: e.pointerId, handle };
    handle.setPointerCapture(e.pointerId);
    handle.addEventListener("pointermove", this.onMove);
    handle.addEventListener("pointerup", this.onUp);
    handle.addEventListener("pointercancel", this.onUp);
    this.core.skeleton.root.classList.add("mach-root--resizing");
  }

  private onMove = (e: PointerEvent): void => {
    const active = this.active;
    if (!active) return;
    const def = active.column.colDef;
    const min = def.minWidth ?? 80;
    const max = def.maxWidth ?? Number.MAX_SAFE_INTEGER;
    this.pendingWidth = clamp(active.startWidth + (e.clientX - active.startX), min, max);
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      const current = this.active;
      if (!current) return;
      this.core.columnModel.setColumnWidth(current.column, this.pendingWidth);
      this.core.relayoutColumns();
      this.core.emit("columnResized", {
        colId: current.column.id,
        width: this.pendingWidth,
        finished: false
      });
    });
  };

  private onUp = (e: PointerEvent): void => {
    const active = this.active;
    if (!active) return;
    this.active = null;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.core.columnModel.setColumnWidth(active.column, this.pendingWidth);
      this.core.relayoutColumns();
    }
    this.rafId = 0;
    active.handle.removeEventListener("pointermove", this.onMove);
    active.handle.removeEventListener("pointerup", this.onUp);
    active.handle.removeEventListener("pointercancel", this.onUp);
    try {
      active.handle.releasePointerCapture(e.pointerId);
    } catch {
      void 0;
    }
    this.core.skeleton.root.classList.remove("mach-root--resizing");
    this.core.emit("columnResized", {
      colId: active.column.id,
      width: active.column.manualWidth ?? active.column.currentWidth,
      finished: true
    });
    this.core.persistColumnState();
  };

  destroy(): void {
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    if (this.active) {
      const active = this.active;
      this.active = null;
      active.handle.removeEventListener("pointermove", this.onMove);
      active.handle.removeEventListener("pointerup", this.onUp);
      active.handle.removeEventListener("pointercancel", this.onUp);
    }
    this.core.skeleton.root?.classList.remove("mach-root--resizing");
  }
}
