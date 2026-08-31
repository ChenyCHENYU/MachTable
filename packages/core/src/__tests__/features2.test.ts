// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  createGrid,
  sanitizeFormulaCell
} from "../index";
import type { GridApi } from "../index";

interface Row {
  id: string;
  name: string;
  score: number;
  at?: string;
  note?: string;
}

function makeRows(count: number, offset = 0): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: `r${offset + i}`, name: `n${offset + i}`, score: offset + i + 1 }));
}

function createHost(): HTMLElement {
  const host = document.createElement("div");
  Object.defineProperty(host, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(host, "clientHeight", { value: 400, configurable: true });
  document.body.appendChild(host);
  return host;
}

afterEach(() => {
  document.body.textContent = "";
});

describe("scoped components", () => {
  it("resolves a named cell renderer from grid components", () => {
    const boldName = (params: any) => `【${params.value}】`;
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [
        { field: "name", headerName: "Name", cellRenderer: "bold-name" },
        { field: "score", headerName: "Score" }
      ],
      rowData: makeRows(3),
      rowKey: (row) => row.id,
      components: { cellRenderers: { "bold-name": boldName } }
    });
    const row0 = host.querySelector('.mach-row[data-index="0"]') as HTMLElement;
    expect(row0.textContent).toContain("【n0】");
    api.destroy();
  });

  it("resolves a named cell editor from grid components", () => {
    const uppercase = (params: any) => {
      const input = document.createElement("input");
      input.className = "mach-editor-input custom-editor";
      input.value = String(params.value ?? "").toUpperCase();
      return {
        el: input,
        getValue: () => input.value,
        focus: () => input.focus()
      };
    };
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "name", headerName: "Name", editable: true, cellEditor: "uppercase" }],
      rowData: makeRows(2),
      rowKey: (row) => row.id,
      components: { cellEditors: { uppercase } }
    });
    api.editing.startCell({ rowIndex: 0, colId: "name" });
    const editor = host.querySelector(".custom-editor") as HTMLInputElement;
    expect(editor.value).toBe("N0");
    editor.value = "CHANGED";
    api.editing.stop();
    expect(api.rows.getById("r0")?.data?.name).toBe("CHANGED");
    api.destroy();
  });

  it("falls back silently for unregistered names", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "name", headerName: "Name", cellRenderer: "not-registered" }],
      rowData: makeRows(2),
      rowKey: (row) => row.id
    });
    const row0 = host.querySelector('.mach-row[data-index="0"]') as HTMLElement;
    expect(row0.textContent).toContain("n0");
    api.destroy();
  });
});

describe("getRowHeight + wrapText", () => {
  it("computes variable row heights in positions", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "name", headerName: "Name" }],
      rowData: makeRows(3),
      rowKey: (row) => row.id,
      getRowHeight: (p) => (Number(p.data?.id.slice(1)) === 1 ? 72 : 36)
    });
    const rows = Array.from(host.querySelectorAll(".mach-row[data-index]")) as HTMLElement[];
    const row1 = rows.find((r) => r.dataset.index === "1") as HTMLElement;
    expect(row1.style.height).toBe("72px");
    expect(api.rows.getAt(2)?.rowIndex).toBe(2);

    const container = host.querySelector(".mach-row-container") as HTMLElement;
    expect(container.style.height).toBe(`${36 + 72 + 36}px`);
    api.destroy();
  });

  it("applies wrap text cell class", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [
        { field: "name", headerName: "Name", wrapText: true },
        { field: "score", headerName: "Score" }
      ],
      rowData: makeRows(2),
      rowKey: (row) => row.id
    });
    const row0 = host.querySelector('.mach-row[data-index="0"]') as HTMLElement;
    const cells = row0.querySelectorAll(".mach-cell");
    expect(cells[0].classList.contains("mach-cell--wrap")).toBe(true);
    expect(cells[1].classList.contains("mach-cell--wrap")).toBe(false);
    api.destroy();
  });

  it("runtime updateOptions getRowHeight triggers relayout", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "name", headerName: "Name" }],
      rowData: makeRows(2),
      rowKey: (row) => row.id
    });
    api.updateOptions({ getRowHeight: () => 50 });
    const rows = Array.from(host.querySelectorAll(".mach-row[data-index]")) as HTMLElement[];
    expect(rows[0].style.height).toBe("50px");
    api.destroy();
  });
});

