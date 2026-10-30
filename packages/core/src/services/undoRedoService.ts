import type { GridCore } from "../core/gridCore";

type UndoContext = Pick<
  GridCore<any>,
  | "bodyRenderer"
  | "cancelPendingInput"
  | "columnModel"
  | "emit"
  | "gridOptions"
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

/** @internal The editing facade delegates history operations without exposing this service. */
export class UndoRedoService {
  private undoStackEntries: UndoEntry[][] = [];
  private pointer = -1;
  private pendingHistoryEntry: UndoEntry[] | null = null;

  constructor(private core: UndoContext) {}

  beginBatch(): void {
    if (this.pendingHistoryEntry) return;
    this.pendingHistoryEntry = [];
  }

  endBatch(): void {
    if (!this.pendingHistoryEntry) return;
    const batch = this.pendingHistoryEntry;
    this.pendingHistoryEntry = null;
    if (batch.length > 0) this.push(batch);
  }

  record(entry: UndoEntry): void {
    if (this.pendingHistoryEntry) {
      this.pendingHistoryEntry.push(entry);
      return;
    }
    this.push([entry]);
  }

  private push(batch: UndoEntry[]): void {
    const maxSize = Math.max(0, this.core.gridOptions.undoStackSize);
    if (maxSize === 0) return;
    this.undoStackEntries.length = this.pointer + 1;
    this.undoStackEntries.push(batch);
    while (this.undoStackEntries.length > maxSize) this.undoStackEntries.shift();
    this.pointer = this.undoStackEntries.length - 1;
  }

  trimToSize(): void {
    const maxSize = Math.max(0, this.core.gridOptions.undoStackSize);
    if (maxSize === 0) {
      this.clear();
      return;
    }
    while (this.undoStackEntries.length > maxSize) {
      this.undoStackEntries.shift();
      this.pointer--;
    }
    if (this.pointer < -1) this.pointer = -1;
  }

  canUndo(): boolean {
    return this.pointer >= 0;
  }

  canRedo(): boolean {
    return this.pointer < this.undoStackEntries.length - 1;
  }

  undo(): boolean {
    this.core.cancelPendingInput();
    if (!this.canUndo()) return false;
    this.apply(this.undoStackEntries[this.pointer], false);
    this.pointer--;
    return true;
  }

  redo(): boolean {
    this.core.cancelPendingInput();
    if (!this.canRedo()) return false;
    this.pointer++;
    this.apply(this.undoStackEntries[this.pointer], true);
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
    this.undoStackEntries = [];
    this.pointer = -1;
    this.pendingHistoryEntry = null;
  }
}
