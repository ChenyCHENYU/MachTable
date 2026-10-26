// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGrid, type GridApi, type RowNode } from "../index";
import { normalizeGridState, selectGridStateSections } from "../lib/gridState";
import { MAX_PERSISTED_GROUP_ID_LENGTH } from "../lib/groupIdentity";
import { buildRowGroups } from "../lib/rowGrouping";

type Row = { id: string; a: unknown; b?: unknown; amount?: number };
const grids: GridApi<Row>[] = [];
afterEach(() => { for (const api of grids.splice(0)) api.destroy(); document.body.replaceChildren(); });

function grid(rows: Row[], nested = false, onError = vi.fn()): GridApi<Row> {
  const host = document.body.appendChild(document.createElement("div"));
  const api = createGrid<Row>(host, { rowData: rows, rowKey: "id", onGridError: onError, pagination: false,
    columnDefs: [{ field: "a", rowGroup: true }, { field: "b", rowGroup: nested }, { field: "amount", aggFunc: "sum" }] });
  grids.push(api);
  return api;
}

function displayed(api: GridApi<Row>): RowNode<Row>[] {
  const rows: RowNode<Row>[] = [];
  for (let index = 0; index < api.rows.getCount(); index++) rows.push(api.rows.getAt(index)!);
  return rows;
}

