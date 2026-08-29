// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createGrid, LOCALE_EN } from "../index";
import type { GridApi, ColDef } from "../index";

interface Row {
  id: string;
  name: string;
  score?: number;
  dept?: string;
  hasChildren?: boolean;
  children?: Row[];
}

function createHost(): HTMLElement {
  const host = document.createElement("div");
  Object.defineProperty(host, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(host, "clientHeight", { value: 400, configurable: true });
  document.body.appendChild(host);
  return host;
}

describe("index column", () => {
  it("renders sequential numbers respecting offset", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [
        { colId: "idx", headerName: "#", type: "index", width: 60 },
        { field: "name", headerName: "Name" }
      ],
      rowData: [{ id: "1", name: "a" }, { id: "2", name: "b" }, { id: "3", name: "c" }],
      indexOffset: 10,
      getRowId: (p) => p.data.id
    });
    const firstRow = host.querySelector('.mach-row[data-index="0"]');
    expect(firstRow?.textContent?.trim().startsWith("11")).toBe(true);
    api.destroy();
  });
});

describe("selectable rows", () => {
  it("disables checkbox and excludes from select-all", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [
        { colId: "sel", headerName: "", width: 46, checkboxSelection: true, sortable: false, resizable: false, movable: false, selectable: (p) => (p.data?.score ?? 0) > 1 }
      ],
      rowData: [
        { id: "1", name: "a", score: 1 },
        { id: "2", name: "b", score: 2 }
      ],
      rowSelection: "multiple",
      getRowId: (p) => p.data.id
    });
    const checkboxes = host.querySelectorAll<HTMLInputElement>(".mach-row-checkbox");
    expect(checkboxes[0].disabled).toBe(true);
    expect(checkboxes[1].disabled).toBe(false);

    api.selectAll(true);
    expect(api.getSelectedRows().length).toBe(1);
    expect(api.getSelectedRows()[0].id).toBe("2");
    api.destroy();
  });
});

describe("singleClickEdit", () => {
  it("starts editing on single click when enabled", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [
        { field: "name", headerName: "Name", editable: true },
        { field: "score", headerName: "Score" }
      ],
      rowData: [{ id: "1", name: "a", score: 5 }],
      singleClickEdit: true,
      getRowId: (p) => p.data.id
    });
    const cell = host.querySelector('.mach-cell[data-col-id="name"]') as HTMLElement;
    cell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(host.querySelector(".mach-editor-input")).toBeTruthy();
    api.destroy();
  });
});

