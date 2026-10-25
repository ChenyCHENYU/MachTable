import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GridApi, GridBatchSaveResult, SaveChangesHandler } from "@agile-team/mach-table";
import { MachTable } from "../MachTable";
import { useMachTableController, type UseMachTableControllerReturn } from "../useMachTableController";
import { useMachTableEditing, type UseMachTableEditingReturn } from "../useMachTableEditing";
import { useMachTableQuery, type UseMachTableQueryReturn } from "../useMachTableQuery";
import type { UseMachTableReturn } from "../useMachTable";

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
    editing: { getDirtyRowIds: () => [], getChanges: () => [], save: vi.fn(() => save) }
  } as unknown as GridApi;
}

const emptyResult: GridBatchSaveResult = { submitted: [], saved: [], failures: [], conflicts: [] };
const saveHandler: SaveChangesHandler = async () => undefined;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => { document.body.textContent = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("React workflow instance ownership", () => {
  it.each(["resolve", "reject"] as const)("isolates a late save %s from a replacement table and its active save", async (outcome) => {
    const oldSave = deferred<GridBatchSaveResult>();
    const newSave = deferred<GridBatchSaveResult>();
    const oldApi = editingApi(oldSave.promise);
    const newApi = editingApi(newSave.promise);
    const table = { apiRef: { current: oldApi }, api: oldApi, ready: true } as UseMachTableReturn;
    const callbacks = { onSaveResult: vi.fn(), onSaveError: vi.fn() };
    let editing!: UseMachTableEditingReturn;
    function Harness() { editing = useMachTableEditing(table, callbacks); return null; }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Harness)));
    let pendingOld!: Promise<GridBatchSaveResult>;
    await act(async () => { pendingOld = editing.saveDetailed(saveHandler); });
    const oldOutcome = pendingOld.catch((error: unknown) => error);
    table.apiRef.current = table.api = newApi;
    await act(async () => root.render(createElement(Harness)));
    expect(editing.saving).toBe(false);
    let pendingNew!: Promise<GridBatchSaveResult>;
    await act(async () => { pendingNew = editing.saveDetailed(saveHandler); });
    await act(async () => {
      if (outcome === "resolve") oldSave.resolve({ ...emptyResult, failures: [{ rowId: "1", message: "old failure" }] });
      else oldSave.reject(new Error("old save failed"));
      const oldResult = await oldOutcome;
      if (outcome === "reject") expect(oldResult).toEqual(new Error("old save failed"));
    });
    expect(editing.saving).toBe(true);
    expect(editing.lastSaveResult).toBeNull();
    expect(editing.saveError).toBeNull();
    expect(callbacks.onSaveResult).not.toHaveBeenCalled();
    expect(callbacks.onSaveError).not.toHaveBeenCalled();
    await act(async () => { newSave.resolve(emptyResult); await pendingNew; });
    expect(editing.saving).toBe(false);
    expect(callbacks.onSaveResult).toHaveBeenCalledExactlyOnceWith(emptyResult);
    await act(async () => root.unmount());
  });

  it("does not resolve an old conflict against a replacement API before effects flush", async () => {
    const result = { ...emptyResult, conflicts: [{ rowId: "1", message: "Conflict", serverData: { id: "1" } }] };
    const api = editingApi(Promise.resolve(result));
    const table = { apiRef: { current: api }, api, ready: true } as UseMachTableReturn;
    let editing!: UseMachTableEditingReturn;
    function Harness() { editing = useMachTableEditing(table); return null; }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Harness)));
    await act(async () => { await editing.saveDetailed(saveHandler); });
    expect(editing.failedRowIds).toEqual(["1"]);
    table.apiRef.current = table.api = editingApi(Promise.resolve(emptyResult));
    expect(editing.resolveConflict("1", "keepLocal")).toBe(false);
    await act(async () => root.render(createElement(Harness)));
    expect(editing.failedRowIds).toEqual([]);
    await act(async () => root.unmount());
  });

  it.each(["resolve", "reject"] as const)("discards an old save %s after rows are reloaded through the same API", async (outcome) => {
    const pending = deferred<GridBatchSaveResult>();
    const api = editingApi(pending.promise);
    const getById = vi.fn().mockReturnValue({ id: "1", data: { id: "1", value: "old" } });
    Object.assign(api, { rows: { getById } });
    api.editing.getDirtyRowIds = () => ["1"];
    const table = { apiRef: { current: api }, api, ready: true } as UseMachTableReturn;
    const callbacks = { onSaveResult: vi.fn(), onSaveError: vi.fn() };
    let editing!: UseMachTableEditingReturn;
    function Harness() { editing = useMachTableEditing(table, callbacks); return null; }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Harness)));
    let saving!: Promise<unknown>;
    await act(async () => { saving = editing.saveDetailed(saveHandler).catch((error: unknown) => error); });
    getById.mockReturnValue({ id: "1", data: { id: "1", value: "replacement" } });
    await act(async () => {
      if (outcome === "resolve") pending.resolve({ ...emptyResult, conflicts: [{ rowId: "1", message: "Old conflict" }] });
      else pending.reject(new Error("Old failure"));
      await saving;
    });
    expect(editing.saving).toBe(false);
    expect(editing.lastSaveResult).toBeNull();
    expect(editing.saveError).toBeNull();
    expect(callbacks.onSaveResult).not.toHaveBeenCalled();
    expect(callbacks.onSaveError).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("rejects a completed conflict when its row is subsequently replaced in the same API", async () => {
    const result = { ...emptyResult, conflicts: [{ rowId: "1", message: "Conflict" }] };
    const api = editingApi(Promise.resolve(result));
    const getById = vi.fn().mockReturnValue({ id: "1", data: { id: "1" } });
    Object.assign(api, { rows: { getById } });
    api.editing.getDirtyRowIds = () => ["1"];
    const table = { apiRef: { current: api }, api, ready: true } as UseMachTableReturn;
    let editing!: UseMachTableEditingReturn;
    function Harness() { editing = useMachTableEditing(table); return null; }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Harness)));
    await act(async () => { await editing.saveDetailed(saveHandler); });
    getById.mockReturnValue({ id: "1", data: { id: "1" } });
    expect(editing.resolveConflict("1", "keepLocal")).toBe(false);
    await act(async () => root.unmount());
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
    const table = { apiRef: { current: api }, api, ready: true } as UseMachTableReturn;
    let editing!: UseMachTableEditingReturn;
    function Harness() { editing = useMachTableEditing(table); return null; }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Harness)));
    await act(async () => { await editing.saveDetailed(saveHandler); });
    await act(async () => {
      if (action === "accept") expect(editing.resolveConflict("1", "acceptServer")).toBe(true);
      else {
        nodes.set("1", { id: "1", data: { id: "1", value: "replacement" } });
        expect(editing.resolveConflict("1", "acceptServer")).toBe(false);
      }
      expect(editing.resolveConflict("2", "acceptServer")).toBe(true);
    });
    expect(nodes.get("2")!.data.value).toBe("server");
    expect(editing.failedRowIds).toEqual(action === "accept" ? [] : ["1"]);
    await act(async () => root.unmount());
  });

  it.each(["resolve", "reject"] as const)("ignores a late save %s after disposal", async (outcome) => {
    const pending = deferred<GridBatchSaveResult>();
    const api = editingApi(pending.promise);
    const table = { apiRef: { current: api }, api, ready: true } as UseMachTableReturn;
    const onSaveResult = vi.fn();
    const onSaveError = vi.fn();
    let editing!: UseMachTableEditingReturn;
    function Harness() { editing = useMachTableEditing(table, { onSaveResult, onSaveError }); return null; }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Harness)));
    let saving!: Promise<GridBatchSaveResult>;
    await act(async () => { saving = editing.saveDetailed(saveHandler); });
    const saveOutcome = saving.catch((error: unknown) => error);
    await act(async () => root.unmount());
    await act(async () => {
      if (outcome === "resolve") pending.resolve(emptyResult);
      else pending.reject(new Error("Save failed after disposal"));
      await saveOutcome;
    });
    expect(onSaveResult).not.toHaveBeenCalled();
    expect(onSaveError).not.toHaveBeenCalled();
  });

  it("clears local selection and restores search when a StrictMode table is replaced", async () => {
    let controller!: UseMachTableControllerReturn<{ id: string; name: string }>;
    function Harness({ scenario }: { scenario: number | null }) {
      controller = useMachTableController({ initialSearch: "Ada" });
      return scenario === null ? null : createElement(MachTable<{ id: string; name: string }>, {
        key: scenario, apiRef: controller.table.apiRef,
        columnDefs: [{ field: "name" }], rowData: [{ id: "1", name: "Ada" }],
        rowKey: "id", rowSelection: "multiple", pagination: false
      });
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const render = (scenario: number | null) => root.render(createElement(StrictMode, null, createElement(Harness, { scenario })));
    await act(async () => render(0));
    const firstApi = controller.table.api!;
    expect(firstApi.getOption("quickFilterText")).toBe("Ada");
    await act(async () => firstApi.selection.selectAll());
    expect(controller.selectedCount).toBe(1);
    await act(async () => render(null));
    expect(firstApi.isDestroyed()).toBe(true);
    expect(controller.table.api).toBeNull();
    expect(controller.selectedCount).toBe(0);
    await act(async () => render(1));
    expect(controller.table.api).not.toBe(firstApi);
    expect(controller.table.api?.getOption("quickFilterText")).toBe("Ada");
    expect(controller.table.ready).toBe(true);
    await act(async () => root.unmount());
  });

  it("keeps immediate false under StrictMode and avoids requests for unchanged search", async () => {
    const response = deferred<{ rows: { id: string }[]; total: number }>();
    const request = vi.fn(() => response.promise);
    let query!: UseMachTableQueryReturn<{ id: string }>;
    function Harness() {
      query = useMachTableQuery({ query: {}, queryKey: "stable", rowKey: "id", request, immediate: false });
      useMachTableController({ query });
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(StrictMode, null, createElement(Harness))));
    expect(request).not.toHaveBeenCalled();
    await act(async () => {
      const pending = query.reload();
      response.resolve({ rows: [{ id: "1" }], total: 1 });
      await pending;
    });
    expect(request).toHaveBeenCalledOnce();
    await act(async () => query.setQuickFilterText(null));
    expect(request).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });
});
