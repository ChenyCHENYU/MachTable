import type { GridCore } from "../core/gridCore";
import type { Column } from "./column";
import { writeClipboard } from "../lib/clipboard";

type KeyboardContext = Pick<
  GridCore<any>,
  | "bodyRenderer"
  | "buildRangeTsv"
  | "clearRangeValues"
  | "cancelPendingInput"
  | "columnModel"
  | "editingService"
  | "isDisposed"
  | "gridOptions"
  | "pasteText"
  | "rowModel"
  | "selectionService"
  | "skeleton"
  | "undoService"
>;

const MOVEMENT_KEYS = new Set([
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"
]);
const NAVIGATION_KEYS = new Set([
  ...MOVEMENT_KEYS, "Enter", "F2", "Tab", " ", "Escape", "Delete", "Backspace"
]);

interface KeyboardPosition {
  colIdx: number;
  row: number;
}

/** @internal Keyboard interaction is grid-owned and never a callback parameter. */
export class KeyboardService {
  constructor(private core: KeyboardContext) {}

  init(): void {
    this.bindEvents("addEventListener");
  }

  destroy(): void {
    this.bindEvents("removeEventListener");
  }

  private bindEvents(method: "addEventListener" | "removeEventListener"): void {
    const root = this.core.skeleton.root;
    root[method]("keydown", this.handleGridKey as EventListener);
    root[method]("copy", this.handleGridCopy as EventListener);
    root[method]("cut", this.handleGridCopy as EventListener);
    root[method]("paste", this.handleGridPaste as EventListener);
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
    // dir 只为 ±1，单调扫描由行边界保证终止。
    while (row >= 0 && row < rowCount) {
      const node = this.core.rowModel.getDisplayedRow(row);
      if (!node || !node.isDetail) return row;
      row += dir;
    }
    return -1;
  }

  private handleGridCopy = (e: ClipboardEvent): void => {
    if (this.shouldYieldEvent(e) || this.core.gridOptions.suppressClipboard) return;
    const range = this.core.bodyRenderer.getNormalizedRangeOrFocus();
    if (!range) return;
    const text = this.core.buildRangeTsv(range);
    const dt = e.clipboardData;
    if (dt && typeof dt.setData === "function") {
      dt.setData("text/plain", text);
    } else {
      void writeClipboard(text);
    }
    if (e.type === "cut") this.core.clearRangeValues(range);
    e.preventDefault();
  };

  private handleGridPaste = (e: ClipboardEvent): void => {
    if (this.shouldYieldEvent(e) || this.core.gridOptions.suppressClipboard) return;
    const start = this.core.bodyRenderer.getPasteStart();
    if (!start) return;
    const dt = e.clipboardData;
    const text = dt && typeof dt.getData === "function" ? dt.getData("text/plain") : null;
    if (typeof text !== "string" || text === "") return;
    e.preventDefault();
    this.core.pasteText(text, start.row, start.colIdx);
  };

  private handleGridKey = (e: KeyboardEvent): void => {
    if (this.shouldYieldEvent(e) || this.core.isDisposed()) return;
    if (this.handleCommand(e)) return;
    if (!NAVIGATION_KEYS.has(e.key)) return;
    if (this.handleRangeCommand(e)) return;
    if (this.focusFirstCell(e)) return;
    this.handleFocusedKey(e);
  };

  /** 原生控件保留自己的键盘、选区与剪贴板语义，避免激活按钮时导航表格。 */
  private shouldYieldEvent(e: Event): boolean {
    const target = e.target;
    return e.defaultPrevented || target instanceof HTMLElement &&
      (target.isContentEditable || !!target.closest("button,a[href],input,textarea,select")) ||
      this.core.editingService.isEditing();
  }

  private handleCommand(e: KeyboardEvent): boolean {
    if (!e.ctrlKey && !e.metaKey) return false;
    const key = e.key.toLowerCase();
    if (key === "a") {
      if (this.core.gridOptions.rowSelection === "multiple") {
        e.preventDefault();
        this.core.selectionService.selectAll(true);
      }
      return true;
    }
    if (e.altKey || (key !== "z" && key !== "y")) return false;
    e.preventDefault();
    if (key === "z" && !e.shiftKey) this.core.undoService.undo();
    else this.core.undoService.redo();
    return true;
  }

  private handleRangeCommand(e: KeyboardEvent): boolean {
    const body = this.core.bodyRenderer;
    if (e.key === "Escape") {
      this.core.cancelPendingInput();
      if (this.core.gridOptions.enableRangeSelection && body.normalizedRange()) {
        e.preventDefault();
        body.clearRangeSelection();
      }
      return true;
    }
    if (e.key !== "Delete" && e.key !== "Backspace") return false;
    if (!this.core.gridOptions.enableRangeSelection) return true;
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
    if (e.shiftKey && this.core.gridOptions.enableRangeSelection && moved) {
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
    const pageRows = Math.max(1, Math.floor(viewport.clientHeight / this.core.gridOptions.rowHeight));
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
    if (this.core.gridOptions.rowSelection === "none") return;
    this.core.selectionService.setNodeSelected(
      node,
      !node.selected,
      this.core.gridOptions.rowSelection === "single"
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
