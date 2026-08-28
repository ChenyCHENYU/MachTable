// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createGrid, toTsv, parseTsv } from "../index";
import type { GridApi, ColDef } from "../index";

interface Row {
  id: string;
  name: string;
  score: number;
  note?: string;
}

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: String(i), name: `n${i}`, score: i + 1 }));
}

function createHost(): HTMLElement {
  const host = document.createElement("div");
  Object.defineProperty(host, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(host, "clientHeight", { value: 400, configurable: true });
  document.body.appendChild(host);
  return host;
}

function createRangeGrid(overrides: Partial<Parameters<typeof createGrid<Row>>[1]> = {}) {
  const host = createHost();
  const columnDefs: ColDef<Row>[] = [
    { field: "id", headerName: "ID", width: 80 },
    { field: "name", headerName: "Name", width: 120, editable: true },
    { field: "score", headerName: "Score", width: 100, editable: true, type: "rightAligned" }
  ];
  const api: GridApi<Row> = createGrid<Row>(host, {
    columnDefs,
    rowData: makeRows(6),
    enableRangeSelection: true,
    getRowId: (p) => p.data.id,
    ...overrides
  });
  return { api, host };
}

function cellAt(host: HTMLElement, row: number, colId: string): HTMLElement {
  const rowEl = host.querySelector(`.mach-row[data-index="${row}"]`);
  const cell = rowEl?.querySelector(`.mach-cell[data-col-id="${colId}"]`);
  if (!cell) throw new Error(`cell ${row}/${colId} not found`);
  return cell as HTMLElement;
}

describe("tsv codec", () => {
  it("escapes and round-trips special characters", () => {
    const rows = [["a\tb", 'say "hi"', "line1\nline2", "plain"]];
    const tsv = toTsv(rows);
    expect(tsv).toBe('"a\tb"\t"say ""hi"""\t"line1\nline2"\tplain');
    expect(parseTsv(tsv)).toEqual(rows);
  });

  it("parses crlf rows and trailing cells", () => {
    expect(parseTsv("a\tb\r\nc\td")).toEqual([["a", "b"], ["c", "d"]]);
    expect(parseTsv("solo")).toEqual([["solo"]]);
    expect(parseTsv("")).toEqual([]);
  });
});

describe("range selection", () => {
  it("selects range via mousedown + mouseover drag", () => {
    const { api, host } = createRangeGrid();
    cellAt(host, 0, "name").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    cellAt(host, 2, "score").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    window.dispatchEvent(new MouseEvent("mouseup"));

    const range = api.getRangeSelection();
    expect(range).toEqual({ row1: 0, row2: 2, colId1: "name", colId2: "score" });
    expect(host.querySelectorAll(".mach-cell--range").length).toBe(6);
    expect(host.querySelectorAll(".mach-cell--range-top").length).toBe(2);
    api.destroy();
  });

  it("extends range with shift+arrow and cancels with escape", () => {
    const { api, host } = createRangeGrid();
    cellAt(host, 1, "id").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    const root = host.querySelector(".mach-root") as HTMLElement;
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true, cancelable: true }));
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: true, bubbles: true, cancelable: true }));

    expect(api.getRangeSelection()).toEqual({ row1: 1, row2: 2, colId1: "id", colId2: "name" });

    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(api.getRangeSelection()).toBeNull();
    expect(host.querySelectorAll(".mach-cell--range").length).toBe(0);
    api.destroy();
  });

  it("emits rangeSelectionChanged events", () => {
    const listener = vi.fn();
    const { api, host } = createRangeGrid();
    api.addEventListener("rangeSelectionChanged", listener);
    cellAt(host, 0, "name").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].range).toEqual({ row1: 0, row2: 0, colId1: "name", colId2: "name" });
    api.destroy();
  });
});

