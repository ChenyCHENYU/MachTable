// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  advancedFilterCondition,
  advancedFilterGroup,
  createGrid,
  createLocalGridViewStore,
  createGridViewManager,
  normalizeGridState,
  normalizeAdvancedFilterModel,
  resolveGridFeatures,
  resolveSaveConflict,
  validateGridOptions,
  type GridFeature,
  type GridViewStore,
  type SavedGridView
} from "../index";

interface Row {
  id: string;
  name: string;
  dept: string;
  amount: number;
  status: string;
}

const rows: Row[] = [
  { id: "1", name: "Alpha", dept: "East", amount: 40, status: "active" },
  { id: "2", name: "Beta", dept: "West", amount: 180, status: "active" },
  { id: "3", name: "Gamma", dept: "West", amount: 20, status: "disabled" }
];

function host(): HTMLElement {
  const element = document.createElement("div");
  Object.defineProperty(element, "clientWidth", { value: 900, configurable: true });
  Object.defineProperty(element, "clientHeight", { value: 420, configurable: true });
  document.body.appendChild(element);
  return element;
}

function createRowsGrid(data = rows.map((row) => ({ ...row }))) {
  return createGrid<Row>(host(), {
    columnDefs: [
      { field: "name", editable: true },
      { field: "dept" },
      { field: "amount", filter: "number" },
      { field: "status" }
    ],
    rowData: data,
    rowKey: "id",
    pagination: false
  });
}

afterEach(() => { document.body.textContent = ""; });