describe("validate on edit", () => {
  it("blocks invalid value and keeps editor open", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [
        {
          field: "score",
          headerName: "Score",
          editable: true,
          validate: (value) => (typeof value === "number" && value >= 0 && value <= 100 ? true : "请输入 0-100")
        }
      ],
      rowData: [{ id: "1", name: "a", score: 5 }],
      getRowId: (p) => p.data.id
    });
    api.startEditingCell({ rowIndex: 0, colId: "score" });
    const input = host.querySelector(".mach-editor-input") as HTMLInputElement;
    input.value = "200";
    api.stopEditing(false);

    const editorEl = host.querySelector(".mach-editor-invalid");
    expect(editorEl).toBeTruthy();
    expect(api.getNodeById("1")?.data?.score).toBe(5);

    input.value = "50";
    host.querySelector(".mach-editor-invalid")?.dispatchEvent(new Event("input", { bubbles: true }));
    api.stopEditing(false);
    expect(api.getNodeById("1")?.data?.score).toBe(50);
    api.destroy();
  });

  it("awaits async validation and keeps invalid editors recoverable", async () => {
    const host = createHost();
    let resolveValidation: ((result: true | string) => void) | undefined;
    const api = createGrid<Row>(host, {
      columnDefs: [
        {
          field: "name",
          editable: true,
          validate: () => new Promise<true | string>((resolve) => {
            resolveValidation = resolve;
          })
        }
      ],
      rowData: [{ id: "1", name: "before" }],
      getRowId: (p) => p.data.id
    });

    api.startEditingCell({ rowIndex: 0, colId: "name" });
    const input = host.querySelector(".mach-editor-input") as HTMLInputElement;
    input.value = "after";
    const stopping = api.stopEditingAsync();
    expect(input.getAttribute("aria-busy")).toBe("true");
    expect(input.inert).toBe(true);

    resolveValidation?.("Already exists");
    await expect(stopping).resolves.toBe(false);
    expect(api.getNodeById("1")?.data?.name).toBe("before");
    expect(host.querySelector(".mach-editor-invalid")).toBe(input);
    expect(input.inert).toBe(false);

    input.dispatchEvent(new Event("input", { bubbles: true }));
    const secondStop = api.stopEditingAsync();
    resolveValidation?.(true);
    await expect(secondStop).resolves.toBe(true);
    expect(api.getNodeById("1")?.data?.name).toBe("after");
    expect(host.querySelector(".mach-editor-input")).toBeNull();
    api.destroy();
  });

  it("cancels an in-flight async validation without applying stale results", async () => {
    const host = createHost();
    let resolveValidation: ((result: true) => void) | undefined;
    const api = createGrid<Row>(host, {
      columnDefs: [{
        field: "name",
        editable: true,
        validate: () => new Promise<true>((resolve) => { resolveValidation = resolve; })
      }],
      rowData: [{ id: "1", name: "before" }],
      getRowId: (p) => p.data.id
    });

    api.startEditingCell({ rowIndex: 0, colId: "name" });
    (host.querySelector(".mach-editor-input") as HTMLInputElement).value = "stale";
    const validation = api.stopEditingAsync();
    await expect(api.stopEditingAsync(true)).resolves.toBe(true);
    resolveValidation?.(true);
    await expect(validation).resolves.toBe(false);
    expect(api.getNodeById("1")?.data?.name).toBe("before");
    api.destroy();
  });
});

describe("row span", () => {
  it("autoRowSpan merges consecutive equal values", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [
        { field: "dept", headerName: "Dept", autoRowSpan: true },
        { field: "name", headerName: "Name" }
      ],
      rowData: [
        { id: "1", dept: "A", name: "a" },
        { id: "2", dept: "A", name: "b" },
        { id: "3", dept: "B", name: "c" }
      ],
      getRowId: (p) => p.data.id
    });

    const row0 = host.querySelector('.mach-row[data-index="0"]');
    const cells0 = row0?.querySelectorAll(".mach-cell");
    const deptCell0 = cells0?.[0] as HTMLElement;
    expect(deptCell0.style.height).toBe("72px");

    const row1 = host.querySelector('.mach-row[data-index="1"]');
    const deptCell1 = row1?.querySelectorAll(".mach-cell")[0] as HTMLElement;
    expect(deptCell1.style.display).toBe("none");
    api.destroy();
  });

  it("custom rowSpan callback overrides", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [
        { field: "name", headerName: "Name", rowSpan: (p) => (p.rowIndex === 0 ? 3 : 1) },
        { field: "score", headerName: "Score" }
      ],
      rowData: [
        { id: "1", name: "a", score: 1 },
        { id: "2", name: "b", score: 2 },
        { id: "3", name: "c", score: 3 }
      ],
      getRowId: (p) => p.data.id
    });
    const row0 = host.querySelector('.mach-row[data-index="0"]');
    const nameCell = row0?.querySelectorAll(".mach-cell")[0] as HTMLElement;
    expect(nameCell.style.height).toBe("108px");
    api.destroy();
  });
});

describe("summary footer", () => {
  it("renders summary values per column", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [
        { field: "name", headerName: "Name" },
        { field: "score", headerName: "Score" }
      ],
      rowData: [
        { id: "1", name: "a", score: 10 },
        { id: "2", name: "b", score: 20 }
      ],
      showSummary: true,
      summaryMethod: ({ colId, values }) => {
        if (colId === "score") return `合计 ${values.reduce((a, v) => a + Number(v ?? 0), 0)}`;
        return "";
      },
      getRowId: (p) => p.data.id
    });
    const footer = host.querySelector(".mach-footer") as HTMLElement;
    expect(footer.style.display).toBe("");
    expect(footer.textContent).toContain("合计 30");

    api.setQuickFilter("a");
    expect(footer.textContent).toContain("合计 10");
    api.destroy();
  });
});

