import { describe, expect, it, vi } from "vitest";
import { createRowOrderController, type RowOrderSaveContext, type RowOrderSaveResult } from "../ordering/controller";
import { reorderRows } from "../ordering/moveRows";
import type { RowOrderIntent } from "../ordering/types";

interface Row { id: string; children?: Row[] }
const intent: RowOrderIntent = { rowIds: ["1", "3"], targetId: "4", position: "after" };
const ids = (rows: readonly Row[]) => rows.map(row => row.id);
function fixture(save?: (intent: RowOrderIntent, context: RowOrderSaveContext<Row>) => Promise<void | RowOrderSaveResult>, treeData = false) {
  let rows: readonly Row[] = treeData ? [{ id: "a", children: [{ id: "1" }, { id: "2" }] }, { id: "b", children: [{ id: "3" }] }, { id: "4" }] : ["1", "2", "3", "4"].map(id => ({ id }));
  const controller = createRowOrderController({ rowKey: "id", getRows: () => rows, applyRows: next => { rows = next; }, save, treeData });
  return { controller, rows: () => rows, replace: (next: readonly Row[]) => { rows = next; } };
}

describe("atomic persisted ordering history", () => {
  it("undoes and redoes non-contiguous rows through one CAS batch per operation", async () => {
    let server = ["1", "2", "3", "4"].map(id => ({ id })), revision = 1;
    const save = vi.fn(async (_: RowOrderIntent, context: RowOrderSaveContext<Row>) => {
      for (const operation of context.operations) expect(operation.expectedRevision).toBe(revision);
      // A host can atomically persist plan.after; operations also replay against stable IDs.
      server = context.operations.reduce((rows, operation) => [...reorderRows(rows, operation, { rowKey: "id" }).after], server);
      expect(server).toEqual(context.plan.after);
      return { revision: ++revision };
    });
    const { controller, rows } = fixture(save);
    expect(controller.state).toMatchObject({ canUndo: false, canRedo: false });
    await controller.move({ ...intent, expectedRevision: 1 });
    expect(controller.state).toMatchObject({ canUndo: true, canRedo: false });
    await controller.undo();
    expect(ids(rows())).toEqual(["1", "2", "3", "4"]);
    expect(controller.state).toMatchObject({ canUndo: false, canRedo: true, revision: 3 });
    await controller.redo();
    expect(ids(rows())).toEqual(["2", "4", "1", "3"]);
    expect(save.mock.calls.map(call => call[1].operation)).toEqual(["move", "undo", "redo"]);
    expect(save.mock.calls[1][1].operations).toHaveLength(2);
    expect(controller.state).toMatchObject({ canUndo: true, canRedo: false, revision: 4 });
  });

  it("restores multi-source tree rows to separate original parents", async () => {
    const { controller, rows } = fixture(undefined, true);
    const before = rows();
    await controller.move({ rowIds: ["1", "3"], targetId: "4", position: "inside" });
    await controller.undo();
    expect(rows()).toBe(before);
    await controller.redo();
    expect(rows()[2].children?.map(row => row.id)).toEqual(["1", "3"]);
  });

  it.each(["failure", "conflict"] as const)("keeps its cursor when undo persistence returns %s", async kind => {
    let fail = false;
    const { controller, rows } = fixture(async () => {
      if (!fail) return;
      if (kind === "conflict") return { status: "conflict", revision: "new" };
      throw new Error("Network failed");
    });
    await controller.move(intent);
    const moved = rows();
    fail = true;
    await expect(controller.undo()).rejects.toThrow();
    expect(rows()).toBe(moved);
    expect(controller.state).toMatchObject({ canUndo: true, canRedo: false, status: kind === "conflict" ? "conflict" : "error" });
    fail = false;
    await controller.undo();
    expect(controller.state).toMatchObject({ canUndo: false, canRedo: true });
  });

  it("invalidates both directions after an external immutable model replacement", async () => {
    const { controller, rows, replace } = fixture();
    await controller.move(intent);
    replace([...rows()]);
    expect(controller.state.canUndo).toBe(true); // Equivalent immutable wrapper preserves the actual model.
    replace(rows().map(row => ({ ...row })));
    expect(controller.state).toMatchObject({ canUndo: false, canRedo: false });
    await expect(controller.undo()).rejects.toThrow(/Nothing/);
  });

  it("drops redo entries after a new successful move and limits history to fifty", async () => {
    const { controller } = fixture();
    await controller.move(intent);
    await controller.undo();
    await controller.move({ rowIds: ["2"], targetId: "4", position: "after" });
    expect(controller.state.canRedo).toBe(false);
    for (let index = 0; index < 55; index++) await controller.move({ rowIds: ["1"], targetId: "3", position: index % 2 ? "before" : "after" });
    let count = 0;
    while (controller.state.canUndo) { await controller.undo(); count++; }
    expect(count).toBe(50);
  });

  it("does not move a history cursor or replace external rows when a pending undo completes late", async () => {
    let release!: () => void, hold = false;
    const { controller, replace, rows } = fixture(async () => { if (hold) await new Promise<void>(resolve => { release = resolve; }); });
    await controller.move(intent);
    hold = true;
    const undoing = controller.undo();
    replace([{ id: "external" }]);
    release();
    await undoing;
    expect(rows()).toEqual([{ id: "external" }]);
    expect(controller.state).toMatchObject({ canUndo: false, canRedo: false, status: "idle" });
  });

  it("aborts a pending undo and clears history on disposal", async () => {
    let release!: () => void, signal: AbortSignal | undefined;
    const { controller } = fixture(async (_, context) => { if (context.operation === "undo") { signal = context.signal; await new Promise<void>(resolve => { release = resolve; }); } });
    await controller.move(intent);
    const undoing = controller.undo();
    const cancelled = expect(undoing).rejects.toMatchObject({ name: "AbortError" });
    controller.dispose();
    expect(signal?.aborted).toBe(true);
    await cancelled;
    release();
    expect(controller.state).toMatchObject({ canUndo: false, canRedo: false });
  });

  it("supports a host that updates its revision synchronously from saved state", async () => {
    let rows: readonly Row[] = ["1", "2", "3", "4"].map(id => ({ id }));
    let revision = 1;
    const controller = createRowOrderController({ rowKey: "id", getRows: () => rows, applyRows: next => { rows = next; }, getRevision: () => revision,
      save: async () => ({ revision: revision + 1 }), onStateChange: state => { if (state.status === "saved") revision = Number(state.revision); } });
    await controller.move(intent);
    expect(controller.state.canUndo).toBe(true);
    await controller.undo();
    expect(revision).toBe(3);
    expect(controller.state).toMatchObject({ canUndo: false, canRedo: true });
    revision = 99;
    expect(controller.state).toMatchObject({ canUndo: false, canRedo: false });
  });

  it("rechecks parent constraints before undo without changing its history cursor", async () => {
    let rows: readonly Row[] = [{ id: "a", children: [{ id: "1" }] }, { id: "b" }], allowed = true;
    const save = vi.fn(async () => undefined);
    const controller = createRowOrderController({ rowKey: "id", treeData: true, getRows: () => rows, applyRows: next => { rows = next; }, save, canMove: () => allowed || "Parent is locked" });
    await controller.move({ rowIds: ["1"], targetId: "b", position: "inside" });
    const moved = rows;
    allowed = false;
    await expect(controller.undo()).rejects.toThrow("Parent is locked");
    expect(rows).toBe(moved);
    expect(controller.state.canUndo).toBe(true);
    expect(save).toHaveBeenCalledOnce();
  });
});
