// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGrid, createLocalGridStateStore, validateGridOptions } from "../index";
import type { ColDef, ColumnState, GridPersistenceOptions, GridState, GridStateStore } from "../index";

interface Row {
  id: string;
  name: string;
  amount: number;
}

const rows: Row[] = [{ id: "1", name: "Alpha", amount: 10 }];

function createHost(width = 800): HTMLElement {
  const host = document.createElement("div");
  Object.defineProperty(host, "clientWidth", { value: width, configurable: true });
  Object.defineProperty(host, "clientHeight", { value: 400, configurable: true });
  document.body.appendChild(host);
  return host;
}

function pointer(type: string, clientX: number, pointerId = 7): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  Object.defineProperty(event, "isPrimary", { value: true });
  return event;
}

function resizeHandle(host: HTMLElement, colId = "name"): HTMLElement {
  const handle = host.querySelector<HTMLElement>(
    `.mach-header-cell[data-col-id="${colId}"] .mach-header-resize`
  );
  if (!handle) throw new Error(`resize handle for ${colId} is missing`);
  return handle;
}

function setViewportWidth(host: HTMLElement, width: number): void {
  Object.defineProperty(host.querySelector(".mach-body")!, "clientWidth", {
    value: width,
    configurable: true
  });
}

function requireStoredState(state: GridState | null): ColumnState[] {
  expect(state).not.toBeNull();
  return state?.columns ?? [];
}