describe("typed local grouping identity", () => {
  it("separates primitive types and literal empty labels while retaining nullish grouping", () => {
    const api = grid([null, undefined, "(空)", 1, "1", false, "false", NaN, "NaN"].map((a, index) => ({ id: String(index), a })));
    const groups = displayed(api);
    expect(groups).toHaveLength(8);
    expect(new Set(groups.map((node) => node.id)).size).toBe(8);
    expect(groups.find((node) => node.leafNodes?.length === 2)?.leafNodes?.map((node) => node.id)).toEqual(["0", "1"]);
  });

  it("keeps delimiter-bearing paths distinct and stable across reorder/expansion/state round trips", () => {
    const rows = [{ id: "1", a: "A/g1:B", b: "C" }, { id: "2", a: "A", b: "B/g1:C" }];
    const api = grid(rows, true);
    api.hierarchy.setAllGroupsExpanded(true);
    const groups = displayed(api).filter((node) => node.isGroup);
    expect(new Set(groups.map((node) => node.id)).size).toBe(4);
    const before = new Map(groups.map((node) => [node.leafNodes?.[0].id + ":" + node.groupLevel, node.id]));
    const state = api.state.get();
    api.rows.setData([...rows].reverse());
    api.state.apply(state);
    for (const node of displayed(api).filter((node) => node.isGroup)) expect(node.id).toBe(before.get(node.leafNodes?.[0].id + ":" + node.groupLevel));
    expect(displayed(api).filter((node) => !node.isGroup)).toHaveLength(2);
  });

  it("migrates unambiguous legacy expansion IDs", () => {
    const api = grid([{ id: "1", a: "A", b: "B" }], true);
    api.state.apply({ ...api.state.get(), expandedGroupIds: ["/g0:A", "/g0:A/g1:B"] });
    expect(displayed(api).map((node) => node.id)).toContain("1");
    expect(api.state.get().expandedGroupIds.every((id) => id.startsWith("group:"))).toBe(true);
  });

  it.each(["a".repeat(490), '"\\'.repeat(245)])("round-trips a legal long legacy identity after typed migration", (value) => {
    const api = grid([{ id: "1", a: value }]);
    api.state.apply({ ...api.state.get(), expandedGroupIds: [`/g0:${value}`] });
    expect(displayed(api).some((node) => node.id === "1")).toBe(true);
    const snapshot = selectGridStateSections(api.state.get(), ["expansion"]);
    expect(snapshot.expandedGroupIds).toHaveLength(1);
    expect(snapshot.expandedGroupIds[0].length).toBeGreaterThan(512);
    api.hierarchy.setAllGroupsExpanded(false);
    api.state.apply(snapshot, { sections: ["expansion"] });
    expect(displayed(api).some((node) => node.id === "1")).toBe(true);
  });

  it("bounds group identities independently without widening row/column IDs", () => {
    const api = grid([{ id: "1", a: "a".repeat(490) }]);
    api.hierarchy.setAllGroupsExpanded(true);
    const id = api.state.get().expandedGroupIds[0];
    const state = normalizeGridState({ ...api.state.get(), columns: [{ colId: id }], sortModel: [{ colId: id, direction: "asc" }],
      selectedRowIds: [id], expandedRowIds: [id], expandedGroupIds: [id, "group:" + "x".repeat(MAX_PERSISTED_GROUP_ID_LENGTH), "x".repeat(513), "/g0:" + "x".repeat(509), "", 42] })!;
    expect(state.expandedGroupIds).toEqual([id]);
    expect(state.selectedRowIds).toEqual([]);
    expect(state.expandedRowIds).toEqual([]);
    expect(state.columns).toEqual([]);
    expect(state.sortModel).toEqual([]);
    // The protocol bound does not impose a new restriction on live records or partially replace the model.
    api.rows.setData([{ id: "oversized", a: "x".repeat(MAX_PERSISTED_GROUP_ID_LENGTH) }]);
    api.hierarchy.setAllGroupsExpanded(true);
    expect(displayed(api).some((node) => node.id === "oversized")).toBe(true);
    expect(normalizeGridState(api.state.get())!.expandedGroupIds.every((entry) => entry.length <= MAX_PERSISTED_GROUP_ID_LENGTH)).toBe(true);
  });

  it("round-trips multi-level escaped legacy paths", () => {
    const a = '"\\x'.repeat(75), b = "g1:/".repeat(60);
    const api = grid([{ id: "1", a, b }], true);
    api.state.apply({ ...api.state.get(), expandedGroupIds: [`/g0:${a}`, `/g0:${a}/g1:${b}`] });
    const snapshot = selectGridStateSections(api.state.get(), ["expansion"]);
    expect(snapshot.expandedGroupIds).toHaveLength(2);
    api.hierarchy.setAllGroupsExpanded(false);
    api.state.apply(snapshot, { sections: ["expansion"] });
    expect(displayed(api).some((node) => node.id === "1")).toBe(true);
  });

  it("keeps the former total state identity budget when canonical IDs grow", () => {
    const api = grid([]);
    const budget = 100_000 * 512;
    const prefix = "group:" + "x".repeat(MAX_PERSISTED_GROUP_ID_LENGTH - 10);
    const ids = Array.from({ length: Math.ceil(budget / MAX_PERSISTED_GROUP_ID_LENGTH) + 1 }, (_, index) => prefix + String(index).padStart(4, "0"));
    const state = normalizeGridState({ ...api.state.get(), expandedGroupIds: [...ids, ids[0], "group:small"] })!;
    expect(state.expandedGroupIds).toHaveLength(Math.floor(budget / MAX_PERSISTED_GROUP_ID_LENGTH) + 1);
    expect(state.expandedGroupIds[state.expandedGroupIds.length - 1]).toBe("group:small");
    expect(state.expandedGroupIds.reduce((total, entry) => total + entry.length, 0)).toBeLessThanOrEqual(budget);
  });

  it("rejects ambiguous legacy IDs even when a conflicting typed path is filtered out", () => {
    const onError = vi.fn();
    const api = grid([{ id: "1", a: 1 }, { id: "2", a: "1" }], false, onError);
    api.filtering.setModel({ a: { type: "set", values: [1] } });
    api.state.apply({ ...api.state.get(), expandedGroupIds: ["/g0:1"] });
    expect(api.state.get().expandedGroupIds).toEqual([]);
    expect(displayed(api).every((node) => node.isGroup)).toBe(true);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "STATE_ERROR", source: "gridState.groupExpansion", error: expect.any(Error) }));
  });

  it("does not append large groups through function arguments", () => {
    const api = grid(Array.from({ length: 140_000 }, (_, index) => ({ id: String(index), a: "A", amount: 1 })));
    expect(displayed(api)[0]?.leafNodes).toHaveLength(140_000);
    expect(displayed(api)[0]?.aggValues?.amount).toBe(140_000);
    api.hierarchy.setAllGroupsExpanded(true);
    expect(api.rows.getCount()).toBe(140_001);
  });

  it("retains legacy expansion restored before local data arrives", () => {
    const api = grid([], true);
    api.state.apply({ ...api.state.get(), expandedGroupIds: ["/g0:A", "/g0:A/g1:B"] });
    api.rows.setData([{ id: "1", a: "A", b: "B" }]);
    expect(displayed(api).some((node) => node.id === "1")).toBe(true);
  });

  it("publishes a migrated state before reporting ambiguity to a reentrant host", () => {
    const rows = [{ id: "1", a: 1 }, { id: "2", a: "1" }];
    const observed: string[][] = [];
    const onError = vi.fn(() => {
      observed.push(api.state.get().expandedGroupIds);
      if (observed.length === 1) api.rows.setData(rows.map((row) => ({ ...row })));
    });
    const api = grid(rows, false, onError);
    api.state.apply({ ...api.state.get(), expandedGroupIds: ["/g0:1"] });
    expect(observed).toEqual([[]]);
    for (const node of displayed(api)) expect(node.leafNodes?.[0]).toBe(api.rows.getById(node.leafNodes![0].id));
  });

  it("maintains distinct stable typed paths against a seeded independent identity oracle", () => {
    const dimensions = [null, undefined, "(空)", 1, "1", false, "false", "A/g1:B", "C/g0:D", "__proto__", 'a"b\\c'];
    let seed = 0x2783b;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000);
    const rows = Array.from({ length: 160 }, (_, index) => ({ id: String(index), a: dimensions[Math.floor(random() * dimensions.length)], b: dimensions[Math.floor(random() * dimensions.length)] }));
    const key = (value: unknown) => value == null ? ["null"] : [typeof value, String(value)];
    const expected = new Set(rows.flatMap((row) => [JSON.stringify([key(row.a)]), JSON.stringify([key(row.a), key(row.b)])]));
    const api = grid(rows, true);
    api.hierarchy.setAllGroupsExpanded(true);
    const before = displayed(api).filter((node) => node.isGroup);
    expect(new Set(before.map((node) => node.id)).size).toBe(expected.size);
    const nodePaths = (nodes: RowNode<Row>[]) => new Map(nodes.filter((node) => node.isGroup).map((node) => [node.id, node.leafNodes?.map((leaf) => leaf.id).sort()]));
    api.rows.setData([...rows].reverse());
    expect(nodePaths(displayed(api))).toEqual(nodePaths(before));
  });

  it("matches a complete two-level display and aggregation-order oracle with hidden groups", () => {
    let seed = 0x614ca;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000);
    const rows = Array.from({ length: 120 }, (_, index) => ({ id: String(index), a: String(Math.floor(random() * 4)), b: String(Math.floor(random() * 3)), amount: Math.floor(random() * 50) }));
    const nodes: RowNode<Row>[] = rows.map((data, rowIndex) => ({ id: data.id, data, rowIndex, selected: false }));
    const columns = [{ id: "a" }, { id: "b" }];
    const calls: string[][] = [];
    const aggregate = (leaves: RowNode<Row>[]) => { calls.push(leaves.map((leaf) => leaf.id)); return { amount: leaves.reduce((total, leaf) => total + leaf.data!.amount!, 0) }; };
    const read = (node: RowNode<Row>, column: { id: string }) => node.data![column.id as "a" | "b"];
    const collapsed = buildRowGroups(nodes, columns, read, aggregate, new Set());
    const expectedCalls: string[][] = [];
    const expected: unknown[] = [];
    for (const a of [...new Set(rows.map((row) => row.a))].sort()) {
      const members = rows.filter((row) => row.a === a);
      const children = [...new Set(members.map((row) => row.b))].sort().map((b) => members.filter((row) => row.b === b));
      const leaves = children.flat();
      expected.push([0, a, leaves.map((row) => row.id), leaves.reduce((total, row) => total + row.amount, 0)]);
      for (const group of children) {
        expectedCalls.push(group.map((row) => row.id));
        expected.push([1, group[0].b, group.map((row) => row.id), group.reduce((total, row) => total + row.amount, 0)], ...group.map((row) => row.id));
      }
      expectedCalls.push(leaves.map((row) => row.id));
    }
    expect(calls).toEqual(expectedCalls);
    expect(collapsed.rows).toHaveLength(4);
    calls.length = 0;
    const expanded = buildRowGroups(nodes, columns, read, aggregate, new Set(collapsed.ids));
    expect(expanded.ids).toEqual(collapsed.ids);
    expect(expanded.rows.map((node) => node.isGroup ? [node.groupLevel, node.groupKey, node.leafNodes!.map((leaf) => leaf.id), node.aggValues!.amount] : node.id)).toEqual(expected);
    expect(calls).toEqual(expectedCalls);
  });
});
