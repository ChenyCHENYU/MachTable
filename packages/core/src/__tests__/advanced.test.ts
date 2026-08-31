// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  createGrid,
  buildColDefsFromSchema,
  describeFilter,
  isColDefGroup
} from "../index";
import { createColumnStateKey, createLocalColumnStateStore } from "../lib/columnStateStore";
import type { GridApi, ColDef, ColDefGroup } from "../index";

interface Row {
  id: string;
  name: string;
  score: number;
}

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: String(i), name: `n${i}`, score: i }));
}

function createHost(): HTMLElement {
  const host = document.createElement("div");
  Object.defineProperty(host, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(host, "clientHeight", { value: 400, configurable: true });
  document.body.appendChild(host);
  return host;
}

describe("describeFilter", () => {
  it("summarizes text and number filters", () => {
    expect(describeFilter({ type: "text", conditions: [{ match: "contains", value: "abc" }] })).toBe("包含 abc");
    expect(describeFilter({ type: "number", conditions: [{ match: "inRange", value: 1, value2: 9 }] })).toBe("范围 1~9");
    expect(describeFilter({ type: "number", conditions: [{ match: "greaterThan", value: 5 }] })).toBe("> 5");
    expect(describeFilter({ type: "text", conditions: [{ match: "blank" }] })).toBe("为空");
    expect(describeFilter({ type: "set", values: ["a", "b"] })).toBe("已选 2 项");
  });
});

describe("buildColDefsFromSchema", () => {
  it("maps field types to colDef behaviors", () => {
    const defs = buildColDefsFromSchema<Row>({
      fields: [
        { field: "name", title: "名称", type: "string", filterable: true },
        { field: "score", title: "分数", type: "number" },
        { field: "id", title: "编号", type: "select", options: [{ label: "一", value: "1" }], editable: true }
      ]
    });
    expect(defs.length).toBe(3);
    const name = defs[0] as ColDef<Row>;
    expect(name.filter).toBe("text");
    const score = defs[1] as ColDef<Row>;
    expect(score.type).toBe("rightAligned");
    expect(score.filter).toBe("number");
    const id = defs[2] as ColDef<Row>;
    expect(id.cellEditor).toBe("select");
    expect(id.valueFormatter?.({ value: "1" } as any)).toBe("一");
  });

  it("builds grouped headers from schema groups", () => {
    const defs = buildColDefsFromSchema<Row>({
      fields: [
        { field: "id", title: "ID" },
        { field: "name", title: "名称" },
        { field: "score", title: "分数" }
      ],
      groups: [{ title: "基本信息", fields: ["name", "score"] }]
    });
    expect(defs.length).toBe(2);
    expect(isColDefGroup(defs[0])).toBe(false);
    expect(isColDefGroup(defs[1])).toBe(true);
    const group = defs[1] as ColDefGroup<Row>;
    expect(group.headerName).toBe("基本信息");
    expect(group.children.length).toBe(2);
  });

  it("formats boolean and date fields", () => {
    const defs = buildColDefsFromSchema<any>({
      fields: [
        { field: "ok", type: "boolean" },
        { field: "at", type: "date", format: "datetime" }
      ]
    });
    const okDef = defs[0] as ColDef<any>;
    const atDef = defs[1] as ColDef<any>;
    expect((okDef.valueFormatter as any)({ value: true })).toBe("是");
    expect((atDef.valueFormatter as any)({ value: "2024-05-06T08:09:00.000Z" })).toContain("2024-05-06");
  });
});

describe("master detail", () => {
  const cols: ColDef<Row>[] = [
    { field: "id", headerName: "ID" },
    { field: "name", headerName: "Name" }
  ];

  it("expands and collapses detail rows with custom renderer", () => {
    const host = createHost();
    const renderer = vi.fn((params: any) => {
      const div = document.createElement("div");
      div.className = "detail-content";
      div.textContent = `detail-${params.data.id}`;
      return div;
    });
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: cols,
      rowData: makeRows(5),
      masterDetail: true,
      detailRowHeight: 200,
      detailRowRenderer: renderer,
      rowKey: (row) => row.id
    });

    expect(api.rows.getCount()).toBe(5);
    expect(api.hierarchy.isRowExpanded("1")).toBe(false);

    expect(api.hierarchy.setRowExpanded("1", true)).toBe(true);
    expect(api.rows.getCount()).toBe(6);
    expect(api.hierarchy.isRowExpanded("1")).toBe(true);
    expect(renderer).toHaveBeenCalled();
    expect(host.querySelector(".detail-content")?.textContent).toBe("detail-1");

    expect(api.hierarchy.setRowExpanded("1", false)).toBe(true);
    expect(api.rows.getCount()).toBe(5);

    api.hierarchy.setRowExpanded("2", !api.hierarchy.isRowExpanded("2"));
    api.hierarchy.setRowExpanded("3", !api.hierarchy.isRowExpanded("3"));
    expect(api.rows.getCount()).toBe(7);

    api.hierarchy.setAllDetailsExpanded(false);
    expect(api.rows.getCount()).toBe(5);

    api.hierarchy.setAllDetailsExpanded(true);
    expect(api.rows.getCount()).toBe(10);
    api.destroy();
  });

  it("emits detailToggled and keeps selection on masters only", () => {
    const host = createHost();
    const listener = vi.fn();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: cols,
      rowData: makeRows(3),
      masterDetail: true,
      rowSelection: "multiple",
      rowKey: (row) => row.id
    });
    api.on("detailToggled", listener);
    api.hierarchy.setRowExpanded("0", true);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ rowId: "0", expanded: true }));

    api.selection.setById("0");
    expect(api.selection.getRows().length).toBe(1);
    api.destroy();
  });

  it("csv export skips detail rows", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: cols,
      rowData: makeRows(3),
      masterDetail: true,
      rowKey: (row) => row.id
    });
    api.hierarchy.setRowExpanded("0", true);
    const lines = api.io.exportCsv().split("\r\n");
    expect(lines.length).toBe(4);
    api.destroy();
  });
});

