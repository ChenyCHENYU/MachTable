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
}

export class ColumnDragService {
  private pending: { column: Column; startX: number; startY: number } | null = null;
  private dragging: ColumnDragState | null = null;
  private suppressClick = false;

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
      this.updateIndicator(e);
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
    this.dragging = { column: pending.column, cellEl, ghost, indicator, targetIndex: -1 };
    this.updateIndicator(e);
  }

  private findHeaderCell(column: Column): HTMLElement | null {
    const pane = this.core.bodyRenderer.paneForColumn(column);
    const container = this.core.skeleton.headerRowContainers[pane];
    return container.querySelector<HTMLElement>(`.mach-header-cell[data-col-id="${cssEscape(column.id)}"]`);
  }

  private updateIndicator(e: PointerEvent): void {
    const dragging = this.dragging;
    if (!dragging) return;
    dragging.ghost.style.left = `${clamp(e.clientX + 12, 8, window.innerWidth - dragging.ghost.offsetWidth - 8)}px`;
    dragging.ghost.style.top = `${clamp(e.clientY + 12, 8, window.innerHeight - dragging.ghost.offsetHeight - 8)}px`;
    const pane = this.core.bodyRenderer.paneForColumn(dragging.column);
    const container = this.core.skeleton.headerRowContainers[pane];
    const rowRect = container.getBoundingClientRect();
    const cols = this.core.columnModel.getPaneColumns(pane);
    const fromIndex = cols.indexOf(dragging.column);

    const x = e.clientX - rowRect.left;
    let target = -1;
    let indicatorX = 0;
    let acc = 0;
    for (let i = 0; i < cols.length; i++) {
      const mid = acc + cols[i].currentWidth / 2;
      if (x < mid) {
        target = i;
        indicatorX = acc;
        break;
      }
      acc += cols[i].currentWidth;
    }
    if (target < 0) {
      target = cols.length;
      indicatorX = acc;
    }

    dragging.targetIndex = target > fromIndex ? target - 1 : target;
    dragging.indicator.style.left = `${indicatorX}px`;
  }

  private onUp = (event: PointerEvent): void => {
    this.pending = null;
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
