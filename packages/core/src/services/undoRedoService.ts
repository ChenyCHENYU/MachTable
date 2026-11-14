import type { GridCore } from "../core/gridCore";
import { refreshEditedRows } from "../lib/editRefresh";

type UndoContext = Pick<
  GridCore<any>,
  | "bodyRenderer"
  | "cancelPendingInput"
  | "changeTracker"
  | "columnModel"
  | "gridOptions"
  | "notifyCellValueChanged"
  | "readCellValue"
  | "rowModel"
  | "statusBarService"
  | "summaryRenderer"
  | "writeValue"
>;

export interface UndoEntry {
  rowId: string;
  colId: string;
  oldValue: any;
  newValue: any;
}

/** @internal The editing facade delegates history operations without exposing this service. */
export class UndoRedoService {
  private undoStackEntries: UndoEntry[][] = [];
  private pointer = -1;
  // False keeps a replaced batch open until endBatch without recording its remaining edits.
  private pendingHistoryEntry: UndoEntry[] | false | null = null;

  constructor(private core: UndoContext) {}

  beginBatch(): void {
    this.core.changeTracker.beginBatch();
    if (this.pendingHistoryEntry === null) this.pendingHistoryEntry = [];
  }

  endBatch(): void {
    const batch = this.pendingHistoryEntry;
    this.pendingHistoryEntry = null;
    if (batch && batch.length) this.push(batch);
    this.core.changeTracker.endBatch();
  }

  record(entry: UndoEntry): void {
    const pending = this.pendingHistoryEntry;
    if (pending) pending.push(entry);
    else if (pending !== false) this.push([entry]);
  }

  private push(batch: UndoEntry[]): void {
    if (this.core.gridOptions.undoStackSize === 0) return;
    this.undoStackEntries.length = this.pointer + 1;
    this.undoStackEntries.push(batch);
    this.pointer++;
    this.trimToSize();
  }

  trimToSize(): void {
    const maxSize = this.core.gridOptions.undoStackSize;
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
    const batch = this.undoStackEntries[this.pointer--];
    this.apply(batch, false);
    return true;
  }

  redo(): boolean {
    this.core.cancelPendingInput();
    if (!this.canRedo()) return false;
    this.apply(this.undoStackEntries[++this.pointer], true);
    return true;
  }

  private apply(batch: UndoEntry[], redo: boolean): void {
    const core = this.core;
    const refreshIndexes: number[] = [];
    let stack = this.undoStackEntries;
    core.changeTracker.beginBatch();
    try {
      for (const entry of batch) {
        if (stack !== this.undoStackEntries) {
          stack = this.undoStackEntries;
          if (!stack.includes(batch)) break;
        }
        const node = core.rowModel.getNodeById(entry.rowId);
        const column = core.columnModel.getColumn(entry.colId);
        if (!node || !column || node.data == null) continue;
        const value = redo ? entry.newValue : entry.oldValue;
        const replaced = redo ? entry.oldValue : entry.newValue;
        // Custom accessors can normalize values. Their external replacements invalidate the batch by row ID.
        if (!column.colDef.valueGetter && !column.colDef.valueSetter &&
            !Object.is(core.readCellValue(node, column), replaced)) continue;
        if (core.writeValue(node, column, value, replaced)) {
          if (node.rowIndex >= 0) refreshIndexes.push(node.rowIndex);
          core.notifyCellValueChanged(node, column, replaced, value, "undo");
        }
      }
      refreshEditedRows(core, refreshIndexes);
    } finally { core.changeTracker.endBatch(); }
  }

  invalidateRows(rowIds: readonly string[]): void {
    if (rowIds.length === 0 || (!this.undoStackEntries.length && !this.pendingHistoryEntry)) return;
    const ids = new Set(rowIds);
    const touches = (batch: UndoEntry[]) => batch.some((entry) => ids.has(entry.rowId));
    const pointer = this.pointer;
    // A paste/fill operation remains one history entry even if only one target row was replaced.
    this.undoStackEntries = this.undoStackEntries.filter((batch, index) => {
      if (!touches(batch)) return true;
      if (index <= pointer) this.pointer--;
      return false;
    });
    if (this.pendingHistoryEntry && touches(this.pendingHistoryEntry)) this.pendingHistoryEntry = false;
  }

  clear(): void {
    this.undoStackEntries = [];
    this.pointer = -1;
    this.pendingHistoryEntry = null;
  }
}
