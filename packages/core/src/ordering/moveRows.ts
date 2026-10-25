import type { RowOrderIntent, RowOrderOptions, RowOrderPlan } from "./types";
import { getByPath } from "../lib/path";

interface Entry<T> { id: string; row: T; parentId: string | null; children: readonly T[]; selectedAncestor: boolean }
interface Index<T> { entries: Entry<T>[]; byId: Map<string, Entry<T>>; byRow: Map<T, Entry<T>>; children: Map<string | null, readonly T[]> }
interface Sources<T> { moved: Entry<T>[]; selected: ReadonlySet<string> }

function keyOf<T>(row: T, options: RowOrderOptions<T>): string {
  const key = typeof options.rowKey === "function" ? options.rowKey(row) : getByPath(row, options.rowKey);
  if (key == null || String(key).length === 0) throw new Error("[MachTable] Row ordering requires a non-empty stable row key.");
  return String(key);
}

function childRows<T>(row: T, childrenKey: keyof T & string): readonly T[] {
  const children = row[childrenKey];
  if (children == null) return [];
  if (!Array.isArray(children)) throw new Error(`[MachTable] Tree ordering expects an array at "${childrenKey}".`);
  return children;
}

/** Iterative indexing rejects duplicate IDs and cyclic/shared nodes before any write. */
function indexRows<T>(rows: readonly T[], selected: ReadonlySet<string>, options: RowOrderOptions<T>, tree: boolean): Index<T> {
  const index: Index<T> = { entries: [], byId: new Map(), byRow: new Map(), children: new Map([[null, rows]]) };
  const pending = [...rows].reverse().map((row) => ({ row, parentId: null as string | null, selectedAncestor: false }));
  const childrenKey = options.childrenKey ?? "children" as keyof T & string;
  while (pending.length) {
    const current = pending.pop()!;
    const id = keyOf(current.row, options);
    if (index.byId.has(id)) throw new Error(`[MachTable] Row ordering found duplicate or cyclic row key "${id}".`);
    const children = tree ? childRows(current.row, childrenKey) : [];
    const entry = { ...current, id, children };
    index.entries.push(entry);
    index.byId.set(id, entry);
    index.byRow.set(entry.row, entry);
    index.children.set(id, children);
    for (let position = children.length - 1; position >= 0; position--) pending.push({
      row: children[position], parentId: id, selectedAncestor: current.selectedAncestor || selected.has(id)
    });
  }
  return index;
}

function normalizeIntent(intent: RowOrderIntent): RowOrderIntent {
  if (!["before", "after", "inside"].includes(intent.position)) throw new Error("[MachTable] Unknown row ordering position.");
  const rowIds = [...new Set(intent.rowIds.map(String))];
  if (!rowIds.length) throw new Error("[MachTable] Row ordering requires at least one source row.");
  return { ...intent, rowIds, targetId: String(intent.targetId) };
}

function resolveSources<T>(index: Index<T>, rowIds: readonly string[]): Sources<T> {
  for (const id of rowIds) if (!index.byId.has(id)) throw new Error(`[MachTable] Ordering source "${id}" is unavailable.`);
  const selected = new Set(rowIds);
  return { selected, moved: index.entries.filter((entry) => selected.has(entry.id) && !entry.selectedAncestor) };
}

function checkTargets<T>(index: Index<T>, sources: Sources<T>, intent: RowOrderIntent, options: RowOrderOptions<T>): string | null {
  const target = index.byId.get(intent.targetId);
  if (!target) throw new Error(`[MachTable] Ordering target "${intent.targetId}" is unavailable.`);
  if (sources.selected.has(target.id) || target.selectedAncestor) throw new Error("[MachTable] A row cannot be moved into or relative to its own subtree.");
  const parentId = intent.position === "inside" ? target.id : target.parentId;
  const parent = parentId === null ? null : index.byId.get(parentId)!.row;
  if (options.canMove) for (const entry of sources.moved) {
    const previousParent = entry.parentId === null ? null : index.byId.get(entry.parentId)!.row;
    const allowed = options.canMove({ row: entry.row, previousParent, parent, target: target.row, intent });
    if (allowed === false || typeof allowed === "string") throw new Error(typeof allowed === "string" ? allowed : "[MachTable] This row cannot be moved to the selected parent.");
  }
  return parentId;
}

/** Pointer feedback reuses this index; only commit constructs changed arrays. */
export function createRowOrderValidator<T>(rows: readonly T[], rowIds: readonly string[], options: RowOrderOptions<T>, tree: boolean): (intent: RowOrderIntent) => void {
  const ids = [...new Set(rowIds.map(String))];
  if (!ids.length) throw new Error("[MachTable] Row ordering requires at least one source row.");
  const index = indexRows(rows, new Set(ids), options, tree);
  const sources = resolveSources(index, ids);
  return (intent) => {
    if (!tree && intent.position === "inside") throw new Error("[MachTable] Flat rows cannot have child destinations.");
    checkTargets(index, sources, intent, options);
  };
}

