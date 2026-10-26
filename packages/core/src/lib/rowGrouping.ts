import type { RowNode } from "../types/row";
import { GROUP_ID_PREFIX } from "./groupIdentity";

interface GroupColumn { id: string }
type GroupPath = readonly [string, string][];
type ReadValue<T, C> = (node: RowNode<T>, column: C) => unknown;

/** Presentation labels are intentionally separate from identity, including nullish labels. */
function identity(value: unknown): string {
  if (value == null) return "null";
  if (value instanceof Date) return JSON.stringify(["date", String(value.getTime())]);
  return JSON.stringify([typeof value, label(value)]);
}

function label(value: unknown): string {
  // Opaque objects retain their established display label; identity separately records their type.
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return value == null ? "(空)" : String(value);
}

function groupId(path: GroupPath): string {
  return GROUP_ID_PREFIX + JSON.stringify(path);
}

interface Bucket<T> { key: string; label: string; rows: RowNode<T>[] }

function bucketsFor<T, C>(rows: RowNode<T>[], column: C, read: ReadValue<T, C>): Bucket<T>[] {
  const buckets = new Map<string, Bucket<T>>();
  for (const row of rows) {
    const value = read(row, column);
    const key = identity(value);
    let bucket = buckets.get(key);
    if (!bucket) { bucket = { key, label: label(value), rows: [] }; buckets.set(key, bucket); }
    bucket.rows.push(row);
  }
  return [...buckets.values()].sort((left, right) =>
    left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: "base" }) || left.key.localeCompare(right.key)
  );
}

/** Construct canonical display and aggregate leaves together; hidden groups still contribute known IDs and aggregates. */
export function buildRowGroups<T, C extends GroupColumn>(
  rows: RowNode<T>[], columns: readonly C[], read: ReadValue<T, C>, aggregate: (leaves: RowNode<T>[]) => Record<string, any>, expanded: ReadonlySet<string>
): { rows: RowNode<T>[]; ids: string[] } {
  const ids: string[] = [];
  const build = (nodes: RowNode<T>[], level: number, path: GroupPath): { display: RowNode<T>[]; leaves: RowNode<T>[] } => {
    if (level === columns.length) return { display: nodes, leaves: nodes };
    const display: RowNode<T>[] = [], leaves: RowNode<T>[] = [];
    for (const bucket of bucketsFor(nodes, columns[level], read)) {
      const nextPath: GroupPath = [...path, [columns[level].id, bucket.key]];
      const id = groupId(nextPath);
      ids.push(id);
      const child = build(bucket.rows, level + 1, nextPath);
      display.push({ id, data: null, rowIndex: -1, selected: false, isGroup: true, groupLevel: level,
        groupKey: bucket.label, leafNodes: child.leaves, aggValues: aggregate(child.leaves) });
      if (expanded.has(id)) for (const node of child.display) display.push(node);
      // The top-level caller only needs display; ancestor groups alone consume the combined leaf list.
      if (level > 0) for (const leaf of child.leaves) leaves.push(leaf);
    }
    return { display, leaves };
  };
  return { rows: build(rows, 0, []).display, ids };
}

/** Validate old delimiter IDs against full input, including rows currently hidden by a filter. */
export function migrateGroupExpansion<T, C extends GroupColumn>(
  expanded: Set<string>, rows: readonly RowNode<T>[], columns: readonly C[], read: ReadValue<T, C>
): { expanded: Set<string>; ambiguous: string[] } {
  const legacy = new Set([...expanded].filter((id) => id.startsWith("/g0:")));
  if (!legacy.size) return { expanded, ambiguous: [] };
  const aliases = new Map<string, string | null>();
  for (const row of rows) {
    const path: [string, string][] = [];
    let oldId = "";
    for (let level = 0; level < columns.length; level++) {
      const value = read(row, columns[level]);
      path.push([columns[level].id, identity(value)]);
      oldId += `/g${level}:${label(value)}`;
      if (!legacy.has(oldId)) continue;
      const id = groupId(path);
      aliases.set(oldId, aliases.has(oldId) && aliases.get(oldId) !== id ? null : id);
    }
  }
  const migrated = new Set([...expanded].filter((id) => !legacy.has(id)));
  const ambiguous: string[] = [];
  for (const oldId of legacy) {
    const id = aliases.get(oldId);
    if (id) migrated.add(id);
    else if (id === null) ambiguous.push(oldId);
    else migrated.add(oldId); // Data may arrive after persisted expansion is restored.
  }
  return { expanded: migrated, ambiguous };
}