describe("fixes round 2", () => {
  it("getSelectedIds returns id list", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "name", headerName: "Name" }],
      rowData: makeRows(3),
      rowSelection: "multiple",
      rowKey: (row) => row.id
    });
    api.selection.setById("r0", true, false);
    api.selection.setById("r2", true, false);
    expect(api.selection.getIds().sort()).toEqual(["r0", "r2"]);
    api.destroy();
  });

  it("infinite mode header checkbox never shows fully checked when rows unloaded", async () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [
        { colId: "sel", headerName: "", width: 46, checkboxSelection: true, sortable: false, resizable: false, movable: false },
        { field: "name", headerName: "Name" }
      ],
      rowSelection: "multiple",
      blockSize: 10,
      rowKey: (row) => row.id,
      datasource: {
        getRows(params) {
          setTimeout(() => {
            params.onSuccess(makeRows(Math.min(10, params.endRow - params.startRow), params.startRow), 50);
          }, 0);
        }
      }
    });
    await new Promise((r) => setTimeout(r, 15));

    api.selection.selectAll(true);
    expect(api.selection.getRows().length).toBe(10);
    const headerCheckbox = host.querySelector(".mach-select-all") as HTMLInputElement;
    expect(headerCheckbox.checked).toBe(false);
    expect(headerCheckbox.indeterminate).toBe(true);
    api.destroy();
  });

  it("columnMenu toggles at runtime rebuild header buttons", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "name", headerName: "Name" }],
      rowData: makeRows(2),
      rowKey: (row) => row.id
    });
    expect(host.querySelector(".mach-menu-btn")).toBeNull();

    api.updateOptions({ columnMenu: true });
    expect(host.querySelector(".mach-menu-btn")).toBeTruthy();

    api.updateOptions({ columnMenu: false });
    expect(host.querySelector(".mach-menu-btn")).toBeNull();
    api.destroy();
  });

  it("date editor preserves original time part", () => {
    const host = createHost();
    const data: Row[] = [{ id: "r0", name: "n0", score: 1, at: "2024-05-06T08:30:00.000Z" }];
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "at", headerName: "时间", editable: true, cellEditor: "date" }],
      rowData: data,
      rowKey: (row) => row.id
    });
    api.editing.startCell({ rowIndex: 0, colId: "at" });
    const input = host.querySelector(".mach-editor-input") as HTMLInputElement;
    expect(input.value).toBe("2024-05-06");
    input.value = "2024-06-07";
    api.editing.stop();
    expect(data[0].at).toBe("2024-06-07T08:30");
    api.destroy();
  });

  it("csv export protects formula injection by default", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "note", headerName: "备注" }],
      rowData: [
        { id: "1", name: "a", score: 1, note: "=cmd|' /C calc'!A0" },
        { id: "2", name: "b", score: 2, note: "-42" },
        { id: "3", name: "c", score: 3, note: "@weblink" }
      ],
      rowKey: (row) => row.id
    });
    const csv = api.io.exportCsv();
    expect(csv).toContain("'=cmd");
    expect(csv).toContain("-42");
    expect(csv).toContain("'@weblink");

    const raw = api.io.exportCsv({ protectFormulas: false });
    expect(raw).toContain("=cmd");
    api.destroy();
  });

  it("sanitizeFormulaCell keeps plain numbers intact", () => {
    expect(sanitizeFormulaCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(sanitizeFormulaCell("-3.5")).toBe("-3.5");
    expect(sanitizeFormulaCell("+123")).toBe("+123");
    expect(sanitizeFormulaCell("普通文本")).toBe("普通文本");
    expect(sanitizeFormulaCell(42)).toBe(42);
  });

  it("warns when treeData combines rowGroup or masterDetail", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [
        { field: "name", headerName: "Name", rowGroup: true },
        { field: "score", headerName: "Score" }
      ],
      rowData: makeRows(2),
      treeData: true,
      masterDetail: true,
      rowKey: (row) => row.id
    });
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
    api.destroy();
  });
});
