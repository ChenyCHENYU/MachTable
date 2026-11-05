// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { buildColDefsFromSchema, createGrid, indexColumn, selectionColumn, validateGridOptions } from "../index";
import type { GridApi, ColDef } from "../index";

interface Row {
  id: string;
  name: string;
  score: number;
}

const rows: Row[] = [
  { id: "1", name: "a", score: 1 },
  { id: "2", name: "b", score: 2 },
  { id: "3", name: "c", score: 3 }
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("align / headerAlign", () => {
  it("allows explicit align values to override the centered default", () => {
    const host = createHost();
    const columnDefs: ColDef<Row>[] = [
      { field: "name", headerName: "名称", align: "center" },
      { field: "score", headerName: "分数", align: "right" },
      { field: "id", headerName: "ID" }
    ];
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs,
      rowData: rows,
      pagination: false,
      rowKey: (row) => row.id
    });

    expect(cellAt(host, 0, "name").classList.contains("mach-cell--center")).toBe(true);
    expect(cellAt(host, 0, "score").classList.contains("mach-cell--right")).toBe(true);
    expect(cellAt(host, 0, "id").textContent).toBe("1");

    const centerHeader = host.querySelector('.mach-header-cell[data-col-id="name"]') as HTMLElement;
    const rightHeader = host.querySelector('.mach-header-cell[data-col-id="score"]') as HTMLElement;
    expect(centerHeader.classList.contains("mach-header-cell--center")).toBe(true);
    expect(rightHeader.classList.contains("mach-header-cell--right")).toBe(true);
    api.destroy();
  });

  it("centers headers and cells by default", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "score", headerName: "分数" }],
      rowData: rows,
      pagination: false,
      rowKey: (row) => row.id
    });
    expect(cellAt(host, 0, "score").classList.contains("mach-cell--center")).toBe(true);
    expect(host.querySelector('.mach-header-cell[data-col-id="score"]')?.classList.contains("mach-header-cell--center")).toBe(true);
    api.destroy();
  });

  it("centers schema numbers and respects explicit left alignment and rightAligned", () => {
    const host = createHost();
    const api = createGrid<Row>(host, {
      columnDefs: [
        ...buildColDefsFromSchema<Row>({ fields: [{ field: "score", type: "number" }] }),
        { field: "score", colId: "left", align: "left" },
        { field: "score", colId: "right", type: "rightAligned" }
      ],
      rowData: rows
    });
    expect(cellAt(host, 0, "score").classList.contains("mach-cell--center")).toBe(true);
    expect(cellAt(host, 0, "left").classList.contains("mach-cell--right")).toBe(false);
    expect(cellAt(host, 0, "left").classList.contains("mach-cell--center")).toBe(false);
    expect(cellAt(host, 0, "right").classList.contains("mach-cell--right")).toBe(true);
    api.destroy();
  });

  it("headerAlign overrides cell align for the header", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "name", headerName: "名称", align: "left", headerAlign: "center" }],
      rowData: rows,
      pagination: false,
      rowKey: (row) => row.id
    });
    const header = host.querySelector('.mach-header-cell[data-col-id="name"]') as HTMLElement;
    expect(header.classList.contains("mach-header-cell--center")).toBe(true);
    expect(cellAt(host, 0, "name").classList.contains("mach-cell--center")).toBe(false);
    api.destroy();
  });
});

describe("row numbers and pagination defaults", () => {
  it("keeps pagination on and supports opting into a UI-only number across pages", () => {
    const host = createHost();
    const rowData = Array.from({ length: 22 }, (_, index) => ({ id: String(index + 1) }));
    const api = createGrid(host, {
      columnDefs: [selectionColumn(), { field: "id", headerName: "编号" }],
      rowData,
      rowKey: "id"
    });
    expect(api.columns.getState().map(column => column.colId)).toEqual(["sel", "id"]);
    api.updateOptions({ rowNumber: true });
    expect(api.columns.getState().map(column => column.colId)).toEqual(["sel", "idx", "id"]);
    expect(api.state.get().columns.map(column => column.colId)).toEqual(["sel", "id"]);
    expect(api.columns.getDefinitions()).toHaveLength(2);
    expect(api.io.exportMatrix({ headersOnly: true })).toEqual([["编号"]]);
    expect(api.pagination.isEnabled()).toBe(true);
    expect(api.pagination.getPageSize()).toBe(20);
    expect(cellAt(host, 0, "idx").textContent).toBe("1");
    api.pagination.setPage(2);
    expect(cellAt(host, 0, "idx").textContent).toBe("21");
    api.updateOptions({ rowNumber: false, pagination: false });
    expect(api.columns.getState().map(column => column.colId)).toEqual(["sel", "id"]);
    expect(api.pagination.isEnabled()).toBe(false);
    api.destroy();
  });

  it("keeps explicit index definitions and business IDs independent of auto numbering", () => {
    const host = createHost();
    const api = createGrid(host, {
      columnDefs: [{ field: "idx" }],
      rowData: [{ idx: "Business ID" }],
      rowNumber: true
    });
    expect(cellAt(host, 0, "idx").textContent).toBe("Business ID");
    expect(cellAt(host, 0, "idx_2").textContent).toBe("1");
    api.updateOptions({
      rowNumber: false,
      columnDefs: [{ headerName: "订单", children: [indexColumn({ colId: "explicit" }), { field: "idx" }] }]
    });
    expect(api.columns.getState().map(column => column.colId)).toEqual(["explicit", "idx"]);
    expect(cellAt(host, 0, "explicit").textContent).toBe("1");
    api.updateOptions({ rowNumber: true });
    expect(api.columns.getState().map(column => column.colId)).toEqual(["explicit", "idx"]);
    api.destroy();
  });
});

