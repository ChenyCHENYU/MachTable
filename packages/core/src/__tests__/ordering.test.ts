import { describe, expect, it, vi } from "vitest";
import { inverseRowOrderOperations, moveTreeNodes, reorderRows } from "../ordering/moveRows";
import type { RowOrderOptions } from "../ordering/types";

interface Row { id: string; children?: Row[]; label?: string }
const options: RowOrderOptions<Row> = { rowKey: "id" };
const ids = (rows: readonly Row[]) => rows.map((row) => row.id);
const intent = { rowIds: ["1"], targetId: "2", position: "before" as const };

function tree(): Row[] {
  return [{ id: "a", children: [{ id: "a1" }, { id: "a2" }] },
    { id: "b", children: [{ id: "b1" }, { id: "b2" }] }, { id: "c" }];
}

describe("stable-ID row ordering", () => {
  it("moves multiple rows in source order with an immutable undo plan", () => {
    const before = [{ id: "1" }, { id: "2" }, { id: "3" }, { id: "4" }];
    const plan = reorderRows(before, { rowIds: ["3", "1", "3"], targetId: "4", position: "after", expectedRevision: "r1" }, options);
    expect(ids(plan.after)).toEqual(["2", "4", "1", "3"]);
    expect(ids(before)).toEqual(["1", "2", "3", "4"]);
    expect(plan.before).toBe(before);
    expect(plan.rowIds).toEqual(["1", "3"]);
    expect(plan.intent).toMatchObject({ rowIds: ["1", "3"], beforeId: "4", afterId: null });
    expect(plan.after[0]).toBe(before[1]);
    expect(plan.intent.expectedRevision).toBe("r1");
    expect(plan.changed).toBe(true);
  });

  it("returns the original list for an unchanged destination", () => {
    const rows = [{ id: "1" }, { id: "2" }, { id: "3" }];
    const plan = reorderRows(rows, { rowIds: ["1", "2"], targetId: "3", position: "before" }, options);
    expect(plan.after).toBe(rows);
    expect(plan.changed).toBe(false);
  });

  it("indexes keys once for a large multi-row move", () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => ({ id: String(index) }));
    const rowKey = vi.fn((row: Row) => row.id);
    const plan = reorderRows(rows, { rowIds: rows.slice(0, 5_000).map((row) => row.id), targetId: "9999", position: "after" }, { rowKey });
    expect(rowKey).toHaveBeenCalledTimes(rows.length);
    expect(plan.after[0]).toBe(rows[5_000]);
    expect(plan.after[plan.after.length - 1]).toBe(rows[4_999]);
  });

  it.each([
    { rowIds: [], targetId: "1", position: "before" },
    { rowIds: ["missing"], targetId: "1", position: "before" },
    { rowIds: ["1"], targetId: "missing", position: "before" },
    { rowIds: ["1"], targetId: "2", position: "inside" },
    { rowIds: ["1"], targetId: "1", position: "after" }
  ] as const)("rejects invalid flat intent %# without changing input", (invalid) => {
    const rows = [{ id: "1" }, { id: "2" }];
    expect(() => reorderRows(rows, invalid, options)).toThrow();
    expect(ids(rows)).toEqual(["1", "2"]);
  });

  it("rejects duplicate and empty business IDs", () => {
    expect(() => reorderRows([{ id: "1" }, { id: "1" }], intent, options)).toThrow(/duplicate/);
    expect(() => reorderRows([{ id: "" }, { id: "2" }], intent, options)).toThrow(/non-empty/);
  });

  it("moves children between parents while sharing untouched branches", () => {
    const rows = tree();
    const plan = moveTreeNodes(rows, { rowIds: ["a2", "a1"], targetId: "b", position: "inside" }, options);
    expect(plan.after[0].children).toEqual([]);
    expect(ids(plan.after[1].children!)).toEqual(["b1", "b2", "a1", "a2"]);
    expect(plan.after[1].children![2]).toBe(rows[0].children![0]);
    expect(plan.after[2]).toBe(rows[2]);
    expect(ids(rows[0].children!)).toEqual(["a1", "a2"]);
    expect(ids(rows[1].children!)).toEqual(["b1", "b2"]);
  });

  it("moves a selected parent and descendant exactly once", () => {
    const rows = tree();
    const plan = moveTreeNodes(rows, { rowIds: ["a1", "a"], targetId: "c", position: "after" }, options);
    expect(ids(plan.after)).toEqual(["b", "c", "a"]);
    expect(plan.rowIds).toEqual(["a"]);
    expect(plan.intent.rowIds).toEqual(["a"]);
    expect(plan.after[2]).toBe(rows[0]);
  });

  it.each(["before", "after", "inside"] as const)("rejects a destination %s a selected subtree", (position) => {
    const rows = tree();
    expect(() => moveTreeNodes(rows, { rowIds: ["a"], targetId: "a1", position }, options)).toThrow(/subtree/);
    expect(ids(rows)).toEqual(["a", "b", "c"]);
  });

  it("validates the new parent before constructing changed branches", () => {
    const rows = tree();
    const canMove = vi.fn(() => "This parent is locked");
    expect(() => moveTreeNodes(rows, { rowIds: ["a1"], targetId: "b1", position: "before" }, { ...options, canMove })).toThrow("This parent is locked");
    expect(canMove).toHaveBeenCalledWith(expect.objectContaining({ row: rows[0].children![0], previousParent: rows[0], parent: rows[1], target: rows[1].children![0] }));
    expect(ids(rows[0].children!)).toEqual(["a1", "a2"]);
  });

  it("rejects cyclic input without recursive traversal or mutation", () => {
    const row: Row = { id: "a" };
    row.children = [row];
    expect(() => moveTreeNodes([row], { rowIds: ["a"], targetId: "a", position: "inside" }, options)).toThrow(/cyclic/);
    expect(row.children[0]).toBe(row);
  });

  it("supports a custom child property and a leaf destination", () => {
    const rows = [{ id: "a", nodes: [{ id: "a1" }] }, { id: "b" }];
    const plan = moveTreeNodes(rows, { rowIds: ["a1"], targetId: "b", position: "inside" }, { rowKey: "id", childrenKey: "nodes" });
    expect(plan.after[1].nodes).toEqual([{ id: "a1" }]);
    expect(rows[1]).not.toHaveProperty("nodes");
  });

  it("replays inverse operations for non-contiguous flat rows in their exact original positions", () => {
    const before = ["1", "2", "3", "4", "5"].map(id => ({ id }));
    const plan = reorderRows(before, { rowIds: ["1", "3"], targetId: "5", position: "after" }, options);
    const restored = inverseRowOrderOperations(plan, options, false).reduce((rows, operation) => reorderRows(rows, operation, options).after, plan.after);
    expect(ids(restored)).toEqual(ids(before));
  });

  it("replays inverse operations across parents including restoring an emptied parent", () => {
    const before = tree();
    const plan = moveTreeNodes(before, { rowIds: ["a1", "a2", "b1"], targetId: "c", position: "inside" }, options);
    const restored = inverseRowOrderOperations(plan, options, true).reduce((rows, operation) => moveTreeNodes(rows, operation, options).after, plan.after);
    expect(restored.slice(0, 2)).toEqual(before.slice(0, 2));
    expect(restored[2].id).toBe("c");
    expect(restored[2].children).toEqual([]);
    expect(ids(plan.after[0].children!)).toEqual([]);
  });
});
