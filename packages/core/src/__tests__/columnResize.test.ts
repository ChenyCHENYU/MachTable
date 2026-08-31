// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGrid, validateGridOptions } from "../index";
import type { ColDef, ColumnState, GridPersistenceOptions, GridState } from "../index";
import { createLocalColumnStateStore } from "../lib/columnStateStore";
import type { ColumnStateStore } from "../types/options";

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
  Object.defineProperty(host.querySelector(".mach-body-viewport--scroll")!, "clientWidth", {
    value: width,
    configurable: true
  });
}

function requireStoredState(state: ColumnState[] | null): ColumnState[] {
  expect(state).not.toBeNull();
  return state ?? [];
}

function columnPersistence(key: string, store: ColumnStateStore): GridPersistenceOptions {
  const wrap = (columns: ColumnState[] | null): GridState | null => columns ? {
    version: 2,
    columns,
    sortModel: [],
    filterModel: {},
    advancedFilterModel: null,
    quickFilterText: null,
    pagination: { enabled: false, page: 1, pageSize: 20 },
    selectedRowIds: [],
    expandedRowIds: [],
    expandedGroupIds: []
  } : null;
  return {
    key,
    sections: ["columns"],
    debounceMs: 0,
    store: {
      load: (storageKey) => {
        const value = store.load(storageKey);
        return value instanceof Promise ? value.then(wrap) : wrap(value);
      },
      save: (storageKey, state) => store.save(storageKey, state.columns)
    }
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
    let stored: ColumnState[] | null = null;
    const save = vi.fn((_key: string, state: ColumnState[]) => {
      stored = state.map((entry) => ({ ...entry }));
    });
    const store: ColumnStateStore = { load: () => stored, save };
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
    api.destroy();
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

  it("restores persisted widths while keeping untouched flex columns responsive", () => {
    let stored: ColumnState[] | null = null;
    const store: ColumnStateStore = {
      load: () => stored,
      save: (_key, state) => {
        stored = state.map((entry) => ({ ...entry }));
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

  it("keeps a dragged column exact in fit layout and lets untouched columns fill the remainder", () => {
    let stored: ColumnState[] | null = null;
    const store: ColumnStateStore = {
      load: () => stored,
      save: (_key, state) => {
        stored = state.map((entry) => ({ ...entry }));
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
      width: 300,
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

  it("offers a safe single-column API independent from pointer resizing", () => {
    const host = createHost();
    const resized = vi.fn();
    const api = createGrid(host, { columnDefs: defs, rowData: rows, pagination: false });
    api.on("columnResized", resized);

    expect(api.columns.setWidth("name", Number.NaN)).toBe(false);
    expect(api.columns.setWidth("missing", 180)).toBe(false);
    api.columns.setState([{
      colId: "name",
      width: Number.NaN,
      pinned: "invalid",
      sort: "invalid"
    }] as any);
    expect(api.columns.getState().find((state) => state.colId === "name")).toMatchObject({
      width: 120,
      pinned: null,
      sort: null
    });
    expect(api.columns.setWidth("name", 10)).toBe(true);
    expect(api.columns.getState().find((state) => state.colId === "name")?.width).toBe(100);
    expect(resized).toHaveBeenCalledWith(expect.objectContaining({ width: 100, finished: true }));
    api.destroy();
  });

  it("sanitizes flex metadata in the built-in persistent store", () => {
    const values = new Map<string, string>();
    const store = createLocalColumnStateStore({
      storage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key)
      }
    });
    store.save("orders", [
      { colId: "responsive", width: 420, flex: 2 },
      { colId: "fixed", width: 160, flex: null },
      { colId: "invalid", width: 120, flex: Number.NaN }
    ]);

    expect(store.load("orders")).toEqual([
      { colId: "responsive", width: 420, flex: 2 },
      { colId: "fixed", width: 160, flex: null },
      { colId: "invalid", width: 120 }
    ]);
  });
});
