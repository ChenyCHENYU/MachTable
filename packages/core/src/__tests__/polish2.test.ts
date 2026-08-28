// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createGrid } from "../index";
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
