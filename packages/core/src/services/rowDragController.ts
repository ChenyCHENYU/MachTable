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
}

/** Owns row-drag global listeners, indicator DOM and completion semantics. */
export class RowDragController {
  private state: RowDragState | null = null;

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
      active: false
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

    const container = this.core.skeleton.rowContainers.center;
    const y = event.clientY - container.getBoundingClientRect().top;
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
    drag.indicator.style.top = `${indicatorY}px`;
  };

  private onUp = (): void => {
    const drag = this.takeState();
    if (!drag || !drag.active || drag.targetIndex < 0) return;
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
    this.core.skeleton.root.classList.remove("mach-root--row-dragging");
  }

  destroy(): void {
    this.takeState();
  }
}