function columnPersistence(key: string, store: GridStateStore): GridPersistenceOptions {
  return {
    key,
    sections: ["columns"],
    debounceMs: 0,
    store
  };
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("opt-in column resizing", () => {
  const defs: ColDef<Row>[] = [
    { field: "name", width: 120, minWidth: 100, maxWidth: 240 },
    { field: "amount", flex: 1 }
  ];

  it("is disabled by default and respects the per-column switch", () => {
    expect(validateGridOptions({ enableColumnResize: "yes" } as any)).toEqual([
      expect.objectContaining({ option: "enableColumnResize", code: "INVALID_OPTION_VALUE" })
    ]);
    const firstHost = createHost();
    const first = createGrid(firstHost, { columnDefs: defs, rowData: rows, pagination: false });
    expect(firstHost.querySelector(".mach-header-resize")).toBeNull();

    const header = firstHost.querySelector<HTMLElement>('.mach-header-cell[data-col-id="name"]')!;
    header.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true }));
    expect(first.columns.getState().find((state) => state.colId === "name")?.width).toBe(120);
    first.destroy();

    const secondHost = createHost();
    const second = createGrid(secondHost, {
      columnDefs: [{ field: "name", resizable: false }, { field: "amount" }],
      rowData: rows,
      pagination: false,
      enableColumnResize: true
    });
    expect(resizeHandle(secondHost, "amount")).toBeTruthy();
    expect(secondHost.querySelector('.mach-header-cell[data-col-id="name"] .mach-header-resize')).toBeNull();
    second.destroy();
  });

  it("can be enabled and disabled at runtime without rebuilding columns", () => {
    const host = createHost();
    const api = createGrid(host, { columnDefs: defs, rowData: rows, pagination: false });
    const before = api.columns.getDefinitions();

    api.updateOptions({ enableColumnResize: true });
    const handle = resizeHandle(host);
    handle.dispatchEvent(pointer("pointerdown", 120));
    window.dispatchEvent(pointer("pointermove", 200));
    expect(api.columns.getDefinitions()).toEqual(before);

    api.updateOptions({ enableColumnResize: false });
    expect(host.querySelector(".mach-header-resize")).toBeNull();
    expect(api.columns.getState().find((state) => state.colId === "name")?.width).toBe(120);
    api.destroy();
  });

  it("clamps pointer widths and saves exactly once after pointerup", () => {
    let stored: GridState | null = null;
    const save = vi.fn((_key: string, state: GridState) => {
      stored = state;
    });
    const store: GridStateStore = { load: () => stored, save };
    const host = createHost();
    const resized = vi.fn();
    const api = createGrid(host, {
      columnDefs: defs,
      rowData: rows,
      pagination: false,
      enableColumnResize: true,
      persistence: columnPersistence("orders", store)
    });
    api.on("columnResized", resized);

    const handle = resizeHandle(host);
    handle.dispatchEvent(pointer("pointerdown", 120));
    expect(handle.classList.contains("mach-header-resize--active")).toBe(true);
    expect(host.querySelector(".mach-column-resize-guide")).not.toBeNull();
    expect(host.querySelector(".mach-column-resize-label")?.textContent).toBe("120 px");
    expect(resizeHandle(host, "amount").classList.contains("mach-header-resize--active")).toBe(false);
    window.dispatchEvent(pointer("pointermove", 500));
    expect(save).not.toHaveBeenCalled();
    window.dispatchEvent(pointer("pointerup", 500));

    expect(api.columns.getState().find((state) => state.colId === "name")).toMatchObject({
      width: 240,
      flex: null,
      widthMode: "manual"
    });
    expect(resized).toHaveBeenLastCalledWith(expect.objectContaining({
      colId: "name",
      width: 240,
      finished: true
    }));
    expect(save).toHaveBeenCalledTimes(1);
    expect(host.querySelector(".mach-column-resize-guide")).toBeNull();
    expect(handle.classList.contains("mach-header-resize--active")).toBe(false);
    expect(requireStoredState(stored).find((state) => state.colId === "name")?.width).toBe(240);
    api.destroy();
  });

  it("restores the previous width on pointer cancellation", () => {
    const save = vi.fn();
    const host = createHost();
    const api = createGrid(host, {
      columnDefs: defs,
      rowData: rows,
      pagination: false,
      enableColumnResize: true,
      persistence: columnPersistence("orders", { load: () => null, save })
    });
    const handle = resizeHandle(host);

    handle.dispatchEvent(pointer("pointerdown", 120));
    window.dispatchEvent(pointer("pointermove", 190));
    window.dispatchEvent(pointer("pointercancel", 190));

    expect(api.columns.getState().find((state) => state.colId === "name")?.width).toBe(120);
    expect(save).not.toHaveBeenCalled();
    expect(host.querySelector(".mach-root--resizing")).toBeNull();
    expect(host.querySelector(".mach-column-resize-guide")).toBeNull();
    api.destroy();
  });

  it("shows the clamped live width during dragging and removes feedback on destroy", async () => {
    vi.useFakeTimers();
    const host = createHost();
    const api = createGrid(host, {
      columnDefs: defs,
      rowData: rows,
      pagination: false,
      enableColumnResize: true
    });
    const handle = resizeHandle(host);
    handle.dispatchEvent(pointer("pointerdown", 120));
    window.dispatchEvent(pointer("pointermove", 500));
    await vi.advanceTimersByTimeAsync(20);

    expect(host.querySelector(".mach-column-resize-label")?.textContent).toBe("240 px");
    expect(api.columns.getState().find((state) => state.colId === "name")?.width).toBe(240);
    api.destroy();
    expect(host.querySelector(".mach-column-resize-guide")).toBeNull();
    expect(handle.classList.contains("mach-header-resize--active")).toBe(false);
  });

  it("does not convert a flex column or persist when its handle is only clicked", () => {
    const save = vi.fn();
    const host = createHost();
    const api = createGrid(host, {
      columnDefs: defs,
      rowData: rows,
      pagination: false,
      enableColumnResize: true,
      persistence: columnPersistence("orders", { load: () => null, save })
    });
    const before = api.columns.getState().find((state) => state.colId === "amount")!;
    const handle = resizeHandle(host, "amount");

    handle.dispatchEvent(pointer("pointerdown", before.width!));
    window.dispatchEvent(pointer("pointerup", before.width!));

    expect(api.columns.getState().find((state) => state.colId === "amount")?.flex).toBe(1);
    expect(save).not.toHaveBeenCalled();
    api.destroy();
  });

  const boundedDrags = [
    { name: "vertical movement", viewport: 800, delta: 0, maxWidth: undefined, nextViewport: 1000 },
    { name: "minimum width", viewport: 300, delta: -30, maxWidth: undefined, nextViewport: 700 },
    { name: "maximum width", viewport: 800, delta: 30, maxWidth: 340, nextViewport: 300 }
  ];

  it.each(boundedDrags.flatMap(scenario => [false, true].map(flushFrame => ({ ...scenario, flushFrame }))))(
    "ignores a zero-effect flex drag at $name (animation frame: $flushFrame)",
    async ({ viewport, delta, maxWidth, nextViewport, flushFrame }) => {
      vi.useFakeTimers();
      const save = vi.fn();
      const resized = vi.fn();
      const host = createHost(viewport);
      const api = createGrid(host, {
        rowNumber: false, rowData: rows, pagination: false, enableColumnResize: true,
        columnDefs: [{ field: "name", width: 130 }, { field: "amount", minWidth: 170, maxWidth, flex: 1 }],
        persistence: columnPersistence("bounded-orders", { load: () => null, save })
      });
      setViewportWidth(host, viewport);
      api.view.refreshLayout();
      api.on("columnResized", resized);
      const before = api.columns.getState();
      const start = before.find(column => column.colId === "amount")!.width!;
      resizeHandle(host, "amount").dispatchEvent(pointer("pointerdown", start));
      const move = pointer("pointermove", start + delta);
      Object.defineProperty(move, "clientY", { value: 30 });
      window.dispatchEvent(move);
      if (flushFrame) await vi.advanceTimersByTimeAsync(20);
      window.dispatchEvent(pointer("pointerup", start + delta));
      await vi.advanceTimersByTimeAsync(20);

      expect(api.columns.getState()).toEqual(before);
      expect(resized).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
      expect(host.querySelector(".mach-column-resize-guide")).toBeNull();
      setViewportWidth(host, nextViewport);
      api.view.refreshLayout();
      expect(api.columns.getState().find(column => column.colId === "amount")).toMatchObject({
        flex: 1, widthMode: "auto", width: nextViewport - 130
      });
      api.destroy();
    }
  );

  it.each(boundedDrags)("restores flex mode after a real drag returns to $name", async ({ viewport, delta, maxWidth }) => {
    vi.useFakeTimers();
    const save = vi.fn();
    const resized = vi.fn();
    const host = createHost(viewport);
    const api = createGrid(host, {
      rowNumber: false, rowData: rows, pagination: false, enableColumnResize: true,
      columnDefs: [{ field: "name", width: 130 }, { field: "amount", minWidth: 170, maxWidth, flex: 1 }],
      persistence: columnPersistence("returning-orders", { load: () => null, save })
    });
    setViewportWidth(host, viewport);
    api.view.refreshLayout();
    api.on("columnResized", resized);
    const before = api.columns.getState();
    const start = before.find(column => column.colId === "amount")!.width!;
    resizeHandle(host, "amount").dispatchEvent(pointer("pointerdown", start));
    window.dispatchEvent(pointer("pointermove", start + (maxWidth ? -50 : 50)));
    await vi.advanceTimersByTimeAsync(20);
    expect(api.columns.getState().find(column => column.colId === "amount")?.widthMode).toBe("manual");
    window.dispatchEvent(pointer("pointermove", start + delta));
    await vi.advanceTimersByTimeAsync(20);
    window.dispatchEvent(pointer("pointerup", start + delta));
    await vi.advanceTimersByTimeAsync(20);

    expect(api.columns.getState()).toEqual(before);
    expect(resized.mock.calls.map(([event]) => event.finished)).toEqual([false, false, true]);
    expect(resized).toHaveBeenLastCalledWith(expect.objectContaining({ colId: "amount", width: start }));
    expect(save).toHaveBeenCalledTimes(1);
    api.destroy();
  });

  it("debounces full GridState only after a resize is finished", () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const host = createHost();
    const api = createGrid(host, {
      columnDefs: defs,
      rowData: rows,
      pagination: false,
      enableColumnResize: true,
      persistence: { key: "orders", debounceMs: 0, store: { load: () => null, save } }
    });
    const handle = resizeHandle(host);

    handle.dispatchEvent(pointer("pointerdown", 120));
    window.dispatchEvent(pointer("pointermove", 180));
    vi.runAllTimers();
    expect(save).not.toHaveBeenCalled();

    window.dispatchEvent(pointer("pointerup", 190));
    vi.runAllTimers();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][1].columns.find((state: ColumnState) => state.colId === "name")).toMatchObject({
      width: 190,
      flex: null,
      widthMode: "manual"
    });
    api.destroy();
  });

  it("never writes state outside the explicitly allowed persistence sections", () => {
    const save = vi.fn();
    const host = createHost();
    const api = createGrid(host, {
      columnDefs: defs,
      rowData: rows,
      rowKey: "id",
      pagination: false,
      persistence: {
        key: "private-orders",
        sections: ["columns"],
        debounceMs: 0,
        store: { load: () => null, save }
      }
    });

    api.selection.setRows(rows);
    api.sorting.setModel([{ colId: "name", direction: "desc" }]);
    api.filtering.setQuickText("Alpha");

    const saved = save.mock.lastCall?.[1] as GridState;
    expect(saved.columns.length).toBeGreaterThan(0);
    expect(saved.sortModel).toEqual([]);
    expect(saved.filterModel).toEqual({});
    expect(saved.advancedFilterModel).toBeNull();
    expect(saved.quickFilterText).toBeNull();
    expect(saved.selectedRowIds).toEqual([]);
    expect(saved.expandedRowIds).toEqual([]);
    expect(saved.expandedGroupIds).toEqual([]);
    expect(saved.pagination).toEqual({ enabled: false, page: 1, pageSize: 20 });
    api.destroy();
  });

  it("restores column layout without mutating the independent sort section", () => {
    const host = createHost();
    const api = createGrid(host, { columnDefs: defs, rowData: rows, pagination: false });
    api.sorting.setModel([{ colId: "amount", direction: "asc" }]);
    const state = api.state.get();

    api.state.apply({
      ...state,
      sortModel: [{ colId: "name", direction: "desc" }]
    }, { sections: ["columns"] });

    expect(api.sorting.getModel()).toEqual([{ colId: "amount", direction: "asc" }]);
    api.destroy();
  });

  it("restores persisted widths while keeping untouched flex columns responsive", () => {
    let stored: GridState | null = null;
    const store: GridStateStore = {
      load: () => stored,
      save: (_key, state) => {
        stored = state;
      }
    };
    const firstHost = createHost(800);
    const first = createGrid(firstHost, {
      columnDefs: defs,
      rowData: rows,
      pagination: false,
      enableColumnResize: true,
      persistence: columnPersistence("orders", store)
    });
    resizeHandle(firstHost).dispatchEvent(pointer("pointerdown", 120));
    window.dispatchEvent(pointer("pointerup", 190));
    expect(requireStoredState(stored).find((state) => state.colId === "amount")).toMatchObject({
      flex: 1,
      widthMode: "auto"
    });
    first.destroy();

    const secondHost = createHost(1000);
    const second = createGrid(secondHost, {
      columnDefs: defs,
      rowData: rows,
      pagination: false,
      enableColumnResize: true,
      persistence: columnPersistence("orders", store)
    });
    setViewportWidth(secondHost, 1000);
    second.view.refreshLayout();
    const state = second.columns.getState();
    expect(state.find((entry) => entry.colId === "name")?.width).toBe(190);
    expect(state.find((entry) => entry.colId === "amount")?.flex).toBe(1);
    expect(state.find((entry) => entry.colId === "amount")?.width).toBeGreaterThan(600);
    second.destroy();
  });

  it("keeps a dragged column exact and lets automatic columns respond to a later container resize", () => {
    let stored: GridState | null = null;
    const store: GridStateStore = {
      load: () => stored,
      save: (_key, state) => {
        stored = state;
      }
    };
    const firstHost = createHost();
    const first = createGrid(firstHost, {
      columnDefs: [{ field: "name", width: 120 }, { field: "amount", width: 180 }],
      rowData: rows,
      pagination: false,
      columnLayout: "fit",
      persistence: columnPersistence("fit-orders", store)
    });
    setViewportWidth(firstHost, 600);
    first.view.refreshLayout();

    expect(first.columns.setWidth("name", 300)).toBe(true);
    expect(first.columns.getState().find((state) => state.colId === "name")).toMatchObject({
      width: 300,
      widthMode: "manual"
    });
    expect(first.columns.getState().find((state) => state.colId === "amount")).toMatchObject({
      width: 360,
      widthMode: "auto"
    });
    first.destroy();

    const secondHost = createHost();
    const second = createGrid(secondHost, {
      columnDefs: [{ field: "name", width: 120 }, { field: "amount", width: 180 }],
      rowData: rows,
      pagination: false,
      columnLayout: "fit",
      persistence: columnPersistence("fit-orders", store)
    });
    setViewportWidth(secondHost, 800);
    second.view.refreshLayout();
    expect(second.columns.getState().find((state) => state.colId === "name")?.width).toBe(300);
    expect(second.columns.getState().find((state) => state.colId === "amount")?.width).toBe(500);
    second.destroy();
  });

  it.each(["normal", "fit"] as const)("isolates manual width changes in %s layout without freezing other columns' modes", async columnLayout => {
    vi.useFakeTimers();
    const host = createHost();
    const api = createGrid(host, {
      rowNumber: false, rowData: rows, pagination: false, enableColumnResize: true, columnLayout,
      columnDefs: [
        { field: "id", colId: "left", width: 100, pinned: "left" },
        { field: "name", width: 120, maxWidth: 420 },
        { field: "amount", width: 180, flex: 1 },
        { field: "id", colId: "right", width: 100, pinned: "right" }
      ]
    });
    setViewportWidth(host, 800);
    api.view.refreshLayout();
    const width = (id: string) => api.columns.getState().find(column => column.colId === id)!.width!;
    const untouched = [width("left"), width("amount"), width("right")];
    const start = width("name");
    const handle = resizeHandle(host);
    handle.dispatchEvent(pointer("pointerdown", start));
    window.dispatchEvent(pointer("pointermove", start + 60));
    await vi.advanceTimersByTimeAsync(20);
    expect(width("name")).toBe(start + 60);
    expect([width("left"), width("amount"), width("right")]).toEqual(untouched);
    window.dispatchEvent(pointer("pointerup", start + 60));
    api.view.refreshLayout();
    expect([width("left"), width("amount"), width("right")]).toEqual(untouched);
    api.columns.setWidth("name", start + 90);
    expect([width("left"), width("amount"), width("right")]).toEqual(untouched);
    expect(api.columns.getState().find(column => column.colId === "amount")).toMatchObject({ flex: 1, widthMode: "auto" });

    setViewportWidth(host, 1000);
    api.view.refreshLayout();
    expect(width("name")).toBe(start + 90);
    expect(width("amount")).toBeGreaterThan(untouched[1]);
    api.columns.fit();
    expect(width("name") + width("amount") + width("left") + width("right")).toBeCloseTo(1000);
    api.destroy();
  });

  it.each(["pointercancel", "Escape", "return"])("restores the exact flex allocation on resize %s", async reason => {
    vi.useFakeTimers();
    const host = createHost();
    const api = createGrid(host, { rowNumber: false, columnDefs: defs, rowData: rows, pagination: false, enableColumnResize: true });
    setViewportWidth(host, 800);
    api.view.refreshLayout();
    const before = api.columns.getState();
    const start = before.find(column => column.colId === "amount")!.width!;
    const handle = resizeHandle(host, "amount");
    handle.dispatchEvent(pointer("pointerdown", start));
    window.dispatchEvent(pointer("pointermove", start - 60));
    await vi.advanceTimersByTimeAsync(20);
    if (reason === "Escape") window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    else window.dispatchEvent(pointer(reason === "return" ? "pointerup" : "pointercancel", reason === "return" ? start : start - 60));
    expect(api.columns.getState()).toEqual(before);
    expect(host.querySelector(".mach-root--resizing")).toBeNull();
    api.view.refreshLayout();
    expect(api.columns.getState()).toEqual(before);
    api.destroy();
  });

  it.each(["normal", "fit"] as const)("remeasures automatic content and honors explicit fit/autosize after a manual %s resize", columnLayout => {
    const host = createHost();
    const api = createGrid(host, {
      rowNumber: false, pagination: false, rowKey: "id", columnLayout,
      columnDefs: [{ field: "name", width: 120 }, { field: "note", headerName: "备注" }],
      rowData: [{ id: "1", name: "Alpha", note: "A" }]
    });
    setViewportWidth(host, 800);
    api.view.refreshLayout();
    const before = api.columns.getState();
    const target = before.find(column => column.colId === "name")!.width! + 40;
    api.columns.setWidth("name", target);
    expect(api.columns.getState().find(column => column.colId === "note")!.width).toBe(before.find(column => column.colId === "note")!.width);
    api.rows.transact({ update: [{ id: "1", name: "Alpha", note: "工艺说明".repeat(1000) }] });
    const automatic = api.columns.getState().find(column => column.colId === "note")!;
    expect(automatic.contentWidth).toBe(360);
    expect(automatic.width).toBe(columnLayout === "fit" ? 800 - target : 360);
    expect(api.columns.getState().find(column => column.colId === "name")!.width).toBe(target);

    api.columns.fit();
    expect(api.columns.getState().reduce((sum, column) => sum + column.width!, 0)).toBeCloseTo(800);
    api.columns.autoSize("name");
    expect(api.columns.getState().find(column => column.colId === "name")!.widthMode).toBe(columnLayout === "fit" ? "auto" : "manual");
    api.destroy();
  });

  it("releases the manual layout snapshot when columnLayout is explicitly changed", () => {
    const host = createHost(600);
    const api = createGrid(host, {
      columnDefs: [{ field: "name", width: 200 }, { field: "amount", width: 200 }],
      rowData: rows, pagination: false, columnLayout: "normal"
    });
    setViewportWidth(host, 600);
    api.view.refreshLayout();
    api.columns.setWidth("name", 240);
    const amountWidth = () => api.columns.getState().find(column => column.colId === "amount")!.width;
    expect(amountWidth()).toBe(200);
    api.updateOptions({ columnLayout: "fit" });
    expect(amountWidth()).toBe(360);
    api.updateOptions({ columnLayout: "normal" });
    expect(amountWidth()).toBe(200);
    expect(api.columns.getState().find(column => column.colId === "name")!.width).toBe(240);
    api.destroy();
  });

  it("does not treat scrollbar occupancy after a manual resize as a container resize", () => {
    const host = createHost();
    const api = createGrid(host, { rowNumber: false, columnDefs: defs, rowData: rows, pagination: false });
    setViewportWidth(host, 800);
    api.view.refreshLayout();
    const before = api.columns.getState().find(column => column.colId === "amount")!.width;
    api.columns.setWidth("name", 200);
    const viewport = host.querySelector(".mach-body-viewport--scroll")!;
    Object.defineProperties(viewport, { offsetWidth: { value: 600 }, clientWidth: { value: 585 } });
    api.view.refreshLayout();
    expect(api.columns.getState().find(column => column.colId === "amount")!.width).toBe(before);
    api.destroy();
  });

  it("offers a safe single-column API independent from pointer resizing", () => {
    const host = createHost();
    const resized = vi.fn();
    const api = createGrid(host, { columnDefs: defs, rowData: rows, pagination: false });
    api.on("columnResized", resized);

    expect(api.columns.setWidth("name", Number.NaN)).toBe(false);
    expect(api.columns.setWidth("missing", 180)).toBe(false);
    api.sorting.setModel([{ colId: "amount", direction: "asc" }]);
    api.columns.setState([{
      colId: "name",
      width: Number.NaN,
      pinned: "invalid"
    }] as any);
    expect(api.columns.getState().find((state) => state.colId === "name")).toMatchObject({
      width: 120,
      pinned: null
    });
    expect(api.sorting.getModel()).toEqual([{ colId: "amount", direction: "asc" }]);
    api.columns.resetState();
    expect(api.sorting.getModel()).toEqual([{ colId: "amount", direction: "asc" }]);
    expect(api.columns.setWidth("name", 10)).toBe(true);
    expect(api.columns.getState().find((state) => state.colId === "name")?.width).toBe(100);
    expect(resized).toHaveBeenCalledWith(expect.objectContaining({ width: 100, finished: true }));
    api.destroy();
  });

  it("sanitizes flex metadata in the built-in persistent store", async () => {
    const values = new Map<string, string>();
    const store = createLocalGridStateStore({
      storage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key)
      }
    });
    store.save("orders", {
      version: 2,
      columns: [
        { colId: "responsive", width: 420, flex: 2 },
        { colId: "fixed", width: 160, flex: null },
        { colId: "invalid", width: 120, flex: Number.NaN }
      ],
      sortModel: [],
      filterModel: {},
      advancedFilterModel: null,
      quickFilterText: null,
      pagination: { enabled: false, page: 1, pageSize: 20 },
      selectedRowIds: [],
      expandedRowIds: [],
      expandedGroupIds: []
    });

    const loaded = await store.load("orders");
    expect(loaded?.columns).toEqual([
      { colId: "responsive", width: 420, flex: 2 },
      { colId: "fixed", width: 160, flex: null },
      { colId: "invalid", width: 120 }
    ]);
  });
});

it("protects four-character header text and controls when pointer or keyboard resizing reaches its lower bound", () => {
  const host = createHost();
  const api = createGrid(host, {
    columnDefs: [{ field: "name", headerName: "生产计划", width: 240, minWidth: 40, filter: true }],
    rowData: rows, pagination: false, enableColumnResize: true, columnMenu: true
  });
  resizeHandle(host).dispatchEvent(pointer("pointerdown", 240));
  window.dispatchEvent(pointer("pointerup", 0));
  const minimum = api.columns.getState()[0].width!;
  expect(minimum).toBeGreaterThan(120);
  const header = host.querySelector<HTMLElement>('.mach-header-cell[data-col-id="name"]')!;
  for (let i = 0; i < 8; i++) header.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true }));
  expect(api.columns.getState()[0].width).toBe(minimum);
  api.destroy();
});