describe("grouped headers", () => {
  it("renders multi-level header rows and group cells", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [
        { field: "id", headerName: "ID" },
        {
          headerName: "业务信息",
          children: [
            { field: "name", headerName: "名称" },
            { headerName: "指标", children: [{ field: "score", headerName: "分数" }] }
          ]
        }
      ] as (ColDef<Row> | ColDefGroup<Row>)[],
      rowData: makeRows(2)
    });

    expect(host.querySelectorAll(".mach-header-row").length).toBeGreaterThanOrEqual(3);
    const groupCells = host.querySelectorAll(".mach-header-cell--group");
    const texts = Array.from(groupCells).map((c) => c.textContent);
    expect(texts).toContain("业务信息");
    expect(texts).toContain("指标");

    expect(host.querySelectorAll(".mach-header-cell--leaf").length).toBe(3);
    const firstRow = host.querySelector('.mach-row[data-index="0"]');
    expect(firstRow?.textContent).toContain("n0");
    api.destroy();
  });

  it("supports custom header component", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [
        {
          field: "name",
          headerName: "Name",
          headerComponent: () => {
            const span = document.createElement("span");
            span.className = "custom-header";
            span.textContent = "自定义表头";
            return span;
          }
        },
        { field: "score", headerName: "Score" }
      ],
      rowData: makeRows(2)
    });
    expect(host.querySelector(".custom-header")?.textContent).toBe("自定义表头");
    api.destroy();
  });
});

