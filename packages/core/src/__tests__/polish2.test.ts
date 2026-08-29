// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createColumnHelper, createEnterprisePreset, createGrid, createMachTablePreset } from "../index";
import type { GridApi, ColDef } from "../index";

interface Row {
  id: string;
  name: string;
  qty: number;
}

const rows: Row[] = [
  { id: "1", name: "a", qty: 1 },
  { id: "2", name: "b", qty: 2 },
  { id: "3", name: "c", qty: 3 }
];

function createHost(): HTMLElement {
  const host = document.createElement("div");
  Object.defineProperty(host, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(host, "clientHeight", { value: 400, configurable: true });
  document.body.appendChild(host);
  return host;
}

function cellAt(host: HTMLElement, row: number, colId: string): HTMLElement {
  const cells = host.querySelectorAll(`.mach-row[data-index="${row}"] .mach-cell[data-col-id="${colId}"]`);
  if (cells.length === 0) throw new Error(`cell ${row}/${colId} missing`);
  return cells[0] as HTMLElement;
}

function key(target: HTMLElement, init: KeyboardEventInit): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: false, cancelable: true, ...init }));
}

describe("header keyboard accessibility", () => {
  const defs: ColDef<Row>[] = [
    { field: "name", headerName: "名称", width: 120 },
    { field: "qty", headerName: "数量", width: 100 }
  ];

  it("header cells are focusable and Enter cycles sort", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: defs,
      rowData: rows,
      pagination: false,
      getRowId: (p) => p.data.id
    });
    const header = host.querySelector('.mach-header-cell[data-col-id="name"]') as HTMLElement;
    expect(header.tabIndex).toBe(0);

    header.focus();
    key(header, { key: "Enter" });
    expect(api.getSortModel()).toEqual([{ colId: "name", direction: "asc" }]);

    key(header, { key: "Enter", shiftKey: true });
    expect(api.getSortModel().length).toBe(1);
    expect(api.getSortModel()[0].direction).toBe("desc");

    key(header, { key: "Enter", shiftKey: true });
    expect(api.getSortModel().length).toBe(0);
    api.destroy();
  });

  it("Alt+Arrow resizes by 24px and emits finished resize", () => {
    const resized = vi.fn();
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: defs,
      rowData: rows,
      pagination: false,
      getRowId: (p) => p.data.id
    });
    api.addEventListener("columnResized", resized);

    const header = host.querySelector('.mach-header-cell[data-col-id="name"]') as HTMLElement;
    header.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, cancelable: true }));
    expect(resized).toHaveBeenCalledWith(expect.objectContaining({ colId: "name", width: 144, finished: true }));

    header.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true, cancelable: true }));
    expect(resized).toHaveBeenLastCalledWith(expect.objectContaining({ colId: "name", width: 120 }));
    api.destroy();
  });

  it("Ctrl+Arrow moves column when movable", () => {
    const moved = vi.fn();
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: defs,
      rowData: rows,
      pagination: false,
      getRowId: (p) => p.data.id
    });
    api.addEventListener("columnMoved", moved);
    const nameHeader = host.querySelector('.mach-header-cell[data-col-id="name"]') as HTMLElement;
    nameHeader.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", ctrlKey: true, cancelable: true })
    );
    expect(moved).toHaveBeenCalledWith(expect.objectContaining({ colId: "name" }));
    api.destroy();
  });

  it("suppressHeaderFocus removes tabindex", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: defs,
      rowData: rows,
      pagination: false,
      suppressHeaderFocus: true,
      getRowId: (p) => p.data.id
    });
    const header = host.querySelector('.mach-header-cell[data-col-id="name"]') as HTMLElement;
    expect(header.hasAttribute("tabindex")).toBe(false);
    api.destroy();
  });

  it("uses roving header focus with Arrow/Home/End navigation", () => {
    const host = createHost();
    const api = createGrid<Row>(host, { columnDefs: defs, rowData: rows, pagination: false });
    const name = host.querySelector('.mach-header-cell[data-col-id="name"]') as HTMLElement;
    const qty = host.querySelector('.mach-header-cell[data-col-id="qty"]') as HTMLElement;
    expect(name.tabIndex).toBe(0);
    expect(qty.tabIndex).toBe(-1);
    name.focus();
    key(name, { key: "ArrowRight" });
    expect(document.activeElement).toBe(qty);
    expect(qty.tabIndex).toBe(0);
    key(qty, { key: "Home" });
    expect(document.activeElement).toBe(name);
    api.destroy();
  });
});