describe("clipboard copy/paste", () => {
  it("copy event writes tsv of the range", () => {
    const { api, host } = createRangeGrid();
    cellAt(host, 0, "id").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    cellAt(host, 1, "name").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    let captured = "";
    const ev = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "clipboardData", {
      value: { setData: (_type: string, value: string) => (captured = value) }
    });
    (host.querySelector(".mach-root") as HTMLElement).dispatchEvent(ev);

    expect(captured).toBe("0\tn0\n1\tn1");
    expect(ev.defaultPrevented).toBe(true);
    api.destroy();
  });

  it("cut copies and clears editable cells", () => {
    const { api, host } = createRangeGrid();
    cellAt(host, 0, "name").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    cellAt(host, 1, "name").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    let captured = "";
    const ev = new Event("cut", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "clipboardData", {
      value: { setData: (_type: string, value: string) => (captured = value) }
    });
    (host.querySelector(".mach-root") as HTMLElement).dispatchEvent(ev);

    expect(captured).toBe("n0\nn1");
    expect(api.getNodeById("0")?.data?.name).toBeNull();
    expect(api.getNodeById("1")?.data?.name).toBeNull();
    expect(api.getNodeById("0")?.data?.score).toBe(1);
    api.destroy();
  });

  it("paste writes values into editable cells with numeric coercion", () => {
    const changed = vi.fn();
    const { api, host } = createRangeGrid({ onCellValueChanged: changed });
    cellAt(host, 0, "name").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));

    const ev = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "clipboardData", {
      value: { getData: () => "pasted\t42\nrows2\t7" }
    });
    (host.querySelector(".mach-root") as HTMLElement).dispatchEvent(ev);

    expect(api.getNodeById("0")?.data?.name).toBe("pasted");
    expect(api.getNodeById("0")?.data?.score).toBe(42);
    expect(api.getNodeById("1")?.data?.name).toBe("rows2");
    expect(api.getNodeById("1")?.data?.score).toBe(7);
    expect(changed).toHaveBeenCalledTimes(4);

    const row0 = host.querySelector('.mach-row[data-index="0"]');
    expect(row0?.textContent).toContain("pasted");
    api.destroy();
  });

  it("delete key clears editable range cells only", () => {
    const { api, host } = createRangeGrid();
    cellAt(host, 0, "name").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    cellAt(host, 1, "score").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    (host.querySelector(".mach-root") as HTMLElement).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true })
    );

    expect(api.getNodeById("0")?.data?.name).toBeNull();
    expect(api.getNodeById("1")?.data?.score).toBeNull();
    expect(api.getNodeById("0")?.data?.id).toBe("0");
    api.destroy();
  });

  it("suppressClipboard disables copy and paste handlers", () => {
    const { api, host } = createRangeGrid({ suppressClipboard: true });
    cellAt(host, 0, "name").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));

    let captured = "";
    const copyEv = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(copyEv, "clipboardData", {
      value: { setData: (_t: string, v: string) => (captured = v) }
    });
    (host.querySelector(".mach-root") as HTMLElement).dispatchEvent(copyEv);
    expect(captured).toBe("");

    const pasteEv = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEv, "clipboardData", { value: { getData: () => "x" } });
    (host.querySelector(".mach-root") as HTMLElement).dispatchEvent(pasteEv);
    expect(api.getNodeById("0")?.data?.name).toBe("n0");
    api.destroy();
  });
});

describe("context menu", () => {
  it("opens built-in menu with locale items and closes on escape", () => {
    const { api, host } = createRangeGrid({ contextMenu: true });
    cellAt(host, 0, "name").dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 20 })
    );

    const menu = document.querySelector(".mach-context-menu") as HTMLElement;
    expect(menu).toBeTruthy();
    const items = Array.from(menu.querySelectorAll("button")).map((b) => b.textContent);
    expect(items).toContain("复制");
    expect(items).toContain("粘贴");
    expect(items).toContain("清除内容");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".mach-context-menu")).toBeNull();
    api.destroy();
  });
});

describe("column virtualization", () => {
  it("only renders visible columns for wide grids", () => {
    const host = createHost();
    const manyCols: ColDef<Row>[] = Array.from({ length: 60 }, (_, i) => ({
      colId: `c${i}`,
      field: "name",
      headerName: `Col${i}`,
      width: 120
    }));
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: manyCols,
      rowData: makeRows(10),
      getRowId: (p) => p.data.id
    });

    const viewport = host.querySelector(".mach-body-viewport--scroll") as HTMLElement;
    Object.defineProperty(viewport, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(viewport, "scrollLeft", { value: 0, configurable: true, writable: true });
    api.refreshLayout();

    const row0 = host.querySelector('.mach-row[data-index="0"]') as HTMLElement;
    const cells = Array.from(row0.querySelectorAll(".mach-cell")) as HTMLElement[];
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.length).toBeLessThan(30);
    expect(cells.every((c) => c.style.display !== "none")).toBe(true);

    Object.defineProperty(viewport, "scrollLeft", { value: 3600, configurable: true });
    api.refreshLayout();
    const row0b = host.querySelector('.mach-row[data-index="0"]') as HTMLElement;
    const cellsB = Array.from(row0b.querySelectorAll(".mach-cell")) as HTMLElement[];
    expect(cellsB.length).toBeLessThan(30);
    const firstVisibleCol = cellsB[0].dataset.colId;
    expect(Number(firstVisibleCol?.slice(1))).toBeGreaterThanOrEqual(25);
    api.destroy();
  });

  it("renders all columns when grid fits viewport", () => {
    const host = createHost();
    const cols: ColDef<Row>[] = Array.from({ length: 25 }, (_, i) => ({
      colId: `c${i}`,
      field: "name",
      headerName: `Col${i}`,
      width: 20
    }));
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: cols,
      rowData: makeRows(3),
      getRowId: (p) => p.data.id
    });
    const row0 = host.querySelector('.mach-row[data-index="0"]') as HTMLElement;
    const hidden = Array.from(row0.querySelectorAll(".mach-cell")).filter((c) => (c as HTMLElement).style.display === "none");
    expect(hidden.length).toBe(0);
    api.destroy();
  });
});
