// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMachTableCommands,
  createGrid,
  createLocalGridStateStore,
  defineMachTableConfig,
  validateGridOptions,
  type ColDef,
  type GridApi,
  type GridState,
} from "../index";
import {
  mergeMachTableConfig,
  normalizeMachTableConfig,
  resolveMachTableGridOptions,
} from "../lib/configuration";

interface Row {
  id: string;
  profile: { code: number };
  name: string;
}

const rows: Row[] = [
  { id: "a", profile: { code: 101 }, name: "Alpha" },
  { id: "b", profile: { code: 102 }, name: "Beta" },
  { id: "c", profile: { code: 103 }, name: "Gamma" },
];
const columns: ColDef<Row>[] = [
  { field: "name" },
  { field: "profile.code", colId: "code" },
];

function host(): HTMLElement {
  const element = document.createElement("div");
  Object.defineProperty(element, "clientWidth", {
    value: 800,
    configurable: true,
  });
  Object.defineProperty(element, "clientHeight", {
    value: 400,
    configurable: true,
  });
  document.body.appendChild(element);
  return element;
}

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  document.body.replaceChildren();
});

describe("0.14 progressive DX", () => {
  it("accepts typed path and function row keys", () => {
    const api = createGrid(host(), {
      columnDefs: columns,
      rowData: rows,
      rowKey: "profile.code",
    });
    expect(api.rows.getById("101")?.data?.id).toBe("a");
    expect(api.view.getRoot()?.classList).toContain("mach-root");
    api.destroy();
    expect(api.view.getRoot()).toBeNull();

    const explicit = createGrid(host(), {
      columnDefs: columns,
      rowData: rows,
      rowKey: (row) => `row:${row.id}`,
    });
    expect(explicit.rows.getById("row:a")?.data?.profile.code).toBe(101);
    expect(explicit.rows.getById("101")).toBeUndefined();
    explicit.destroy();
  });

  it("renders an explicit error overlay before the empty state", () => {
    const root = host();
    const api = createGrid(root, {
      columnDefs: columns,
      rowData: [],
      error: new Error("offline"),
    });
    expect(root.querySelector(".mach-overlay")?.getAttribute("role")).toBe(
      "alert",
    );
    expect(root.querySelector(".mach-overlay")?.textContent).toContain(
      "数据加载失败",
    );
    api.updateOptions({ error: null });
    expect(root.querySelector(".mach-overlay")?.textContent).toContain(
      "暂无数据",
    );
    api.destroy();
  });

  it("autoHeight renders all rows and follows runtime layout changes", () => {
    const root = host();
    const api = createGrid(root, {
      columnDefs: columns,
      rowData: rows,
      rowKey: "id",
      pagination: false,
      domLayout: "autoHeight",
    });
    expect(root.querySelectorAll(".mach-row[data-index]")).toHaveLength(3);
    expect(root.querySelector(".mach-root")?.classList).toContain(
      "mach-dom-layout--auto-height",
    );
    expect((root.querySelector(".mach-body") as HTMLElement).style.height).toBe(
      "108px",
    );
    api.updateOptions({ domLayout: "normal" });
    expect(root.querySelector(".mach-root")?.classList).not.toContain(
      "mach-dom-layout--auto-height",
    );
    api.destroy();
  });

  it("autoHeight removes stale rows from every pane when a nonempty data set shrinks", () => {
    const root = host();
    const api = createGrid(root, {
      columnDefs: [
        { field: "id", pinned: "left" },
        { field: "name" },
        { field: "profile.code", pinned: "right" },
      ],
      rowData: rows,
      rowKey: "id",
      pagination: false,
      domLayout: "autoHeight",
      getRowHeight: ({ data }) => (data?.id === "b" ? 48 : 36),
    });
    const rowIds = (pane: string) =>
      [...root.querySelectorAll<HTMLElement>(`.mach-pane--${pane} .mach-row[data-id]`)]
        .map((row) => row.dataset.id);
    const panes = ["left", "center", "right"];
    const body = root.querySelector<HTMLElement>(".mach-body")!;
    for (const pane of panes) expect(rowIds(pane)).toEqual(["a", "b", "c"]);
    expect(body.style.height).toBe("120px");

    api.rows.setData(rows.slice(1, 2));
    for (const pane of panes) expect(rowIds(pane)).toEqual(["b"]);
    expect(body.style.height).toBe("48px");

    api.rows.setData(rows);
    for (const pane of panes) expect(rowIds(pane)).toEqual(["a", "b", "c"]);
    expect(body.style.height).toBe("120px");
    api.destroy();
  });

  it("expands the row pool on async data changes and releases hidden rich cells", () => {
    const root = host();
    const destroy = vi.fn();
    const api = createGrid(root, {
      columnDefs: [
        { field: "id", width: 100, pinned: "left" },
        { field: "name", width: 180, cellRenderer: () => ({ el: document.createElement("span"), destroy }) },
        { field: "profile.code", width: 100, pinned: "right" },
      ],
      rowKey: "id", pagination: false, domLayout: "autoHeight"
    });
    const current = [...rows, { ...rows[0], id: "d" }, { ...rows[0], id: "e" }];
    const renderedIds = (pane: string) => new Set(
      [...root.querySelectorAll<HTMLElement>(`.mach-pane--${pane} .mach-row[data-id]`)].map(row => row.dataset.id)
    );
    for (const data of [rows, current, rows.slice(0, 1)]) {
      api.rows.setData(data);
      for (const pane of ["left", "center", "right"]) {
        expect(renderedIds(pane)).toEqual(new Set(data.map(row => row.id)));
      }
    }
    destroy.mockClear();
    api.rows.setData([]);
    expect(destroy).toHaveBeenCalledTimes(1);
    api.destroy();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("caps the natural body height and returns to natural sizing after filtering", () => {
    const root = host();
    let rowHeight = 36;
    const getRowHeight = () => rowHeight;
    const api = createGrid(root, {
      columnDefs: [{ field: "name", width: 180 }],
      rowData: Array.from({ length: 500 }, (_, index) => ({ ...rows[0], id: String(index), name: `row ${index}` })),
      rowKey: "id", pagination: false, domLayout: "autoHeight", maxBodyHeight: 120, getRowHeight
    });
    const body = root.querySelector<HTMLElement>(".mach-body")!;
    const scroller = root.querySelector<HTMLElement>(".mach-body-viewport--scroll")!;
    Object.defineProperty(scroller, "clientHeight", { get: () => parseFloat(body.style.height) });
    api.view.refreshLayout();
    expect(body.style.height).toBe("120px");
    expect(scroller.style.overflowY).toBe("auto");
    expect(root.querySelectorAll(".mach-row[data-id]").length).toBeLessThan(30);
    api.filtering.setQuickText("row 499");
    expect(body.style.height).toBe("36px");
    expect(scroller.style.overflowY).toBe("");
    expect(root.querySelector(".mach-row[data-id]")?.getAttribute("data-id")).toBe("499");
    rowHeight = 72;
    api.updateOptions({ getRowHeight });
    expect(body.style.height).toBe("72px");
    rowHeight = 50;
    api.view.refreshLayout();
    expect(body.style.height).toBe("72px");
    api.updateOptions({ getRowHeight });
    expect(body.style.height).toBe("50px");
    api.filtering.setQuickText(null);
    api.updateOptions({ maxBodyHeight: 180 });
    expect(body.style.height).toBe("180px");
    expect(root.querySelectorAll(".mach-row[data-id]").length).toBeLessThan(30);
    api.destroy();
  });

  it("reclaims oversized auto-height pools while retaining the active rows", () => {
    const root = host();
    let mounted = 0;
    const cellRenderer = () => {
      mounted++;
      return { el: document.createElement("span"), destroy: () => { mounted--; } };
    };
    const data = Array.from({ length: 250 }, (_, index) => ({ ...rows[0], id: String(index) }));
    const api = createGrid(root, {
      columnDefs: [
        { field: "id", width: 100, pinned: "left" },
        { field: "name", width: 180, cellRenderer },
        { field: "profile.code", width: 100, pinned: "right" }
      ],
      rowData: data, rowKey: "id", pagination: false, domLayout: "autoHeight"
    });
    const paneRows = (pane: string) => root.querySelectorAll(`.mach-pane--${pane} .mach-row`);
    const first = paneRows("center")[0];
    expect(paneRows("center")).toHaveLength(250);
    expect(mounted).toBe(250);

    api.rows.setData(data.slice(0, 2));
    for (const pane of ["left", "center", "right"]) expect(paneRows(pane).length).toBeLessThan(20);
    expect(paneRows("center")[0]).toBe(first);
    expect(mounted).toBe(2);

    api.rows.setData(data);
    expect(root.querySelectorAll(".mach-pane--center .mach-row[data-index]")).toHaveLength(250);
    api.rows.setData([]);
    expect(paneRows("center").length).toBeLessThan(20);
    expect(root.querySelectorAll(".mach-row[data-index]")).toHaveLength(0);
    expect(mounted).toBe(0);
    api.destroy();
    expect(mounted).toBe(0);
  });

  it("reclaims a capped pool while preserving scrolled visible cells and editors", () => {
    const root = host();
    let mounted = 0;
    const api = createGrid(root, {
      columnDefs: [{ field: "name", width: 180, editable: true, cellRenderer: () => {
        mounted++;
        return { el: document.createElement("span"), destroy: () => { mounted--; } };
      } }],
      rowData: Array.from({ length: 250 }, (_, index) => ({ id: String(index), name: `row ${index}` })),
      rowKey: "id", pagination: false, domLayout: "autoHeight"
    });
    const body = root.querySelector<HTMLElement>(".mach-body")!;
    const viewport = root.querySelector<HTMLElement>(".mach-body-viewport--scroll")!;
    Object.defineProperty(viewport, "clientHeight", { get: () => parseFloat(body.style.height) });
    api.updateOptions({ maxBodyHeight: 1200 });
    api.view.scrollToRow(100, "top");
    expect(api.editing.startCell({ rowIndex: 100, colId: "name" })).toBe(true);
    const editor = root.querySelector(".mach-editor-input");
    const cell = root.querySelector('.mach-row[data-id="100"] .mach-cell');
    api.updateOptions({ maxBodyHeight: 120 });
    expect(root.querySelectorAll(".mach-pane--center .mach-row").length).toBeLessThan(40);
    expect(mounted).toBeLessThan(40);
    expect(root.querySelector(".mach-editor-input")).toBe(editor);
    expect(root.querySelector('.mach-row[data-id="100"] .mach-cell')).toBe(cell);
    api.destroy();
    expect(mounted).toBe(0);
  });

  it("autoHeight releases overlay sizing after empty, loading and error states recover", () => {
    const root = host();
    const api = createGrid(root, {
      columnDefs: columns, rowData: [], rowKey: "id", pagination: false,
      domLayout: "autoHeight"
    });
    const grid = root.querySelector(".mach-root")!;
    const body = root.querySelector<HTMLElement>(".mach-body")!;
    expect(grid.classList.contains("mach-has-overlay")).toBe(true);
    api.rows.setData(rows.slice(0, 1));
    expect(grid.classList.contains("mach-has-overlay")).toBe(false);
    expect(body.style.height).toBe("36px");
    api.updateOptions({ loading: true });
    expect(grid.classList.contains("mach-has-overlay")).toBe(true);
    api.updateOptions({ loading: false, error: "加载失败" });
    expect(grid.classList.contains("mach-has-overlay")).toBe(true);
    api.updateOptions({ error: null });
    expect(grid.classList.contains("mach-has-overlay")).toBe(false);
    expect(body.style.height).toBe("36px");
    api.rows.setData([]);
    expect(grid.classList.contains("mach-has-overlay")).toBe(true);
    api.destroy();
  });

  it("persists and restores selected state sections through one persistence option", () => {
    vi.useFakeTimers();
    const first: GridApi<Row> = createGrid(host(), {
      columnDefs: columns,
      rowData: rows,
      rowKey: "id",
      pagination: false,
      persistence: { key: "orders", debounceMs: 10 },
      rowSelection: "multiple",
    });
    first.sorting.setModel([{ colId: "name", direction: "desc" }]);
    first.selection.setById("b");
    vi.advanceTimersByTime(11);
    expect(localStorage.getItem("mach-table:grid-state:orders")).toBeTruthy();
    first.destroy();

    const second = createGrid(host(), {
      columnDefs: columns,
      rowData: rows,
      rowKey: "id",
      pagination: false,
      persistence: { key: "orders" },
      rowSelection: "multiple",
    });
    expect(second.sorting.getModel()).toEqual([
      { colId: "name", direction: "desc" },
    ]);
    expect(second.selection.getIds()).toEqual(["b"]);
    second.destroy();
  });

  it("does not let a late persistence load overwrite a newer user change", async () => {
    let resolveLoad!: (state: GridState | null) => void;
    const load = new Promise<GridState | null>((resolve) => {
      resolveLoad = resolve;
    });
    const api = createGrid(host(), {
      columnDefs: columns,
      rowData: rows,
      pagination: false,
      persistence: {
        key: "late-state",
        sections: ["sort"],
        debounceMs: 0,
        store: { load: () => load, save: vi.fn() },
      },
    });
    api.sorting.setModel([{ colId: "name", direction: "asc" }]);
    resolveLoad({
      version: 2,
      columns: [],
      sortModel: [{ colId: "name", direction: "desc" }],
      filterModel: {},
      advancedFilterModel: null,
      quickFilterText: null,
      pagination: { enabled: false, page: 1, pageSize: 20 },
      selectedRowIds: [],
      expandedRowIds: [],
      expandedGroupIds: [],
    });

    await load;
    await Promise.resolve();
    expect(api.sorting.getModel()).toEqual([
      { colId: "name", direction: "asc" },
    ]);
    api.destroy();
  });

  it("serializes asynchronous persistence writes and coalesces to the latest state", async () => {
    let finishFirst!: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const save = vi
      .fn()
      .mockImplementationOnce(() => firstWrite)
      .mockImplementation(() => undefined);
    const api = createGrid(host(), {
      columnDefs: columns,
      rowData: rows,
      pagination: false,
      persistence: {
        key: "ordered-state",
        sections: ["sort"],
        debounceMs: 0,
        store: { load: () => null, save },
      },
    });

    api.sorting.setModel([{ colId: "name", direction: "desc" }]);
    api.sorting.setModel([{ colId: "name", direction: "asc" }]);
    expect(save).toHaveBeenCalledOnce();
    finishFirst();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.lastCall?.[1]).toEqual(
      expect.objectContaining({
        sortModel: [{ colId: "name", direction: "asc" }],
      }),
    );
    api.destroy();
  });

  it("rejects oversized state payloads and diagnoses unsafe layout combinations", () => {
    const onError = vi.fn();
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    const store = createLocalGridStateStore({
      storage,
      maxBytes: 1_024,
      onError,
    });
    const huge = {
      version: 2 as const,
      columns: [],
      sortModel: [],
      filterModel: {},
      quickFilterText: "x".repeat(2_000),
      advancedFilterModel: null,
      pagination: { enabled: false, page: 1, pageSize: 20 },
      selectedRowIds: [],
      expandedRowIds: [],
      expandedGroupIds: [],
    };
    store.save("huge", huge);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
    expect(
      validateGridOptions({
        domLayout: "autoHeight",
        datasource: { getRows() {} },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ option: "domLayout" }),
      ]),
    );
  });

  it("shares layered configuration, presets, warnings and option provenance", () => {
    const inheritedWarning = vi.fn();
    const parent = normalizeMachTableConfig(
      defineMachTableConfig({
        defaults: { theme: "light", defaultColDef: { sortable: false } },
        columnTypes: { money: { align: "right" } },
        components: { cellRenderers: {} },
        presets: {
          list: { stripedRows: true, defaultColDef: { resizable: false } },
        },
        defaultPreset: "list",
        onConfigWarning: inheritedWarning,
      }),
    );
    const merged = mergeMachTableConfig(parent, {
      defaults: { size: "compact" },
      presets: {
        list: { defaultColDef: { editable: false } },
        editable: { editType: "fullRow" },
      },
    });
    const resolved = resolveMachTableGridOptions(
      merged,
      ["", "missing", "list", "editable"],
      { size: "large" },
    );
    expect(inheritedWarning).toHaveBeenCalledWith(
      expect.objectContaining({ code: "UNKNOWN_PRESET" }),
    );
    expect(resolved.options.defaultColDef).toEqual({
      sortable: false,
      resizable: false,
      editable: false,
    });
    expect(resolved.options.editType).toBe("fullRow");
    expect(resolved.explain("size")).toEqual(
      expect.objectContaining({ source: "table props", value: "large" }),
    );
    expect(resolved.explain("rowHeight")).toEqual(
      expect.objectContaining({ source: "MachTable built-in" }),
    );

    const report = vi.fn();
    resolveMachTableGridOptions(merged, "unknown", {}, report);
    expect(report).toHaveBeenCalledOnce();
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    resolveMachTableGridOptions(normalizeMachTableConfig(), "unknown", {});
    expect(warning).toHaveBeenCalledOnce();
  });

  it("provides framework-neutral commands with safe unavailable fallbacks", async () => {
    const fullscreenParent = document.createElement("section");
    const gridRoot = document.createElement("div");
    fullscreenParent.appendChild(gridRoot);
    const defaultFullscreen = vi.fn(async () => undefined);
    Object.defineProperty(fullscreenParent, "requestFullscreen", {
      value: defaultFullscreen,
    });
    const api = {
      isDestroyed: vi.fn(() => false),
      updateOptions: vi.fn(),
      batch: vi.fn((callback) => callback(api)),
      filtering: {
        setQuickText: vi.fn(),
        setModel: vi.fn(),
        setAdvancedModel: vi.fn(),
      },
      sorting: { setModel: vi.fn() },
      pagination: { setPage: vi.fn() },
      selection: { selectAll: vi.fn(), clear: vi.fn(), clearRange: vi.fn() },
      view: { getRoot: vi.fn(() => gridRoot), refreshCells: vi.fn() },
      rows: {
        isRemote: vi.fn(() => false),
        reload: vi.fn(async () => undefined),
      },
      columns: { openWorkbench: vi.fn(), resetState: vi.fn() },
      editing: {
        undo: vi.fn(() => true),
        redo: vi.fn(() => true),
        canUndo: vi.fn(() => true),
        canRedo: vi.fn(() => false),
      },
      io: { exportCsv: vi.fn(() => "id\n1") },
    } as unknown as GridApi<Row>;
    const reload = vi.fn(async () => undefined);
    const fullscreen = {
      requestFullscreen: vi.fn(async () => undefined),
    } as unknown as HTMLElement;
    const commands = createMachTableCommands({
      getApi: () => api,
      reload,
      getFullscreenElement: () => fullscreen,
    });
    commands.search("alpha");
    await commands.refresh();
    commands.openColumns(document.createElement("button"));
    commands.setDensity("compact");
    commands.selectAll();
    commands.clearSelection();
    commands.resetColumns();
    commands.resetView();
    expect(commands.undo()).toBe(true);
    expect(commands.redo()).toBe(true);
    expect(commands.canUndo()).toBe(true);
    expect(commands.canRedo()).toBe(false);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined,
    );
    expect(commands.exportCsv("rows.csv")).toBe(true);
    expect(await commands.toggleFullscreen()).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
    expect(api.filtering.setQuickText).toHaveBeenCalledWith("alpha");
    expect(api.columns.openWorkbench).toHaveBeenCalledOnce();
    expect(api.updateOptions).toHaveBeenCalledWith({ size: "compact" });
    expect(api.selection.selectAll).toHaveBeenCalledWith(true);
    expect(api.selection.clear).toHaveBeenCalledTimes(2);
    expect(api.selection.clearRange).toHaveBeenCalledTimes(2);
    expect(api.filtering.setModel).toHaveBeenCalledWith(null);
    expect(api.sorting.setModel).toHaveBeenCalledWith(null);
    expect(api.pagination.setPage).toHaveBeenCalledWith(1);
    expect(api.columns.resetState).toHaveBeenCalledTimes(2);
    expect(fullscreen.requestFullscreen).toHaveBeenCalledOnce();

    const direct = createMachTableCommands({ getApi: () => api });
    await direct.refresh();
    expect(api.view.refreshCells).toHaveBeenCalledOnce();
    (api.rows.isRemote as ReturnType<typeof vi.fn>).mockReturnValue(true);
    await direct.refresh();
    expect(api.rows.reload).toHaveBeenCalledOnce();
    expect(await direct.toggleFullscreen()).toBe(true);
    expect(defaultFullscreen).toHaveBeenCalledOnce();

    const unavailable = createMachTableCommands<Row>({ getApi: () => null });
    unavailable.search(null);
    await unavailable.refresh();
    unavailable.selectAll();
    unavailable.clearSelection();
    unavailable.resetView();
    expect(unavailable.undo()).toBe(false);
    expect(unavailable.redo()).toBe(false);
    expect(unavailable.canUndo()).toBe(false);
    expect(unavailable.canRedo()).toBe(false);
    expect(unavailable.exportCsv()).toBe(false);
    expect(await unavailable.toggleFullscreen()).toBe(false);
  });
});