describe("manual sorting / filtering (server mode)", () => {
  it("keeps client order when manual flags are set", () => {
    const host = createHost();
    const sortListener = vi.fn();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [
        { field: "name", headerName: "Name" },
        { field: "score", headerName: "Score" }
      ],
      rowData: [
        { id: "1", name: "c", score: 3 },
        { id: "2", name: "a", score: 1 },
        { id: "3", name: "b", score: 2 }
      ],
      manualSorting: true,
      manualFiltering: true,
      getRowId: (p) => p.data.id
    });
    api.addEventListener("sortChanged", sortListener);

    api.setSortModel([{ colId: "score", direction: "asc" }]);
    expect(sortListener).toHaveBeenCalled();
    expect(api.getSortModel()).toEqual([{ colId: "score", direction: "asc" }]);
    expect(api.getRowNode(0)?.data?.name).toBe("c");

    api.setFilterModel({ score: { type: "number", conditions: [{ match: "equals", value: 1 }] } });
    expect(api.getDisplayedRowCount()).toBe(3);

    api.destroy();
  });
});

describe("row drag", () => {
  it("reorders rows via api and emits event", () => {
    const host = createHost();
    const dragListener = vi.fn();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [
        { colId: "drag", headerName: "", rowDrag: true, width: 40, sortable: false, resizable: false, movable: false },
        { field: "name", headerName: "Name" }
      ],
      rowData: [
        { id: "1", name: "a" },
        { id: "2", name: "b" },
        { id: "3", name: "c" }
      ],
      getRowId: (p) => p.data.id
    });
    api.addEventListener("rowDragEnd", dragListener);

    expect(host.querySelector(".mach-row-drag-handle")).toBeTruthy();
    expect(api.reorderRows(0, 2)).toBe(true);
    expect(api.getRowNode(0)?.data?.name).toBe("b");
    expect(api.getRowNode(1)?.data?.name).toBe("c");
    expect(api.getRowNode(2)?.data?.name).toBe("a");
    api.destroy();
  });

  it("always removes the drag indicator and global drag state on pointer up", () => {
    const host = createHost();
    const api = createGrid<Row>(host, {
      columnDefs: [
        { colId: "drag", rowDrag: true, width: 40 },
        { field: "name" }
      ],
      rowData: [
        { id: "1", name: "a" },
        { id: "2", name: "b" }
      ],
      getRowId: (params) => params.data.id,
      pagination: false
    });
    const handle = host.querySelector(".mach-row-drag-handle")!;
    handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientY: 1 }));
    expect(host.querySelector(".mach-row-drop-indicator")).toBeTruthy();
    window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientY: 80 }));
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientY: 80 }));
    expect(host.querySelector(".mach-row-drop-indicator")).toBeNull();
    expect(host.querySelector(".mach-root")?.classList.contains("mach-root--row-dragging")).toBe(false);
    api.destroy();
  });
});