describe("0.18 runtime API governance", () => {
  it("reports and isolates invalid JavaScript option patches", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const api = createRowsGrid();
    const before = api.getOption("rowHeight");
    api.updateOptions({ rowHeight: "forty" as any });
    expect(api.getOption("rowHeight")).toBe(before);
    expect(validateGridOptions({ rowHeight: "forty" } as any)).toContainEqual(expect.objectContaining({
      code: "INVALID_OPTION_VALUE", option: "rowHeight"
    }));
    expect(warn).toHaveBeenCalled();
    api.destroy();
    warn.mockRestore();
  });

  it("orders feature dependencies and isolates conflicts and cycles", () => {
    const order: string[] = [];
    const base: GridFeature = { key: "base", version: "1.2.0", setup: () => { order.push("base"); } };
    const dependent: GridFeature = { key: "dependent", requires: ["base"], setup: () => { order.push("dependent"); } };
    const conflict: GridFeature = { key: "conflict", conflicts: ["base"], setup: vi.fn() };
    const resolved = resolveGridFeatures([dependent, conflict, base]);
    expect(resolved.features.map((feature) => feature.key)).toEqual(["base", "dependent"]);
    expect(resolved.issues).toContainEqual(expect.objectContaining({ code: "FEATURE_CONFLICT" }));
    const cyclic = resolveGridFeatures([
      { key: "a", requires: ["b"], setup() {} },
      { key: "b", requires: ["a"], setup() {} }
    ]);
    expect(cyclic.features).toEqual([]);
    expect(cyclic.issues).toContainEqual(expect.objectContaining({ code: "FEATURE_CYCLE" }));

    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const api = createGrid(host(), { columnDefs: [{ field: "name" }], rowData: [], features: [dependent, base] });
    expect(order).toEqual(["base", "dependent"]);
    expect(api.diagnostics.get().activeFeatures).toEqual([
      { key: "base", version: "1.2.0" }, { key: "dependent" }
    ]);
    api.destroy();

    const dependentSetup = vi.fn();
    const failedApi = createGrid(host(), {
      columnDefs: [{ field: "name" }],
      rowData: [],
      features: [
        { key: "broken", setup: () => { throw new Error("setup failed"); } },
        { key: "blocked", requires: ["broken"], setup: dependentSetup }
      ]
    });
    expect(dependentSetup).not.toHaveBeenCalled();
    expect(failedApi.diagnostics.get().activeFeatures).toEqual([]);
    expect(failedApi.diagnostics.get().recentErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ context: expect.objectContaining({ code: "FEATURE_DEPENDENCY_SETUP_FAILED" }) })
    ]));
    failedApi.destroy();
    error.mockRestore();
  });

  it("refreshes a mounted renderer without recreating or leaking it", () => {
    const refresh = vi.fn((params: any) => { element.textContent = String(params.value); return true; });
    const destroy = vi.fn();
    const renderer = vi.fn((params: any) => {
      element.textContent = String(params.value);
      return { el: element, refresh, destroy };
    });
    const element = document.createElement("span");
    const api = createGrid<Row>(host(), {
      columnDefs: [{ field: "name", cellRenderer: renderer }],
      rowData: [rows[0]], rowKey: "id", pagination: false
    });
    expect(renderer).toHaveBeenCalledTimes(1);
    api.rows.transact({ update: [{ ...rows[0], name: "Updated" }] });
    expect(renderer).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalled();
    expect(element.textContent).toBe("Updated");
    api.destroy();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

describe("0.17 advanced filters and saved views", () => {
  it("applies initial quick and advanced filters only after columns are available", () => {
    const api = createGrid<Row>(host(), {
      columnDefs: [{ field: "name" }, { field: "status" }],
      rowData: rows,
      rowKey: "id",
      pagination: false,
      quickFilterText: "alpha",
      advancedFilterModel: {
        version: 1,
        root: advancedFilterCondition("missing", { type: "set", values: ["ignored"] })
      }
    });
    expect(api.rows.getCount()).toBe(1);
    expect(api.filtering.getQuickText()).toBe("alpha");
    expect(api.filtering.getAdvancedModel()).toBeNull();
    api.destroy();
  });

  it("evaluates nested AND/OR/NOT filters and sanitizes cyclic input", () => {
    const api = createRowsGrid();
    api.filtering.setAdvancedModel({
      version: 1,
      root: advancedFilterGroup("and", [
        advancedFilterCondition("status", { type: "set", values: ["active"] }),
        advancedFilterGroup("or", [
          advancedFilterCondition("dept", { type: "text", conditions: [{ match: "equals", value: "East" }] }),
          advancedFilterCondition("amount", { type: "number", conditions: [{ match: "greaterThan", value: 100 }] })
        ])
      ])
    });
    expect(api.rows.getCount()).toBe(2);
    expect([api.rows.getAt(0)?.id, api.rows.getAt(1)?.id]).toEqual(["1", "2"]);
    const cyclic: any = { kind: "group", operator: "and", children: [] };
    cyclic.children.push(cyclic);
    expect(normalizeAdvancedFilterModel({ version: 1, root: cyclic })).toBeNull();
    api.destroy();
  });

  it("rejects obsolete state and normalizes the current state schema", () => {
    const legacy = {
      version: 1 as const, columns: [], sortModel: [], filterModel: {}, quickFilterText: null,
      pagination: { enabled: false, page: 1, pageSize: 20 },
      selectedRowIds: [], expandedRowIds: [], expandedGroupIds: []
    };
    expect(normalizeGridState(legacy)).toBeNull();
    const current = { ...legacy, version: 2 as const, advancedFilterModel: null };
    expect(normalizeGridState({
      ...current,
      columns: [null, { colId: " name ", width: Number.POSITIVE_INFINITY, pinned: "middle" }],
      sortModel: [{ colId: " name ", direction: "desc" }, { colId: "name", direction: "asc" }]
    })).toEqual(expect.objectContaining({
      columns: [{ colId: "name" }],
      sortModel: [{ colId: "name", direction: "desc" }]
    }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onGridError = vi.fn();
    const api = createRowsGrid();
    api.on("gridError", onGridError);
    api.state.apply(legacy as never);
    expect(onGridError).toHaveBeenCalledWith(expect.objectContaining({ source: "gridState.apply" }));
    api.state.apply(current);
    expect(api.state.get().version).toBe(2);
    api.filtering.setAdvancedModel({
      version: 1,
      root: advancedFilterCondition("status", { type: "set", values: ["active"] })
    });
    expect(api.state.get().advancedFilterModel).toEqual(expect.objectContaining({ version: 1 }));
    api.destroy();
    consoleError.mockRestore();
  });

  it("saves named views without capturing business selection", async () => {
    const values = new Map<string, SavedGridView>();
    const store: GridViewStore = {
      list: () => [...values.values()],
      save: (_scope, view) => { values.set(view.id, view); },
      remove: (_scope, id) => { values.delete(id); }
    };
    const api = createRowsGrid();
    const manager = createGridViewManager(api, { scope: "tenant:user:orders", store });
    api.columns.setWidth("name", 220);
    api.filtering.setModel({ status: { type: "set", values: ["active"] } });
    const saved = await manager.save("我的待办", "mine");
    expect(saved.state.columns.find((column) => column.colId === "name")?.width).toBe(220);
    expect(saved.state).not.toHaveProperty("selectedRowIds");

    api.columns.setWidth("name", 120);
    api.filtering.setModel(null);
    await manager.apply("mine", { emitEvents: false });
    expect(api.columns.getState().find((column) => column.colId === "name")?.width).toBe(220);
    expect(api.filtering.getModel()).toHaveProperty("status");
    await manager.remove("mine");
    expect(await manager.list()).toEqual([]);
    api.destroy();
  });

  it("reports and rejects explicit named-view writes that were not persisted", async () => {
    const onError = vi.fn();
    const store = createLocalGridViewStore({
      storage: {
        getItem: () => null,
        setItem: () => { throw new DOMException("quota", "QuotaExceededError"); },
        removeItem: () => undefined
      },
      onError
    });
    const api = createRowsGrid();
    const manager = createGridViewManager(api, { scope: "tenant:user:orders", store });
    await expect(manager.save("cannot persist")).rejects.toThrow("quota");
    expect(onError).toHaveBeenCalledWith(expect.anything(), "save", "tenant:user:orders");
    api.destroy();
  });
});

describe("0.17 batch save review and conflict resolution", () => {
  it("keeps failed/conflicting rows dirty and acknowledges only successful snapshots", async () => {
    const api = createRowsGrid();
    api.editing.startCell({ rowIndex: 0, colId: "name" });
    const input = document.querySelector<HTMLInputElement>(".mach-editor-input")!;
    input.value = "Local";
    api.editing.stop();
    const result = await api.editing.save(async () => ({
      failures: [{ rowId: "1", message: "stale validation response" }],
      conflicts: [{ rowId: "1", message: "版本冲突", code: "VERSION_CONFLICT", serverData: { ...rows[0], name: "Server" } }]
    }));
    expect(result.saved).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.conflicts[0].rowId).toBe("1");
    expect(api.editing.getDirtyRowIds()).toEqual(["1"]);
    expect(resolveSaveConflict(api, result.conflicts[0], "acceptServer")).toBe(true);
    expect(api.rows.getById("1")?.data?.name).toBe("Server");
    expect(api.editing.getDirtyRowIds()).toEqual([]);

    expect(resolveSaveConflict(api, {
      rowId: "1",
      message: "mismatched server row",
      serverData: { ...rows[1], name: "Wrong target" }
    }, "acceptServer")).toBe(false);
    expect(api.rows.getById("1")?.data?.name).toBe("Server");
    expect(api.rows.getById("2")?.data?.name).toBe("Beta");
    api.destroy();
  });

  it("does not lose an edit made while an earlier snapshot is saving", async () => {
    const api = createRowsGrid();
    const edit = (value: string) => {
      api.editing.startCell({ rowIndex: 0, colId: "name" });
      const input = document.querySelector<HTMLInputElement>(".mach-editor-input")!;
      input.value = value;
      api.editing.stop();
    };
    edit("First");
    let finish!: () => void;
    const saving = api.editing.save(() => new Promise<void>((resolve) => { finish = resolve; }));
    edit("Second");
    finish();
    const result = await saving;
    expect(result.saved[0].cells[0].value).toBe("First");
    expect(api.editing.getChanges()[0].cells[0]).toEqual(expect.objectContaining({ originalValue: "First", value: "Second" }));
    api.destroy();
  });
});

describe("0.18 performance evidence", () => {
  it("exposes bounded rolling render metrics and supports reset", () => {
    const api = createRowsGrid();
    const metrics = api.diagnostics.getPerformance();
    expect(metrics.sampleCount).toBeGreaterThan(0);
    expect(metrics.renderedRows).toBeGreaterThan(0);
    expect(metrics.renderedCells).toBe(metrics.renderedRows * metrics.renderedColumns);
    expect(api.diagnostics.get().performance).toEqual(metrics);
    api.diagnostics.resetPerformance();
    expect(api.diagnostics.getPerformance().sampleCount).toBe(0);
    api.destroy();
  });
});
