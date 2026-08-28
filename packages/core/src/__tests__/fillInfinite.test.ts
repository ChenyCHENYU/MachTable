// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createGrid } from "../index";
import type { GridApi, GridDatasource } from "../index";

interface Row {
  id: string;
  name: string;
  score: number;
}

function makeRows(count: number, offset = 0): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `r${offset + i}`,
    name: `n${offset + i}`,
    score: offset + i + 1
  }));
}

function createHost(height = 400): HTMLElement {
  const host = document.createElement("div");
  Object.defineProperty(host, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(host, "clientHeight", { value: height, configurable: true });
  document.body.appendChild(host);
  return host;
}

function cellAt(host: HTMLElement, row: number, colId: string): HTMLElement {
  const rowEl = host.querySelector(`.mach-row[data-index="${row}"]`);
  const cell = rowEl?.querySelector(`.mach-cell[data-col-id="${colId}"]`);
  if (!cell) throw new Error(`cell ${row}/${colId} not found`);
  return cell as HTMLElement;
}

function selectRange(host: HTMLElement, r1: number, c1: string, r2: number, c2: string): void {
  cellAt(host, r1, c1).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  if (r2 !== r1 || c2 !== c1) {
    cellAt(host, r2, c2).dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  }
  window.dispatchEvent(new MouseEvent("mouseup"));
}

describe("fill handle", () => {
  function createFillGrid(editable = true) {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [
        { field: "name", headerName: "Name", width: 120, editable },
        { field: "score", headerName: "Score", width: 100, editable, type: "rightAligned" }
      ],
      rowData: makeRows(6),
      enableRangeSelection: true,
      getRowId: (p) => p.data.id
    });
    return { api, host };
  }

  it("copies single value down", () => {
    const changed = vi.fn();
    const { api, host } = createFillGrid();
    api.addEventListener("cellValueChanged", changed);

    selectRange(host, 0, "name", 0, "name");
    const handle = host.querySelector(".mach-fill-handle") as HTMLElement;
    expect(handle).toBeTruthy();
    expect(handle.style.display).toBe("");

    handle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientY: 3 * 36 }));
    window.dispatchEvent(new MouseEvent("mouseup", { clientY: 3 * 36 }));

    expect(api.getNodeById("r1")?.data?.name).toBe("n0");
    expect(api.getNodeById("r2")?.data?.name).toBe("n0");
    expect(api.getNodeById("r3")?.data?.name).toBe("n0");
    expect(changed).toHaveBeenCalledTimes(3);
    api.destroy();
  });

  it("extrapolates numeric sequence", () => {
    const { api, host } = createFillGrid();
    selectRange(host, 0, "score", 1, "score");

    const handle = host.querySelector(".mach-fill-handle") as HTMLElement;
    handle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientY: 3 * 36 + 10 }));
    window.dispatchEvent(new MouseEvent("mouseup", { clientY: 3 * 36 + 10 }));

    expect(api.getNodeById("r2")?.data?.score).toBe(3);
    expect(api.getNodeById("r3")?.data?.score).toBe(4);
    api.destroy();
  });

  it("cycles non-numeric multi-row pattern", () => {
    const { api, host } = createFillGrid();
    selectRange(host, 0, "name", 1, "name");

    const handle = host.querySelector(".mach-fill-handle") as HTMLElement;
    handle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientY: 3 * 36 + 10 }));
    window.dispatchEvent(new MouseEvent("mouseup", { clientY: 3 * 36 + 10 }));

    expect(api.getNodeById("r2")?.data?.name).toBe("n0");
    expect(api.getNodeById("r3")?.data?.name).toBe("n1");
    api.destroy();
  });

  it("hides when range cleared", () => {
    const { api, host } = createFillGrid();
    selectRange(host, 0, "name", 1, "name");
    const handle = host.querySelector(".mach-fill-handle") as HTMLElement;
    expect(handle.style.display).toBe("");

    api.clearRangeSelection();
    expect(handle.style.display).toBe("none");
    api.destroy();
  });

  it("skips non-editable cells", () => {
    const { api, host } = createFillGrid(false);
    selectRange(host, 0, "name", 0, "name");
    const handle = host.querySelector(".mach-fill-handle") as HTMLElement;
    handle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientY: 2 * 36 }));
    window.dispatchEvent(new MouseEvent("mouseup", { clientY: 2 * 36 }));

    expect(api.getNodeById("r1")?.data?.name).toBe("n1");
    api.destroy();
  });
});

describe("status bar", () => {
  it("shows row count, selected count and range aggregates", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [
        { field: "name", headerName: "Name", editable: true },
        { field: "score", headerName: "Score", editable: true }
      ],
      rowData: makeRows(6),
      rowSelection: "multiple",
      enableRangeSelection: true,
      statusBar: true,
      getRowId: (p) => p.data.id
    });

    const bar = host.querySelector(".mach-statusbar") as HTMLElement;
    expect(bar).toBeTruthy();
    expect(bar.textContent).toContain("共 6 行");

    api.selectNodeById("r0", true, false);
    api.selectNodeById("r1", true, false);
    expect(bar.textContent).toContain("已选 2 行");

    selectRange(host, 0, "score", 2, "score");
    expect(bar.textContent).toContain("和 6");

    api.updateOptions({ statusBar: false });
    expect(bar.style.display).toBe("none");
    api.destroy();
  });
});

