// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { buildColDefsFromSchema, createGrid } from "../index";
import type { ColDef, ColumnFilter, GridApi, GridOptions, GridStateInput, InfiniteGetRowsParams } from "../index";

const grids: GridApi[] = [];

function create(options: GridOptions): GridApi {
  const host = document.createElement("div");
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 400 } });
  document.body.append(host);
  const api = createGrid(host, { rowKey: "id", rowNumber: false, pagination: false, ...options });
  grids.push(api);
  return api;
}

function fields(...names: string[]): ColDef[] {
  return names.map(field => ({ field, filter: "text" }));
}

function fieldOrder(api: GridApi): string[] {
  return api.columns.getState().map(column => column.colId);
}

function equals(value: string): ColumnFilter {
  return { type: "text", conditions: [{ match: "equals", value }] };
}

afterEach(() => {
  grids.splice(0).forEach(api => api.destroy());
  document.body.replaceChildren();
});

it("uses the incoming order for untouched scopes and keeps a user move among surviving siblings", () => {
  const group = (id: string, ...names: string[]) => ({ groupId: id, headerName: id, children: fields(...names) });
  const left = (field: string): ColDef => ({ field, pinned: "left" });
  const api = create({
    columnDefs: [...fields("a", "b"), group("shift", "c", "d"), group("furnace", "f", "g"), left("j"), left("k")],
    rowData: [{ id: "1", a: "old" }]
  });
  api.columns.move("b", 0);
  api.columns.move("d", 0);
  api.columns.move("k", 0);
  api.columns.setWidth("a", 250);

  api.updateOptions({
    columnDefs: [...fields("a", "e", "b"), group("shift", "c", "h", "d"), group("furnace", "g", "f"), left("j"), left("k")],
    rowData: [{ id: "2", e: "new" }]
  });

  expect(fieldOrder(api)).toEqual(["b", "e", "a", "d", "h", "c", "g", "f", "k", "j"]);
  expect(api.columns.getState().find(column => column.colId === "a")?.width).toBe(250);
  expect(api.rows.getAt(0)?.data).toEqual({ id: "2", e: "new" });

  // A moved field never follows its old siblings across a group boundary.
  api.updateOptions({
    columnDefs: [...fields("b", "a"), group("shift", "c", "h"), group("furnace", "d", "f", "g"), left("j"), left("k")]
  });
  expect(fieldOrder(api)).toEqual(["b", "a", "c", "h", "d", "f", "g", "k", "j"]);
});

it("accepts revised definitions for untouched properties and keeps explicit view changes", () => {
  const api = create({ columnDefs: fields("a", "b", "c"), rowData: [{ id: "1", a: "automatic width" }] });
  api.columns.setWidth("b", 210);
  api.columns.setVisible("b", false);
  api.columns.setPinned("b", "right");

  api.updateOptions({ columnDefs: [
    { field: "a", width: 260, pinned: "left" },
    { field: "b", width: 190, pinned: "left", hide: false },
    { field: "c", flex: 2, hide: true }
  ] });

  expect(api.columns.getState()).toEqual([
    expect.objectContaining({ colId: "a", width: 260, pinned: "left" }),
    expect.objectContaining({ colId: "b", width: 210, widthMode: "manual", pinned: "right", hide: true }),
    expect.objectContaining({ colId: "c", flex: 2, hide: true })
  ]);
});

it("keeps grouped preferences on title changes and resets to the latest schema order", () => {
  const definitions = (title: string, updated = false) => buildColDefsFromSchema({
    fields: ["a", "b", "c", "d", "e", "f", "g"].map(field => ({ field })),
    groups: [
      { groupId: "main", title, fields: updated ? ["c", "d", "e"] : ["c", "e"] },
      { groupId: "other", title, fields: ["f", "g"] }
    ]
  });
  const api = create({ columnDefs: definitions("计划"), rowData: [{ id: "1", a: "keep" }] });
  api.columns.move("b", 0);
  api.columns.move("e", 0);
  api.columns.setWidth("c", 250);
  api.columns.setPinned("e", "right");
  api.columns.setVisible("g", false);
  api.sorting.setModel([{ colId: "a", direction: "asc" }]);
  api.filtering.setQuickText("keep");
  api.selection.setById("1");
  const renamed = definitions("生产计划", true);
  api.columns.setDefinitions(renamed);
  expect(fieldOrder(api)).toEqual(["b", "a", "e", "d", "c", "f", "g"]);

  api.columns.resetState();

  expect(fieldOrder(api)).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
  expect(api.columns.getState().find(column => column.colId === "c")?.widthMode).toBe("auto");
  expect(api.columns.getState().find(column => column.colId === "e")?.pinned).toBeNull();
  expect(api.columns.getState().find(column => column.colId === "g")?.hide).toBe(false);
  expect(api.sorting.getModel()).toEqual([{ colId: "a", direction: "asc" }]);
  expect(api.filtering.getQuickText()).toBe("keep");
  expect(api.selection.getIds()).toEqual(["1"]);
  api.columns.setDefinitions(renamed);
  expect(fieldOrder(api)).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
});

