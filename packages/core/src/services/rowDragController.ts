import type { GridCore } from "../core/gridCore";
import { clamp, el } from "../lib/dom";
import { DEFAULT_LOCALE, formatTwo } from "../lib/locale";
import type { RowNode } from "../types/row";

const PANES = ["left", "center", "right"] as const;
type RowDragContext = Pick<GridCore<any>, "emit" | "options" | "rowModel" | "skeleton" | "columnModel" | "editingService">;

interface RowDragState {
  node: RowNode<any>;
  order: readonly RowNode<any>[];
  fromIndex: number;
  startY: number;
  clientX: number;
  clientY: number;
  pointerId: number;
  indicators: HTMLElement[];
  preview: HTMLElement;
  targetIndex: number;
  active: boolean;
}

/** Owns pointer/keyboard ordering, feedback, scrolling and all cancellation paths. */
export class RowDragController {
  private state: RowDragState | null = null;
  private moveRaf = 0;
  private focusRaf = 0;

  constructor(
    private core: RowDragContext,
    private getRowTop: (index: number) => number,
    private findRowAt: (offset: number) => number
  ) {}

  canDrag(node: RowNode<any>): boolean {
    if (this.core.editingService.isEditing()) return false;
    if (node.isDetail || node.isGroup || node.loading || !node.data || this.core.rowModel.isTree) return false;
    if (this.core.columnModel.getRowGroupColumns().length > 0) return false;
    return !this.core.options.applyRowDrag || this.core.rowModel.canReorderRows();
  }

  isSource(node: RowNode<any>): boolean {
    return this.state?.active === true && this.state.node === node;
  }

