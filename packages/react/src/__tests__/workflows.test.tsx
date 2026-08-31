import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GridApi, GridChange, MachTableCommands, SaveChangesHandler } from "@agile-team/mach-table";
import { MachTable } from "../MachTable";
import { MachTableToolbar } from "../MachTableToolbar";
import { useMachTableController, type UseMachTableControllerReturn } from "../useMachTableController";
import { useMachTableEditing, type UseMachTableEditingReturn } from "../useMachTableEditing";
import { useMachTableQuery, type UseMachTableQueryReturn } from "../useMachTableQuery";
import type { UseMachTableReturn } from "../useMachTable";

class ResizeObserverStub {
  observe(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  document.body.textContent = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("React B-side workflows", () => {
  it("guards editing saves and exposes rollback, mark and reveal helpers", async () => {
    let resolveSave!: (changes: GridChange[]) => void;
    const changes: GridChange[] = [{
      rowId: "1",
      data: { name: "after" },
      cells: [{ colId: "name", originalValue: "before", value: "after" }]
    }];
    const saveHandler: SaveChangesHandler = vi.fn(async () => undefined);
    const removeListener = vi.fn();
    const onSaveSuccess = vi.fn();
    const onSaveError = vi.fn();
    const api = {
      isDestroyed: () => false,
      on: vi.fn(() => removeListener),
      editing: {
        getDirtyRowIds: vi.fn(() => ["1"]),
        getChanges: vi.fn(() => changes),
        save: vi.fn(() => new Promise((resolve) => {
          resolveSave = (saved) => resolve({ submitted: changes, saved, failures: [], conflicts: [] });
        })),
        rollback: vi.fn(() => true),
        markSaved: vi.fn(),
        startCell: vi.fn(() => true)
      },
      rows: { getById: vi.fn(() => ({ rowIndex: 2 })) },
      view: { scrollToRow: vi.fn() }
    };
    const table = {
      apiRef: { current: api },
      api,
      ready: true
    } as unknown as UseMachTableReturn;
    let editing: UseMachTableEditingReturn | null = null;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    function Harness() {
      editing = useMachTableEditing(table, {
        guardBeforeUnload: true,
        beforeUnloadMessage: "Save first",
        onSaveSuccess,
        onSaveError
      });
      return null;
    }

    await act(async () => root.render(createElement(Harness)));
    expect(editing!.dirty).toBe(true);
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    let pending!: Promise<GridChange[]>;
    await act(async () => {
      pending = editing!.save(saveHandler);
      await expect(editing!.save(saveHandler)).rejects.toThrow(/already in progress/);
      resolveSave(changes);
      await pending;
    });
    expect(onSaveSuccess).toHaveBeenCalledOnce();
    expect(editing!.reveal("1", "name", true)).toBe(true);
    expect(api.view.scrollToRow).toHaveBeenCalledWith(2, "middle");
    await act(async () => {
      expect(editing!.rollback(["1"])).toBe(true);
      editing!.markSaved(["1"]);
    });
    expect(api.editing.markSaved).toHaveBeenCalledWith(["1"]);

    api.rows.getById.mockReturnValueOnce(null as never);
    expect(editing!.reveal("missing", "name", true)).toBe(false);
    api.editing.save = vi.fn().mockRejectedValue(new Error("save failed"));
    await act(async () => {
      await expect(editing!.save(saveHandler)).rejects.toThrow("save failed");
    });
    expect(editing!.saveError).toBeInstanceOf(Error);
    expect(onSaveError).toHaveBeenCalledOnce();

    table.apiRef.current = null;
    await expect(editing!.save(saveHandler)).rejects.toThrow(/grid is ready/);
    await act(async () => root.unmount());
    expect(removeListener).toHaveBeenCalledOnce();
  });

  it("composes local and remote controllers without hiding React hook order", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    let local: UseMachTableControllerReturn<{ id: string; name: string }> | null = null;

    function LocalHarness() {
      local = useMachTableController();
      return createElement(MachTable<{ id: string; name: string }>, {
        apiRef: local.table.apiRef,
        columnDefs: [{ field: "name" }],
        rowData: [{ id: "1", name: "Ada" }],
        rowKey: "id",
        rowSelection: "multiple",
        pagination: false
      });
    }
    await act(async () => root.render(createElement(LocalHarness)));
    expect(local!.table.api).not.toBeNull();
    await act(async () => local!.setSearch("Ada"));
    expect(local!.table.apiRef.current?.getOption("quickFilterText")).toBe("Ada");
    await act(async () => local!.table.apiRef.current?.selection.selectAll());
    expect(local!.selectedCount).toBe(1);
    await act(async () => local!.commands.refresh());
    local!.commands.setDensity("compact");
    expect(local!.table.apiRef.current?.getOption("size")).toBe("compact");
    expect(await local!.commands.toggleFullscreen()).toBe(false);
    await act(async () => root.unmount());

    const reload = vi.fn(async () => undefined);
    const setQuickFilterText = vi.fn();
    const remote = {
      rows: [{ id: "2" }], loading: true, error: new Error("offline"), page: 1, pageSize: 20, total: 1,
      sortModel: [], filterModel: {}, quickFilterText: null, setQuickFilterText,
      selectedKeys: ["2"], selectedRows: [{ id: "2" }],
      selectionState: { mode: "explicit", selectedKeys: ["2"] },
      bindings: {}, reload, retry: reload, reset: reload, abort: vi.fn(),
      clearSelection: vi.fn(), selectAllMatching: vi.fn(), applySelectionState: vi.fn()
    } as unknown as UseMachTableQueryReturn<{ id: string }>;
    const remoteHost = document.createElement("div");
    document.body.appendChild(remoteHost);
    const remoteRoot = createRoot(remoteHost);
    let composed: UseMachTableControllerReturn<{ id: string }> | null = null;
    function RemoteHarness() {
      composed = useMachTableController({ query: remote });
      return null;
    }
    await act(async () => remoteRoot.render(createElement(RemoteHarness)));
    expect(composed!.selectedCount).toBe(1);
    expect(composed!.busy).toBe(true);
    expect(composed!.error).toBe(remote.error);
    await act(async () => composed!.setSearch("server"));
    expect(setQuickFilterText).toHaveBeenCalledWith("server");
    await composed!.commands.refresh();
    expect(reload).toHaveBeenCalledOnce();
    await act(async () => remoteRoot.unmount());
  });

  it("wires every optional toolbar command and extension surface", async () => {
    const calls = {
      search: vi.fn(), refresh: vi.fn(async () => undefined), openColumns: vi.fn(), setDensity: vi.fn(),
      resetColumns: vi.fn(), undo: vi.fn(() => true), redo: vi.fn(() => true),
      canUndo: vi.fn(() => true), canRedo: vi.fn(() => true), exportCsv: vi.fn(() => true),
      toggleFullscreen: vi.fn(async () => true)
    } satisfies MachTableCommands;
    const clear = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(MachTableToolbar, {
      commands: calls,
      search: "",
      selectedCount: 3,
      onClearSelection: clear,
      features: { undoRedo: true, fullscreen: true },
      start: createElement("span", { id: "start" }, "start"),
      children: createElement("span", { id: "middle" }, "middle"),
      end: createElement("span", { id: "end" }, "end")
    })));

    const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "orders");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const density = host.querySelector<HTMLSelectElement>("select")!;
    density.value = "compact";
    density.dispatchEvent(new Event("change", { bubbles: true }));
    for (const button of host.querySelectorAll<HTMLButtonElement>("button")) button.click();
    await act(async () => Promise.resolve());

    expect(calls.search).toHaveBeenCalledWith("orders");
    expect(calls.refresh).toHaveBeenCalledOnce();
    expect(calls.openColumns).toHaveBeenCalledOnce();
    expect(calls.setDensity).toHaveBeenCalledWith("compact");
    expect(calls.undo).toHaveBeenCalledOnce();
    expect(calls.redo).toHaveBeenCalledOnce();
    expect(calls.exportCsv).toHaveBeenCalledOnce();
    expect(calls.toggleFullscreen).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledOnce();
    expect(host.querySelector("#start")).toBeTruthy();
    expect(host.querySelector("#middle")).toBeTruthy();
    expect(host.querySelector("#end")).toBeTruthy();

    const api = {
      getOption: vi.fn(() => "normal"),
      updateOptions: vi.fn(),
      filtering: { setQuickText: vi.fn() },
      rows: { isRemote: vi.fn(() => false), reload: vi.fn() },
      view: { refreshCells: vi.fn() },
      columns: { openWorkbench: vi.fn() },
      editing: {
        canUndo: vi.fn(() => true),
        canRedo: vi.fn(() => true),
        undo: vi.fn(() => true),
        redo: vi.fn(() => true)
      }
    } as unknown as GridApi;
    await act(async () => root.render(createElement(MachTableToolbar, {
      api,
      search: "",
      selectedCount: 1,
      features: { undoRedo: true, fullscreen: true }
    })));
    const apiInput = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(apiInput, "local");
    apiInput.dispatchEvent(new Event("input", { bubbles: true }));
    const apiDensity = host.querySelector<HTMLSelectElement>("select")!;
    apiDensity.value = "large";
    apiDensity.dispatchEvent(new Event("change", { bubbles: true }));
    for (const button of host.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")) button.click();
    expect(api.filtering.setQuickText).toHaveBeenCalledWith("local");
    expect(api.view.refreshCells).toHaveBeenCalledOnce();
    expect(api.columns.openWorkbench).toHaveBeenCalledOnce();
    expect(api.updateOptions).toHaveBeenCalledWith({ size: "large" });
    expect(api.editing.undo).toHaveBeenCalledOnce();
    expect(api.editing.redo).toHaveBeenCalledOnce();

    const onSearchChange = vi.fn();
    const onRefresh = vi.fn();
    await act(async () => root.render(createElement(MachTableToolbar, {
      search: "",
      onSearchChange,
      onRefresh,
      features: { columns: false, density: false, export: false }
    })));
    const callbackInput = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(callbackInput, "callback");
    callbackInput.dispatchEvent(new Event("input", { bubbles: true }));
    host.querySelector<HTMLButtonElement>("button")?.click();
    expect(onSearchChange).toHaveBeenCalledWith("callback");
    expect(onRefresh).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });

