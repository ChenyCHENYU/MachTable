import { describe, expect, it, vi } from "vitest";
import { createRowOrderController, RowOrderConflictError, type RowOrderControllerOptions, type RowOrderSaveResult } from "../ordering/controller";
import type { RowOrderIntent } from "../ordering/types";
import { attachAdapterLifecycle } from "../lib/adapterLifecycle";

interface Row { id: string; children?: Row[] }
const intent: RowOrderIntent = { rowIds: ["1"], targetId: "3", position: "after" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness(overrides: Partial<RowOrderControllerOptions<Row>> = {}) {
  let rows: readonly Row[] = [{ id: "1" }, { id: "2" }, { id: "3" }];
  const applyRows = vi.fn((next: readonly Row[]) => { rows = next; });
  const controller = createRowOrderController({ rowKey: "id", getRows: () => rows, applyRows, ...overrides });
  return { controller, applyRows, getRows: () => rows, replace: (next: readonly Row[]) => { rows = next; } };
}

function mockApi(dirty: string[] = []): any {
  const api = { isDestroyed: () => false, getOption: () => undefined, on: () => () => {}, rows: { forEach() {} }, view: { refreshCells: vi.fn() }, editing: { getDirtyRowIds: () => dirty } };
  attachAdapterLifecycle(api as any, { suspend() {}, resume() {}, readCell: () => "", writeInput() {}, canReplaceData: () => dirty.length === 0 });
  return api;
}

function dragEvent(input = intent, applied = false): any {
  return { applied, api: mockApi(), intent: { ...input, beforeId: "3", afterId: null } };
}

function dropContext(input = intent): any {
  return { intent: input, api: mockApi() };
}

async function flush(): Promise<void> { for (let index = 0; index < 6; index++) await Promise.resolve(); }

describe("row order persistence controller", () => {
  it("installs local order once and exposes the previous model for explicit undo", async () => {
    const { controller, getRows, applyRows } = harness();
    const before = getRows();
    const plan = await controller.move(intent);
    expect(getRows().map((row) => row.id)).toEqual(["2", "3", "1"]);
    expect(plan.before).toBe(before);
    expect(controller.state.status).toBe("saved");
    expect(applyRows).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("preserves a no-op without saving or notifying listeners", async () => {
    const save = vi.fn();
    const { controller, applyRows } = harness({ save });
    const listener = vi.fn();
    controller.subscribe(listener);
    const plan = await controller.move({ ...intent, targetId: "2", position: "before" });
    expect(plan.changed).toBe(false);
    expect(applyRows).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it("sends stable IDs, neighbours and revision while locking overlapping moves", async () => {
    const pending = deferred<RowOrderSaveResult>();
    const save = vi.fn(() => pending.promise);
    const { controller } = harness({ save, getRevision: () => "r1" });
    const request = controller.move({ ...intent, beforeId: "3", afterId: null });
    expect(controller.state.status).toBe("saving");
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ rowIds: ["1"], beforeId: "3", afterId: null, expectedRevision: "r1" }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    await expect(controller.move(intent)).rejects.toThrow(/in progress/);
    expect(controller.state.status).toBe("saving");
    pending.resolve({ revision: "r2" });
    await request;
    expect(controller.state.revision).toBe("r2");
  });

  it("can submit an explicitly known revision without inventing a local revision", async () => {
    const { controller } = harness({ save: async () => ({ revision: "r2" }) });
    await controller.move({ ...intent, expectedRevision: "r1" });
    expect(controller.state.revision).toBe("r2");
    expect(controller.state.status).toBe("saved");
  });

  it.each(["failure", "conflict"] as const)("rolls back an owned optimistic order on %s", async (kind) => {
    const save = vi.fn(async () => {
      if (kind === "conflict") return { status: "conflict" as const, revision: "r2", message: "Server revision changed" };
      throw new Error("Network unavailable");
    });
    const { controller, getRows, applyRows } = harness({ save, getRevision: () => "r1" });
    const before = getRows();
    await expect(controller.move(intent)).rejects.toThrow(kind === "conflict" ? "Server revision changed" : "Network unavailable");
    expect(getRows()).toBe(before);
    expect(applyRows).toHaveBeenCalledTimes(2);
    expect(controller.state.status).toBe(kind === "conflict" ? "conflict" : "error");
    if (kind === "conflict") expect((controller.state.error as RowOrderConflictError).serverRevision).toBe("r2");
  });

  it.each(["resolve", "reject"] as const)("does not overwrite external rows or publish stale drag errors after a late %s", async (outcome) => {
    const pending = deferred<RowOrderSaveResult>();
    const { controller, getRows, replace } = harness({ save: () => pending.promise });
    controller.bindings.onRowDragEnd!(dragEvent());
    await flush();
    const external = [{ id: "new" }];
    replace(external);
    if (outcome === "resolve") pending.resolve({ revision: "new" });
    else pending.reject(new Error("Old failure"));
    await flush();
    expect(getRows()).toBe(external);
    expect(controller.state.status).toBe("idle");
    expect(controller.state.error).toBeNull();
  });

  it("does not roll back a newer externally supplied revision", async () => {
    let revision = "r1";
    const pending = deferred<RowOrderSaveResult>();
    const { controller, getRows } = harness({ getRevision: () => revision, save: () => pending.promise });
    const saving = controller.move(intent);
    const installed = getRows();
    revision = "r2";
    pending.reject(new Error("Old failure"));
    await expect(saving).rejects.toThrow("Old failure");
    expect(getRows()).toBe(installed);
    expect(controller.state.status).toBe("idle");
  });

  it("checks expected revisions before installing any model", async () => {
    const { controller, applyRows } = harness({ getRevision: () => "r2" });
    await expect(controller.move({ ...intent, expectedRevision: "r1" })).rejects.toBeInstanceOf(RowOrderConflictError);
    expect(applyRows).not.toHaveBeenCalled();
  });

  it("keeps the save error observable if the host cannot install a rollback", async () => {
    const failure = new Error("Network failed");
    let installs = 0;
    let rows: readonly Row[] = [{ id: "1" }, { id: "2" }, { id: "3" }];
    const { controller } = harness({ getRows: () => rows, applyRows: (next) => {
      if (++installs === 2) throw new Error("Model is locked");
      rows = next;
    }, save: async () => { throw failure; } });
    await expect(controller.move(intent)).rejects.toBe(failure);
    expect(controller.state).toMatchObject({ status: "error", error: { message: expect.stringContaining("or restored"), cause: failure, rollbackError: expect.any(Error) } });
  });

  it("does not submit persistence after a synchronous observer replaces its model", async () => {
    const save = vi.fn();
    let replace: (rows: readonly Row[]) => void = () => undefined;
    const fixture = harness({ save, onStateChange: (state) => { if (state.status === "saving") replace([{ id: "external" }]); } });
    replace = fixture.replace;
    await fixture.controller.move(intent);
    expect(save).not.toHaveBeenCalled();
    expect(fixture.getRows()).toEqual([{ id: "external" }]);
    expect(fixture.controller.state.status).toBe("idle");
  });

  it("locks a reentrant move while the host is installing optimistic rows", async () => {
    let reentrant: Promise<unknown> | undefined;
    let moveAgain = () => {};
    let rows: readonly Row[] = [{ id: "1" }, { id: "2" }, { id: "3" }];
    const fixture = harness({ getRows: () => rows, applyRows: (next) => { rows = next; moveAgain(); } });
    moveAgain = () => { reentrant = fixture.controller.move(intent).catch((error: unknown) => error); };
    await fixture.controller.move(intent);
    expect(await reentrant).toMatchObject({ message: expect.stringContaining("in progress") });
    expect(fixture.controller.state.status).toBe("saved");
    expect(rows.map((row) => row.id)).toEqual(["2", "3", "1"]);
  });

  it.each(["resolve", "reject"] as const)("cancels save ownership and observer delivery before a late transport %s", async outcome => {
    const pending = deferred<RowOrderSaveResult>();
    let signal!: AbortSignal;
    const observer = vi.fn();
    const { controller, getRows, applyRows } = harness({ save: (_, context) => { signal = context.signal; return pending.promise; }, onStateChange: observer });
    const listener = vi.fn();
    const remove = controller.subscribe(listener);
    const saving = controller.move(intent);
    const cancelled = expect(saving).rejects.toMatchObject({ name: "AbortError" });
    const installed = getRows();
    remove();
    const count = listener.mock.calls.length;
    const deliveries = observer.mock.calls.length;
    controller.dispose();
    expect(signal.aborted).toBe(true);
    await cancelled;
    if (outcome === "resolve") pending.resolve({ revision: "late" });
    else pending.reject(new Error("Late transport failure"));
    await flush();
    expect(listener).toHaveBeenCalledTimes(count);
    expect(observer).toHaveBeenCalledTimes(deliveries);
    expect(getRows()).toBe(installed);
    expect(applyRows).toHaveBeenCalledOnce();
    expect(controller.state).toMatchObject({ status: "idle", plan: null, error: null });
    expect(() => controller.preview(intent)).toThrow(/disposed/);
  });

  it("settles disposal promptly when persistence ignores abort and never resolves", async () => {
    const { controller, getRows, applyRows } = harness({ save: () => new Promise(() => {}) });
    let outcome: unknown = "pending";
    void controller.move(intent).then(value => { outcome = value; }, error => { outcome = error; });
    const installed = getRows();
    controller.dispose();
    await flush();
    expect(outcome).toMatchObject({ name: "AbortError" });
    expect(getRows()).toBe(installed);
    expect(applyRows).toHaveBeenCalledOnce();
    expect(controller.state).toMatchObject({ status: "idle", plan: null, canUndo: false, canRedo: false });
  });

  it("observes cancellation triggered synchronously by persistence before the waiter attaches", async () => {
    const pending = deferred<RowOrderSaveResult>();
    let dispose = () => {};
    const { controller } = harness({ save: () => { dispose(); return pending.promise; } });
    dispose = () => controller.dispose();
    await expect(controller.move(intent)).rejects.toMatchObject({ name: "AbortError" });
    pending.reject(new Error("Late transport failure"));
    await flush();
    expect(controller.state).toMatchObject({ status: "idle", plan: null, error: null });
  });

  it.each(["resolve", "reject"] as const)("cancels an old grid's waiter on rebinding before a late %s", async outcome => {
    const pending = deferred<RowOrderSaveResult>();
    const save = vi.fn().mockImplementationOnce(() => pending.promise).mockResolvedValue({ revision: "current" });
    const { controller, replace, getRows } = harness({ save });
    const canDrag = controller.bindings.rowDragPolicy!.canDrag!;
    canDrag({ api: mockApi(), node: {} as any });
    const saving = controller.move(intent).catch((error: unknown) => error);
    replace([{ id: "1" }, { id: "2" }, { id: "3" }]);
    const currentApi = mockApi();
    expect(canDrag({ api: currentApi, node: {} as any })).toBe(true);
    expect(controller.state).toMatchObject({ status: "idle", plan: null, error: null });
    const current = controller.move(intent);
    expect(await saving).toMatchObject({ name: "AbortError" });
    await current;
    const installed = getRows();
    if (outcome === "resolve") pending.resolve({ revision: "obsolete" });
    else pending.reject(new Error("Obsolete save failed"));
    await flush();
    expect(getRows()).toBe(installed);
    expect(controller.state).toMatchObject({ status: "saved", revision: "current", canUndo: true, error: null });
    controller.dispose();
  });

  it("reuses a read-only feedback index across target changes", () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => ({ id: String(index) }));
    const rowKey = vi.fn((row: Row) => row.id);
    const { controller } = harness({ rowKey, getRows: () => rows });
    for (let index = 1; index < 100; index++) expect(controller.bindings.rowDragPolicy!.canDrop!(dropContext({ rowIds: ["0"], targetId: String(index), position: "after" }))).toBe(true);
    expect(rowKey).toHaveBeenCalledTimes(rows.length);
    expect(controller.bindings.rowDragPolicy!.canDrop!(dropContext({ ...intent, position: "inside" }))).toMatch(/Flat rows/);
  });

  it("explains dirty editing and invalid tree parent targets without changing data", () => {
    const rows: Row[] = [{ id: "1", children: [{ id: "2" }] }, { id: "3" }];
    const { controller, applyRows } = harness({ treeData: true, getRows: () => rows });
    const dirty = mockApi(["1"]);
    expect(controller.bindings.rowDragPolicy!.canDrag!({ api: dirty, node: {} as any })).toMatch(/Save or discard/);
    expect(controller.bindings.rowDragPolicy!.canDrop!(dropContext({ rowIds: ["1"], targetId: "2", position: "inside" }))).toMatch(/subtree/);
    expect(applyRows).not.toHaveBeenCalled();
  });

  it("handles real drag intent through one binding and reports invalid targets without rejected event promises", async () => {
    const { controller, getRows } = harness();
    controller.bindings.onRowDragEnd!(dragEvent(intent, true));
    await flush();
    expect(getRows()[0].id).toBe("1");
    controller.bindings.onRowDragEnd!(dragEvent({ ...intent, targetId: "missing" }));
    await flush();
    expect(controller.state.status).toBe("error");
    controller.bindings.onRowDragEnd!(dragEvent());
    await flush();
    expect(getRows().map((row) => row.id)).toEqual(["2", "3", "1"]);
  });

  it("isolates observer failures from the save and later observers", async () => {
    const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { controller } = harness({ onStateChange: () => { throw new Error("Observer failure"); } });
    const listener = vi.fn();
    controller.subscribe(listener);
    await controller.move(intent);
    expect(controller.state.status).toBe("saved");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledTimes(2);
    report.mockRestore();
  });
});