describe("infinite scroll datasource", () => {
  const TOTAL = 200;
  const PAGE = 50;

  function newCapture(): { calls: any[] } {
    return { calls: [] };
  }

  function createInfinite(capture: { calls: any[] }) {
    const host = createHost(360);
    const datasource: GridDatasource<Row> = {
      getRows(params) {
        capture.calls.push(params);
        const rows = makeRows(Math.max(0, Math.min(PAGE, params.endRow - params.startRow)), params.startRow);
        setTimeout(() => params.onSuccess(rows, TOTAL), 0);
      }
    };
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [
        { field: "id", headerName: "ID", width: 100 },
        { field: "name", headerName: "Name" }
      ],
      datasource,
      blockSize: PAGE,
      getRowId: (p) => p.data.id
    });
    return { api, host };
  }

  function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 10));
  }

  it("loads first block and sizes scrollbar to server total", async () => {
    const capture = newCapture();
    const { api, host } = createInfinite(capture);
    await flush();

    expect(capture.calls.length).toBe(1);
    expect(capture.calls[0].startRow).toBe(0);
    expect(capture.calls[0].endRow).toBe(PAGE);
    expect(api.getDisplayedRowCount()).toBe(PAGE);

    const container = host.querySelector(".mach-row-container") as HTMLElement;
    expect(container.style.height).toBe(`${TOTAL * 36}px`);
    api.destroy();
  });

  it("prefetches next block when scrolling near the end", async () => {
    const capture = newCapture();
    const { api, host } = createInfinite(capture);
    await flush();

    const viewport = host.querySelector(".mach-body-viewport--scroll") as HTMLElement;
    Object.defineProperty(viewport, "clientHeight", { value: 360, configurable: true });
    Object.defineProperty(viewport, "scrollTop", { value: 40 * 36, configurable: true, writable: true });
    viewport.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    await flush();

    expect(capture.calls.length).toBeGreaterThanOrEqual(2);
    expect(capture.calls[1].startRow).toBe(PAGE);
    expect(api.getDisplayedRowCount()).toBe(PAGE * 2);
    api.destroy();
  });

  it("passes sortModel to datasource and reloads", async () => {
    const capture = newCapture();
    const { api } = createInfinite(capture);
    await flush();

    api.setSortModel([{ colId: "name", direction: "desc" }]);
    await flush();

    expect(capture.calls.length).toBe(2);
    expect(capture.calls[1].sortModel).toEqual([{ colId: "name", direction: "desc" }]);
    expect(capture.calls[1].startRow).toBe(0);
    api.destroy();
  });

  it("preserves selection by id across reload", async () => {
    const capture = newCapture();
    const { api } = createInfinite(capture);
    await flush();

    api.selectNodeById("r5");
    expect(api.getSelectedRows().length).toBe(1);

    api.reload();
    await flush();

    expect(api.getNodeById("r5")?.selected).toBe(true);
    expect(api.getSelectedRows().length).toBe(1);
    api.destroy();
  });

  it("renders index column correctly in infinite mode", async () => {
    const capture = newCapture();
    const host = createHost(360);
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [
        { colId: "idx", headerName: "#", type: "index", width: 60 },
        { field: "id", headerName: "ID", width: 100 }
      ],
      blockSize: PAGE,
      getRowId: (p) => p.data.id,
      datasource: {
        getRows(params) {
          capture.calls.push(params);
          const rows = makeRows(Math.max(0, Math.min(PAGE, params.endRow - params.startRow)), params.startRow);
          setTimeout(() => params.onSuccess(rows, TOTAL), 0);
        }
      }
    });
    await flush();

    const row0 = host.querySelector('.mach-row[data-index="0"]') as HTMLElement;
    const row1 = host.querySelector('.mach-row[data-index="1"]') as HTMLElement;
    const row5Node = api.getNodeById("r5");
    expect(row0?.textContent?.trimStart().startsWith("1")).toBe(true);
    expect(row1?.textContent?.trimStart().startsWith("2")).toBe(true);
    expect(row0?.textContent).toContain("r0");
    expect(row5Node?.rowIndex).toBe(5);
    api.destroy();
  });

  it("stops loading after lastRow is reached", async () => {
    const capture = newCapture();
    const { api, host } = createInfinite(capture);
    await flush();

    const viewport = host.querySelector(".mach-body-viewport--scroll") as HTMLElement;
    Object.defineProperty(viewport, "clientHeight", { value: 360, configurable: true });

    for (const scrollTop of [40 * 36, 90 * 36, 150 * 36, 190 * 36]) {
      Object.defineProperty(viewport, "scrollTop", { value: scrollTop, configurable: true });
      viewport.dispatchEvent(new Event("scroll"));
      await new Promise((resolve) => setTimeout(resolve, 25));
      await flush();
    }

    expect(api.getDisplayedRowCount()).toBe(TOTAL);
    const callsBefore = capture.calls.length;

    Object.defineProperty(viewport, "scrollTop", { value: 195 * 36, configurable: true });
    viewport.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(capture.calls.length).toBe(callsBefore);
    api.destroy();
  });
});