describe("body keyboard and ARIA accessibility", () => {
  it("moves horizontally, exposes the active cell and lets Tab leave at the edge", () => {
    const host = createHost();
    const api = createGrid<Row>(host, {
      columnDefs: [
        { field: "name", width: 120, editable: true },
        { field: "qty", width: 100, editable: true }
      ],
      rowData: rows,
      pagination: false,
      rowSelection: "multiple",
      ariaLabel: "Inventory",
      getRowId: (p) => p.data.id
    });
    const root = host.querySelector('.mach-root') as HTMLElement;
    cellAt(host, 0, "name").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const right = new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true });
    root.dispatchEvent(right);
    expect(cellAt(host, 0, "qty").classList.contains("mach-cell--focus")).toBe(true);
    expect(root.getAttribute("aria-activedescendant")).toBe(cellAt(host, 0, "qty").id);
    expect(root.getAttribute("aria-label")).toBe("Inventory");

    cellAt(host, 2, "qty").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const tab = new KeyboardEvent("keydown", { key: "Tab", cancelable: true });
    root.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    api.destroy();
  });

  it("uses treegrid row semantics and span attributes", () => {
    const host = createHost();
    const tree = [{ id: "p", name: "parent", qty: 1, children: [{ id: "c", name: "child", qty: 2 }] }];
    const api = createGrid<any>(host, {
      columnDefs: [{ field: "name", colSpan: () => 2 }, { field: "qty" }],
      rowData: tree,
      treeData: true,
      defaultExpandAll: true,
      pagination: false,
      rowSelection: "multiple",
      getRowId: (p) => p.data.id
    });
    const root = host.querySelector('.mach-root') as HTMLElement;
    expect(root.getAttribute("role")).toBe("treegrid");
    expect(root.getAttribute("aria-multiselectable")).toBe("true");
    const firstRow = host.querySelector('.mach-row[data-index="0"]') as HTMLElement;
    expect(firstRow.getAttribute("aria-level")).toBe("1");
    expect(firstRow.getAttribute("aria-expanded")).toBe("true");
    expect(cellAt(host, 0, "name").getAttribute("aria-colspan")).toBe("2");
    api.destroy();
  });

  it("keeps focus styling when a checkbox click refreshes selection", () => {
    const host = createHost();
    const api = createGrid<Row>(host, {
      columnDefs: [{ colId: "select", checkboxSelection: true, width: 46 }, { field: "name" }],
      rowData: rows,
      rowSelection: "multiple",
      pagination: false,
      getRowId: (p) => p.data.id
    });
    const checkbox = host.querySelector('.mach-row[data-index="0"] .mach-row-checkbox') as HTMLInputElement;
    checkbox.click();
    expect(cellAt(host, 0, "select").classList.contains("mach-cell--focus")).toBe(true);
    expect((host.querySelector(".mach-root") as HTMLElement).getAttribute("aria-activedescendant"))
      .toBe(cellAt(host, 0, "select").id);
    api.destroy();
  });
});

