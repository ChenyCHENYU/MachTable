import type { GridCore } from "../core/gridCore";
import { el } from "../lib/dom";
import type { RowNode } from "../types/row";

type RowDragContext = Pick<GridCore<any>, "emit" | "options" | "rowModel" | "skeleton">;

interface RowDragState {
  node: RowNode<any>;
  startY: number;
  indicator: HTMLElement;
  targetIndex: number;
  active: boolean;
  viewportTop: number;
}

/** Owns row-drag global listeners, indicator DOM and completion semantics. */
export class RowDragController {
  private state: RowDragState | null = null;
  private moveRaf = 0;
  private pendingClientY: number | null = null;

  constructor(
    private core: RowDragContext,
    private getRowTop: (index: number) => number,
    private findRowAt: (offset: number) => number
  ) {}

  start(event: PointerEvent, node: RowNode<any>): void {
    this.destroy();
    const indicator = el("div", "mach-row-drop-indicator");
    this.core.skeleton.rowContainers.center.appendChild(indicator);
    this.state = {
      node,
      startY: event.clientY,
      indicator,
      targetIndex: -1,
      active: false,
      viewportTop: this.core.skeleton.bodyViewports.center.getBoundingClientRect().top
    };
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onUp);
  }

  private onMove = (event: PointerEvent): void => {
    const drag = this.state;
    if (!drag) return;
    if (!drag.active) {
      if (Math.abs(event.clientY - drag.startY) < 5) return;
      drag.active = true;
      this.core.skeleton.root.classList.add("mach-root--row-dragging");
    }

    this.pendingClientY = event.clientY;
    if (this.moveRaf) return;
    this.moveRaf = requestAnimationFrame(() => {
      this.moveRaf = 0;
      const clientY = this.pendingClientY;
      this.pendingClientY = null;
      if (clientY !== null) this.updateIndicator(clientY);
    });
  };

  private updateIndicator(clientY: number): void {
    const drag = this.state;
    if (!drag?.active) return;
    const viewport = this.core.skeleton.bodyViewports.center;
    const y = clientY - drag.viewportTop + viewport.scrollTop;
    const rowCount = this.core.rowModel.getDisplayedRowCount();
    let targetIndex = Math.max(0, Math.min(this.findRowAt(y), rowCount));
    while (targetIndex < rowCount) {
      const candidate = this.core.rowModel.getDisplayedRow(targetIndex);
      if (candidate && !candidate.isDetail && !candidate.isGroup) break;
      targetIndex++;
    }
    const top = this.getRowTop(targetIndex);
    const bottom = this.getRowTop(Math.min(rowCount, targetIndex + 1));
    if (targetIndex < rowCount && y >= top + (bottom - top) / 2) targetIndex++;
    const indicatorY = this.getRowTop(targetIndex);
    drag.targetIndex = targetIndex;
    drag.indicator.style.transform = `translate3d(0, ${indicatorY}px, 0)`;
  }

  private onUp = (event: PointerEvent): void => {
    if (event.type !== "pointercancel" && this.state?.active) {
      this.updateIndicator(event.clientY);
    }
    const drag = this.takeState();
    if (event.type === "pointercancel" || !drag || !drag.active || drag.targetIndex < 0) return;
    const from = drag.node.rowIndex;
    const to = Math.max(0, Math.min(drag.targetIndex, this.core.rowModel.getDisplayedRowCount()));
    if (from === to || from === to - 1) return;
    this.core.emit("rowDragEnd", { rowNode: drag.node, fromIndex: from, toIndex: to });
    if (this.core.options.applyRowDrag && !this.core.rowModel.isTree) {
      this.core.rowModel.reorderRowsByDisplayed(from, to > from ? to - 1 : to);
    }
  };

  private takeState(): RowDragState | null {
    const drag = this.state;
    this.state = null;
    this.detachListeners();
    drag?.indicator.remove();
    return drag;
  }

  private detachListeners(): void {
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onUp);
    if (this.moveRaf) cancelAnimationFrame(this.moveRaf);
    this.moveRaf = 0;
    this.pendingClientY = null;
    this.core.skeleton.root.classList.remove("mach-root--row-dragging");
  }

  destroy(): void {
    this.takeState();
  }
}
