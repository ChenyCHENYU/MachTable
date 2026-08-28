import type { GridCore } from "../core/gridCore";

type UndoContext = Pick<
  GridCore<any>,
  | "bodyRenderer"
  | "columnModel"
  | "emit"
  | "options"
  | "rowModel"
  | "statusBarService"
  | "summaryRenderer"
  | "writeValue"
>;

export interface UndoEntry {
  nodeId: string;
  columnId: string;
  oldValue: any;
  newValue: any;
}

export class UndoRedoService {
  private stack: UndoEntry[][] = [];
  private pointer = -1;
  private pending: UndoEntry[] | null = null;

  constructor(private core: UndoContext) {}

  beginBatch(): void {
    if (this.pending) return;
    this.pending = [];
  }

  endBatch(): void {
    if (!this.pending) return;
    const batch = this.pending;
    this.pending = null;
    if (batch.length > 0) this.push(batch);
  }

  cancelBatch(): void {
    this.pending = null;
  }

  record(entry: UndoEntry): void {
    if (this.pending) {
      this.pending.push(entry);
      return;
    }
    this.push([entry]);
  }

  private push(batch: UndoEntry[]): void {
    const maxSize = Math.max(0, this.core.options.undoStackSize);
    if (maxSize === 0) return;
    this.stack.length = this.pointer + 1;
    this.stack.push(batch);
    while (this.stack.length > maxSize) this.stack.shift();
    this.pointer = this.stack.length - 1;
  }

  trimToSize(): void {
    const maxSize = Math.max(0, this.core.options.undoStackSize);
    if (maxSize === 0) {
      this.clear();
      return;
    }
    while (this.stack.length > maxSize) {
      this.stack.shift();
      this.pointer--;
    }
    if (this.pointer < -1) this.pointer = -1;
  }

  canUndo(): boolean {
    return this.pointer >= 0;
  }

  canRedo(): boolean {
    return this.pointer < this.stack.length - 1;
  }

  undo(): boolean {
    if (!this.canUndo()) return false;
    this.apply(this.stack[this.pointer], false);
    this.pointer--;
    return true;
  }

  redo(): boolean {
    if (!this.canRedo()) return false;
    this.pointer++;
    this.apply(this.stack[this.pointer], true);
    return true;
  }

  private apply(batch: UndoEntry[], redo: boolean): void {
    const core = this.core;
    const refreshIndexes: number[] = [];
    for (const entry of batch) {
      const node = core.rowModel.getNodeById(entry.nodeId);
      const column = core.columnModel.getColumn(entry.columnId);
      if (!node || !column || node.data == null) continue;
      const value = redo ? entry.newValue : entry.oldValue;
      const replaced = redo ? entry.oldValue : entry.newValue;
      if (core.writeValue(node, column, value, replaced)) {
        core.bodyRenderer.invalidateRowHeight(node);
        core.bodyRenderer.queueFlash([node.rowIndex], [column.id]);
        if (node.rowIndex >= 0) refreshIndexes.push(node.rowIndex);
        core.emit("cellValueChanged", {
          oldValue: replaced,
          newValue: value,
          rowNode: node,
          rowIndex: node.rowIndex,
          column,
          colDef: column.colDef,
          data: node.data
        });
      }
    }
    if (refreshIndexes.length > 0) core.bodyRenderer.refreshRows(refreshIndexes);
    core.summaryRenderer.refresh();
    core.statusBarService.refresh();
  }

  clear(): void {
    this.stack = [];
    this.pointer = -1;
    this.pending = null;
  }
}