describe("async transaction batching", () => {
  it("preserves transaction order and refreshes the model once", async () => {
    const host = createHost();
    const data = rows.map((row) => ({ ...row }));
    const api = createGrid<Row>(host, {
      columnDefs: [{ field: "name" }, { field: "qty" }],
      rowData: data,
      pagination: false,
      asyncTransactionWaitMillis: 0,
      getRowId: (p) => p.data.id
    });
    const updated = vi.fn();
    api.addEventListener("modelUpdated", updated);
    const p1 = api.applyTransactionAsync({ update: [{ id: "1", name: "first", qty: 10 }] });
    const p2 = api.applyTransactionAsync({ update: [{ id: "1", name: "second", qty: 20 }] });
    await Promise.all([p1, p2]);
    expect(api.getNodeById("1")?.data).toEqual({ id: "1", name: "second", qty: 20 });
    expect(updated).toHaveBeenCalledTimes(1);
    api.destroy();
  });
});

describe("versioned grid state", () => {
  it("round-trips columns, query, pagination and selection through initialState", () => {
    const sourceHost = createHost();
    const source = createGrid<Row>(sourceHost, {
      columnDefs: [{ field: "name" }, { field: "qty" }],
      rowData: rows,
      pagination: { pageSize: 1 },
      rowSelection: "multiple",
      getRowId: (p) => p.data.id
    });
    source.setSortModel([{ colId: "qty", direction: "desc" }]);
    source.setQuickFilter("b");
    source.selectNodeById("2", true, false);
    source.setPage(1);
    const state = source.getState();
    source.destroy();

    const targetHost = createHost();
    const target = createGrid<Row>(targetHost, {
      columnDefs: [{ field: "name" }, { field: "qty" }],
      rowData: rows,
      pagination: { pageSize: 20 },
      rowSelection: "multiple",
      initialState: state,
      getRowId: (p) => p.data.id
    });
    expect(target.getSortModel()).toEqual([{ colId: "qty", direction: "desc" }]);
    expect(target.getQuickFilter()).toBe("b");
    expect(target.getPageSize()).toBe(1);
    expect(target.getSelectedIds()).toEqual(["2"]);
    expect(target.getState()).toEqual(state);
    target.destroy();
  });
});