describe("tree data", () => {
  const treeRows: Row[] = [
    {
      id: "r1",
      name: "华东",
      score: 0,
      children: [
        { id: "c1", name: "上海", score: 10 },
        { id: "c2", name: "杭州", score: 20 }
      ]
    },
    {
      id: "r2",
      name: "华南",
      score: 0,
      children: [{ id: "c3", name: "深圳", score: 30 }]
    }
  ];

  function treeDefs(): ColDef<Row>[] {
    return [
      { colId: "sel", headerName: "", width: 46, checkboxSelection: true, sortable: false, resizable: false, movable: false },
      { field: "name", headerName: "名称" },
      { field: "score", headerName: "分数", type: "rightAligned" }
    ];
  }

  it("renders only roots when collapsed and children when expanded", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: treeDefs(),
      rowData: treeRows,
      treeData: true,
      getRowId: (p) => p.data.id
    });
    expect(api.getDisplayedRowCount()).toBe(2);

    api.expandRow("r1");
    expect(api.getDisplayedRowCount()).toBe(4);
    expect(api.getRowNode(1)?.data?.name).toBe("上海");

    api.collapseRow("r1");
    expect(api.getDisplayedRowCount()).toBe(2);

    api.expandAllDetails();
    expect(api.getDisplayedRowCount()).toBe(5);
    api.destroy();
  });

  it("cascades selection to children with tri-state parents", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: treeDefs(),
      rowData: treeRows,
      treeData: true,
      rowSelection: "multiple",
      getRowId: (p) => p.data.id
    });
    api.expandAllDetails();

    api.selectNodeById("c1", true, false);
    const findRowById = (id: string) =>
      Array.from(host.querySelectorAll<HTMLElement>(".mach-row")).find((r) => r.dataset.id === id);
    const r1Checkbox = findRowById("r1")?.querySelector<HTMLInputElement>(".mach-row-checkbox");
    expect(r1Checkbox?.checked).toBe(false);
    expect(r1Checkbox?.indeterminate).toBe(true);

    api.selectNodeById("c2", true, false);
    const r1Checkbox2 = findRowById("r1")?.querySelector<HTMLInputElement>(".mach-row-checkbox");
    expect(r1Checkbox2?.checked).toBe(true);
    expect(r1Checkbox2?.indeterminate).toBe(false);
    expect(api.getSelectedRows().length).toBe(3);
    api.destroy();
  });

  it("filters keep ancestors of matching rows", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: treeDefs(),
      rowData: treeRows,
      treeData: true,
      getRowId: (p) => p.data.id
    });
    api.setQuickFilter("深圳");
    expect(api.getDisplayedRowCount()).toBe(1);
    expect(api.getRowNode(0)?.data?.name).toBe("华南");

    api.expandRow("r2");
    expect(api.getDisplayedRowCount()).toBe(2);
    expect(api.getRowNode(1)?.data?.name).toBe("深圳");
    api.destroy();
  });

  it("removes a subtree recursively (grandchildren included)", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "name", headerName: "名称" }],
      rowData: [
        {
          id: "p1",
          name: "父1",
          children: [
            {
              id: "c1",
              name: "子1",
              children: [{ id: "g1", name: "孙1" }, { id: "g2", name: "孙2" }]
            }
          ]
        },
        { id: "p2", name: "父2" }
      ],
      treeData: true,
      defaultExpandAll: true,
      getRowId: (p) => p.data.id
    });
    expect(api.getDisplayedRowCount()).toBe(5);

    const p1 = api.getNodeById("p1");
    api.applyTransaction({ remove: [p1!.data!] });

    expect(api.getDisplayedRowCount()).toBe(1);
    expect(api.getNodeById("c1")).toBeUndefined();
    expect(api.getNodeById("g1")).toBeUndefined();
    expect(api.getNodeById("g2")).toBeUndefined();
    expect(api.getNodeById("p2")).toBeTruthy();
    api.destroy();
  });

  it("adds nested tree transactions with correct depth and rejects duplicate child ids", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "name", headerName: "名称" }],
      rowData: [],
      treeData: true,
      getRowId: (p) => p.data.id
    });

    api.applyTransaction({
      add: [
        {
          id: "parent",
          name: "父",
          children: [{ id: "child", name: "子", children: [{ id: "grandchild", name: "孙" }] }]
        }
      ]
    });
    api.expandRow("parent");
    api.expandRow("child");

    expect(api.getDisplayedRowCount()).toBe(3);
    expect(api.getRowNode(2)?.id).toBe("grandchild");
    const grandchildIndent = host.querySelector<HTMLElement>(
      '.mach-row[data-index="2"] .mach-tree-indent'
    );
    expect(grandchildIndent?.style.width).toBe("32px");

    api.applyTransaction({
      add: [{ id: "duplicate", name: "父", children: [{ id: "duplicate", name: "重复子" }] }]
    });
    expect(api.getNodeById("duplicate")?.data?.name).toBe("父");
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("transaction.add"),
      expect.any(Error)
    );

    error.mockRestore();
    api.destroy();
  });

  it("sorts siblings without flattening tree", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: treeDefs(),
      rowData: [
        { id: "r1", name: "B", score: 0, children: [{ id: "c1", name: "y", score: 0 }, { id: "c2", name: "x", score: 0 }] },
        { id: "r2", name: "A", score: 0 }
      ],
      treeData: true,
      getRowId: (p) => p.data.id
    });
    api.setSortModel([{ colId: "name", direction: "asc" }]);
    expect(api.getRowNode(0)?.data?.name).toBe("A");

    api.expandRow("r1");
    expect(api.getRowNode(1)?.data?.name).toBe("B");
    expect(api.getRowNode(2)?.data?.name).toBe("x");
    expect(api.getRowNode(3)?.data?.name).toBe("y");
    api.destroy();
  });

  it("loads lazy children once, deduplicates requests and exposes loading state", async () => {
    const host = createHost();
    let resolveRequest!: (rows: readonly Row[]) => void;
    const loadTreeChildren = vi.fn(() => new Promise<readonly Row[]>((resolve) => { resolveRequest = resolve; }));
    const loaded = vi.fn();
    const api = createGrid<Row>(host, {
      columnDefs: [{ field: "name" }],
      rowData: [{ id: "parent", name: "Parent", hasChildren: true }],
      treeData: true,
      getRowId: ({ data }) => data.id,
      isTreeRowExpandable: ({ data }) => data.hasChildren === true,
      loadTreeChildren,
      onTreeChildrenLoaded: loaded
    });

    expect(api.expandRow("parent")).toBe(true);
    expect(api.isTreeRowLoading("parent")).toBe(true);
    const duplicate = api.loadTreeChildren("parent");
    await Promise.resolve();
    expect(loadTreeChildren).toHaveBeenCalledTimes(1);
    resolveRequest([{ id: "child", name: "Child" }]);
    await duplicate;

    expect(api.isTreeRowLoading("parent")).toBe(false);
    expect(api.getDisplayedRowCount()).toBe(2);
    expect(api.getNodeById("child")?.data?.name).toBe("Child");
    expect(loaded).toHaveBeenCalledTimes(1);
    await api.loadTreeChildren("parent");
    expect(loadTreeChildren).toHaveBeenCalledTimes(1);
    api.destroy();
  });

  it("surfaces lazy tree failures and supports an atomic retry", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const host = createHost();
    const failure = new Error("offline");
    const loadTreeChildren = vi.fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce([{ id: "child", name: "Recovered" }]);
    const failed = vi.fn();
    const api = createGrid<Row>(host, {
      columnDefs: [{ field: "name" }],
      rowData: [{ id: "parent", name: "Parent", hasChildren: true }],
      treeData: true,
      getRowId: ({ data }) => data.id,
      isTreeRowExpandable: ({ data }) => data.hasChildren === true,
      loadTreeChildren,
      onTreeChildrenLoadFailed: failed
    });

    await expect(api.loadTreeChildren("parent")).rejects.toBe(failure);
    expect(api.getNodeById("parent")?.treeLoadError).toBe(failure);
    expect(failed).toHaveBeenCalledTimes(1);
    await api.retryTreeChildren("parent");
    expect(api.getNodeById("parent")?.treeLoadError).toBeUndefined();
    expect(api.getNodeById("child")?.data?.name).toBe("Recovered");
    api.destroy();
    consoleError.mockRestore();
  });

  it("keeps the previous lazy subtree when replacement IDs are invalid", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const host = createHost();
    const api = createGrid<Row>(host, {
      columnDefs: [{ field: "name" }],
      rowData: [
        { id: "parent", name: "Parent", children: [{ id: "old", name: "Old child" }] },
        { id: "reserved", name: "Reserved root" }
      ],
      treeData: true,
      getRowId: ({ data }) => data.id,
      isTreeRowExpandable: ({ data }) => data.id === "parent",
      loadTreeChildren: async () => [{ id: "reserved", name: "Duplicate" }]
    });

    await expect(api.retryTreeChildren("parent")).rejects.toThrow("Duplicate row id: reserved");
    expect(api.getNodeById("old")?.data?.name).toBe("Old child");
    expect(api.getNodeById("reserved")?.data?.name).toBe("Reserved root");
    api.destroy();
    consoleError.mockRestore();
  });

  it("treats an explicit empty children array as an already loaded leaf", async () => {
    const loadTreeChildren = vi.fn(async () => [{ id: "unexpected", name: "Unexpected" }]);
    const api = createGrid<Row>(createHost(), {
      columnDefs: [{ field: "name" }],
      rowData: [{ id: "leaf", name: "Leaf", hasChildren: true, children: [] }],
      treeData: true,
      getRowId: ({ data }) => data.id,
      isTreeRowExpandable: ({ data }) => data.hasChildren === true,
      loadTreeChildren
    });

    expect(api.expandRow("leaf")).toBe(false);
    await expect(api.loadTreeChildren("leaf")).resolves.toEqual([]);
    expect(loadTreeChildren).not.toHaveBeenCalled();
    api.destroy();
  });

  it("rejects cyclic lazy children before mutating a generated-id tree", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const child: { name: string; children?: unknown[] } = { name: "Cycle" };
    child.children = [child];
    const api = createGrid<{ name: string; hasChildren?: boolean; children?: unknown[] }>(createHost(), {
      columnDefs: [{ field: "name" }],
      rowData: [{ name: "Parent", hasChildren: true }],
      treeData: true,
      isTreeRowExpandable: ({ data }) => data.hasChildren === true,
      loadTreeChildren: async () => [child]
    });
    const parentId = api.getRowNode(0)!.id;

    await expect(api.loadTreeChildren(parentId)).rejects.toThrow("cyclic object graph");
    expect(api.getDisplayedRowCount()).toBe(1);
    api.destroy();
    consoleError.mockRestore();
  });
});

