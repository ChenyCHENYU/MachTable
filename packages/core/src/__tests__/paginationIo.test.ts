// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createGrid, downloadFile } from "../index";
import type { GridApi, ColDef } from "../index";

interface Row {
  id: string;
  name: string;
  score: number;
}

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: `r${i}`, name: `n${i}`, score: i + 1 }));
}

function createHost(): HTMLElement {
  const host = document.createElement("div");
  Object.defineProperty(host, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(host, "clientHeight", { value: 400, configurable: true });
  document.body.appendChild(host);
  return host;
}

function createPagedGrid(rowCount: number, cfg: Record<string, any> = {}) {
  const host = createHost();
  const columnDefs: ColDef<Row>[] = [
    { colId: "idx", headerName: "#", type: "index", width: 60 },
    { field: "id", headerName: "ID", width: 90 },
    { field: "name", headerName: "Name" },
    { field: "score", headerName: "Score", width: 90, type: "rightAligned" }
  ];
  const api: GridApi<Row> = createGrid<Row>(host, {
    columnDefs,
    rowData: makeRows(rowCount),
    getRowId: (p) => p.data.id,
    pagination: { pageSize: 20, ...cfg }
  });
  return { api, host };
}

describe("pagination", () => {
  it("is enabled by default and slices rows by pageSize", () => {
    const { api, host } = createPagedGrid(55);
    expect(api.paginationEnabled()).toBe(true);
    expect(api.getDisplayedRowCount()).toBe(20);
    expect(api.getPageCount()).toBe(3);
    expect(api.getTotalRowCount()).toBe(55);

    const bar = host.querySelector(".mach-pagination") as HTMLElement;
    expect(bar).toBeTruthy();
    expect(bar.style.display).toBe("");
    expect(bar.textContent).toContain("共 55 条");
    expect(bar.textContent).toContain("1 / 3");
    api.destroy();
  });

  it("navigates pages via api and ui buttons with disabled bounds", () => {
    const { api, host } = createPagedGrid(45);
    expect(api.getPage()).toBe(1);
    expect(api.getRowNode(0)?.data?.id).toBe("r0");

    api.setPage(2);
    expect(api.getPage()).toBe(2);
    expect(api.getDisplayedRowCount()).toBe(20);
    expect(api.getRowNode(0)?.data?.id).toBe("r20");

    api.setPage(99);
    expect(api.getPage()).toBe(3);
    api.setPage(0);
    expect(api.getPage()).toBe(1);

    const next = host.querySelector(".mach-pagination-next") as HTMLButtonElement;
    const prev = host.querySelector(".mach-pagination-prev") as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    next.click();
    expect(api.getPage()).toBe(2);
    expect(prev.disabled).toBe(false);

    api.setPage(3);
    const last = host.querySelector(".mach-pagination-last") as HTMLButtonElement;
    expect(last.disabled).toBe(true);
    const first = host.querySelector(".mach-pagination-first") as HTMLButtonElement;
    first.click();
    expect(api.getPage()).toBe(1);
    api.destroy();
  });

  it("index column keeps absolute numbering across pages", () => {
    const { api, host } = createPagedGrid(45);
    api.setPage(2);
    const firstRow = host.querySelector('.mach-row[data-index="0"]') as HTMLElement;
    expect(firstRow.textContent?.trimStart().startsWith("21")).toBe(true);
    api.destroy();
  });

  it("setPageSize keeps first visible row in view and updates count", () => {
    const { api } = createPagedGrid(100);
    api.setPage(3);
    api.setPageSize(50);
    expect(api.getPageSize()).toBe(50);
    expect(api.getPage()).toBe(1);
    expect(api.getPageCount()).toBe(2);
    expect(api.getDisplayedRowCount()).toBe(50);
    api.destroy();
  });

  it("hides the bar when no rows or single short page via config off", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "id", headerName: "ID" }],
      rowData: [],
      getRowId: (p) => p.data.id
    });
    const bar = host.querySelector(".mach-pagination") as HTMLElement;
    expect(bar.style.display).toBe("none");
    api.destroy();

    const host2 = createHost();
    const api2: GridApi<Row> = createGrid<Row>(host2, {
      columnDefs: [{ field: "id", headerName: "ID" }],
      rowData: makeRows(8),
      pagination: false,
      getRowId: (p) => p.data.id
    });
    expect(api2.paginationEnabled()).toBe(false);
    expect(api2.getDisplayedRowCount()).toBe(8);
    const bar2 = host2.querySelector(".mach-pagination") as HTMLElement;
    expect(bar2.style.display).toBe("none");
    api2.destroy();
  });

  it("filters re-clamp page and keep pagination stable", () => {
    const { api } = createPagedGrid(45);
    api.setPage(3);
    api.setQuickFilter("n1");
    expect(api.getTotalRowCount()).toBe(11);
    expect(api.getPage()).toBe(1);
    expect(api.getDisplayedRowCount()).toBe(11);
    api.destroy();
  });

  it("csv export covers all pages, headersOnly emits header row only", () => {
    const { api } = createPagedGrid(45);
    const lines = api.getDataAsCsv().split("\r\n");
    expect(lines.length).toBe(46);

    const template = api.getDataAsCsv({ headersOnly: true }).split("\r\n");
    expect(template.length).toBe(1);
    expect(template[0]).toContain("ID");
    api.destroy();
  });

  it("runtime toggle via updateOptions", () => {
    const { api } = createPagedGrid(45);
    api.updateOptions({ pagination: false });
    expect(api.paginationEnabled()).toBe(false);
    expect(api.getDisplayedRowCount()).toBe(45);

    api.updateOptions({ pagination: { pageSize: 10 } });
    expect(api.paginationEnabled()).toBe(true);
    expect(api.getDisplayedRowCount()).toBe(10);
    expect(api.getPageCount()).toBe(5);
    api.destroy();
  });

  it("emits paginationChanged", () => {
    const listener = vi.fn();
    const { api } = createPagedGrid(45);
    api.addEventListener("paginationChanged", listener);
    api.setPage(2);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ page: 2, pageCount: 3, total: 45 }));
    api.destroy();
  });

  it("auto-disabled in infinite mode", async () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "id", headerName: "ID" }],
      blockSize: 30,
      getRowId: (p) => p.data.id,
      datasource: {
        getRows(params) {
          setTimeout(() => params.onSuccess(makeRows(30), 90), 0);
        }
      }
    });
    expect(api.paginationEnabled()).toBe(false);
    await new Promise((r) => setTimeout(r, 15));
    expect(api.getDisplayedRowCount()).toBe(30);
    api.destroy();
  });
});