describe("enterprise DX helpers and change tracking", () => {
  it("builds typed nested columns and merges presets", () => {
    interface NestedRow { id: string; customer: { name: string }; }
    const helper = createColumnHelper<NestedRow>();
    const column = helper.accessor("customer.name", { headerName: "Customer" });
    expect(column.field).toBe("customer.name");
    const preset = createMachTablePreset<NestedRow>(
      createEnterprisePreset<NestedRow>(),
      { defaultColDef: { minWidth: 120 }, size: "compact" }
    );
    expect(preset.enableRangeSelection).toBe(true);
    expect(preset.defaultColDef).toEqual(expect.objectContaining({ filter: true, minWidth: 120 }));
  });

  it("merges semantic preset objects and composes event handlers", () => {
    const appReady = vi.fn();
    const routeReady = vi.fn();
    const preset = createMachTablePreset<any>(
      {
        pagination: { pageSize: 20, pageSizeOptions: [20, 50], showTotal: true },
        statusBar: { panels: ["rowCount"] },
        columnTypes: { money: { align: "right", filter: "number" } },
        onGridReady: appReady
      },
      {
        pagination: { pageSize: 50 },
        columnTypes: { status: { filter: "set" }, money: { editable: true } },
        onGridReady: routeReady
      }
    );
    expect(preset.pagination).toEqual({ pageSize: 50, pageSizeOptions: [20, 50], showTotal: true });
    expect(preset.statusBar).toEqual({ panels: ["rowCount"] });
    expect(preset.columnTypes).toEqual({
      money: { align: "right", filter: "number", editable: true },
      status: { filter: "set" }
    });
    preset.onGridReady?.({ api: {} as any, type: "gridReady" });
    expect(appReady).toHaveBeenCalledOnce();
    expect(routeReady).toHaveBeenCalledOnce();
  });

  it("applies named column types before local column overrides", () => {
    const api = createGrid<Row>(createHost(), {
      columnTypes: {
        numeric: { align: "right", filter: "number", editable: true },
        readonly: { editable: false }
      },
      columnDefs: [{ field: "qty", type: ["numeric", "readonly"], editable: true }],
      rowData: rows,
      pagination: false
    });
    const column = api.getColumnDefs()?.[0] as ColDef<Row>;
    expect(column.type).toEqual(["numeric", "readonly"]);
    const rendered = document.querySelector<HTMLElement>(".mach-cell[data-col-id='qty']");
    expect(rendered?.classList.contains("mach-cell--right")).toBe(true);
    expect(api.startEditingCell({ rowIndex: 0, colId: "qty" })).toBe(true);
    api.destroy();
  });

  it("tracks, rolls back and marks edited rows as saved", async () => {
    const host = createHost();
    const data = rows.map((row) => ({ ...row }));
    const dirty = vi.fn();
    const api = createGrid<Row>(host, {
      columnDefs: [{ field: "name", editable: true }, { field: "qty" }],
      rowData: data,
      pagination: false,
      getRowId: (p) => p.data.id,
      onDirtyStateChanged: dirty
    });
    await api.whenReady();
    const cell = cellAt(host, 0, "name");
    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const input = cell.querySelector("input") as HTMLInputElement;
    input.value = "edited";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(api.getDirtyRowIds()).toEqual(["1"]);
    expect(api.getChanges()[0]).toEqual(expect.objectContaining({
      rowId: "1",
      cells: [expect.objectContaining({ colId: "name", originalValue: "a", value: "edited" })]
    }));
    expect(api.rollbackChanges()).toBe(true);
    expect(data[0].name).toBe("a");
    expect(api.getDirtyRowIds()).toEqual([]);

    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const input2 = cell.querySelector("input") as HTMLInputElement;
    input2.value = "saved";
    input2.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    api.markChangesSaved(["1"]);
    expect(api.getChanges()).toEqual([]);
    expect(dirty).toHaveBeenCalled();
    api.destroy();
  });

  it("preserves edits made while an async save is in flight", async () => {
    const host = createHost();
    const data = [{ id: "1", name: "before", qty: 1 }];
    const api = createGrid<Row>(host, {
      columnDefs: [{ field: "name", editable: true }],
      rowData: data,
      pagination: false,
      getRowId: (p) => p.data.id
    });
    const editTo = async (value: string) => {
      expect(api.startEditingCell({ rowIndex: 0, colId: "name" })).toBe(true);
      (host.querySelector(".mach-editor-input") as HTMLInputElement).value = value;
      await api.stopEditingAsync();
    };

    await editTo("pending-save");
    let finishSave: (() => void) | undefined;
    const saving = api.saveChanges(() => new Promise<void>((resolve) => { finishSave = resolve; }));
    await editTo("newer-local-edit");
    finishSave?.();
    await expect(saving).resolves.toEqual([
      expect.objectContaining({ rowId: "1", cells: [expect.objectContaining({ value: "pending-save" })] })
    ]);
    expect(api.getChanges()[0].cells[0]).toEqual(expect.objectContaining({
      originalValue: "pending-save",
      value: "newer-local-edit"
    }));

    let finishSecond: (() => void) | undefined;
    const secondSave = api.saveChanges(() => new Promise<void>((resolve) => { finishSecond = resolve; }));
    await editTo("pending-save");
    expect(api.getChanges()).toEqual([]);
    finishSecond?.();
    await secondSave;
    expect(api.getChanges()[0].cells[0]).toEqual(expect.objectContaining({
      originalValue: "newer-local-edit",
      value: "pending-save"
    }));
    api.destroy();
  });
});