  it("handles React query errors, reset, compact selection and cancellation", async () => {
    const steps: Array<(signal: AbortSignal) => Promise<{ rows: { id: string }[]; total: number }>> = [
      async () => { throw new Error("offline"); },
      async () => ({ rows: null as unknown as { id: string }[], total: -1 }),
      async () => ({ rows: [{ id: "1" }, { id: "2" }], total: 1_000 }),
      async () => ({ rows: [{ id: "1" }], total: 1 }),
      (signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))
    ];
    const onError = vi.fn();
    const request = vi.fn(({ signal }: { signal: AbortSignal }) => steps.shift()!(signal));
    const querySource = () => ({ status: "all" });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    let query: UseMachTableQueryReturn<{ id: string }> | null = null;
    function Harness() {
      query = useMachTableQuery({
        query: querySource,
        rowKey: (row) => row.id,
        request,
        immediate: false,
        mode: "manual",
        keepPreviousData: false,
        selectionScope: "query",
        pageSizeOptions: [0, 20, 20],
        onError
      });
      return null;
    }
    await act(async () => root.render(createElement(Harness)));
    expect(request).not.toHaveBeenCalled();

    await act(async () => { await query!.reload(); });
    expect(query!.error).toEqual(expect.objectContaining({ message: "offline" }));
    expect((query!.bindings.overlayErrorTemplate as () => string)()).toContain("Remote request failed");
    await act(async () => { await query!.retry(); });
    expect(query!.error).toBeInstanceOf(TypeError);
    await act(async () => { await query!.reload({ resetPage: true }); });
    expect(query!.rows).toEqual([{ id: "1" }, { id: "2" }]);

    act(() => query!.selectAllMatching());
    expect(query!.selectionState).toEqual({ mode: "allMatching", excludedKeys: [] });
    act(() => query!.bindings.onSelectionChanged?.({ selectedRows: [{ id: "2" }] } as never));
    expect(query!.selectionState).toEqual({ mode: "allMatching", excludedKeys: ["1"] });
    act(() => query!.applySelectionState({ mode: "explicit", selectedKeys: ["1"] }));
    expect(query!.selectedKeys).toEqual(["1"]);
    act(() => query!.clearSelection());
    expect(query!.selectedKeys).toEqual([]);

    act(() => query!.bindings.onSortChanged?.({ sortModel: [{ colId: "id", sort: "asc" }] } as never));
    act(() => query!.bindings.onFilterChanged?.({
      filterModel: { id: { type: "contains", filter: "1" } },
      api: { filtering: { getQuickText: () => null } }
    } as never));
    act(() => query!.setQuickFilterText("urgent"));
    await act(async () => { await query!.reset(); });
    expect(query!.sortModel).toEqual([]);
    expect(query!.filterModel).toEqual({});
    expect(query!.quickFilterText).toBeNull();
    expect(request.mock.lastCall?.[0]).toEqual(expect.objectContaining({ quickFilterText: null }));

    let pending!: Promise<void>;
    act(() => { pending = query!.reload(); });
    expect(query!.loading).toBe(true);
    act(() => query!.abort());
    await act(async () => pending);
    expect(query!.loading).toBe(false);
    expect(onError).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
  });

  it("loads a changed quick filter once even before a grid API is mounted", async () => {
    const request = vi.fn(async ({ quickFilterText }: { quickFilterText: string | null }) => ({
      rows: [{ id: quickFilterText ?? "none" }],
      total: 1
    }));
    const host = document.createElement("div");
    const root = createRoot(host);
    const criteria = {};
    let query: UseMachTableQueryReturn<{ id: string }> | null = null;
    function Harness() {
      query = useMachTableQuery({
        query: criteria,
        rowKey: "id",
        request,
        immediate: false
      });
      return null;
    }
    await act(async () => root.render(createElement(Harness)));

    await act(async () => {
      query!.setQuickFilterText("urgent");
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.lastCall?.[0]).toEqual(expect.objectContaining({ quickFilterText: "urgent" }));
    expect(query!.rows).toEqual([{ id: "urgent" }]);
    await act(async () => root.unmount());
  });
});
