import { getByPath } from "../lib/path";
import type { GridApi } from "../types/api";
import type { RowNode } from "../types/row";
import type { RowOrderOptions } from "./types";
import { formatTwo } from "../lib/locale";
import type { RowDragIntent } from "../types/events";

export interface OrderDragSession<T> {
  rowIds: readonly string[];
  resolve(params: { targetNode: RowNode<T>; position: RowDragIntent["position"]; fraction: number; height: number }): {
    intent: RowDragIntent; indicatorIndex?: number; indicatorStyle?: string; text?: string; toIndex: number; targetIndex: number;
  } | string | false;
  validate(): boolean | string;
  keyboardTarget(direction: -1 | 1): RowNode<T> | undefined;
  isSource(nodeId: string): boolean;
}

interface Topology {
  parents: Map<string, string>;
  siblings: Map<string | null, string[]>;
  depths: Map<string, number>;
}

function dropPosition(tree: boolean, fraction: number, proposed: RowDragIntent["position"]): RowDragIntent["position"] {
  return tree && fraction > .25 && fraction < .75 ? "inside" : proposed;
}

function lowerBound(indexes: readonly number[], value: number): number {
  let first = 0, last = indexes.length;
  while (first < last) {
    const middle = (first + last) >>> 1;
    if (indexes[middle] < value) first = middle + 1;
    else last = middle;
  }
  return first;
}

function feedback(api: GridApi, count: number, from: number, target: number, position: RowDragIntent["position"], height: number) {
  const locale = api.getOption("locale") ?? {};
  const text = count > 1 ? formatTwo(locale.rowDragSelection ?? "已选 {a} 行 → 第 {b} 行", count, target + 1)
    : formatTwo(locale.rowDragPosition ?? "第 {a} 行 → 第 {b} 行", from + 1, target + 1);
  const label = position === "inside" ? locale.rowDragInside ?? "移入" : position === "before" ? locale.rowDragBefore ?? "之前" : locale.rowDragAfter ?? "之后";
  return { text: `${text} · ${label}`,
    indicatorStyle: position === "inside" ? `height:${height}px;background:color-mix(in srgb,var(--mach-primary) 12%,transparent);box-shadow:inset 0 0 0 1px var(--mach-primary)` : undefined };
}

function indexTopology<T>(rows: readonly T[], options: RowOrderOptions<T>, tree: boolean): Topology {
  const index: Topology = { parents: new Map(), siblings: new Map([[null, []]]), depths: new Map() };
  const pending = [...rows].reverse().map((row) => ({ row, parent: null as string | null, depth: 0 }));
  const childrenKey = options.childrenKey ?? "children" as keyof T & string;
  while (pending.length) {
    const { row, parent, depth } = pending.pop()!;
    const id = String(typeof options.rowKey === "function" ? options.rowKey(row) : getByPath(row, options.rowKey));
    if (index.depths.has(id)) throw new Error("[MachTable] Row ordering requires unique, acyclic row keys.");
    index.depths.set(id, depth);
    index.siblings.get(parent)!.push(id);
    index.siblings.set(id, []);
    if (parent !== null) index.parents.set(id, parent);
    const children = tree ? row[childrenKey] as readonly T[] | undefined : undefined;
    if (children != null && !Array.isArray(children)) throw new Error("[MachTable] Row ordering children must be an array.");
    for (let i = (children?.length ?? 0) - 1; i >= 0; i--) pending.push({ row: children![i], parent: id, depth: depth + 1 });
  }
  return index;
}

/** Expensive hierarchy/selection indexing belongs to this optional entry, once per gesture. */
export function createOrderDragSession<T>(api: GridApi<T>, source: RowNode<T>, rows: readonly T[], options: RowOrderOptions<T>, tree: boolean, revision?: string | number): OrderDragSession<T> {
  const nodes = new Map<string, RowNode<T>>();
  api.rows.forEach((node) => { if (!node.loading && !node.isDetail && !node.isGroup && node.data != null) nodes.set(node.id, node); });
  const topology = indexTopology(rows, options, tree);
  const ids = new Set(source.selected ? [...topology.depths.keys()].filter((id) => nodes.get(id)?.selected) : [source.id]);
  const rowIds = [...ids];
  const isSource = (nodeId: string): boolean => {
    let id: string | undefined = nodeId;
    while (id !== undefined) { if (ids.has(id)) return true; id = topology.parents.get(id); }
    return false;
  };
  const siblings = new Map<string | null, string[]>();
  const positions = new Map<string, number>();
  for (const [parent, children] of topology.siblings) {
    const remaining = children.filter((id) => !ids.has(id));
    siblings.set(parent, remaining);
    remaining.forEach((id, index) => positions.set(id, index));
  }
  const ends = new Map<string, number>();
  const sourceIndexes: number[] = [];
  const ancestors: RowNode<T>[] = [];
  let boundary = 0;
  api.rows.forEachDisplayed((node) => {
    if (isSource(node.id)) sourceIndexes.push(node.rowIndex);
    boundary = node.rowIndex + 1;
    const depth = topology.depths.get(node.id) ?? 0;
    while (ancestors.length && (topology.depths.get(ancestors[ancestors.length - 1].id) ?? 0) >= depth) ends.set(ancestors.pop()!.id, node.rowIndex);
    if (topology.siblings.get(node.id)?.length) ancestors.push(node);
  });
  for (const node of ancestors) ends.set(node.id, boundary);
  return {
    rowIds, isSource,
    validate: () => {
      for (const id of rowIds) {
        const node = nodes.get(id)!;
        if (node.treeLoading) return false;
        const allowed = api.getOption("rowDragPolicy")?.canDrag?.({ node, api });
        if (allowed === false || typeof allowed === "string") return allowed;
      }
      return true;
    },
    resolve: ({ targetNode, position: proposed, fraction, height }) => {
      const position = dropPosition(tree, fraction, proposed);
      if (isSource(targetNode.id)) return "Cannot target own subtree.";
      if (!tree && position === "inside") return false;
      const parent = position === "inside" ? targetNode.id : topology.parents.get(targetNode.id) ?? null;
      const remaining = siblings.get(parent) ?? [];
      const at = position === "inside" ? remaining.length : (positions.get(targetNode.id) ?? 0) + Number(position === "after");
      const toIndex = position === "before" ? targetNode.rowIndex : ends.get(targetNode.id) ?? targetNode.rowIndex + 1;
      const targetIndex = toIndex - lowerBound(sourceIndexes, toIndex) + lowerBound(sourceIndexes, source.rowIndex);
      return { intent: { rowIds, targetId: targetNode.id, position,
        beforeId: remaining[at - 1] ?? null, afterId: remaining[at] ?? null, expectedRevision: revision },
      indicatorIndex: position === "inside" ? targetNode.rowIndex : position === "after" ? ends.get(targetNode.id) : undefined,
      toIndex, targetIndex,
      ...feedback(api, rowIds.length, source.rowIndex, targetNode.rowIndex, position, height) };
    },
    keyboardTarget: (direction) => {
      let origin = source.id;
      while (ids.has(topology.parents.get(origin) ?? "")) origin = topology.parents.get(origin)!;
      const candidates = topology.siblings.get(topology.parents.get(origin) ?? null) ?? [];
      let index = candidates.indexOf(origin) + direction;
      while (index >= 0 && index < candidates.length) {
        const id = candidates[index];
        if (!isSource(id) && nodes.has(id)) return nodes.get(id);
        index += direction;
      }
      return undefined;
    }
  };
}
