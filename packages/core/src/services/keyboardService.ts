import type { GridCore } from "../core/gridCore";
import type { Column } from "./column";
import { writeClipboard } from "../lib/clipboard";

type KeyboardContext = Pick<
  GridCore<any>,
  | "bodyRenderer"
  | "buildRangeTsv"
  | "clearRangeValues"
  | "columnModel"
  | "editingService"
  | "isDestroyed"
  | "options"
  | "pasteText"
  | "rowModel"
  | "selectionService"
  | "skeleton"
  | "undoService"
>;

export class KeyboardService {
  constructor(private core: KeyboardContext) {}

  init(): void {
    this.core.skeleton.root.addEventListener("keydown", this.onKeyDown);
    this.core.skeleton.root.addEventListener("copy", this.onCopy as EventListener);
    this.core.skeleton.root.addEventListener("cut", this.onCut as EventListener);
    this.core.skeleton.root.addEventListener("paste", this.onPaste as EventListener);
  }

  destroy(): void {
    this.core.skeleton.root.removeEventListener("keydown", this.onKeyDown);
    this.core.skeleton.root.removeEventListener("copy", this.onCopy as EventListener);
    this.core.skeleton.root.removeEventListener("cut", this.onCut as EventListener);
    this.core.skeleton.root.removeEventListener("paste", this.onPaste as EventListener);
  }

  nextEditable(rowIndex: number, colId: string, dir: 1 | -1): { rowIndex: number; column: Column } | null {
    const cols = this.core.columnModel.getOrderedVisible();
    const start = cols.findIndex((c) => c.id === colId);
    if (start < 0) return null;
    const rowCount = this.core.rowModel.getDisplayedRowCount();
    let i = start;
    let row = rowIndex;

    for (let guard = 0; guard < (cols.length + 1) * (rowCount + 1); guard++) {
      i += dir;
      if (i >= cols.length) {
        if (row >= rowCount - 1) return null;
        i = 0;
        row = this.skipDetailRows(row + 1, 1);
      } else if (i < 0) {
        if (row <= 0) return null;
        i = cols.length - 1;
        row = this.skipDetailRows(row - 1, -1);
      }
      if (row < 0 || row >= rowCount) return null;
      const node = this.core.rowModel.getDisplayedRow(row);
      if (node && !node.isDetail && this.core.editingService.isEditable(node, cols[i])) {
        return { rowIndex: row, column: cols[i] };
      }
    }
    return null;
  }

  private skipDetailRows(row: number, dir: 1 | -1): number {
    const rowCount = this.core.rowModel.getDisplayedRowCount();
    let guard = 0;
    while (row >= 0 && row < rowCount) {
      const node = this.core.rowModel.getDisplayedRow(row);
      if (!node || !node.isDetail) return row;
      row += dir;
      guard++;
      if (guard > rowCount + 2) break;
    }
    return -1;
  }

  private onCopy = (e: ClipboardEvent): void => {
    if (this.core.options.suppressClipboard || this.core.editingService.isEditing()) return;
    const range = this.core.bodyRenderer.getNormalizedRangeOrFocus();
    if (!range) return;
    const text = this.core.buildRangeTsv(range);
    const dt = e.clipboardData;
    if (dt && typeof dt.setData === "function") {
      dt.setData("text/plain", text);
    } else {
      void writeClipboard(text);
    }
    e.preventDefault();
  };

  private onCut = (e: ClipboardEvent): void => {
    if (this.core.options.suppressClipboard || this.core.editingService.isEditing()) return;
    const range = this.core.bodyRenderer.getNormalizedRangeOrFocus();
    if (!range) return;
    const text = this.core.buildRangeTsv(range);
    const dt = e.clipboardData;
    if (dt && typeof dt.setData === "function") {
      dt.setData("text/plain", text);
    } else {
      void writeClipboard(text);
    }
    this.core.clearRangeValues(range);
    e.preventDefault();
  };

  private onPaste = (e: ClipboardEvent): void => {
    if (this.core.options.suppressClipboard || this.core.editingService.isEditing()) return;
    const start = this.core.bodyRenderer.getPasteStart();
    if (!start) return;
    const dt = e.clipboardData;
    const text = dt && typeof dt.getData === "function" ? dt.getData("text/plain") : null;
    if (typeof text !== "string" || text === "") return;
    e.preventDefault();
    this.core.pasteText(text, start.row, start.colIdx);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.core.isDestroyed()) return;
    if (this.core.editingService.isEditing()) return;

    if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
      if (this.core.options.rowSelection === "multiple") {
        e.preventDefault();
        this.core.selectionService.selectAll(true);
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const key = e.key.toLowerCase();
      if (key === "z") {
        e.preventDefault();
        if (e.shiftKey) this.core.undoService.redo();
        else this.core.undoService.undo();
        return;
      }
      if (key === "y") {
        e.preventDefault();
        this.core.undoService.redo();
        return;
      }
    }

