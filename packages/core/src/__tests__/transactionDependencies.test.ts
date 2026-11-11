// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { GridCore } from "../core/gridCore";
import { captureProjectionValues } from "../lib/projectionDependencies";
import type { ColDef, GridOptions, RowNode } from "../index";

interface Row { id: string; group: string; amount: number; status: string; nested?: { value: number }; extra?: Record<string, number> }
const data: Row[] = [{ id: "1", group: "A", amount: 3, status: "new" }, { id: "2", group: "B", amount: 8, status: "new" }, { id: "3", group: "A", amount: 5, status: "new" }];
const cores: GridCore<Row>[] = [];
afterEach(() => { for (const core of cores.splice(0)) core.destroy(); document.body.replaceChildren(); });

function grid(columnDefs: ColDef<Row>[], extra: GridOptions<Row> = {}): GridCore<Row> {
  const host = document.body.appendChild(document.createElement("div"));
  const core = new GridCore<Row>(host, { rowKey: "id", rowData: data.map((row) => ({ ...row })), pagination: false, columnDefs, ...extra });
  cores.push(core);
  return core;
}

function snapshot(nodes: RowNode<Row>[]): unknown[] {
  return nodes.map((node) => node.isGroup
    ? { id: node.id, aggregate: node.aggValues, leaves: node.leafNodes?.map((leaf) => leaf.id) }
    : { id: node.id, data: node.data, rowIndex: node.rowIndex });
}

