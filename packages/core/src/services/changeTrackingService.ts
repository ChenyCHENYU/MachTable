import type { GridCore } from "../core/gridCore";
import type { GridChange } from "../types/api";
import type { CellValueChangedEvent } from "../types/events";

type ChangeTrackingContext = Pick<
  GridCore<any>,
  | "bodyRenderer"
  | "columnModel"
  | "emit"
  | "eventBus"
  | "getCellValue"
  | "rowModel"
  | "statusBarService"
  | "summaryRenderer"
  | "writeValue"
>;

interface CellChange {
  rowId: string;
  colId: string;
  originalValue: unknown;
  value: unknown;
}

export class ChangeTrackingService<TData = any> {
  private changes = new Map<string, CellChange>();
  private rollingBack = false;
  private unsubscribe: (() => void) | null = null;

  constructor(private core: ChangeTrackingContext) {}

  init(): void {
    this.unsubscribe = this.core.eventBus.on("cellValueChanged", (event) => {
      if (!this.rollingBack) this.record(event as CellValueChangedEvent<TData>);
    });
  }

  private record(event: CellValueChangedEvent<TData>): void {
    const key = `${event.rowNode.id}\u0000${event.column.id}`;
    const existing = this.changes.get(key);
    const originalValue = existing?.originalValue ?? event.oldValue;
    if (Object.is(event.newValue, originalValue)) this.changes.delete(key);
    else {
      this.changes.set(key, {
        rowId: event.rowNode.id,
        colId: event.column.id,
        originalValue,
        value: event.newValue
      });
    }
    this.emitChanged();
  }

  getDirtyRowIds(): string[] {
    return [...new Set([...this.changes.values()].map((change) => change.rowId))];
  }

  getChanges(): GridChange<TData>[] {
    const byRow = new Map<string, GridChange<TData>>();
    for (const change of this.changes.values()) {
      const node = this.core.rowModel.getNodeById(change.rowId);
      if (!node?.data) continue;
      let row = byRow.get(change.rowId);
      if (!row) {
        row = { rowId: change.rowId, data: node.data, cells: [] };
        byRow.set(change.rowId, row);
      }
      row.cells.push({
        colId: change.colId,
        originalValue: change.originalValue,
        value: change.value
      });
    }
    return [...byRow.values()];
  }

  markSaved(rowIds?: readonly string[]): void {
    if (!rowIds) this.changes.clear();
    else {
      const ids = new Set(rowIds);
      for (const [key, change] of this.changes) {
        if (ids.has(change.rowId)) this.changes.delete(key);
      }
    }
    this.emitChanged();
  }

  acknowledge(saved: readonly GridChange<TData>[]): void {
    for (const row of saved) {
      for (const cell of row.cells) {
        const key = `${row.rowId}\u0000${cell.colId}`;
        const current = this.changes.get(key);
        if (current) {
          if (Object.is(current.value, cell.value)) this.changes.delete(key);
          else current.originalValue = cell.value;
          continue;
        }
        const node = this.core.rowModel.getNodeById(row.rowId);
        const column = this.core.columnModel.getColumn(cell.colId);
        if (!node || !column || node.data == null) continue;
        const value = this.core.getCellValue(node, column);
        if (!Object.is(value, cell.value)) {
          this.changes.set(key, {
            rowId: row.rowId,
            colId: cell.colId,
            originalValue: cell.value,
            value
          });
        }
      }
    }
    this.emitChanged();
  }

  rollback(rowIds?: readonly string[]): boolean {
    const ids = rowIds ? new Set(rowIds) : null;
    const targets = [...this.changes.entries()].filter(([, change]) => !ids || ids.has(change.rowId));
    if (targets.length === 0) return false;
    const refresh = new Set<number>();
    const completed = new Set<string>();
    this.rollingBack = true;
    try {
      for (const [key, change] of targets) {
        const node = this.core.rowModel.getNodeById(change.rowId);
        const column = this.core.columnModel.getColumn(change.colId);
        if (!node || !column || node.data == null) continue;
        const current = this.core.getCellValue(node, column);
        if (Object.is(current, change.originalValue)) {
          completed.add(key);
          continue;
        }
        if (!this.core.writeValue(node, column, change.originalValue, current)) continue;
        completed.add(key);
        this.core.bodyRenderer.invalidateRowHeight(node);
        if (node.rowIndex >= 0) refresh.add(node.rowIndex);
        this.core.emit("cellValueChanged", {
          oldValue: current,
          newValue: change.originalValue,
          rowNode: node,
          rowIndex: node.rowIndex,
          column,
          colDef: column.colDef,
          data: node.data
        });
      }
    } finally {
      this.rollingBack = false;
    }
    for (const key of completed) this.changes.delete(key);
    if (refresh.size > 0) this.core.bodyRenderer.refreshRows([...refresh]);
    this.core.summaryRenderer.refresh();
    this.core.statusBarService.refresh();
    this.emitChanged();
    return completed.size > 0;
  }

  clearRows(rowIds: readonly string[]): void {
    if (rowIds.length === 0) return;
    const ids = new Set(rowIds);
    for (const [key, change] of this.changes) {
      if (ids.has(change.rowId)) this.changes.delete(key);
    }
    this.emitChanged();
  }

  clear(): void {
    if (this.changes.size === 0) return;
    this.changes.clear();
    this.emitChanged();
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.changes.clear();
  }

  private emitChanged(): void {
    this.core.emit("dirtyStateChanged", { dirtyRowIds: this.getDirtyRowIds() });
  }
}