describe("locale", () => {
  it("localizes filter panel and column menu", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "name", headerName: "Name", filter: "text" }],
      rowData: [{ id: "1", name: "a" }],
      locale: LOCALE_EN,
      getRowId: (p) => p.data.id
    });
    const filterBtn = host.querySelector(".mach-filter-btn") as HTMLButtonElement;
    filterBtn.click();
    const panel = document.querySelector(".mach-filter-panel") as HTMLElement;
    expect(panel).toBeTruthy();
    const options = Array.from(panel.querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toContain("Contains");
    expect(panel.querySelector(".mach-filter-btn-apply")?.textContent).toBe("Apply");
    api.destroy();
  });
});

describe("column workbench", () => {
  it("searches, pins, reorders and closes through the public API", () => {
    const host = createHost();
    const api = createGrid<Row>(host, {
      columnDefs: [
        { field: "name", headerName: "Name" },
        { field: "score", headerName: "Score" },
        { field: "dept", headerName: "Department" }
      ],
      rowData: [{ id: "1", name: "A", score: 1, dept: "R&D" }]
    });
    expect(api.getColumnWorkbenchItems().map((item) => item.label)).toEqual(["Name", "Score", "Department"]);

    api.openColumnWorkbench();
    const panel = document.querySelector<HTMLElement>('.mach-column-panel[role="dialog"]')!;
    const search = panel.querySelector<HTMLInputElement>(".mach-column-workbench-search")!;
    search.value = "score";
    search.dispatchEvent(new Event("input"));
    expect(panel.querySelectorAll(".mach-column-workbench-item")).toHaveLength(1);

    const pin = panel.querySelector<HTMLSelectElement>(".mach-column-workbench-pin")!;
    pin.value = "right";
    pin.dispatchEvent(new Event("change"));
    expect(api.getColumnWorkbenchItems().find((item) => item.colId === "score")?.pinned).toBe("right");
    api.closeColumnWorkbench();
    expect(document.querySelector(".mach-column-panel")).toBeNull();
    api.destroy();
  });
});