describe("plain-field transaction projection dependencies", () => {
  it("retains sorted/filtered/grouped projections for unrelated immutable updates", () => {
    const core = grid([{ field: "group", rowGroup: true }, { field: "amount", initialSort: "asc", aggFunc: "sum" }, { field: "status" }]);
    core.rowModel.setFilterModel({ amount: { type: "number", conditions: [{ match: "greaterThan", value: 0 }] } });
    core.rowModel.refreshPipeline();
    const before = core.rowModel.getDisplayedRows().slice();
    const refresh = vi.spyOn(core.rowModel, "refreshPipeline");
    const impact = core.rowModel.applyTransaction({ update: [{ ...data[0], status: "done" }] });
    expect(impact).toEqual({ pipelineChanged: false, updatedRowIds: ["1"] });
    expect(refresh).not.toHaveBeenCalled();
    expect(core.rowModel.getDisplayedRows()).toEqual(before);
    expect(before[0].leafNodes?.find((node) => node.id === "1")?.data?.status).toBe("done");
  });

  it.each(["amount", "group"] as const)("rebuilds when dependent %s changes", (field) => {
    const core = grid([{ field: "group", rowGroup: true }, { field: "amount", initialSort: "asc", aggFunc: "sum" }]);
    const refresh = vi.spyOn(core.rowModel, "refreshPipeline");
    core.rowModel.applyTransaction({ update: [{ ...data[0], [field]: field === "amount" ? 9 : "C" }] });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("tracks advanced-filter and visible quick-search fields, respecting manual projection", () => {
    const core = grid([{ field: "amount" }, { field: "status" }, { field: "group", hide: true }]);
    core.rowModel.setAdvancedFilterModel({ version: 1, root: { kind: "condition", colId: "amount", filter: { type: "number", conditions: [{ match: "greaterThan", value: 4 }] } } });
    core.rowModel.refreshPipeline();
    expect(core.rowModel.applyTransaction({ update: [{ ...data[0], status: "done" }] }).pipelineChanged).toBe(false);
    expect(core.rowModel.applyTransaction({ update: [{ ...data[0], amount: 7 }] }).pipelineChanged).toBe(true);
    core.rowModel.setQuickFilter("done"); core.rowModel.refreshPipeline();
    expect(core.rowModel.applyTransaction({ update: [{ ...data[0], status: "done" }] }).pipelineChanged).toBe(true);
    core.gridOptions.manualFiltering = true;
    expect(core.rowModel.applyTransaction({ update: [{ ...data[0], status: "other" }] }).pipelineChanged).toBe(false);
  });

  it("checks the projection snapshot budget before reading row fields", () => {
    const read = vi.fn(() => 3);
    const node = { id: "row", rowIndex: 0, selected: false, data: { get amount() { return read(); } } };
    const nodes = Array<typeof node>(100_000).fill(node);
    const fields = ["amount", ...Array.from({ length: 99 }, (_, index) => `extra.${index}`)];
    expect(captureProjectionValues(nodes, fields)).toBeNull();
    expect(read).not.toHaveBeenCalled();
    expect(captureProjectionValues([node], fields)?.get(node)?.[0]).toBe(3);
    expect(read).toHaveBeenCalledOnce();
  });

  it("rebuilds an oversized quick-search projection and resumes incremental updates when narrowed", () => {
    const rows = Array.from({ length: 10_000 }, (_, amount) => ({ id: String(amount), amount, status: "match", group: "A" }));
    const narrow: ColDef<Row>[] = [{ field: "status", width: 100 }, { field: "amount", initialSort: "asc", width: 100 }];
    const extra: ColDef<Row>[] = Array.from({ length: 100 }, (_, index) => ({ field: `extra.${index}`, width: 100 }));
    const core = grid([...narrow, ...extra], { rowData: rows });
    core.api.filtering.setQuickText("match");
    expect(core.rowModel.applyTransaction({ update: [{ ...rows[2], group: "B" }] }).pipelineChanged).toBe(true);
    rows[0].amount = 20_000;
    rows[1].status = "hidden";
    core.rowModel.applyTransactions([{ update: [{ ...rows[0] }] }, { update: [rows[1]] }]);
    expect(core.api.rows.getCount()).toBe(rows.length - 1);
    expect(core.api.rows.getAt(0)?.id).toBe("2");
    expect(core.api.rows.getAt(rows.length - 2)?.id).toBe("0");

    core.api.columns.setDefinitions(narrow);
    expect(core.rowModel.applyTransaction({ update: [{ ...rows[2], group: "C" }] }).pipelineChanged).toBe(false);
  });

  it.each([
    [{ field: "amount", initialSort: "asc", valueGetter: (params: { data: Row | null }) => params.data?.status }],
    [{ field: "amount", initialSort: "asc", comparator: (_a: unknown, _b: unknown, left: RowNode<Row>, right: RowNode<Row>) => String(left.data?.status).localeCompare(String(right.data?.status)) }],
    [{ field: "group", rowGroup: true }, { field: "amount", aggFunc: "custom" }]
  ] as ColDef<Row>[][])("conservatively refreshes opaque projection dependencies", (...columnDefs) => {
    const core = grid(columnDefs, { aggFuncs: { custom: (values) => values.length } });
    expect(core.rowModel.applyTransaction({ update: [{ ...data[0], status: "done" }] }).pipelineChanged).toBe(true);
  });

  it("keeps in-place projection writes conservative", () => {
    const core = grid([{ field: "amount", initialSort: "asc" }]);
    const row = core.rowModel.getNodeById("1")!.data!;
    row.amount = 99;
    expect(core.rowModel.applyTransaction({ update: [row] }).pipelineChanged).toBe(true);
  });

  it("updates row geometry without rebuilding unchanged row membership and order", () => {
    const getRowHeight = vi.fn(({ data: row }: { data: Row | null }) => (row?.amount ?? 0) * 10);
    const core = grid([{ field: "amount", width: 100 }], { getRowHeight });
    const displayed = core.rowModel.getDisplayedRows();
    const revision = core.rowModel.getDisplayRevision();
    const refresh = vi.spyOn(core.rowModel, "refreshPipeline");
    getRowHeight.mockClear();
    core.api.diagnostics.resetPerformance();

    core.api.rows.transact({ update: [{ ...data[0], amount: 6 }] });

    expect(refresh).not.toHaveBeenCalled();
    expect(core.rowModel.getDisplayedRows()).toBe(displayed);
    expect(core.rowModel.getDisplayRevision()).toBe(revision);
    expect(core.api.diagnostics.getPerformance().modelSampleCount).toBe(0);
    expect(getRowHeight).toHaveBeenCalledOnce();
    const cell = core.bodyRenderer.getCellElement(0, "amount")!;
    expect(cell.parentElement!.style.height).toBe("60px");
    expect(core.skeleton.rowContainers.center.style.height).toBe("190px");
    expect(core.bodyRenderer.getCellElement(2, "amount")!.parentElement!.style.transform).toBe("translateY(140px)");

    const refreshRows = vi.spyOn(core.bodyRenderer, "onDataChanged");
    core.api.rows.transact({ update: [{ ...data[0], id: "missing" }] });
    expect(refreshRows).not.toHaveBeenCalled();
  });

  it("updates an offscreen row height and retains the scroll offset and final-row reachability", () => {
    const rowData = Array.from({ length: 100 }, (_, index) => ({ ...data[0], id: String(index), amount: 36 }));
    const core = grid([{ field: "amount", width: 100 }], { rowData, getRowHeight: ({ data: row }) => row?.amount ?? 36 });
    const viewport = core.skeleton.bodyViewports.center;
    Object.defineProperty(viewport, "clientHeight", { value: 180 });
    viewport.scrollTop = 500;
    core.api.view.refreshLayout();
    const revision = core.rowModel.getDisplayRevision();
    core.api.rows.transact({ update: [{ ...rowData[80], amount: 72 }] });
    expect(core.rowModel.getDisplayRevision()).toBe(revision);
    expect(viewport.scrollTop).toBe(500);
    expect(core.skeleton.rowContainers.center.style.height).toBe("3636px");
    core.api.view.scrollToRow(80, "top");
    expect(core.bodyRenderer.getCellElement(80, "amount")!.parentElement!.style.height).toBe("72px");
    core.api.view.scrollToRow(99, "bottom");
    expect(core.bodyRenderer.getCellElement(99, "amount")!.textContent).toBe("36");
    expect(viewport.scrollTop).toBe(3456);
  });

  it("batches geometry-only changes and still rebuilds when filter or sort dependencies change", async () => {
    const core = grid([{ field: "amount", width: 100, initialSort: "asc" }, { field: "status", width: 100 }], {
      getRowHeight: ({ data: row }) => row?.status === "done" ? 72 : 36
    });
    core.api.filtering.setModel({ amount: { type: "number", conditions: [{ match: "greaterThan", value: 0 }] } });
    const revision = core.rowModel.getDisplayRevision();
    const refresh = vi.spyOn(core.rowModel, "refreshPipeline");
    const updates = [data[0], data[2]].map(row => core.api.rows.transactAsync({ update: [{ ...row, status: "done" }] }));
    core.api.rows.flushTransactions();
    await Promise.all(updates);
    expect(refresh).not.toHaveBeenCalled();
    expect(core.rowModel.getDisplayRevision()).toBe(revision);
    expect(core.skeleton.rowContainers.center.style.height).toBe("180px");
    expect(core.api.rows.getAt(0)?.id).toBe("1");

    core.api.rows.transact({ update: [{ ...data[0], amount: -1 }] });
    expect(refresh).toHaveBeenCalledOnce();
    expect(core.api.rows.getCount()).toBe(2);
    expect(core.api.rows.getAt(0)?.id).toBe("3");
  });

  it("invalidates index-dependent heights when sorting or pagination changes the displayed positions", () => {
    const core = grid([{ field: "amount", width: 100 }], {
      getRowHeight: ({ node }) => 30 + node.rowIndex * 10
    });
    const height = (id: string) => core.bodyRenderer.getCellElement(core.api.rows.getById(id)!.rowIndex, "amount")!.parentElement!.style.height;
    expect(height("1")).toBe("30px");
    expect(height("2")).toBe("40px");
    core.api.sorting.setModel([{ colId: "amount", direction: "desc" }]);
    expect(height("2")).toBe("30px");
    expect(height("1")).toBe("50px");

    core.api.pagination.setEnabled(true);
    core.api.pagination.setPageSize(1);
    expect(height("2")).toBe("30px");
    core.api.pagination.setPage(2);
    expect(height("3")).toBe("30px");
    core.api.pagination.setEnabled(false);
    expect(height("3")).toBe("40px");
    expect(height("1")).toBe("50px");
  });

  it("refreshes all callback heights after a structural row-count change", () => {
    const core = grid([{ field: "amount", width: 100 }], {
      getRowHeight: ({ api }) => 30 + api.rows.getCount()
    });
    expect(core.skeleton.rowContainers.center.style.height).toBe("99px");
    core.api.rows.transact({ add: [{ ...data[0], id: "4" }] });
    expect(core.skeleton.rowContainers.center.style.height).toBe("136px");
    core.api.rows.transact({ remove: [{ ...data[0], id: "4" }] });
    expect(core.skeleton.rowContainers.center.style.height).toBe("99px");
  });

  it("detects mutation before a spread replacement against the previous projection", () => {
    const core = grid([{ field: "amount", initialSort: "asc" }]);
    const row = core.rowModel.getNodeById("1")!.data!;
    row.amount = 99;
    expect(core.rowModel.applyTransaction({ update: [{ ...row }] }).pipelineChanged).toBe(true);
    expect(core.rowModel.getDisplayedRows().map((node) => node.id)).toEqual(["3", "2", "1"]);
  });

  it("tracks nested primitive paths across shared-object mutation but leaves object-valued fields conservative", () => {
    const rows = data.map((row) => ({ ...row, nested: { value: row.amount } }));
    const core = grid([{ field: "nested.value", initialSort: "asc" }], { rowData: rows });
    expect(core.rowModel.applyTransaction({ update: [{ ...rows[0], status: "done" }] }).pipelineChanged).toBe(false);
    rows[0].nested.value = 99;
    expect(core.rowModel.applyTransaction({ update: [{ ...rows[0] }] }).pipelineChanged).toBe(true);
    expect(core.rowModel.getDisplayedRows().map((node) => node.id)).toEqual(["3", "2", "1"]);
    core.api.columns.setDefinitions([{ field: "nested", initialSort: "asc" }]);
    expect(core.rowModel.applyTransaction({ update: [{ ...rows[0], status: "other" }] }).pipelineChanged).toBe(true);
  });

  it("invalidates the baseline between filter changes and falls back after opaque dynamic columns", () => {
    const core = grid([{ field: "amount", initialSort: "asc" }, { field: "status" }]);
    core.rowModel.setFilterModel({ amount: { type: "number", conditions: [{ match: "greaterThan", value: 4 }] } });
    expect(core.rowModel.applyTransaction({ update: [{ ...data[0], status: "done" }] }).pipelineChanged).toBe(true);
    expect(core.rowModel.getDisplayedRows().map((node) => node.id)).toEqual(["3", "2"]);
    core.api.columns.setDefinitions([{ colId: "amount", valueGetter: ({ data: row }) => row?.amount, initialSort: "asc" }]);
    expect(core.rowModel.applyTransaction({ update: [{ ...data[0], status: "other" }] }).pipelineChanged).toBe(true);
    core.api.columns.setDefinitions([{ field: "amount", initialSort: "asc" }]);
    expect(core.rowModel.applyTransaction({ update: [{ ...data[0], status: "last" }] }).pipelineChanged).toBe(false);
  });

  it("matches a complete rebuild oracle across seeded mixed updates and transaction batches", () => {
    const columns: ColDef<Row>[] = [{ field: "group", rowGroup: true }, { field: "amount", initialSort: "desc", aggFunc: "sum" }, { field: "status" }];
    const core = grid(columns);
    const oracle = grid(columns);
    let rows = Array.from({ length: 80 }, (_, index) => ({ id: String(index), group: String(index % 5), amount: index, status: "new" }));
    const filter = { amount: { type: "number" as const, conditions: [{ match: "greaterThan" as const, value: 15 }] } };
    for (const model of [core.rowModel, oracle.rowModel]) { model.setFilterModel(filter); model.setRowData(rows); }
    let seed = 0x722fb;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000);
    for (let trial = 0; trial < 60; trial++) {
      if (trial % 9 === 0) {
        const definitions = trial % 18 === 0 ? columns : columns.map((column) => column.field === "amount"
          ? { ...column, valueGetter: ({ data: row }: { data: Row | null }) => (row?.amount ?? 0) + (row?.status.length ?? 0) }
          : column);
        for (const owner of [core, oracle]) owner.api.columns.setDefinitions(definitions);
      }
      if (trial % 7 === 0) {
        const nextFilter = { amount: { type: "number" as const, conditions: [{ match: "greaterThan" as const, value: Math.floor(random() * 40) }] } };
        for (const owner of [core, oracle]) owner.api.filtering.setModel(nextFilter);
      }
      const updates: Row[] = [];
      for (let count = 0; count < 3; count++) {
        const index = Math.floor(random() * rows.length);
        const field = ["status", "amount", "group"][Math.floor(random() * 3)];
        // The host can mutate an exposed record before submitting an immutable replacement.
        if (trial % 8 === 0) rows[index].amount = Math.floor(random() * 100);
        const row = { ...rows[index], [field]: field === "amount" ? Math.floor(random() * 100) - 20 : String(Math.floor(random() * 6)) };
        rows = rows.map((previous, position) => position === index ? row : previous);
        updates.push(row);
      }
      core.rowModel.applyTransactions(updates.map((row) => ({ update: [row] })));
      oracle.rowModel.setRowData(rows);
      expect(snapshot(core.rowModel.getDisplayedRows())).toEqual(snapshot(oracle.rowModel.getDisplayedRows()));
    }
  });
});