describe("column state persistence", () => {
  it("persists and restores column state via localStorage key", () => {
    localStorage.clear();
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [
        { field: "id", headerName: "ID" },
        { field: "name", headerName: "Name" }
      ],
      rowData: makeRows(2),
      persistence: { key: "test-key", sections: ["columns"], debounceMs: 0 },
      rowKey: (row) => row.id
    });

    api.columns.setState([
      { colId: "id", width: 222 },
      { colId: "name", hide: true }
    ]);

    const saved = localStorage.getItem("mach-table:grid-state:test-key");
    expect(saved).toBeTruthy();
    expect(JSON.parse(saved!).state.columns.some((s: any) => s.colId === "id" && s.width === 222)).toBe(true);

    api.destroy();

    const host2 = createHost();
    const api2: GridApi<Row> = createGrid<Row>(host2, {
      columnDefs: [
        { field: "id", headerName: "ID" },
        { field: "name", headerName: "Name" }
      ],
      rowData: makeRows(2),
      persistence: { key: "test-key", sections: ["columns"], debounceMs: 0 }
    });
    expect(api2.columns.getState().find((s) => s.colId === "id")?.width).toBe(222);
    expect(api2.columns.getState().find((s) => s.colId === "name")?.hide).toBe(true);
    api2.destroy();
    localStorage.clear();
  });

  it("persists column order across reload", () => {
    localStorage.clear();
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [
        { field: "id", headerName: "ID" },
        { field: "name", headerName: "Name" },
        { field: "score", headerName: "Score" }
      ],
      rowData: makeRows(2),
      persistence: { key: "order-key", sections: ["columns"], debounceMs: 0 }
    });
    api.columns.move("score", 0);
    api.destroy();

    const host2 = createHost();
    const api2: GridApi<Row> = createGrid<Row>(host2, {
      columnDefs: [
        { field: "id", headerName: "ID" },
        { field: "name", headerName: "Name" },
        { field: "score", headerName: "Score" }
      ],
      rowData: makeRows(2),
      persistence: { key: "order-key", sections: ["columns"], debounceMs: 0 }
    });
    const headerTexts = Array.from(host2.querySelectorAll(".mach-header-cell--leaf")).map((c) => c.textContent);
    expect(headerTexts[0]).toBe("Score");
    api2.destroy();
    localStorage.clear();
  });

  it("isolates versioned user state and migrates legacy payloads", () => {
    localStorage.clear();
    const key = createColumnStateKey({
      app: "erp",
      tenant: "north",
      user: "u/1",
      route: "/orders",
      table: "main",
      schema: 2
    });
    expect(key).toContain("table=main");
    expect(key).not.toContain("u/1");

    const store = createLocalColumnStateStore({
      namespace: "test-columns",
      version: 2,
      migrate: (columns, from) => from === 0
        ? columns.map((column) => column.colId === "old" ? { ...column, colId: "new" } : column)
        : null
    });
    localStorage.setItem(store.storageKey(key), JSON.stringify([
      { colId: "old", width: 180 },
      { colId: "old", width: 999 },
      { colId: "bad", width: -1, pinned: "center" }
    ]));
    expect(store.load(key)).toEqual([
      { colId: "new", width: 180 },
      { colId: "bad" }
    ]);
    store.save(key, [{ colId: "new", width: 200 }]);
    expect(JSON.parse(localStorage.getItem(store.storageKey(key))!)).toEqual(expect.objectContaining({
      version: 2,
      columns: [{ colId: "new", width: 200 }]
    }));
    store.clear(key);
    expect(store.load(key)).toBeNull();
  });

  it("single selection keeps only the latest row", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [
        { colId: "sel", headerName: "", width: 46, checkboxSelection: true, sortable: false, resizable: false, movable: false },
        { field: "id", headerName: "ID" }
      ],
      rowData: makeRows(3),
      rowSelection: "single",
      rowKey: (row) => row.id
    });
    api.selection.setById("0");
    expect(api.selection.getRows().length).toBe(1);
    api.selection.setById("1");
    expect(api.selection.getRows().length).toBe(1);
    expect(api.selection.getRows()[0].id).toBe("1");
    const radio = host.querySelector(".mach-row-checkbox");
    expect(radio?.getAttribute("type")).toBe("radio");
    api.destroy();
  });
});