    const navigationKeys = [
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Enter",
      "F2",
      "Home",
      "End",
      "PageUp",
      "PageDown",
      "Tab",
      " ",
      "Escape",
      "Delete",
      "Backspace"
    ];
    if (!navigationKeys.includes(e.key)) return;

    const body = this.core.bodyRenderer;
    const focus = body.focusedCell;

    if (e.key === "Escape") {
      if (this.core.options.enableRangeSelection && body.normalizedRange()) {
        e.preventDefault();
        body.clearRangeSelection();
      }
      return;
    }

    if (e.key === "Delete" || e.key === "Backspace") {
      if (this.core.options.enableRangeSelection) {
        const range = body.normalizedRange();
        if (range && !(range.r1 === range.r2 && range.c1 === range.c2)) {
          e.preventDefault();
          this.core.clearRangeValues(range);
          return;
        }
      }
      return;
    }

    if (!focus) {
      if (this.core.rowModel.getDisplayedRowCount() > 0) {
        const cols = this.core.columnModel.getOrderedVisible();
        if (cols.length > 0) {
          e.preventDefault();
          body.setFocusedCell(0, cols[0].id);
        }
      }
      return;
    }

    const cols = this.core.columnModel.getOrderedVisible();
    const colIdx = cols.findIndex((c) => c.id === focus.colId);
    if (colIdx < 0) return;
    const rowCount = this.core.rowModel.getDisplayedRowCount();
    if (rowCount === 0) return;

    const rangeMode = e.shiftKey && this.core.options.enableRangeSelection;

    let row = focus.rowIndex;
    let handled = true;
    let nextRow = row;
    let nextColIdx = colIdx;

    switch (e.key) {
      case "ArrowUp":
        nextRow = this.skipDetailRows(row - 1, -1);
        if (nextRow >= 0) row = nextRow;
        break;
      case "ArrowDown":
        nextRow = this.skipDetailRows(row + 1, 1);
        if (nextRow >= 0 && nextRow < rowCount) row = nextRow;
        break;
      case "ArrowLeft":
        nextColIdx = Math.max(0, colIdx - 1);
        break;
      case "ArrowRight":
        nextColIdx = Math.min(cols.length - 1, colIdx + 1);
        break;
      case "Home":
        nextColIdx = 0;
        if (e.ctrlKey) row = 0;
        break;
      case "End":
        nextColIdx = cols.length - 1;
        if (e.ctrlKey) row = Math.max(0, this.skipDetailRows(rowCount - 1, -1));
        break;
      case "PageUp":
      case "PageDown": {
        const viewport = this.core.skeleton.bodyViewports.center;
        const pageRows = Math.max(1, Math.floor(viewport.clientHeight / this.core.options.rowHeight));
        const target = e.key === "PageUp" ? row - pageRows : row + pageRows;
        const skipped = this.skipDetailRows(Math.max(0, Math.min(rowCount - 1, target)), e.key === "PageUp" ? -1 : 1);
        if (skipped >= 0) row = skipped;
        break;
      }
      case "Enter":
      case "F2": {
        const node = this.core.rowModel.getDisplayedRow(row);
        const column = cols[colIdx];
        if (node && !node.isDetail && column && this.core.editingService.isEditable(node, column)) {
          this.core.editingService.start(row, column, e.key === "F2" ? e.key : null);
        } else {
          const down = this.skipDetailRows(row + 1, 1);
          if (down >= 0 && down < rowCount) row = down;
        }
        break;
      }
      case " ": {
        const node = this.core.rowModel.getDisplayedRow(row);
        if (node && !node.isDetail) {
          if (node.isGroup) {
            this.core.rowModel.toggleGroup(node.id);
          } else if (this.core.options.rowSelection !== "none") {
            this.core.selectionService.setNodeSelected(
              node,
              !node.selected,
              this.core.options.rowSelection === "single"
            );
          }
        }
        break;
      }
      case "Tab": {
        const next = this.nextEditable(row, focus.colId, e.shiftKey ? -1 : 1);
        if (next) {
          body.setFocusedCell(next.rowIndex, next.column.id);
          this.core.editingService.start(next.rowIndex, next.column);
        } else {
          // Let the browser move to the previous/next control outside the grid.
          // A composite grid must never trap keyboard-only users at its edges.
          handled = false;
        }
        break;
      }
      default:
        handled = false;
    }

    if (handled) e.preventDefault();

    if (rangeMode && (row !== focus.rowIndex || nextColIdx !== colIdx)) {
      body.moveRangeEnd(row, nextColIdx);
      return;
    }

    if (row !== focus.rowIndex || cols[nextColIdx].id !== focus.colId) {
      body.setFocusedCell(row, cols[nextColIdx].id);
    }
  };
}
