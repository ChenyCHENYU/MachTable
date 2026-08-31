// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { createGrid, selectionColumn, indexColumn, actionsColumn } from "../index";
import type { GridApi, ColDef } from "../index";

interface Row {
  id: string;
  name: string;
  status: string;
  remark?: string;
}

const rows: Row[] = [
  { id: "1", name: "a", status: "运行中", remark: "" },
  { id: "2", name: "b", status: "故障", remark: "" },
  { id: "3", name: "c", status: "待机", remark: "" }
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
  vi.useRealTimers();
});

describe("rich tooltip", () => {
  it("shows custom tooltip after delay and hides on leave", () => {
    vi.useFakeTimers();
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "name", headerName: "Name" }],
      rowData: rows,
      rowKey: (row) => row.id,
      tooltipComponent: (p) => `提示: ${p.formatted} (行${p.rowIndex + 1})`
    });

    cellAt(host, 0, "name").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(document.querySelector(".mach-tooltip")).toBeNull();

    vi.advanceTimersByTime(600);
    const tip = document.querySelector(".mach-tooltip") as HTMLElement;
    expect(tip).toBeTruthy();
    expect(tip.textContent).toBe("提示: a (行1)");

    host.querySelector(".mach-body")!.dispatchEvent(new MouseEvent("mouseleave"));
    expect(document.querySelector(".mach-tooltip")).toBeNull();
    api.destroy();
  });

  it("respects tooltipShowDelay and suppresses native title", () => {
    vi.useFakeTimers();
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "name", headerName: "Name" }],
      rowData: rows,
      rowKey: (row) => row.id,
      tooltipShowDelay: 100,
      tooltipComponent: () => "T"
    });
    expect(cellAt(host, 0, "name").getAttribute("title")).toBeNull();

    cellAt(host, 1, "name").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    vi.advanceTimersByTime(100);
    expect(document.querySelector(".mach-tooltip")).toBeTruthy();
    api.destroy();
  });
});

describe("flash on change", () => {
  it("adds flash class after edit and after undo", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "name", headerName: "Name", editable: true }],
      rowData: rows,
      rowKey: (row) => row.id
    });

    api.editing.startCell({ rowIndex: 0, colId: "name" });
    const input = host.querySelector(".mach-editor-input") as HTMLInputElement;
    input.value = "changed";
    api.editing.stop();

    expect(cellAt(host, 0, "name").classList.contains("mach-cell--flash")).toBe(true);

    api.editing.undo();
    expect(cellAt(host, 0, "name").classList.contains("mach-cell--flash")).toBe(true);
    api.destroy();
  });

  it("can be disabled via flashCells: false", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "name", headerName: "Name", editable: true }],
      rowData: rows,
      rowKey: (row) => row.id,
      flashCells: false
    });
    api.editing.startCell({ rowIndex: 0, colId: "name" });
    const input = host.querySelector(".mach-editor-input") as HTMLInputElement;
    input.value = "x";
    api.editing.stop();
    expect(cellAt(host, 0, "name").classList.contains("mach-cell--flash")).toBe(false);
    api.destroy();
  });
});

describe("custom context menu", () => {
  it("renders custom items with separator/danger and invokes action", () => {
    const host = createHost();
    const action = vi.fn();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "name", headerName: "Name" }],
      rowData: rows,
      rowKey: (row) => row.id,
      contextMenu: true,
      getContextMenuItems: (p) => [
        { label: `编辑 ${p.value}`, action },
        { separator: true },
        { label: "删除", danger: true, action }
      ]
    });

    cellAt(host, 1, "name").dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 30, clientY: 30 })
    );
    const menu = document.querySelector(".mach-context-menu") as HTMLElement;
    expect(menu).toBeTruthy();
    const items = menu.querySelectorAll("button");
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe("编辑 b");
    expect(items[1].classList.contains("mach-context-menu-item--danger")).toBe(true);
    expect(menu.querySelectorAll(".mach-context-menu-separator").length).toBe(1);

    items[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(action).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".mach-context-menu")).toBeNull();
    api.destroy();
  });

  it("returning null suppresses the menu", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "name", headerName: "Name" }],
      rowData: rows,
      rowKey: (row) => row.id,
      contextMenu: true,
      getContextMenuItems: () => null
    });
    cellAt(host, 0, "name").dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 30, clientY: 30 })
    );
    expect(document.querySelector(".mach-context-menu")).toBeNull();
    api.destroy();
  });
});

describe("colSpan", () => {
  it("extends cell width and hides covered cells", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [
        { field: "name", headerName: "Name", width: 100, colSpan: (p) => (p.rowIndex === 0 ? 2 : 1) },
        { field: "status", headerName: "Status", width: 80 },
        { field: "remark", headerName: "Remark", width: 120 }
      ],
      rowData: rows,
      rowKey: (row) => row.id
    });

    const row0name = cellAt(host, 0, "name");
    const row0status = cellAt(host, 0, "status");
    expect(row0name.style.width).toBe("180px");
    expect(row0status.style.display).toBe("none");

    const row1name = cellAt(host, 1, "name");
    const row1status = cellAt(host, 1, "status");
    expect(row1name.style.width).toBe("100px");
    expect(row1status.style.display).toBe("");
    api.destroy();
  });
});

describe("autoHeight", () => {
  it("measures wrapped content height via canvas", () => {
    const measureMock = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({
        measureText: (t: string) => ({ width: t.length * 7 })
      } as any);

    const host = createHost();
    const data: Row[] = [
      { id: "1", name: "short", status: "ok" },
      { id: "2", name: "a".repeat(80), status: "ok" }
    ];
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "name", headerName: "名称", width: 150, wrapText: true, autoHeight: true }],
      rowData: data,
      rowKey: (row) => row.id
    });

    const rowsEls = Array.from(host.querySelectorAll(".mach-row[data-index]")) as HTMLElement[];
    const rowShort = rowsEls.find((r) => r.dataset.index === "0")!;
    const rowLong = rowsEls.find((r) => r.dataset.index === "1")!;
    expect(parseInt(rowShort.style.height)).toBeLessThanOrEqual(40);
    expect(parseInt(rowLong.style.height)).toBeGreaterThan(40);

    measureMock.mockRestore();
    api.destroy();
  });
});

describe("preset columns", () => {
  it("selectionColumn + indexColumn + actionsColumn compose concisely", () => {
    const clicked: string[] = [];
    const host = createHost();
    const columnDefs: ColDef<Row>[] = [
      selectionColumn(),
      indexColumn(),
      { field: "name", headerName: "名称", flex: 1 },
      actionsColumn({
        actions: [
          { icon: "edit", title: "编辑", onClick: (p) => clicked.push(p.data!.id) },
          { icon: "delete", title: "删除", variant: "danger", onClick: () => clicked.push("del") }
        ]
      })
    ];
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs,
      rowData: rows,
      rowSelection: "multiple",
      rowKey: (row) => row.id
    });

    expect(host.querySelectorAll(".mach-row-checkbox").length).toBeGreaterThan(0);
    expect(cellAt(host, 0, "idx").textContent).toBe("1");
    const opCell = cellAt(host, 0, "op");
    const btns = opCell.querySelectorAll(".mach-action-btn");
    expect(btns.length).toBe(2);
    btns[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicked).toEqual(["1"]);
    api.destroy();
  });
});
