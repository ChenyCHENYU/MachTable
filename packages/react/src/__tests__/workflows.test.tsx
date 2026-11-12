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
      rows: { getById: vi.fn().mockReturnValue({ rowIndex: 2 }) },
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
      toggleFullscreen: vi.fn(async () => true), selectAll: vi.fn(), clearSelection: vi.fn(), resetView: vi.fn()
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

  it.each([false, true])("keeps mounted quick-filter state in sync before gridReady: %s", async (delayGridReady) => {
    if (delayGridReady) vi.stubGlobal("requestAnimationFrame", vi.fn(() => 0));
    type Row = { id: string };
    const request = vi.fn(async ({ quickFilterText }: { quickFilterText: string | null }) => ({
      rows: [{ id: quickFilterText ?? "1" }], total: 50,
    }));
    const criteria = {};
    const columnDefs = [{ field: "id" }];
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    let controller!: UseMachTableControllerReturn<Row>;

    function Harness() {
      const query = useMachTableQuery({
        query: criteria, rowKey: "id", request, initialPage: 2, initialQuickFilterText: "seed",
      });
      controller = useMachTableController({ query });
      return createElement("div", null,
        createElement("input", { value: controller.search, onChange: (event) => controller.setSearch(event.currentTarget.value) }),
        createElement(MachTable<Row>, { columnDefs, ...controller.bindings, apiRef: controller.table.apiRef }),
      );
    }
    const assertSearch = (text: string | null): void => {
      expect(host.querySelector("input")?.value).toBe(text ?? "");
      expect(controller.table.apiRef.current?.filtering.getQuickText()).toBe(text);
    };

    await act(async () => root.render(createElement(Harness)));
    assertSearch("seed");
    await act(async () => controller.setSearch("typed"));
    assertSearch("typed");
    await act(async () => controller.commands.search("command"));
    assertSearch("command");
    await act(async () => controller.table.apiRef.current?.filtering.setQuickText("api"));
    assertSearch("api");
    await act(async () => controller.query?.reset());
    assertSearch(null);
    expect(request.mock.calls.map(([params]) => params.quickFilterText)).toEqual([
      "seed", "typed", "command", "api", null,
    ]);
    await act(async () => root.unmount());
  });

  it.each(["page", "preserve", "query"] as const)("keeps mounted %s selection consistent with accepted pages", async (selectionScope) => {
    type Row = { id: string; name: string };
    const criteria = {};
    let revision = 0;
    const request = vi.fn(async ({ page }: { page: number }) => ({
      rows: [{ id: String(page), name: `page-${page}-${++revision}` }, { id: "shared", name: "shared" }], total: 40,
    }));
    let query!: UseMachTableQueryReturn<Row>;
    const apiRef = { current: null as GridApi<Row> | null };
    const columnDefs = [{ field: "name", checkboxSelection: true }];
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    function Harness() {
      query = useMachTableQuery({ query: criteria, request, rowKey: "id", selectionScope });
      return createElement(MachTable<Row>, { ...query.bindings, columnDefs, rowSelection: "multiple", apiRef });
    }
    await act(async () => root.render(createElement(Harness)));
    const api = apiRef.current!;
    await act(async () => { await api.whenReady(); });
    await act(async () => api.selection.setById("1"));
    await act(async () => api.selection.setById("shared", true, false));
    expect(query.selectedKeys).toEqual(["1", "shared"]);

    await act(async () => query.reload());
    expect(query.selectedRows).toEqual(query.rows);
    expect(api.selection.getIds()).toEqual(["1", "shared"]);
    await act(async () => api.pagination.setPage(2));
    expect(query.rows[0]?.id).toBe("2");
    expect(api.selection.getIds()).toEqual(["shared"]);
    expect(query.selectedKeys).toEqual(selectionScope === "page" ? ["shared"] : ["1", "shared"]);
    expect(query.selectedRows.map(row => row.id)).toEqual(selectionScope === "page" ? ["shared"] : ["1", "shared"]);
    await act(async () => api.selection.setById("2"));
    expect(query.selectedKeys).toEqual(selectionScope === "page" ? ["2"] : ["1", "2"]);
    await act(async () => root.unmount());
  });

  it("does not discard page selection for failed or stale responses", async () => {
    type Row = { id: string };
    const criteria = {};
    const pending: Array<{ resolve(result: { rows: Row[]; total: number }): void; reject(error: Error): void }> = [];
    const request = () => new Promise<{ rows: Row[]; total: number }>((resolve, reject) => pending.push({ resolve, reject }));
    let query!: UseMachTableQueryReturn<Row>;
    const apiRef = { current: null as GridApi<Row> | null };
    const columnDefs = [{ field: "id" }];
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    function Harness() {
      query = useMachTableQuery({ query: criteria, request, rowKey: "id", selectionScope: "page", mode: "manual" });
      return createElement(MachTable<Row>, { ...query.bindings, columnDefs, rowSelection: "multiple", apiRef });
    }
    await act(async () => root.render(createElement(Harness)));
    const api = apiRef.current!;
    await act(async () => { await api.whenReady(); });
    await act(async () => {
      const initial = query.reload();
      pending.shift()!.resolve({ rows: [{ id: "1" }], total: 40 });
      await initial;
    });
    await act(async () => api.selection.setById("1"));

    await act(async () => {
      api.pagination.setPage(2);
      const failed = query.reload();
      pending.shift()!.reject(new Error("offline"));
      await failed;
    });
    expect(query.selectedKeys).toEqual(["1"]);
    expect(api.selection.getIds()).toEqual(["1"]);
    await act(async () => {
      const invalid = query.reload();
      pending.shift()!.resolve({ rows: [{} as Row], total: 40 });
      await invalid;
    });
    expect(query.error).toBeInstanceOf(Error);
    expect(query.selectedKeys).toEqual(["1"]);

    let stale!: Promise<void>;
    let old!: (typeof pending)[number];
    await act(async () => {
      stale = query.reload();
      old = pending.shift()!;
      api.pagination.setPage(3);
      const latest = query.reload();
      pending.shift()!.resolve({ rows: [{ id: "3" }], total: 60 });
      await latest;
    });
    expect(query.selectedKeys).toEqual([]);
    await act(async () => api.selection.setById("3"));
    await act(async () => {
      old.resolve({ rows: [{ id: "2" }], total: 40 });
      await stale;
    });
    expect(query.rows).toEqual([{ id: "3" }]);
    expect(query.selectedKeys).toEqual(["3"]);
    expect(query.selectedRows).toEqual([{ id: "3" }]);
    expect(api.selection.getIds()).toEqual(["3"]);
    await act(async () => {
      const aborted = query.reload();
      const cancelled = pending.shift()!;
      query.abort();
      cancelled.resolve({ rows: [{ id: "4" }], total: 40 });
      await aborted;
    });
    expect(query.rows).toEqual([{ id: "3" }]);
    expect(query.selectedKeys).toEqual(["3"]);
    await act(async () => root.unmount());
  });

  it.each([[0.5, 20], [1.5, 1]])("normalizes fractional initial paging %s to valid page and size", async (input, expectedSize) => {
    let query!: UseMachTableQueryReturn<{ id: string }>;
    const request = vi.fn(async (params: unknown) => { void params; return { rows: [] as { id: string }[], total: 0 }; });
    const criteria = {};
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    function Harness() {
      query = useMachTableQuery({
        query: criteria, rowKey: "id", request, mode: "manual", initialPage: input, pageSize: input,
        pageSizeOptions: [0.5, 1.5, 2.9, Number.NaN, Infinity, -1, true as unknown as number]
      });
      return null;
    }
    await act(async () => root.render(createElement(Harness)));
    try {
      expect(query.page).toBe(1);
      expect(query.pageSize).toBe(expectedSize);
      expect(query.bindings.pagination).toEqual(expect.objectContaining({
        page: 1, pageSize: expectedSize, pageSizeOptions: expectedSize === 20 ? [1, 2, 20] : [1, 2]
      }));
      await act(async () => query.reload());
      expect(request).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ page: 1, pageSize: expectedSize }));
    } finally { await act(async () => root.unmount()); }
  });

  it.each(["path", "function"] as const)("normalizes %s row keys consistently while preserving empty-key errors", async (kind) => {
    type Row = { meta: { key: unknown } };
    const rowKey = kind === "path" ? "meta.key" : (row: Row) => row.meta.key as string | number;
    let query!: UseMachTableQueryReturn<Row>;
    const criteria = {};
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    function Harness() {
      query = useMachTableQuery({ query: criteria, rowKey, mode: "manual", request: async () => ({ rows: [], total: 0 }) });
      return null;
    }
    await act(async () => root.render(createElement(Harness)));
    try {
      const identify = query.bindings.rowKey;
      if (typeof identify !== "function") throw new Error("Expected the normalized row-key binding");
      for (const key of [0, false, "001", "0", "1"]) expect(identify({ meta: { key } })).toBe(String(key));
      for (const key of [null, undefined, ""]) {
        expect(() => identify({ meta: { key } })).toThrow(`[MachTable] Empty rowKey "${String(rowKey)}".`);
      }
    } finally { await act(async () => root.unmount()); }
  });

  it.each(["abort", "dispose", "supersede"] as const)("settles a non-cooperative request on %s and observes its late rejection", async (action) => {
    type Result = { rows: { id: string }[]; total: number };
    const pending: Array<{ signal: AbortSignal; resolve(result: Result): void; reject(error: Error): void }> = [];
    const request = ({ signal }: { signal: AbortSignal }) => new Promise<Result>((resolve, reject) => pending.push({ signal, resolve, reject }));
    let query!: UseMachTableQueryReturn<{ id: string }>;
    const criteria = {};
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    function Harness() {
      query = useMachTableQuery({ query: criteria, rowKey: "id", request, mode: "manual" });
      return null;
    }
    await act(async () => root.render(createElement(Harness)));
    let old!: Promise<void>;
    act(() => { old = query.reload(); });
    let mounted = true;
    try {
      if (action === "dispose") { await act(async () => root.unmount()); mounted = false; }
      else if (action === "abort") act(() => query.abort());
      else await act(async () => {
        const latest = query.reload();
        pending[1].resolve({ rows: [{ id: "latest" }], total: 1 });
        await latest;
      });
      expect(pending[0].signal.aborted).toBe(true);
      expect(await Promise.race([old.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 30))])).toBe(true);
      await act(async () => {
        pending[0].reject(new Error("late transport failure"));
        await old;
      });
      if (mounted) expect(query.loading).toBe(false);
      expect(query.error).toBeNull();
      expect(query.rows).toEqual(action === "supersede" ? [{ id: "latest" }] : []);
    } finally {
      await act(async () => {
        pending[0].reject(new Error("transport cleanup"));
        await old;
        if (mounted) root.unmount();
      });
    }
  });

  it.each(["page", "preserve", "query"] as const)("rejects duplicate remote keys before changing %s data or selection", async (selectionScope) => {
    type Row = { id: string | number; name: string };
    const accepted: Row = { id: "1", name: "accepted" };
    let result = { rows: [accepted], total: 40 };
    const onSuccess = vi.fn(), onError = vi.fn();
    let query!: UseMachTableQueryReturn<Row>;
    const criteria = {};
    const apiRef = { current: null as GridApi<Row> | null };
    const columnDefs = [{ field: "name" }];
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    function Harness() {
      query = useMachTableQuery({ query: criteria, rowKey: "id", request: async () => result, mode: "manual", selectionScope, onSuccess, onError });
      return createElement(MachTable<Row>, { ...query.bindings, columnDefs, rowSelection: "multiple", apiRef });
    }
    await act(async () => root.render(createElement(Harness)));
    try {
      await act(async () => query.reload());
      const api = apiRef.current!;
      act(() => {
        if (selectionScope === "preserve") query.selectAllMatching();
        else query.applySelectionState({ mode: "explicit", selectedKeys: ["1"] });
      });
      const selection = query.selectionState;
      result = { rows: [{ id: 1, name: "first" }, { id: "1", name: "second" }], total: 60 };
      await act(async () => query.reload());
      expect(query.error).toEqual(expect.objectContaining({ message: expect.stringMatching(/duplicate.*key/i) }));
      expect(query.rows).toEqual([accepted]);
      expect(query.total).toBe(40);
      expect(query.selectionState).toEqual(selection);
      expect(query.selectedRows).toEqual([accepted]);
      expect(api.rows.getAt(0)?.data).toEqual(accepted);
      expect(api.selection.getRows()).toEqual([accepted]);
      expect(onSuccess).toHaveBeenCalledOnce();
      expect(onError).toHaveBeenCalledOnce();
      const recovered = { id: "1", name: "recovered" };
      result = { rows: [recovered], total: 41 };
      await act(async () => query.retry());
      expect(query.error).toBeNull();
      expect(query.rows).toEqual([recovered]);
      expect(query.selectedRows).toEqual([recovered]);
      expect(api.selection.getRows()).toEqual([recovered]);
    } finally { await act(async () => root.unmount()); }
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
      api: {
        filtering: { getQuickText: () => null, setQuickText: vi.fn(), setModel: vi.fn(), setAdvancedModel: vi.fn() },
        sorting: { setModel: vi.fn() },
        selection: { clear: vi.fn(), setRows: vi.fn() },
        isDestroyed: () => false
      }
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