it("keeps transaction-only rows through both column replacement entry points", () => {
  const api = create({ columnDefs: fields("a"), rowData: [{ id: "1", a: "first" }] });
  api.rows.transact({ add: [{ id: "2", b: "second" }] });

  api.updateOptions({ columnDefs: fields("a", "b") });
  expect(api.rows.getById("2")?.data).toEqual({ id: "2", b: "second" });

  api.columns.setDefinitions(fields("b"));
  expect(api.rows.getById("2")?.data).toEqual({ id: "2", b: "second" });
  expect(api.rows.getCount()).toBe(2);
});

const saved: GridStateInput = {
  version: 2,
  columns: [{ colId: "b", width: 250, widthMode: "manual" }, { colId: "a", width: 120, widthMode: "manual" }],
  sortModel: [],
  filterModel: {},
  advancedFilterModel: null,
  quickFilterText: null,
  pagination: { enabled: false, page: 1, pageSize: 20 },
  selectedRowIds: [],
  expandedRowIds: [],
  expandedGroupIds: []
};

it("restores synchronous layout preferences in the first projection of deferred columns and rows", () => {
  const onModelUpdated = vi.fn();
  const store = { load: vi.fn(() => saved), save: vi.fn() };
  const api = create({ onModelUpdated, persistence: { key: "report", store, sections: ["columns"] } });
  onModelUpdated.mockClear();

  api.updateOptions({ columnDefs: fields("a", "b"), rowData: [{ id: "1", a: "data" }] });

  expect(onModelUpdated).toHaveBeenCalledOnce();
  expect(fieldOrder(api)).toEqual(["b", "a"]);
  expect(api.columns.getState().find(column => column.colId === "b")?.width).toBe(250);
  expect(api.rows.getAt(0)?.data).toEqual({ id: "1", a: "data" });
});

it.each([false, true])("restores late grouped column preferences with an async store (%s)", async asynchronous => {
  const store = { load: vi.fn(() => asynchronous ? Promise.resolve(saved) : saved), save: vi.fn() };
  const api = create({ persistence: { key: "report", store, sections: ["columns"], debounceMs: 0 } });
  expect(store.load).not.toHaveBeenCalled();

  api.updateOptions({
    columnDefs: [{ headerName: "Details", children: fields("a", "b") }],
    rowData: [{ id: "1", a: "data" }]
  });
  await vi.waitFor(() => expect(fieldOrder(api)).toEqual(["b", "a"]));
  expect(api.columns.getState().find(column => column.colId === "b")?.width).toBe(250);
  expect(store.load).toHaveBeenCalledOnce();
  expect(store.save).not.toHaveBeenCalled();

  api.updateOptions({ columnDefs: [{ headerName: "Details", children: fields("a", "c", "b") }] });
  expect(fieldOrder(api)).toEqual(["b", "c", "a"]);
  api.columns.move("c", 0);
  api.columns.setDefinitions([{ headerName: "Details", children: fields("a", "c", "b") }]);
  expect(fieldOrder(api)).toEqual(["c", "b", "a"]);
  expect(store.load).toHaveBeenCalledOnce();
});

it("lets a real user change win over async preferences after the schema arrives", async () => {
  let resolve!: (value: GridStateInput) => void;
  const pending = new Promise<GridStateInput>(done => { resolve = done; });
  const api = create({ persistence: { key: "report", store: { load: () => pending, save: vi.fn() } } });
  api.updateOptions({ columnDefs: fields("a", "b") });
  api.columns.setWidth("b", 190);
  resolve(saved);
  await pending;
  expect(fieldOrder(api)).toEqual(["a", "b"]);
  expect(api.columns.getState().find(column => column.colId === "b")?.width).toBe(190);
});

