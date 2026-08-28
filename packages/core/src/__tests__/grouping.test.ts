// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createGrid } from "../index";
import type { GridApi, ColDef } from "../index";

interface Row {
  id: string;
  region: string;
  product: string;
  amount: number;
}

const rows: Row[] = [
  { id: "1", region: "华东", product: "A", amount: 10 },
  { id: "2", region: "华东", product: "B", amount: 20 },
  { id: "3", region: "华南", product: "A", amount: 5 },
  { id: "4", region: "华南", product: "B", amount: 15 },
  { id: "5", region: "华北", product: "A", amount: 40 }
];

function createHost(): HTMLElement {
  const host = document.createElement("div");
  Object.defineProperty(host, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(host, "clientHeight", { value: 400, configurable: true });
  document.body.appendChild(host);
  return host;
}

function groupedDefs(): ColDef<Row>[] {
  return [
    { colId: "sel", headerName: "", width: 46, checkboxSelection: true, sortable: false, resizable: false, movable: false },
    { field: "region", headerName: "区域", rowGroup: true, hide: false },
    { field: "product", headerName: "产品" },
    { field: "amount", headerName: "金额", aggFunc: "sum", type: "rightAligned" }
  ];
}

describe("row grouping and aggregation", () => {
  it("builds collapsed group rows with aggregated values", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: groupedDefs(),
      rowData: rows,
      getRowId: (p) => p.data.id
    });

    expect(api.getDisplayedRowCount()).toBe(3);

    const groupTexts = Array.from(host.querySelectorAll(".mach-group-text")).map((e) => e.textContent);
    expect(groupTexts).toEqual(["区域: 华东", "区域: 华北", "区域: 华南"]);

    const groupAggs = Array.from(host.querySelectorAll(".mach-row")).map((r) => r.textContent);
    expect(groupAggs.some((t) => t?.includes("30"))).toBe(true);
    expect(groupAggs.some((t) => t?.includes("40"))).toBe(true);
    expect(groupAggs.some((t) => t?.includes("20"))).toBe(true);
    api.destroy();
  });

  it("expands groups to reveal leaf rows", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: groupedDefs(),
      rowData: rows,
      getRowId: (p) => p.data.id
    });

    const firstGroupText = host.querySelector(".mach-group-text")?.textContent;
    expect(firstGroupText).toContain("华东");

    api.expandAllGroups();
    expect(api.getDisplayedRowCount()).toBe(8);
    const leafTexts = Array.from(host.querySelectorAll(".mach-row")).map((r) => r.textContent);
    expect(leafTexts.some((t) => t?.includes("A"))).toBe(true);
    expect(leafTexts.some((t) => t?.includes("B"))).toBe(true);

    api.collapseAllGroups();
    expect(api.getDisplayedRowCount()).toBe(3);
    api.destroy();
  });

  it("aggregates with custom agg functions", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [
        { field: "region", headerName: "区域", rowGroup: true },
        { field: "amount", headerName: "均值", aggFunc: "avg" }
      ],
      rowData: rows,
      aggFuncs: {
        doubleSum: (values) => values.reduce((a: number, v: any) => a + (typeof v === "number" ? v * 2 : 0), 0)
      },
      getRowId: (p) => p.data.id
    });

    const groupAggs = Array.from(host.querySelectorAll(".mach-row")).map((r) => r.textContent);
    expect(groupAggs.some((t) => t?.includes("15"))).toBe(true);
    api.destroy();
  });

  it("group checkbox selects all child rows", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: groupedDefs(),
      rowData: rows,
      rowSelection: "multiple",
      getRowId: (p) => p.data.id
    });

    api.expandAllGroups();
    const leafCount = api.getDisplayedRowCount() - 3;
    expect(leafCount).toBe(5);

    api.selectNodeById("1", true, false);
    api.selectNodeById("2", true, false);
    expect(api.getSelectedRows().length).toBe(2);
    expect(api.getVisibleSelection().length).toBe(2);
    api.destroy();
  });

  it("csv export skips group rows", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: groupedDefs(),
      rowData: rows,
      getRowId: (p) => p.data.id
    });
    api.expandAllGroups();
    const lines = api.getDataAsCsv().split("\r\n");
    expect(lines.length).toBe(6);
    expect(lines[1]).toContain("华东");
    api.destroy();
  });
});

describe("cellStyle", () => {
  it("applies dynamic styles and cleans previous ones", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [
        { field: "id", headerName: "ID", width: 80 },
        {
          field: "amount",
          headerName: "金额",
          width: 120,
          cellStyle: (params) => (Number(params.value) > 20 ? { color: "red", fontWeight: "700" } : { color: "green" })
        }
      ],
      rowData: rows,
      getRowId: (p) => p.data.id
    });

    api.setSortModel([{ colId: "amount", direction: "asc" }]);
    const firstRow = host.querySelector('.mach-row[data-index="0"]');
    const amountCell = Array.from(firstRow?.querySelectorAll(".mach-cell") ?? [])[1] as HTMLElement;
    expect(amountCell.style.color).toBe("green");

    api.setSortModel([{ colId: "amount", direction: "desc" }]);
    const topRow = host.querySelector('.mach-row[data-index="0"]');
    const topAmountCell = Array.from(topRow?.querySelectorAll(".mach-cell") ?? [])[1] as HTMLElement;
    expect(topAmountCell.style.color).toBe("red");
    expect(topAmountCell.style.fontWeight).toBe("700");
    api.destroy();
  });
});

describe("setSelection", () => {
  it("selects rows by data reference or id", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "id", headerName: "ID" }],
      rowData: rows,
      rowSelection: "multiple",
      getRowId: (p) => p.data.id
    });

    api.setSelection([rows[0], rows[2]]);
    expect(api.getSelectedRows().length).toBe(2);

    api.setSelection([rows[4]]);
    expect(api.getSelectedRows().length).toBe(1);
    expect(api.getSelectedRows()[0].id).toBe("5");
    api.destroy();
  });
});