describe("theme option", () => {
  it("theme dark applies dark class; runtime switch to light removes it", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "name", headerName: "名称" }],
      rowData: rows,
      pagination: false,
      theme: "dark"
    });
    const root = host.querySelector(".mach-root") as HTMLElement;
    expect(root.classList.contains("mach-theme-dark")).toBe(true);

    api.updateOptions({ theme: "light" });
    expect(root.classList.contains("mach-theme-dark")).toBe(false);
    api.updateOptions({ theme: "dark" });
    expect(root.classList.contains("mach-theme-dark")).toBe(true);
    api.destroy();
  });

  it("auto theme follows system preference and reacts to change", () => {
    const listeners: Array<() => void> = [];
    const mq: any = {
      matches: true,
      addEventListener: (_: string, fn: () => void) => listeners.push(fn),
      removeEventListener: () => undefined
    };
    const mm = vi.fn().mockReturnValue(mq);
    vi.stubGlobal("matchMedia", mm);

    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "name", headerName: "名称" }],
      rowData: rows,
      pagination: false,
      theme: "auto"
    });
    const root = host.querySelector(".mach-root") as HTMLElement;
    expect(root.classList.contains("mach-theme-dark")).toBe(true);
    expect(listeners.length).toBe(1);

    mq.matches = false;
    listeners[0]();
    expect(root.classList.contains("mach-theme-dark")).toBe(false);

    mq.matches = true;
    listeners[0]();
    expect(root.classList.contains("mach-theme-dark")).toBe(true);

    api.destroy();
    void mm;
  });

});

describe("status bar with pagination", () => {
  it("shows total row count instead of page size", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "name", headerName: "名称" }],
      rowData: Array.from({ length: 45 }, (_, i) => ({ id: String(i), name: `n${i}`, score: i })),
      rowSelection: "multiple",
      statusBar: true,
      rowKey: (row) => row.id
    });
    const bar = host.querySelector(".mach-statusbar") as HTMLElement;
    expect(api.rows.getCount()).toBe(20);
    expect(bar.textContent).toContain("共 45 行");
    api.destroy();
  });
});

describe("grid option validation", () => {
  it("suggests misspelled options and reports unsafe combinations", () => {
    expect(validateGridOptions({ rowHight: 40 } as any)).toEqual([
      expect.objectContaining({ code: "UNKNOWN_OPTION", option: "rowHight", suggestion: "rowHeight" })
    ]);
    const issues = validateGridOptions({
      datasource: { getRows: vi.fn() },
      pagination: { mode: "server", total: -1 }
    });
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "OPTION_CONFLICT",
      "MISSING_STABLE_ROW_ID",
      "INVALID_OPTION_VALUE"
    ]));
  });

  it("warns once for dynamic JavaScript mistakes and respects suppressWarnings", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const api = createGrid(createHost(), {
      columnDefs: [{ field: "id" }],
      rowData: rows,
      rowHight: 40
    } as any);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("rowHeight"));
    api.updateOptions({ rowHight: 50 } as any);
    expect(warning.mock.calls.filter(([message]) => String(message).includes("UNKNOWN_OPTION"))).toHaveLength(1);
    api.destroy();

    warning.mockClear();
    const quiet = createGrid(createHost(), {
      columnDefs: [{ field: "id" }],
      rowData: rows,
      rowHight: 40,
      suppressWarnings: true
    } as any);
    expect(warning).not.toHaveBeenCalled();
    quiet.destroy();
  });
});
