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

const NAVIGATION_KEYS = new Set([
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
]);

const MOVEMENT_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown"
]);

interface KeyboardPosition {
  colIdx: number;
  row: number;
}

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
    if (this.core.isDestroyed() || this.core.editingService.isEditing()) return;
    if (this.handleSelectAll(e) || this.handleHistoryShortcut(e)) return;
    if (!NAVIGATION_KEYS.has(e.key)) return;
    if (this.handleRangeCommand(e)) return;
    if (this.focusFirstCell(e)) return;
    this.handleFocusedKey(e);
  };

  private handleSelectAll(e: KeyboardEvent): boolean {
    const modifier = e.ctrlKey || e.metaKey;
    if (!modifier || e.key.toLowerCase() !== "a") return false;
    if (this.core.options.rowSelection === "multiple") {
      e.preventDefault();
      this.core.selectionService.selectAll(true);
    }
    return true;
  }

  private handleHistoryShortcut(e: KeyboardEvent): boolean {
    if ((!e.ctrlKey && !e.metaKey) || e.altKey) return false;
    const key = e.key.toLowerCase();
    if (key === "z") {
      e.preventDefault();
      if (e.shiftKey) this.core.undoService.redo();
      else this.core.undoService.undo();
      return true;
    }
    if (key !== "y") return false;
    e.preventDefault();
    this.core.undoService.redo();
    return true;
  }

  private handleRangeCommand(e: KeyboardEvent): boolean {
    const body = this.core.bodyRenderer;
    if (e.key === "Escape") {
      if (this.core.options.enableRangeSelection && body.normalizedRange()) {
        e.preventDefault();
        body.clearRangeSelection();
      }
      return true;
    }
    if (e.key !== "Delete" && e.key !== "Backspace") return false;
    if (!this.core.options.enableRangeSelection) return true;
    const range = body.normalizedRange();
    if (range && !(range.r1 === range.r2 && range.c1 === range.c2)) {
      e.preventDefault();
      this.core.clearRangeValues(range);
    }
    return true;
  }

  private focusFirstCell(e: KeyboardEvent): boolean {
    if (this.core.bodyRenderer.focusedCell) return false;
    const columns = this.core.columnModel.getOrderedVisible();
    if (this.core.rowModel.getDisplayedRowCount() > 0 && columns.length > 0) {
      e.preventDefault();
      this.core.bodyRenderer.setFocusedCell(0, columns[0].id);
    }
    return true;
  }

  private handleFocusedKey(e: KeyboardEvent): void {
    const body = this.core.bodyRenderer;
    const focus = body.focusedCell;
    if (!focus) return;
    const columns = this.core.columnModel.getOrderedVisible();
    const colIdx = columns.findIndex((column) => column.id === focus.colId);
    const rowCount = this.core.rowModel.getDisplayedRowCount();
    if (colIdx < 0 || rowCount === 0) return;

    const start = { row: focus.rowIndex, colIdx };
    const position = this.resolveKeyPosition(e, start, columns, rowCount);
    if (!position) return;
    e.preventDefault();

    const moved = position.row !== start.row || position.colIdx !== start.colIdx;
    if (e.shiftKey && this.core.options.enableRangeSelection && moved) {
      body.moveRangeEnd(position.row, position.colIdx);
      return;
    }
    if (moved) body.setFocusedCell(position.row, columns[position.colIdx].id);
  }

  private resolveKeyPosition(
    e: KeyboardEvent,
    position: KeyboardPosition,
    columns: readonly Column[],
    rowCount: number
  ): KeyboardPosition | null {
    if (MOVEMENT_KEYS.has(e.key)) return this.movePosition(e, position, columns.length, rowCount);
    if (e.key === "Enter" || e.key === "F2") {
      return this.activateEditor(e, position, columns, rowCount);
    }
    if (e.key === " ") {
      this.toggleFocusedRow(position.row);
      return position;
    }
    if (e.key === "Tab") return this.moveToEditable(e, position, columns);
    return null;
  }

  private movePosition(
    e: KeyboardEvent,
    position: KeyboardPosition,
    columnCount: number,
    rowCount: number
  ): KeyboardPosition {
    let { row, colIdx } = position;
    switch (e.key) {
      case "ArrowUp":
        row = this.validSkippedRow(row, this.skipDetailRows(row - 1, -1), rowCount);
        break;
      case "ArrowDown":
        row = this.validSkippedRow(row, this.skipDetailRows(row + 1, 1), rowCount);
        break;
      case "ArrowLeft":
        colIdx = Math.max(0, colIdx - 1);
        break;
      case "ArrowRight":
        colIdx = Math.min(columnCount - 1, colIdx + 1);
        break;
      case "Home":
        colIdx = 0;
        if (e.ctrlKey) row = 0;
        break;
      case "End":
        colIdx = columnCount - 1;
        if (e.ctrlKey) row = Math.max(0, this.skipDetailRows(rowCount - 1, -1));
        break;
      case "PageUp":
      case "PageDown":
        row = this.movePage(e.key, row, rowCount);
        break;
    }
    return { row, colIdx };
  }

  private validSkippedRow(current: number, candidate: number, rowCount: number): number {
    return candidate >= 0 && candidate < rowCount ? candidate : current;
  }

  private movePage(key: string, row: number, rowCount: number): number {
    const viewport = this.core.skeleton.bodyViewports.center;
    const pageRows = Math.max(1, Math.floor(viewport.clientHeight / this.core.options.rowHeight));
    const direction: 1 | -1 = key === "PageUp" ? -1 : 1;
    const target = Math.max(0, Math.min(rowCount - 1, row + pageRows * direction));
    return this.validSkippedRow(row, this.skipDetailRows(target, direction), rowCount);
  }

  private activateEditor(
    e: KeyboardEvent,
    position: KeyboardPosition,
    columns: readonly Column[],
    rowCount: number
  ): KeyboardPosition {
    const node = this.core.rowModel.getDisplayedRow(position.row);
    const column = columns[position.colIdx];
    if (node && !node.isDetail && column && this.core.editingService.isEditable(node, column)) {
      this.core.editingService.start(position.row, column, e.key === "F2" ? e.key : null);
      return position;
    }
    const down = this.skipDetailRows(position.row + 1, 1);
    return { ...position, row: this.validSkippedRow(position.row, down, rowCount) };
  }

  private toggleFocusedRow(row: number): void {
    const node = this.core.rowModel.getDisplayedRow(row);
    if (!node || node.isDetail) return;
    if (node.isGroup) {
      this.core.rowModel.toggleGroup(node.id);
      return;
    }
    if (this.core.options.rowSelection === "none") return;
    this.core.selectionService.setNodeSelected(
      node,
      !node.selected,
      this.core.options.rowSelection === "single"
    );
  }

  private moveToEditable(
    e: KeyboardEvent,
    position: KeyboardPosition,
    columns: readonly Column[]
  ): KeyboardPosition | null {
    const next = this.nextEditable(position.row, columns[position.colIdx].id, e.shiftKey ? -1 : 1);
    if (!next) return null;
    this.core.bodyRenderer.setFocusedCell(next.rowIndex, next.column.id);
    this.core.editingService.start(next.rowIndex, next.column);
    return position;
  }
}
