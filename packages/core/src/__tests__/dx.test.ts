// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { createGrid, validateGridOptions } from "../index";
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
  it("applies explicit align classes and falls back to numeric auto-right", () => {
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

  it("numeric columns still auto-right-align without explicit align", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "score", headerName: "分数" }],
      rowData: rows,
      pagination: false,
      rowKey: (row) => row.id
    });
    expect(cellAt(host, 0, "score").classList.contains("mach-cell--num")).toBe(true);
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

  it("legacy className mach-theme-dark still works without theme option", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "name", headerName: "名称" }],
      rowData: rows,
      pagination: false,
      className: "mach-theme-dark"
    });
    const root = host.querySelector(".mach-root") as HTMLElement;
    expect(root.classList.contains("mach-theme-dark")).toBe(true);
    api.destroy();
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