function changedLists<T>(index: Index<T>, moved: readonly Entry<T>[], parentId: string | null, intent: RowOrderIntent): Map<string | null, readonly T[]> {
  const ids = new Set(moved.map((entry) => entry.id));
  const changed = new Map<string | null, readonly T[]>();
  for (const entry of moved) {
    if (changed.has(entry.parentId)) continue;
    changed.set(entry.parentId, index.children.get(entry.parentId)!.filter((row) => !ids.has(index.byRow.get(row)!.id)));
  }
  const destination = changed.get(parentId) ?? index.children.get(parentId)!;
  const targetIndex = destination.findIndex((row) => row === index.byId.get(intent.targetId)!.row);
  const insertion = intent.position === "inside" ? destination.length : targetIndex + Number(intent.position === "after");
  // Array spreads avoid the engine's argument limit for large selected sets.
  changed.set(parentId, [...destination.slice(0, insertion), ...moved.map((entry) => entry.row), ...destination.slice(insertion)]);
  return changed;
}

function sameRows<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((row, index) => row === right[index]);
}

function reconstruct<T>(rows: readonly T[], index: Index<T>, changed: Map<string | null, readonly T[]>, options: RowOrderOptions<T>): readonly T[] {
  const replacements = new Map<T, T>();
  const key = options.childrenKey ?? "children" as keyof T & string;
  for (let position = index.entries.length - 1; position >= 0; position--) {
    const entry = index.entries[position];
    const children = changed.get(entry.id) ?? entry.children;
    const next = children.map((row) => replacements.get(row) ?? row);
    if (!sameRows(entry.children, next)) replacements.set(entry.row, { ...entry.row, [key]: next });
  }
  const next = (changed.get(null) ?? rows).map((row) => replacements.get(row) ?? row);
  return sameRows(rows, next) ? rows : next;
}

function placement<T>(intent: RowOrderIntent, moved: readonly Entry<T>[], siblings: readonly T[], index: Index<T>): RowOrderIntent {
  const start = siblings.indexOf(moved[0].row);
  const end = start + moved.length;
  return {
    ...intent,
    rowIds: moved.map((entry) => entry.id),
    beforeId: start > 0 ? index.byRow.get(siblings[start - 1])!.id : null,
    afterId: end < siblings.length ? index.byRow.get(siblings[end])!.id : null
  };
}

/** Reverse source order lets each restored row anchor to its already-restored next sibling. */
export function inverseRowOrderOperations<T>(plan: RowOrderPlan<T>, options: RowOrderOptions<T>, tree: boolean): readonly RowOrderIntent[] {
  const index = indexRows(plan.before, new Set(plan.rowIds), options, tree);
  const positions = new Map<string, number>();
  for (const siblings of index.children.values()) siblings.forEach((row, position) => positions.set(index.byRow.get(row)!.id, position));
  return resolveSources(index, plan.rowIds).moved.reverse().map(entry => {
    const siblings = index.children.get(entry.parentId)!;
    const position = positions.get(entry.id)!;
    const next = siblings[position + 1];
    if (next) return { rowIds: [entry.id], targetId: index.byRow.get(next)!.id, position: "before" };
    if (entry.parentId !== null) return { rowIds: [entry.id], targetId: entry.parentId, position: "inside" };
    const previous = siblings[position - 1];
    if (!previous) throw new Error("[MachTable] Row ordering cannot restore an isolated root.");
    return { rowIds: [entry.id], targetId: index.byRow.get(previous)!.id, position: "after" };
  });
}

export function validateRowOrderRestore<T>(before: readonly T[], after: readonly T[], operations: readonly RowOrderIntent[], options: RowOrderOptions<T>, tree: boolean): void {
  if (!options.canMove) return;
  const source = indexRows(before, new Set(), options, tree), destination = indexRows(after, new Set(), options, tree);
  for (const intent of operations) for (const id of intent.rowIds) {
    const entry = source.byId.get(id)!, restored = destination.byId.get(id)!;
    const parent = restored.parentId === null ? null : source.byId.get(restored.parentId)!.row;
    const previousParent = entry.parentId === null ? null : source.byId.get(entry.parentId)!.row;
    const allowed = options.canMove({ row: entry.row, previousParent, parent, target: source.byId.get(intent.targetId)!.row, intent });
    if (allowed === false || typeof allowed === "string") throw new Error(typeof allowed === "string" ? allowed : "[MachTable] This row cannot be restored to its previous parent.");
  }
}

function move<T>(rows: readonly T[], rawIntent: RowOrderIntent, options: RowOrderOptions<T>, tree: boolean): RowOrderPlan<T> {
  const intent = normalizeIntent(rawIntent);
  if (!tree && intent.position === "inside") throw new Error("[MachTable] Flat rows cannot have child destinations.");
  const index = indexRows(rows, new Set(intent.rowIds), options, tree);
  const { moved, selected } = resolveSources(index, intent.rowIds);
  const parentId = checkTargets(index, { moved, selected }, intent, options);
  const changed = changedLists(index, moved, parentId, intent);
  const after = reconstruct(rows, index, changed, options);
  const installedIntent = placement(intent, moved, changed.get(parentId)!, index);
  return { before: rows, after, intent: installedIntent, rowIds: installedIntent.rowIds, changed: rows !== after };
}

/** Pure stable-ID move. Input arrays and row objects are never mutated. */
export function reorderRows<T>(rows: readonly T[], intent: RowOrderIntent, options: RowOrderOptions<T>): RowOrderPlan<T> {
  return move(rows, intent, options, false);
}

/** Moves selected subtrees together, sharing every untouched branch by identity. */
export function moveTreeNodes<T>(rows: readonly T[], intent: RowOrderIntent, options: RowOrderOptions<T>): RowOrderPlan<T> {
  return move(rows, intent, options, true);
}
