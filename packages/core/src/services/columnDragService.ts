import type { GridCore } from "../core/gridCore";
import type { Column } from "./column";
import { applyPortalTheme, clamp, el } from "../lib/dom";

const DRAG_THRESHOLD = 6;
type ColumnDragContext = Pick<
  GridCore<any>,
  "bodyRenderer" | "columnModel" | "moveColumn" | "skeleton"
>;

interface ColumnDragState {
  column: Column;
  cellEl: HTMLElement;
  ghost: HTMLElement;
  indicator: HTMLElement;
  targetIndex: number;
  pane: "left" | "center" | "right";
  containerLeft: number;
  startScrollLeft: number;
  fromIndex: number;
  midpoints: Float64Array;
  offsets: Float64Array;
  ghostWidth: number;
  ghostHeight: number;
}

export class ColumnDragService {
  private pending: { column: Column; startX: number; startY: number } | null = null;
  private dragging: ColumnDragState | null = null;
  private suppressClick = false;
  private moveRaf = 0;
  private pendingPoint: { clientX: number; clientY: number } | null = null;

  constructor(private core: ColumnDragContext) {}

  onPointerDown(e: PointerEvent, column: Column): void {
    if (e.button !== 0) return;
    if (!column.movable) return;
    this.pending = { column, startX: e.clientX, startY: e.clientY };
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onUp);
  }

  didDrag(): boolean {
    const value = this.suppressClick;
    this.suppressClick = false;
    return value;
  }

  private onMove = (e: PointerEvent): void => {
    if (this.dragging) {
      this.scheduleIndicator(e);
      return;
    }
    const pending = this.pending;
    if (!pending) return;
    if (Math.abs(e.clientX - pending.startX) < DRAG_THRESHOLD && Math.abs(e.clientY - pending.startY) < DRAG_THRESHOLD) {
      return;
    }
    this.startDrag(e);
  };

  private startDrag(e: PointerEvent): void {
    const pending = this.pending;
    if (!pending) return;
    const cellEl = this.findHeaderCell(pending.column);
    if (!cellEl || !cellEl.parentElement) {
      this.cleanup();
      return;
    }
    this.suppressClick = true;
    const indicator = el("div", "mach-drop-indicator");
    const ghost = el("div", "mach-column-drag-ghost");
    ghost.textContent = pending.column.colDef.headerName ?? pending.column.colDef.field ?? pending.column.id;
    ghost.ariaHidden = "true";
    applyPortalTheme(ghost, this.core.skeleton.root);
    document.body.appendChild(ghost);
    cellEl.parentElement.appendChild(indicator);
    cellEl.classList.add("mach-header-cell--dragging");
    this.core.skeleton.root.classList.add("mach-root--dragging");
    const pane = this.core.bodyRenderer.paneForColumn(pending.column);
    const container = this.core.skeleton.headerRowContainers[pane];
    const columns = this.core.columnModel.getPaneColumns(pane);
    const offsets = new Float64Array(columns.length + 1);
    const midpoints = new Float64Array(columns.length);
    for (let index = 0; index < columns.length; index++) {
      const width = columns[index].currentWidth;
      midpoints[index] = offsets[index] + width / 2;
      offsets[index + 1] = offsets[index] + width;
    }
    const ghostRect = ghost.getBoundingClientRect();
    this.dragging = {
      column: pending.column,
      cellEl,
      ghost,
      indicator,
      targetIndex: -1,
      pane,
      containerLeft: container.getBoundingClientRect().left,
      startScrollLeft: this.core.skeleton.bodyViewports.center.scrollLeft,
      fromIndex: columns.indexOf(pending.column),
      midpoints,
      offsets,
      ghostWidth: ghostRect.width,
      ghostHeight: ghostRect.height
    };
    this.applyIndicator(e.clientX, e.clientY);
  }

  private findHeaderCell(column: Column): HTMLElement | null {
    const pane = this.core.bodyRenderer.paneForColumn(column);
    const container = this.core.skeleton.headerRowContainers[pane];
    return container.querySelector<HTMLElement>(`.mach-header-cell[data-col-id="${cssEscape(column.id)}"]`);
  }

  private scheduleIndicator(e: PointerEvent): void {
    this.pendingPoint = { clientX: e.clientX, clientY: e.clientY };
    if (this.moveRaf) return;
    this.moveRaf = requestAnimationFrame(() => {
      this.moveRaf = 0;
      const point = this.pendingPoint;
      this.pendingPoint = null;
      if (point) this.applyIndicator(point.clientX, point.clientY);
    });
  }

  private applyIndicator(clientX: number, clientY: number): void {
    const dragging = this.dragging;
    if (!dragging) return;
    const ghostX = clamp(clientX + 12, 8, window.innerWidth - dragging.ghostWidth - 8);
    const ghostY = clamp(clientY + 12, 8, window.innerHeight - dragging.ghostHeight - 8);
    dragging.ghost.style.transform = `translate3d(${ghostX}px, ${ghostY}px, 0)`;

    const scrollDelta = dragging.pane === "center"
      ? this.core.skeleton.bodyViewports.center.scrollLeft - dragging.startScrollLeft
      : 0;
    const x = clientX - (dragging.containerLeft - scrollDelta);
    let target = dragging.midpoints.length;
    for (let index = 0; index < dragging.midpoints.length; index++) {
      if (x < dragging.midpoints[index]) {
        target = index;
        break;
      }
    }
    dragging.targetIndex = target > dragging.fromIndex ? target - 1 : target;
    dragging.indicator.style.transform = `translate3d(${dragging.offsets[target]}px, 0, 0)`;
  }

  private onUp = (event: PointerEvent): void => {
    this.pending = null;
    if (event.type !== "pointercancel" && this.dragging) {
      this.applyIndicator(event.clientX, event.clientY);
    }
    this.cleanup();
    const dragging = this.clearDrag();
    if (!dragging) return;
    if (event.type !== "pointercancel" && dragging.targetIndex >= 0) {
      this.core.moveColumn(dragging.column.id, dragging.targetIndex);
    }
  };

  private clearDrag(): ColumnDragState | null {
    const dragging = this.dragging;
    if (!dragging) return null;
    this.dragging = null;
    dragging.cellEl.classList.remove("mach-header-cell--dragging");
    dragging.ghost.remove();
    dragging.indicator.remove();
    this.core.skeleton.root.classList.remove("mach-root--dragging");
    return dragging;
  }

  private cleanup(): void {
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onUp);
    if (this.moveRaf) cancelAnimationFrame(this.moveRaf);
    this.moveRaf = 0;
    this.pendingPoint = null;
  };

  destroy(): void {
    this.cleanup();
    this.clearDrag();
    this.pending = null;
  }
}

function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
