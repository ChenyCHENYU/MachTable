import type { GridApi } from "../types/api";
import type { RowNode } from "../types/row";
import type { RowOrderIntent, RowOrderPlan } from "./types";

export interface SnapshotEntry<T> { row: T; parent: T | null }
export interface NodeEntry<T> { node: RowNode<T>; data: T | null }
export interface OrderHistoryEntry<T> { plan: RowOrderPlan<T>; inverse: readonly RowOrderIntent[] }

export function snapshot<T>(rows: readonly T[], key: keyof T & string, tree: boolean): SnapshotEntry<T>[] {
  const entries: SnapshotEntry<T>[] = [];
  const pending = [...rows].reverse().map(row => ({ row, parent: null as T | null }));
  const seen = new Set<T>();
  while (pending.length) {
    const entry = pending.pop()!;
    if (seen.has(entry.row)) throw new Error("[MachTable] Installed order contains duplicate or cyclic rows.");
    seen.add(entry.row);
    entries.push(entry);
    const children = tree ? (entry.row[key] ?? []) as readonly T[] : [];
    for (let index = children.length - 1; index >= 0; index--) pending.push({ row: children[index], parent: entry.row });
  }
  return entries;
}

export function ownsSnapshot<T>(rows: readonly T[], installed: readonly SnapshotEntry<T>[], key: keyof T & string, tree: boolean): boolean {
  try {
    const current = snapshot(rows, key, tree);
    return current.length === installed.length && current.every((entry, index) => entry.row === installed[index].row && entry.parent === installed[index].parent);
  } catch { return false; }
}

export function nodeSnapshot<T>(api: GridApi<T> | null): NodeEntry<T>[] {
  const nodes: NodeEntry<T>[] = [];
  api?.rows.forEach(node => nodes.push({ node, data: node.data }));
  return nodes;
}

export function ownsNodes<T>(api: GridApi<T> | null, installed: readonly NodeEntry<T>[]): boolean {
  if (!api) return true;
  if (api.isDestroyed()) return false;
  let index = 0, same = true;
  api.rows.forEach(node => { const entry = installed[index++]; if (entry?.node !== node || entry.data !== node.data) same = false; });
  return same && index === installed.length;
}

/** A bounded cursor changes only after the corresponding atomic save succeeds. */
export class RowOrderHistory<T> {
  private entries: OrderHistoryEntry<T>[] = [];
  private cursor = 0;
  get canUndo(): boolean { return this.cursor > 0; }
  get canRedo(): boolean { return this.cursor < this.entries.length; }
  peek(direction: "undo" | "redo"): OrderHistoryEntry<T> | undefined { return this.entries[direction === "undo" ? this.cursor - 1 : this.cursor]; }
  commit(operation: "move" | "undo" | "redo", entry: OrderHistoryEntry<T>): void {
    if (operation === "undo") this.cursor--;
    else if (operation === "redo") this.cursor++;
    else {
      this.entries.splice(this.cursor);
      this.entries.push(entry);
      if (this.entries.length > 50) this.entries.shift();
      this.cursor = this.entries.length;
    }
  }
  clear(): void { this.entries = []; this.cursor = 0; }
}
