// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMachTableCommands,
  createGrid,
  createLocalGridStateStore,
  defineMachTableConfig,
  mergeMachTableConfig,
  normalizeMachTableConfig,
  resolveMachTableGridOptions,
  validateGridOptions,
  type ColDef,
  type GridApi
} from "../index";

interface Row {
  id: string;
  profile: { code: number };
  name: string;
}

const rows: Row[] = [
  { id: "a", profile: { code: 101 }, name: "Alpha" },
  { id: "b", profile: { code: 102 }, name: "Beta" },
  { id: "c", profile: { code: 103 }, name: "Gamma" }
];
const columns: ColDef<Row>[] = [{ field: "name" }, { field: "profile.code", colId: "code" }];

function host(): HTMLElement {
  const element = document.createElement("div");
  Object.defineProperty(element, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(element, "clientHeight", { value: 400, configurable: true });
  document.body.appendChild(element);
  return element;
}

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  document.body.replaceChildren();
});

describe("0.14 progressive DX", () => {
  it("accepts a typed nested rowKey and keeps getRowId precedence", () => {
    const api = createGrid(host(), { columnDefs: columns, rowData: rows, rowKey: "profile.code" });
    expect(api.getNodeById("101")?.data?.id).toBe("a");
    expect(api.getRootElement()?.classList).toContain("mach-root");
    api.destroy();
    expect(api.getRootElement()).toBeNull();

    const explicit = createGrid(host(), {
      columnDefs: columns,
      rowData: rows,
      rowKey: "profile.code",
      getRowId: ({ data }) => `row:${data.id}`
    });
    expect(explicit.getNodeById("row:a")?.data?.profile.code).toBe(101);
    expect(explicit.getNodeById("101")).toBeUndefined();
    explicit.destroy();
  });

  it("renders an explicit error overlay before the empty state", () => {
    const root = host();
    const api = createGrid(root, { columnDefs: columns, rowData: [], error: new Error("offline") });
    expect(root.querySelector(".mach-overlay")?.getAttribute("role")).toBe("alert");
    expect(root.querySelector(".mach-overlay")?.textContent).toContain("数据加载失败");
    api.updateOptions({ error: null });
    expect(root.querySelector(".mach-overlay")?.textContent).toContain("暂无数据");
    api.destroy();
  });

  it("autoHeight renders all rows and follows runtime layout changes", () => {
    const root = host();
    const api = createGrid(root, {
      columnDefs: columns,
      rowData: rows,
      rowKey: "id",
      pagination: false,
      domLayout: "autoHeight"
    });
    expect(root.querySelectorAll('.mach-row[data-index]')).toHaveLength(3);
    expect(root.querySelector(".mach-root")?.classList).toContain("mach-dom-layout--auto-height");
    expect((root.querySelector(".mach-body") as HTMLElement).style.height).toBe("108px");
    api.updateOptions({ domLayout: "normal" });
    expect(root.querySelector(".mach-root")?.classList).not.toContain("mach-dom-layout--auto-height");
    api.destroy();
  });

  it("persists and restores full state through stateKey", () => {
    vi.useFakeTimers();
    const first: GridApi<Row> = createGrid(host(), {
      columnDefs: columns,
      rowData: rows,
      rowKey: "id",
      pagination: false,
      stateKey: "orders",
      stateSaveDebounceMs: 10
    });
    first.setSortModel([{ colId: "name", direction: "desc" }]);
    first.selectNodeById("b");
    vi.advanceTimersByTime(11);
    expect(localStorage.getItem("mach-table:grid-state:orders")).toBeTruthy();
    first.destroy();

    const second = createGrid(host(), {
      columnDefs: columns,
      rowData: rows,
      rowKey: "id",
      pagination: false,
      stateKey: "orders"
    });
    expect(second.getSortModel()).toEqual([{ colId: "name", direction: "desc" }]);
    expect(second.getSelectedIds()).toEqual(["b"]);
    second.destroy();
  });

  it("rejects oversized state payloads and diagnoses unsafe layout combinations", () => {
    const onError = vi.fn();
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    const store = createLocalGridStateStore({ storage, maxBytes: 1_024, onError });
    const huge = {
      version: 1 as const,
      columns: [], sortModel: [], filterModel: {}, quickFilterText: "x".repeat(2_000),
      pagination: { enabled: false, page: 1, pageSize: 20 },
      selectedRowIds: [], expandedRowIds: [], expandedGroupIds: []
    };
    store.save("huge", huge);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
    expect(validateGridOptions({ domLayout: "autoHeight", datasource: { getRows() {} } }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ option: "domLayout" })]));
  });

  it("shares layered configuration, presets, warnings and option provenance", () => {
    const inheritedWarning = vi.fn();
    const parent = normalizeMachTableConfig(defineMachTableConfig({
      defaults: { theme: "light", defaultColDef: { sortable: false } },
      columnTypes: { money: { align: "right" } },
      components: { cellRenderers: {} },
      presets: { list: { stripedRows: true, defaultColDef: { resizable: false } } },
      defaultPreset: "list",
      onConfigWarning: inheritedWarning
    }));
    const merged = mergeMachTableConfig(parent, {
      defaults: { size: "compact" },
      presets: {
        list: { defaultColDef: { editable: false } },
        editable: { editType: "fullRow" }
      }
    });
    const resolved = resolveMachTableGridOptions(
      merged,
      ["", "missing", "list", "editable"],
      { size: "large" }
    );
    expect(inheritedWarning).toHaveBeenCalledWith(expect.objectContaining({ code: "UNKNOWN_PRESET" }));
    expect(resolved.options.defaultColDef).toEqual({ sortable: false, resizable: false, editable: false });
    expect(resolved.options.editType).toBe("fullRow");
    expect(resolved.explain("size")).toEqual(expect.objectContaining({ source: "table props", value: "large" }));
    expect(resolved.explain("rowHeight")).toEqual(expect.objectContaining({ source: "MachTable built-in" }));

    const report = vi.fn();
    resolveMachTableGridOptions(merged, "unknown", {}, report);
    expect(report).toHaveBeenCalledOnce();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    resolveMachTableGridOptions(normalizeMachTableConfig(), "unknown", {});
    expect(warning).toHaveBeenCalledOnce();
  });

  it("provides framework-neutral commands with safe unavailable fallbacks", async () => {
    const fullscreenParent = document.createElement("section");
    const gridRoot = document.createElement("div");
    fullscreenParent.appendChild(gridRoot);
    const defaultFullscreen = vi.fn(async () => undefined);
    Object.defineProperty(fullscreenParent, "requestFullscreen", { value: defaultFullscreen });
    const api = {
      isDestroyed: vi.fn(() => false),
      getRootElement: vi.fn(() => gridRoot),
      setQuickFilter: vi.fn(),
      refreshCells: vi.fn(),
      isInfinite: vi.fn(() => false),
      reload: vi.fn(async () => undefined),
      openColumnWorkbench: vi.fn(),
      setGridOption: vi.fn(),
      resetColumnState: vi.fn(),
      undo: vi.fn(() => true),
      redo: vi.fn(() => true),
      canUndo: vi.fn(() => true),
      canRedo: vi.fn(() => false),
      getDataAsCsv: vi.fn(() => "id\n1")
    } as unknown as GridApi<Row>;
    const reload = vi.fn(async () => undefined);
    const fullscreen = { requestFullscreen: vi.fn(async () => undefined) } as unknown as HTMLElement;
    const commands = createMachTableCommands({ getApi: () => api, reload, getFullscreenElement: () => fullscreen });
    commands.search("alpha");
    await commands.refresh();
    commands.openColumns(document.createElement("button"));
    commands.setDensity("compact");
    commands.resetColumns();
    expect(commands.undo()).toBe(true);
    expect(commands.redo()).toBe(true);
    expect(commands.canUndo()).toBe(true);
    expect(commands.canRedo()).toBe(false);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    expect(commands.exportCsv("rows.csv")).toBe(true);
    expect(await commands.toggleFullscreen()).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
    expect(api.setQuickFilter).toHaveBeenCalledWith("alpha");
    expect(api.openColumnWorkbench).toHaveBeenCalledOnce();
    expect(api.setGridOption).toHaveBeenCalledWith("size", "compact");
    expect(api.resetColumnState).toHaveBeenCalledOnce();
    expect(fullscreen.requestFullscreen).toHaveBeenCalledOnce();

    const direct = createMachTableCommands({ getApi: () => api });
    await direct.refresh();
    expect(api.refreshCells).toHaveBeenCalledOnce();
    (api.isInfinite as ReturnType<typeof vi.fn>).mockReturnValue(true);
    await direct.refresh();
    expect(api.reload).toHaveBeenCalledOnce();
    expect(await direct.toggleFullscreen()).toBe(true);
    expect(defaultFullscreen).toHaveBeenCalledOnce();

    const unavailable = createMachTableCommands<Row>({ getApi: () => null });
    unavailable.search(null);
    await unavailable.refresh();
    expect(unavailable.undo()).toBe(false);
    expect(unavailable.redo()).toBe(false);
    expect(unavailable.canUndo()).toBe(false);
    expect(unavailable.canRedo()).toBe(false);
    expect(unavailable.exportCsv()).toBe(false);
    expect(await unavailable.toggleFullscreen()).toBe(false);
  });
});