describe("watermark", () => {
  it("renders pointer-free overlay when enabled and hides when off", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "id", headerName: "ID" }],
      rowData: makeRows(3),
      watermark: { text: "机密文件" }
    });
    const mark = host.querySelector(".mach-watermark") as HTMLElement;
    expect(mark).toBeTruthy();
    expect(mark.style.display).toBe("");
    expect(getComputedStyle(mark).pointerEvents).toBe("none");

    api.updateOptions({ watermark: false });
    expect(mark.style.display).toBe("none");
    api.destroy();
  });

  it("hidden by default", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "id", headerName: "ID" }],
      rowData: makeRows(3)
    });
    const mark = host.querySelector(".mach-watermark") as HTMLElement;
    expect(mark.style.display).toBe("none");
    api.destroy();
  });
});

describe("empty state", () => {
  it("shows built-in illustration with locale text", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "id", headerName: "ID" }],
      rowData: []
    });
    const empty = host.querySelector(".mach-empty") as HTMLElement;
    expect(empty).toBeTruthy();
    expect(empty.querySelector("svg")).toBeTruthy();
    expect(empty.textContent).toContain("暂无数据");
    expect(empty.textContent).toContain("没有可显示的行");
    api.destroy();
  });

  it("custom template overrides built-in", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "id", headerName: "ID" }],
      rowData: [],
      overlayNoRowsTemplate: '<div class="custom-empty">EMPTY</div>',
      allowUnsafeOverlayHtml: true
    });
    expect(host.querySelector(".custom-empty")).toBeTruthy();
    expect(host.querySelector(".mach-empty")).toBeNull();
    api.destroy();
  });
});

describe("print", () => {
  it("opens window with print document and returns true", () => {
    const written: string[] = [];
    const fakeWin: any = {
      document: {
        write: (html: string) => written.push(html),
        close: () => undefined
      },
      focus: () => undefined,
      print: () => undefined
    };
    const openSpy = vi.spyOn(window, "open").mockReturnValue(fakeWin);
    const { api } = createPagedGrid(45);
    const ok = api.print({ title: "设备清单" });
    expect(ok).toBe(true);
    expect(written.length).toBe(1);
    expect(written[0]).toContain("设备清单");
    expect(written[0]).toContain("<table>");
    expect(written[0]).toContain("n44");
    openSpy.mockRestore();
    api.destroy();
  });

  it("returns false when popup blocked", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const { api } = createPagedGrid(10);
    expect(api.print()).toBe(false);
    openSpy.mockRestore();
    api.destroy();
  });
});

describe("importCsv", () => {
  const csv = "ID,Name,Score\nr101,导入甲,88\nr102,导入乙,66";

  it("replace mode maps headers to fields with numeric coercion", () => {
    const { api } = createPagedGrid(3);
    expect(api.importCsv(csv)).toBe(true);
    expect(api.getTotalRowCount()).toBe(2);
    const first = api.getNodeById("r101");
    expect(first?.data).toBeTruthy();
    expect((first?.data as any).score).toBe(88);
    expect((first?.data as any).name).toBe("导入甲");
    api.destroy();
  });

  it("append mode adds to existing rows", () => {
    const { api } = createPagedGrid(3);
    api.importCsv(csv, { mode: "append" });
    expect(api.getTotalRowCount()).toBe(5);
    api.destroy();
  });

  it("paste mode routes through paste pipeline", () => {
    const { api } = createPagedGrid(10);
    api.setPage(1);
    api.importCsv(",,\nr103,粘贴行,50", { mode: "paste" });
    api.destroy();
  });

  it("returns false for empty input", () => {
    const { api } = createPagedGrid(3);
    expect(api.importCsv("")).toBe(false);
    api.destroy();
  });
});

describe("downloadFile", () => {
  it("creates anchor with blob url", () => {
    if (!("createObjectURL" in URL)) {
      Object.defineProperty(URL, "createObjectURL", {
        value: () => "blob:test",
        configurable: true
      });
    }
    const clickSpy = vi.fn();
    const anchor = document.createElement("a");
    anchor.click = clickSpy;
    const createSpy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "a") return anchor;
      return document.createElementNS("http://www.w3.org/1999/xhtml", tag) as any;
    });
    const urlSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    const ok = downloadFile("t.csv", "a,b", "text/csv");
    expect(ok).toBe(true);
    expect(clickSpy).toHaveBeenCalled();
    expect(anchor.download).toBe("t.csv");
    urlSpy.mockRestore();
    createSpy.mockRestore();
  });
});