describe("diagnostics and lifecycle hygiene", () => {
  it("returns a support snapshot with stable error codes", () => {
    const host = createHost();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const api = createGrid<Row>(host, {
      columnDefs: [{
        field: "name",
        cellRenderer: () => { throw new Error("renderer exploded"); }
      }],
      rowData: rows,
      pagination: false,
      getRowId: (p) => p.data.id
    });
    const diagnostics = api.getDiagnostics();
    expect(diagnostics).toEqual(expect.objectContaining({
      destroyed: false,
      rowCount: 3,
      columnCount: 1,
      infinite: false
    }));
    expect(diagnostics.version).toMatch(/^0\./);
    expect(diagnostics.recentErrors[0]).toEqual(expect.objectContaining({
      code: "RENDERER_ERROR",
      source: "cellRenderer",
      message: "renderer exploded"
    }));
    api.destroy();
    consoleError.mockRestore();
  });

  it("balances global listeners across repeated mount/destroy cycles", () => {
    const active = new Map<string, Set<EventListenerOrEventListenerObject>>();
    const originalAdd = window.addEventListener.bind(window);
    const originalRemove = window.removeEventListener.bind(window);
    const add = vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
      const listeners = active.get(type) ?? new Set<EventListenerOrEventListenerObject>();
      listeners.add(listener);
      active.set(type, listeners);
      originalAdd(type, listener, options);
    });
    const remove = vi.spyOn(window, "removeEventListener").mockImplementation((type, listener, options) => {
      active.get(type)?.delete(listener);
      originalRemove(type, listener, options);
    });

    for (let index = 0; index < 20; index++) {
      const host = createHost();
      const api = createGrid<Row>(host, {
        columnDefs: [{ field: "name" }, { field: "qty" }],
        rowData: rows,
        pagination: false,
        getRowId: (p) => p.data.id
      });
      api.destroy();
      expect(host.childElementCount).toBe(0);
      host.remove();
    }

    expect([...active.values()].reduce((count, listeners) => count + listeners.size, 0)).toBe(0);
    add.mockRestore();
    remove.mockRestore();
  });
});

describe("dev validation warnings", () => {
  it("warns duplicate ids and missing field/getter", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [
        { colId: "dup", headerName: "A" },
        { colId: "dup", headerName: "B" },
        { field: "name", headerName: "Name" }
      ],
      rowData: rows,
      pagination: false,
      getRowId: (p) => p.data.id
    });
    const messages = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(messages).toContain('重复的 colId/field "dup"');
    expect(messages).toContain("既无 field 也无 valueGetter");
    warn.mockRestore();
    api.destroy();
  });

  it("same defs reference is not re-warned on structure change", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const host = createHost();
    const bad: ColDef<Row>[] = [{ colId: "bad", headerName: "无字段列" }];
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: bad,
      rowData: rows,
      pagination: false,
      getRowId: (p) => p.data.id
    });
    const afterCreate = warn.mock.calls.length;

    api.setColumnVisibility("bad", false);
    expect(warn.mock.calls.length).toBe(afterCreate);
    warn.mockRestore();
    api.destroy();
  });

  it("suppressWarnings silences config warnings but keeps treeData combo notice", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [
        { colId: "dupA", headerName: "A" },
        { colId: "dupA", headerName: "B" }
      ],
      rowData: rows,
      pagination: false,
      treeData: true,
      suppressWarnings: true
    });
    const machWarnings = warn.mock.calls.filter((c) => String(c[0]).includes("[mach-table]"));
    expect(machWarnings.length).toBe(0);
    warn.mockRestore();
    api.destroy();
  });
});

