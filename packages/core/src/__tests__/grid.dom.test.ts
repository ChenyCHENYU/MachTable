// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createGrid } from "../index";
import type { GridApi, ColDef } from "../index";

interface Row {
  id: string;
  name: string;
  score: number;
}

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: String(i),
    name: `row-${count - i}`,
    score: count - i
  }));
}

const columnDefs: ColDef<Row>[] = [
  { field: "id", headerName: "ID" },
  { field: "name", headerName: "Name", editable: true },
  { field: "score", headerName: "Score", filter: "number" }
];

function createHost(): HTMLElement {
  const host = document.createElement("div");
  Object.defineProperty(host, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(host, "clientHeight", { value: 400, configurable: true });
  document.body.appendChild(host);
  return host;
}

function createStandardGrid(): { api: GridApi<Row>; host: HTMLElement } {
  const host = createHost();
  const api = createGrid<Row>(host, {
    columnDefs,
    rowData: makeRows(100),
    rowSelection: "multiple",
    pagination: false,
    rowKey: (row) => row.id
  });
  return { api, host };
}

describe("grid smoke (jsdom)", () => {
  it("creates dom skeleton and renders rows", () => {
    const { api, host } = createStandardGrid();

    const root = host.querySelector(".mach-root");
    expect(root).toBeTruthy();
    expect(root?.getAttribute("role")).toBe("grid");

    const headerCells = host.querySelectorAll(".mach-header-cell");
    expect(headerCells.length).toBe(3);
    expect(headerCells[0].textContent).toContain("ID");

    const rows = host.querySelectorAll(".mach-row");
    expect(rows.length).toBeGreaterThan(0);

    const firstRow = host.querySelector('.mach-row[data-index="0"]');
    expect(firstRow?.textContent).toContain("row-100");

    expect(api.rows.getCount()).toBe(100);
    api.destroy();
  });

  it("sorts via api and updates rendered cells", () => {
    const { api, host } = createStandardGrid();

    api.sorting.setModel([{ colId: "score", direction: "asc" }]);
    expect(api.sorting.getModel()).toEqual([{ colId: "score", direction: "asc" }]);
    const firstRow = host.querySelector('.mach-row[data-index="0"]');
    expect(firstRow?.textContent).toContain("row-1");

    api.sorting.setModel([]);
    const restored = host.querySelector('.mach-row[data-index="0"]');
    expect(restored?.textContent).toContain("row-100");
    api.destroy();
  });

  it("filters rows by column filter and quick filter", () => {
    const { api, host } = createStandardGrid();

    api.filtering.setModel({ score: { type: "number", conditions: [{ match: "lessThan", value: 10 }] } });
    expect(api.rows.getCount()).toBe(9);
    const overlayEl = host.querySelector(".mach-overlay") as HTMLElement | null;
    expect(overlayEl?.style.display || "none").toBe("none");

    api.filtering.setModel(null);
    expect(api.rows.getCount()).toBe(100);

    api.filtering.setQuickText("row-5");
    expect(api.rows.getCount()).toBe(11);

    api.filtering.setQuickText("no-such-value");
    expect(api.rows.getCount()).toBe(0);
    const overlay = host.querySelector(".mach-overlay") as HTMLElement;
    expect(overlay && overlay.style.display === "" || overlay?.style.display === "").toBeTruthy();

    api.filtering.setQuickText(null);
    expect(api.rows.getCount()).toBe(100);
    api.destroy();
  });

  it("selects rows and reports selection events", () => {
    const { api } = createStandardGrid();
    const listener = vi.fn();
    api.on("selectionChanged", listener);

    api.selection.setById("5");
    expect(api.selection.getRows().length).toBe(1);
    expect(api.selection.getRows()[0].id).toBe("5");
    expect(listener).toHaveBeenCalled();

    api.selection.selectAll(true);
    expect(api.selection.getRows().length).toBe(100);

    api.selection.clear();
    expect(api.selection.getRows().length).toBe(0);
    api.destroy();
  });

  it("edits a cell and updates data", () => {
    const { api } = createStandardGrid();
    const changeListener = vi.fn();
    api.on("cellValueChanged", changeListener);

    const ok = api.editing.startCell({ rowIndex: 0, colId: "name" });
    expect(ok).toBe(true);

    const input = document.querySelector<HTMLInputElement>(".mach-editor-input");
    expect(input).toBeTruthy();
    input!.value = "edited";
    api.editing.stop();

    expect(changeListener).toHaveBeenCalledTimes(1);
    expect(changeListener.mock.calls[0][0].newValue).toBe("edited");
    const node = api.rows.getById("0");
    expect(node?.data?.name).toBe("edited");
    api.destroy();
  });

  it("exports csv", () => {
    const { api } = createStandardGrid();
    api.sorting.setModel([{ colId: "score", direction: "asc" }]);
    const csv = api.io.exportCsv();
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("ID,Name,Score");
    expect(lines[1]).toBe("99,row-1,1");
    expect(lines.length).toBe(101);
    api.destroy();
  });

  it("applies transactions add/update/remove", () => {
    const { api } = createStandardGrid();

    api.rows.transact({ update: [{ id: "0", name: "updated", score: 999 }] });
    expect(api.rows.getById("0")?.data?.name).toBe("updated");

    api.rows.transact({ remove: [{ id: "0", name: "updated", score: 999 }] });
    expect(api.rows.getById("0")).toBeUndefined();
    expect(api.rows.getCount()).toBe(99);

    api.rows.transact({ add: [{ id: "new", name: "new-row", score: 1 }], addIndex: 0 });
    expect(api.rows.getCount()).toBe(100);
    expect(api.rows.getAt(0)?.id).toBe("new");
    api.destroy();
  });

  it("manages column state: visibility, move, pin, width", () => {
    const { api, host } = createStandardGrid();

    api.columns.setVisible("name", false);
    expect(host.querySelectorAll(".mach-header-cell").length).toBe(2);

    api.columns.setVisible("name", true);
    api.columns.move("score", 0);
    expect(api.columns.getState()[0].colId).toBe("score");

    api.columns.setPinned("score", "left");
    const state = api.columns.getState();
    const scoreState = state.find((s) => s.colId === "score");
    expect(scoreState?.pinned).toBe("left");

    api.columns.autoSize("name");
    expect(typeof api.columns.getState().find((s) => s.colId === "name")?.width).toBe("number");
    api.destroy();
  });

  it("supports size presets and visual options", () => {
    const host = createHost();
    const api = createGrid<Row>(host, {
      columnDefs,
      rowData: makeRows(10),
      size: "compact",
      stripedRows: true,
      showCellBorders: true
    });
    const root = host.querySelector(".mach-root") as HTMLElement;
    expect(root.classList.contains("mach-size--compact")).toBe(true);
    expect(root.classList.contains("mach-striped")).toBe(true);
    expect(root.classList.contains("mach-cell-borders")).toBe(true);
    expect(root.style.getPropertyValue("--mach-row-h")).toBe("30px");

    const oddRow = host.querySelector('.mach-row[data-index="1"]');
    expect(oddRow?.classList.contains("mach-row--odd")).toBe(true);

    api.updateOptions({ size: "large", stripedRows: false, showCellBorders: false });
    expect(root.classList.contains("mach-size--large")).toBe(true);
    expect(root.classList.contains("mach-size--compact")).toBe(false);
    expect(root.classList.contains("mach-striped")).toBe(false);
    expect(root.classList.contains("mach-cell-borders")).toBe(false);
    expect(root.style.getPropertyValue("--mach-row-h")).toBe("44px");
    api.destroy();
  });

  it("cleans up on destroy", () => {
    const host = createHost();
    const api = createGrid<Row>(host, { columnDefs, rowData: makeRows(10) });
    api.destroy();
    expect(host.querySelector(".mach-root")).toBeNull();
    expect(api.isDestroyed()).toBe(true);
  });
});
