import { createApp, defineComponent, effectScope, h, nextTick, shallowRef } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GridApi, GridBatchSaveResult, SaveChangesHandler } from "@agile-team/mach-table";
import { useMachTable, type UseMachTableReturn } from "../useMachTable";
import { useMachTableEditing, type UseMachTableEditingReturn } from "../useMachTableEditing";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function editingApi(save: Promise<GridBatchSaveResult>) {
  return {
    isDestroyed: () => false,
    on: vi.fn(() => vi.fn()),
    editing: {
      getDirtyRowIds: () => [],
      getChanges: () => [],
      save: vi.fn(() => save)
    }
  } as unknown as GridApi;
}

const emptyResult: GridBatchSaveResult = { submitted: [], saved: [], failures: [], conflicts: [] };
const saveHandler: SaveChangesHandler = async () => undefined;

afterEach(() => { vi.restoreAllMocks(); });

describe("Vue workflow instance ownership", () => {
  it("ignores readiness from replaced APIs and disposed scopes", async () => {
    const first = deferred<GridApi>();
    const second = deferred<GridApi>();
    const firstApi = { whenReady: () => first.promise, isDestroyed: () => false } as GridApi;
    const secondApi = { whenReady: () => second.promise, isDestroyed: () => false } as GridApi;
    const scope = effectScope();
    const table = scope.run(() => useMachTable())!;
    table.ref.value = { getApi: () => firstApi } as any;
    await nextTick();
    table.ref.value = { getApi: () => secondApi } as any;
    await nextTick();
    first.resolve(firstApi);
    await Promise.resolve();
    expect(table.api.value).toBe(secondApi);
    expect(table.ready.value).toBe(false);
    scope.stop();
    second.resolve(secondApi);
    await Promise.resolve();
    expect(table.api.value).toBeNull();
    expect(table.ready.value).toBe(false);
  });

  it.each(["resolve", "reject"] as const)("isolates a late save %s from a replacement table and its active save", async (outcome) => {
    const oldSave = deferred<GridBatchSaveResult>();
    const newSave = deferred<GridBatchSaveResult>();
    const oldApi = editingApi(oldSave.promise);
    const newApi = editingApi(newSave.promise);
    const table = { api: shallowRef(oldApi) } as UseMachTableReturn;
    const callbacks = { onSaveResult: vi.fn(), onSaveError: vi.fn() };
    const scope = effectScope();
    const editing = scope.run(() => useMachTableEditing(table, callbacks))!;
    const pendingOld = editing.saveDetailed(saveHandler);
    const oldOutcome = pendingOld.catch((error: unknown) => error);
    table.api.value = newApi;
    await nextTick();
    expect(editing.saving.value).toBe(false);
    const pendingNew = editing.saveDetailed(saveHandler);
    if (outcome === "resolve") oldSave.resolve({ ...emptyResult, failures: [{ rowId: "1", message: "old failure" }] });
    else oldSave.reject(new Error("old save failed"));
    const oldResult = await oldOutcome;
    if (outcome === "reject") expect(oldResult).toEqual(new Error("old save failed"));
    expect(editing.saving.value).toBe(true);
    expect(editing.lastSaveResult.value).toBeNull();
    expect(editing.saveError.value).toBeNull();
    expect(callbacks.onSaveResult).not.toHaveBeenCalled();
    expect(callbacks.onSaveError).not.toHaveBeenCalled();
    newSave.resolve(emptyResult);
    await pendingNew;
    expect(editing.saving.value).toBe(false);
    expect(callbacks.onSaveResult).toHaveBeenCalledExactlyOnceWith(emptyResult);
    scope.stop();
  });

  it("clears completed conflict state before it can be applied to a new API", async () => {
    const result = { ...emptyResult, conflicts: [{ rowId: "1", message: "Conflict", serverData: { id: "1" } }] };
    const table = { api: shallowRef(editingApi(Promise.resolve(result))) } as UseMachTableReturn;
    const scope = effectScope();
    const editing = scope.run(() => useMachTableEditing(table))!;
    await editing.saveDetailed(saveHandler);
    expect(editing.failedRowIds.value).toEqual(["1"]);
    table.api.value = editingApi(Promise.resolve(emptyResult));
    expect(editing.resolveConflict("1", "keepLocal")).toBe(false);
    expect(editing.failedRowIds.value).toEqual([]);
    scope.stop();
  });

  it.each(["resolve", "reject"] as const)("discards an old save %s after rows are reloaded through the same API", async (outcome) => {
    const pending = deferred<GridBatchSaveResult>();
    const api = editingApi(pending.promise);
    const getById = vi.fn().mockReturnValue({ id: "1", data: { id: "1", value: "old" } });
    Object.assign(api, { rows: { getById } });
    api.editing.getDirtyRowIds = () => ["1"];
    const table = { api: shallowRef(api) } as UseMachTableReturn;
    const callbacks = { onSaveResult: vi.fn(), onSaveError: vi.fn() };
    const scope = effectScope();
    const editing = scope.run(() => useMachTableEditing(table, callbacks))!;
    const saving = editing.saveDetailed(saveHandler).catch((error: unknown) => error);
    getById.mockReturnValue({ id: "1", data: { id: "1", value: "replacement" } });
    if (outcome === "resolve") pending.resolve({ ...emptyResult, conflicts: [{ rowId: "1", message: "Old conflict" }] });
    else pending.reject(new Error("Old failure"));
    await saving;
    expect(editing.saving.value).toBe(false);
    expect(editing.lastSaveResult.value).toBeNull();
    expect(editing.saveError.value).toBeNull();
    expect(callbacks.onSaveResult).not.toHaveBeenCalled();
    expect(callbacks.onSaveError).not.toHaveBeenCalled();
    scope.stop();
  });

  it("rejects a completed conflict when its row is subsequently replaced in the same API", async () => {
    const result = { ...emptyResult, conflicts: [{ rowId: "1", message: "Conflict" }] };
    const api = editingApi(Promise.resolve(result));
    const getById = vi.fn().mockReturnValue({ id: "1", data: { id: "1" } });
    Object.assign(api, { rows: { getById } });
    api.editing.getDirtyRowIds = () => ["1"];
    const scope = effectScope();
    const editing = scope.run(() => useMachTableEditing({ api: shallowRef(api) } as UseMachTableReturn))!;
    await editing.saveDetailed(saveHandler);
    getById.mockReturnValue({ id: "1", data: { id: "1" } });
    expect(editing.resolveConflict("1", "keepLocal")).toBe(false);
    scope.stop();
  });

  it.each(["accept", "replace"] as const)("keeps other conflicts actionable after one row is %s", async (action) => {
    const conflicts = ["1", "2"].map((id) => ({ rowId: id, message: "Conflict", serverData: { id, value: "server" } }));
    const nodes = new Map(["1", "2"].map((id) => [id, { id, data: { id, value: "local" } }]));
    const api = editingApi(Promise.resolve({ ...emptyResult, conflicts }));
    Object.assign(api, {
      getOption: () => "id",
      rows: {
        getById: (id: string) => nodes.get(id),
        transact: ({ update }: { update: Array<{ id: string; value: string }> }) => {
          for (const data of update) nodes.get(data.id)!.data = data;
        }
      }
    });
    api.editing.getDirtyRowIds = () => ["1", "2"];
    api.editing.rollback = vi.fn();
    api.editing.markSaved = vi.fn();
    const scope = effectScope();
    const editing = scope.run(() => useMachTableEditing({ api: shallowRef(api) } as UseMachTableReturn))!;
    await editing.saveDetailed(saveHandler);
    if (action === "accept") expect(editing.resolveConflict("1", "acceptServer")).toBe(true);
    else {
      nodes.set("1", { id: "1", data: { id: "1", value: "replacement" } });
      expect(editing.resolveConflict("1", "acceptServer")).toBe(false);
    }
    expect(editing.resolveConflict("2", "acceptServer")).toBe(true);
    expect(nodes.get("2")!.data.value).toBe("server");
    expect(editing.failedRowIds.value).toEqual(action === "accept" ? [] : ["1"]);
    scope.stop();
  });

  it.each(["resolve", "reject"] as const)("ignores a late save %s after component disposal", async (outcome) => {
    const pending = deferred<GridBatchSaveResult>();
    const api = editingApi(pending.promise);
    const table = { api: shallowRef(api) } as UseMachTableReturn;
    const onSaveResult = vi.fn();
    const onSaveError = vi.fn();
    let editing!: UseMachTableEditingReturn;
    const app = createApp(defineComponent({
      setup() { editing = useMachTableEditing(table, { onSaveResult, onSaveError }); return () => h("div"); }
    }));
    app.mount(document.createElement("div"));
    const saving = editing.saveDetailed(saveHandler);
    const saveOutcome = saving.catch((error: unknown) => error);
    app.unmount();
    if (outcome === "resolve") pending.resolve(emptyResult);
    else pending.reject(new Error("Save failed after disposal"));
    await saveOutcome;
    expect(editing.lastSaveResult.value).toBeNull();
    expect(onSaveResult).not.toHaveBeenCalled();
    expect(onSaveError).not.toHaveBeenCalled();
  });
});