it("does not write an empty layout or replace a user filter entered before the schema arrives", () => {
  const store = { load: vi.fn(() => saved), save: vi.fn() };
  const api = create({ persistence: { key: "report", store, debounceMs: 0 }, rowNumber: true });
  api.filtering.setQuickText("keep");
  expect(store.load).not.toHaveBeenCalled();
  expect(store.save).not.toHaveBeenCalled();

  api.updateOptions({ columnDefs: fields("a", "b"), rowData: [{ id: "1", a: "keep" }] });

  expect(api.filtering.getQuickText()).toBe("keep");
  expect(store.load).not.toHaveBeenCalled();
  expect(store.save).toHaveBeenCalledOnce();
});

it("prunes removed sort and filter IDs before the next datasource request", async () => {
  const getRows = vi.fn((params: InfiniteGetRowsParams) => params.onSuccess([], 0));
  const onFilterChanged = vi.fn();
  const onSortChanged = vi.fn();
  const api = create({ columnDefs: fields("a", "b"), datasource: { getRows }, onFilterChanged, onSortChanged });
  const retained = { kind: "condition", colId: "b", filter: equals("keep") } as const;
  api.filtering.setModel({ a: equals("remove"), b: equals("keep") });
  api.filtering.setAdvancedModel({ version: 1, root: {
    kind: "group", operator: "or", not: true,
    children: [{ kind: "condition", colId: "a", filter: equals("remove") }, retained]
  } });
  api.sorting.setModel([{ colId: "a", direction: "asc" }, { colId: "b", direction: "desc" }]);
  getRows.mockClear();
  onFilterChanged.mockClear();
  onSortChanged.mockClear();

  api.updateOptions({ columnDefs: fields("b", "c") });

  const expected = {
    sortModel: [{ colId: "b", direction: "desc" }],
    filterModel: { b: equals("keep") },
    advancedFilterModel: { version: 1, root: { kind: "group", operator: "or", not: true, children: [retained] } }
  };
  await vi.waitFor(() => expect(getRows).toHaveBeenCalledWith(expect.objectContaining(expected)));
  expect(onFilterChanged).toHaveBeenCalledOnce();
  expect(onSortChanged).toHaveBeenCalledOnce();
});

it("requests the first available schema only once with restored remote criteria", async () => {
  const getRows = vi.fn((params: InfiniteGetRowsParams) => params.onSuccess([], 0));
  const filterModel = { b: equals("restored") };
  const store = { load: vi.fn(() => ({ ...saved, filterModel })), save: vi.fn() };
  const api = create({ datasource: { getRows }, persistence: { key: "report", store } });
  await vi.waitFor(() => expect(getRows).toHaveBeenCalledOnce());
  getRows.mockClear();

  api.updateOptions({ columnDefs: fields("a", "b") });

  await vi.waitFor(() => expect(getRows).toHaveBeenCalledOnce());
  expect(getRows).toHaveBeenCalledWith(expect.objectContaining({ filterModel }));
  expect(api.columns.getState().find(column => column.colId === "b")?.width).toBe(250);
});

it("does not reload the datasource for asynchronously restored layout preferences", async () => {
  const getRows = vi.fn((params: InfiniteGetRowsParams) => params.onSuccess([], 0));
  const store = { load: vi.fn(() => Promise.resolve(saved)), save: vi.fn() };
  const api = create({ datasource: { getRows }, persistence: { key: "report", store, sections: ["columns"] } });
  await vi.waitFor(() => expect(getRows).toHaveBeenCalledOnce());
  getRows.mockClear();

  api.updateOptions({ columnDefs: fields("a", "b") });

  await vi.waitFor(() => expect(api.columns.getState().find(column => column.colId === "b")?.width).toBe(250));
  expect(getRows).toHaveBeenCalledOnce();
});

it("normalizes a controlled advanced filter against the columns in the same update", () => {
  const api = create({ columnDefs: fields("a") });
  const advancedFilterModel = {
    version: 1,
    root: { kind: "condition", colId: "b", filter: equals("keep") }
  } as const;
  api.updateOptions({
    columnDefs: fields("b"),
    rowData: [{ id: "keep", b: "keep" }, { id: "hide", b: "hide" }],
    advancedFilterModel
  });
  expect(api.filtering.getAdvancedModel()).toEqual(advancedFilterModel);
  expect(api.rows.getCount()).toBe(1);
  expect(api.rows.getAt(0)?.data?.id).toBe("keep");
});