describe("horizontal fill handle", () => {
  interface FillRow {
    id: string;
    q1: number;
    q2: number;
    t1?: number;
    t2?: number;
  }

  it("per-row numeric extrapolation to the right", () => {
    const host = createHost();
    const data: FillRow[] = [
      { id: "r1", q1: 1, q2: 2 },
      { id: "r2", q1: 10, q2: 25 }
    ];
    const api: GridApi<FillRow> = createGrid<FillRow>(host, {
      columnDefs: [
        { colId: "q1", field: "q1", headerName: "Q1", width: 80, editable: true },
        { colId: "q2", field: "q2", headerName: "Q2", width: 80, editable: true },
        { colId: "t1", field: "t1", headerName: "T1", width: 80, editable: true },
        { colId: "t2", field: "t2", headerName: "T2", width: 80, editable: true }
      ],
      rowData: data,
      enableRangeSelection: true,
      fillHandle: true,
      getRowId: (p) => p.data.id
    });

    // 选择 2×2 源区域 Q1:Q2 × 行0:行1
    cellAt(host, 0, "q1").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    cellAt(host, 1, "q2").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    window.dispatchEvent(new MouseEvent("mouseup"));

    const handle = host.querySelector(".mach-fill-handle") as HTMLElement;
    handle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));

    // 向右拖至 t2 列右缘：x=320（4 列 × 80）
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 320, clientY: 20 }));
    window.dispatchEvent(new MouseEvent("mouseup", { clientX: 320, clientY: 20 }));

    // r1 [1,2] 等差1 → t1=3；r2 [10,25] 等差15 → t1=40
    expect(cellAt(host, 0, "t1").textContent).toBe("3");
    expect(cellAt(host, 1, "t1").textContent).toBe("40");

    // 填充柄随范围扩展到最右
    const handleAfter = host.querySelector(".mach-fill-handle") as HTMLElement;
    const expectedLeft = 4 * 80 - 4;
    expect(handleAfter.style.left).toBe(`${expectedLeft}px`);
    api.destroy();
  });

  it("cycles text values per row across columns", () => {
    const host = createHost();
    const data = [
      { id: "r1", a: "甲", b: "乙", c: "", d: "" },
      { id: "r2", a: "丙", b: "丁", c: "", d: "" }
    ];
    const api: GridApi<any> = createGrid<any>(host, {
      columnDefs: [
        { colId: "a", field: "a", headerName: "A", width: 70, editable: true },
        { colId: "b", field: "b", headerName: "B", width: 70, editable: true },
        { colId: "c", field: "c", headerName: "C", width: 70, editable: true },
        { colId: "d", field: "d", headerName: "D", width: 70, editable: true }
      ],
      rowData: data,
      enableRangeSelection: true,
      fillHandle: true,
      getRowId: (p) => p.data.id
    });

    cellAt(host, 0, "a").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    cellAt(host, 1, "b").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    window.dispatchEvent(new MouseEvent("mouseup"));

    const handle = host.querySelector(".mach-fill-handle") as HTMLElement;
    handle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 245, clientY: 60 }));
    window.dispatchEvent(new MouseEvent("mouseup", { clientX: 245, clientY: 60 }));

    expect(data[0].c).toBe("甲");
    expect(data[0].d).toBe("乙");
    expect(data[1].c).toBe("丙");
    expect(data[1].d).toBe("丁");
    api.destroy();
  });

  it("skips non-editable targets when filling right", () => {
    const host = createHost();
    const data: FillRow[] = [
      { id: "r1", q1: 5, q2: 9 }
    ];
    const api: GridApi<FillRow> = createGrid<FillRow>(host, {
      columnDefs: [
        { colId: "q1", field: "q1", headerName: "Q1", width: 80, editable: true },
        { colId: "q2", field: "q2", headerName: "锁死列", width: 80, editable: false },
        { colId: "t1", field: "t1", headerName: "T1", width: 80, editable: true }
      ],
      rowData: data,
      enableRangeSelection: true,
      fillHandle: true,
      getRowId: (p) => p.data.id
    });

    cellAt(host, 0, "q1").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    window.dispatchEvent(new MouseEvent("mouseup"));

    const handle = host.querySelector(".mach-fill-handle") as HTMLElement;
    handle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 240, clientY: 18 }));
    window.dispatchEvent(new MouseEvent("mouseup", { clientX: 240, clientY: 18 }));

    expect(data[0].q2).toBe(9);   // 只读列始终不被写入
    expect(data[0].t1).toBe(5);   // 单值复制继续向右侧可编辑列扩散
    api.destroy();
  });
});
