// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createGrid } from "../index";
import type { GridApi, ColDef } from "../index";

interface Row {
  id: string;
  name: string;
  amount: number;
}

const rows: Row[] = [
  { id: "1", name: "a", amount: 10 },
  { id: "2", name: "b", amount: 20 },
  { id: "3", name: "c", amount: 30 }
];

function createHost(): HTMLElement {
  const host = document.createElement("div");
  Object.defineProperty(host, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(host, "clientHeight", { value: 400, configurable: true });
  document.body.appendChild(host);
  return host;
}

describe("pinned top/bottom rows", () => {
  const defs: ColDef<Row>[] = [
    { colId: "sel", headerName: "", width: 46, checkboxSelection: true, sortable: false, resizable: false, movable: false },
    { field: "name", headerName: "名称", width: 150 },
    { field: "amount", headerName: "金额", width: 120, type: "rightAligned" }
  ];

  it("renders pinned top and bottom rows with formatted values", () => {    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: defs,
      rowData: rows,
      pinnedTopRowData: [{ id: "t", name: "汇总行", amount: 60 }],
      pinnedBottomRowData: [{ id: "b", name: "均值行", amount: 20 }],
      rowKey: (row) => row.id
    });

    const top = host.querySelector(".mach-pinned-rows--top") as HTMLElement;
    const bottom = host.querySelector(".mach-pinned-rows--bottom") as HTMLElement;
    expect(top.style.display).toBe("");
    expect(bottom.style.display).toBe("");
    expect(top.textContent).toContain("汇总行");
    expect(top.textContent).toContain("60");
    expect(bottom.textContent).toContain("均值行");

    const checkboxCells = top.querySelectorAll(".mach-cell--selection");
    expect(checkboxCells.length).toBe(1);
    expect(checkboxCells[0].textContent).toBe("");
    api.destroy();
  });

  it("setters update data dynamically and hide when empty", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: defs,
      rowData: rows,
      rowKey: (row) => row.id
    });
    const top = host.querySelector(".mach-pinned-rows--top") as HTMLElement;
    expect(top.style.display).toBe("none");

    api.view.setPinnedRows("top", [{ id: "t", name: "新增", amount: 1 }]);
    expect(top.style.display).toBe("");
    expect(api.view.getPinnedRows("top").length).toBe(1);

    api.view.setPinnedRows("top", null);
    expect(top.style.display).toBe("none");
    expect(api.view.getPinnedRows("top").length).toBe(0);

    api.view.setPinnedRows("bottom", [{ id: "b", name: "底", amount: 2 }]);
    expect(api.view.getPinnedRows("bottom")[0].name).toBe("底");
    api.destroy();
  });

  it("syncs center segment with horizontal scroll", async () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [
        ...defs,
        { field: "pad", headerName: "填充", width: 900 }
      ],
      rowData: rows,
      pinnedTopRowData: [{ id: "t", name: "顶", amount: 1 }],
      rowKey: (row) => row.id
    });
    const topSeg = host.querySelector(".mach-pinned-rows--top .mach-pinned-seg--center") as HTMLElement;
    const viewport = host.querySelector(".mach-body-viewport--scroll") as HTMLElement;
    Object.defineProperty(viewport, "scrollLeft", { value: 120, configurable: true, writable: true });
    viewport.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(topSeg.style.transform).toContain("-120");
    api.destroy();
  });

  it("excludes pinned rows from csv export and row selection", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: defs,
      rowData: rows,
      pinnedTopRowData: [{ id: "t", name: "汇总", amount: 60 }],
      rowSelection: "multiple",
      rowKey: (row) => row.id
    });
    const lines = api.io.exportCsv().split("\r\n");
    expect(lines.length).toBe(4);
    expect(lines.join("")).not.toContain("汇总");
    expect(api.rows.getCount()).toBe(3);
    api.destroy();
  });
});