  start(event: PointerEvent, node: RowNode<any>): void {
    this.destroy();
    if (!this.canDrag(node) || event.isPrimary === false) return;
    const indicators = PANES.map(pane => {
      const indicator = el("div", "mach-row-drop-indicator");
      indicator.hidden = true;
      this.core.skeleton.rowContainers[pane].appendChild(indicator);
      return indicator;
    });
    const preview = el("div", "mach-row-drag-preview");
    preview.setAttribute("role", "status");
    preview.hidden = true;
    this.core.skeleton.root.appendChild(preview);
    this.state = {
      node, order: this.core.rowModel.getDisplayedRows().slice(), fromIndex: node.rowIndex,
      startY: event.clientY, clientX: event.clientX, clientY: event.clientY,
      pointerId: event.pointerId, indicators, preview, targetIndex: -1, active: false
    };
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onCancel);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("blur", this.onCancel);
  }

  moveWithKeyboard(event: KeyboardEvent, node: RowNode<any>): void {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    event.stopPropagation();
    if (!this.canDrag(node)) return;
    const from = node.rowIndex;
    const direction = event.key === "ArrowUp" ? -1 : 1;
    let target = from + direction;
    while (this.core.rowModel.getDisplayedRow(target)?.isDetail) target += direction;
    if (!this.core.rowModel.getDisplayedRow(target)) return;
    let boundary = target > from ? target + 1 : target;
    while (this.core.rowModel.getDisplayedRow(boundary)?.isDetail) boundary++;
    const applied = this.commit(node, from, target, boundary);
    if (!applied) return;
    this.focusRaf = requestAnimationFrame(() => {
      this.focusRaf = 0;
      this.core.skeleton.root.querySelector<HTMLElement>(`.mach-row[data-index="${node.rowIndex}"] .mach-row-drag-handle`)?.focus();
    });
  }

  private onMove = (event: PointerEvent): void => {
    const drag = this.state;
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.clientX = event.clientX;
    drag.clientY = event.clientY;
    if (!drag.active) {
      if (Math.abs(event.clientY - drag.startY) < 5) return;
      drag.active = true;
      this.core.skeleton.root.classList.add("mach-root--row-dragging");
      this.core.skeleton.root.querySelectorAll<HTMLElement>(".mach-row").forEach(row => {
        row.classList.toggle("mach-row--drag-source", row.dataset.id === drag.node.id);
      });
    }
    this.scheduleFrame();
  };

  private scheduleFrame(): void {
    if (!this.moveRaf) this.moveRaf = requestAnimationFrame(this.onFrame);
  }

  private onFrame = (): void => {
    this.moveRaf = 0;
    if (!this.state?.active) return;
    this.updateFeedback();
    if (this.scrollAtEdge()) this.scheduleFrame();
  };

  private isInside(clientX: number, clientY: number, margin = 0): boolean {
    const body = this.core.skeleton.bodyEl.getBoundingClientRect();
    return clientX >= body.left && clientX <= body.right &&
      clientY >= body.top - margin && clientY <= body.bottom + margin;
  }

  private scrollAtEdge(): boolean {
    const drag = this.state;
    if (!drag || !this.isInside(drag.clientX, drag.clientY, 28)) return false;
    const viewport = this.core.skeleton.bodyViewports.center;
    const rect = viewport.getBoundingClientRect();
    const edge = Math.min(36, rect.height / 3);
    if (edge <= 0) return false;
    const delta = drag.clientY < rect.top + edge
      ? -Math.ceil(14 * clamp((rect.top + edge - drag.clientY) / edge, 0, 1))
      : Math.ceil(14 * clamp((drag.clientY - rect.bottom + edge) / edge, 0, 1));
    const previous = viewport.scrollTop;
    viewport.scrollTop = clamp(previous + delta, 0, Math.max(0, viewport.scrollHeight - viewport.clientHeight));
    return viewport.scrollTop !== previous;
  }

  private updateFeedback(): void {
    const drag = this.state;
    if (!drag?.active) return;
    const valid = this.isInside(drag.clientX, drag.clientY);
    const viewport = this.core.skeleton.bodyViewports.center;
    const y = drag.clientY - viewport.getBoundingClientRect().top + viewport.scrollTop;
    const count = this.core.rowModel.getDisplayedRowCount();
    let boundary = clamp(this.findRowAt(y), 0, count);
    const top = this.getRowTop(boundary);
    const bottom = this.getRowTop(Math.min(count, boundary + 1));
    if (boundary < count && y >= top + (bottom - top) / 2) boundary++;
    // Keep expanded master/detail pairs together.
    while (this.core.rowModel.getDisplayedRow(boundary)?.isDetail) boundary++;
    drag.targetIndex = boundary;
    for (const indicator of drag.indicators) {
      indicator.hidden = !valid;
      indicator.style.transform = `translate3d(0, ${this.getRowTop(boundary)}px, 0)`;
    }
    const rootRect = this.core.skeleton.root.getBoundingClientRect();
    const target = this.finalIndex(drag.fromIndex, boundary);
    drag.preview.hidden = false;
    drag.preview.textContent = valid
      ? formatTwo(this.core.options.locale.rowDragPosition ?? DEFAULT_LOCALE.rowDragPosition, drag.fromIndex + 1, target + 1)
      : this.core.options.locale.rowDragOutside ?? DEFAULT_LOCALE.rowDragOutside;
    drag.preview.style.transform = `translate3d(${clamp(drag.clientX - rootRect.left + 16, 8, Math.max(8, rootRect.width - 224))}px, ${clamp(drag.clientY - rootRect.top + 16, 8, Math.max(8, rootRect.height - 48))}px, 0)`;
  }

  private onUp = (event: PointerEvent): void => {
    const state = this.state;
    if (!state || event.pointerId !== state.pointerId) return;
    state.clientX = event.clientX;
    state.clientY = event.clientY;
    if (state.active) this.updateFeedback();
    const drag = this.takeState();
    if (!drag?.active || !this.isInside(event.clientX, event.clientY)) return;
    const order = this.core.rowModel.getDisplayedRows();
    if (order.length !== drag.order.length || order.some((node, index) => node !== drag.order[index])) return;
    const boundary = drag.targetIndex;
    let target = boundary > drag.fromIndex ? boundary - 1 : boundary;
    while (this.core.rowModel.getDisplayedRow(target)?.isDetail) target--;
    this.commit(drag.node, drag.fromIndex, target, boundary);
  };

  private commit(node: RowNode<any>, from: number, target: number, boundary: number): boolean {
    if (from === target || target < 0 || !this.canDrag(node)) return false;
    const finalIndex = this.finalIndex(from, boundary);
    const applied = this.core.options.applyRowDrag && this.core.rowModel.reorderRowsByDisplayed(from, target);
    if (this.core.options.applyRowDrag && !applied) return false;
    this.core.emit("rowDragEnd", { rowNode: node, fromIndex: from, toIndex: boundary, targetIndex: applied ? node.rowIndex : finalIndex, applied });
    return applied;
  }

  private finalIndex(from: number, boundary: number): number {
    let end = from + 1;
    while (this.core.rowModel.getDisplayedRow(end)?.isDetail) end++;
    return boundary > from ? boundary - (end - from) : boundary;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") { event.preventDefault(); this.destroy(); }
  };

  private onCancel = (event: Event): void => {
    if (event.type === "pointercancel" && (event as PointerEvent).pointerId !== this.state?.pointerId) return;
    this.destroy();
  };

  private takeState(): RowDragState | null {
    const drag = this.state;
    this.state = null;
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onCancel);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("blur", this.onCancel);
    cancelAnimationFrame(this.moveRaf);
    this.moveRaf = 0;
    this.core.skeleton.root.classList.remove("mach-root--row-dragging");
    this.core.skeleton.root.querySelectorAll(".mach-row--drag-source").forEach(row => row.classList.remove("mach-row--drag-source"));
    drag?.indicators.forEach(indicator => indicator.remove());
    drag?.preview.remove();
    return drag;
  }

  destroy(): void {
    this.takeState();
    cancelAnimationFrame(this.focusRaf);
    this.focusRaf = 0;
  }
}
