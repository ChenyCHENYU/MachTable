// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGrid, dragColumn, type GridApi, type GridOptions } from "../index";
import { inspectGridRow } from "../workbench";

interface Row { id: string; name: string; amount: number; children?: Row[] }
const apis: GridApi<Row>[] = [];
function grid(options: Partial<GridOptions<Row>> = {}) {
  const host = document.createElement("div");
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 400 } });
  document.body.append(host);
  const api = createGrid<Row>(host, { rowKey: "id", pagination: false,
    columnDefs: [dragColumn(), { field: "name", editable: true }, { field: "amount", filter: "number" }],
    rowData: Array.from({ length: 1000 }, (_, index) => ({ id: String(index), name: `Row ${index}`, amount: index })), ...options });
  apis.push(api);
  return api;
}
afterEach(() => { apis.splice(0).forEach(api => api.destroy()); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("explicit optional row inspection", () => {
  it("checks one public row index and bounded rendered DOM without enumerating the model", () => {
    const api = grid();
    const getAt = vi.fn(api.rows.getAt);
    const forbidden = vi.fn(() => { throw new Error("Enumeration is forbidden"); });
    const publicApi: GridApi<Row> = { ...api, rows: { ...api.rows, getAt, forEach: forbidden, forEachDisplayed: forbidden,
      ensureLoaded: forbidden, reload: forbidden } };
    const visible = inspectGridRow(publicApi, "0");
    expect(visible).toMatchObject({ availability: "loaded", visibility: "displayed", rendered: true, drag: { allowed: true, policyEvaluated: false } });
    const virtual = inspectGridRow(publicApi, "999");
    expect(virtual).toMatchObject({ visibility: "displayed", rendered: false, drag: { allowed: null } });
    expect(virtual.notes).toContainEqual(expect.objectContaining({ code: "OUTSIDE_RENDER_WINDOW" }));
    expect(getAt).toHaveBeenCalledTimes(2);
    expect(forbidden).not.toHaveBeenCalled();
  });

  it("reports hidden/off-page records as candidates instead of inventing a specific cause", () => {
    const api = grid({ pagination: { pageSize: 2 } });
    const result = inspectGridRow(api, "5");
    expect(result.visibility).toBe("not-displayed");
    expect(result.notes).toContainEqual(expect.objectContaining({ code: "ROW_NOT_DISPLAYED", message: expect.stringContaining("可能") }));
    api.filtering.setModel({ amount: { type: "number", conditions: [{ match: "greaterThan", value: 10 }] } });
    expect(inspectGridRow(api, "0").visibility).toBe("not-displayed");
  });

  it("distinguishes manual execution and managed sorting restrictions", () => {
    const api = grid({ manualSorting: true, manualFiltering: true });
    api.sorting.setModel([{ colId: "amount", direction: "asc" }]);
    api.filtering.setQuickText("row");
    const result = inspectGridRow(api, "0");
    expect(result.execution).toMatchObject({ sorting: "host", filtering: "host", sortActive: true, filterActive: true });
    expect(result.drag.reasons).toContainEqual(expect.objectContaining({ code: "MANAGED_SORT" }));
  });

  it("does not claim a configured processor actually ran", () => {
    const api = grid({ dataProcessor: { process: async () => ({ rowIds: [] }) }, dataProcessorMinRows: 5000 });
    const result = inspectGridRow(api, "0");
    expect(result.execution).toMatchObject({ sorting: "client-or-processor", filtering: "client-or-processor", processorConfigured: true });
    expect(result.drag.reasons).toContainEqual(expect.objectContaining({ code: "MANAGED_PROCESSOR" }));
  });

  it("explains actual editing, grouping and managed tree restrictions without calling policy", () => {
    const canDrag = vi.fn(() => true);
    const api = grid({ rowDragPolicy: { canDrag } });
    api.editing.startCell({ rowIndex: 0, colId: "name" });
    canDrag.mockClear();
    expect(inspectGridRow(api, "0").drag.reasons).toContainEqual(expect.objectContaining({ code: "EDITING_ACTIVE" }));
    expect(canDrag).not.toHaveBeenCalled();
    const grouped = grid({ columnDefs: [dragColumn(), { headerName: "分组列", children: [{ field: "name", rowGroup: true }] }] });
    expect(inspectGridRow(grouped, "0").drag.reasons).toContainEqual(expect.objectContaining({ code: "GROUPING_ACTIVE" }));
    const tree = grid({ treeData: true });
    expect(inspectGridRow(tree, "0").drag.reasons).toContainEqual(expect.objectContaining({ code: "MANAGED_TREE" }));
  });

  it("executes only the requested policy on demand and isolates its failure", () => {
    const canDrag = vi.fn(({ node }: { node: { id: string } }) => node.id === "0" ? "已锁定" : true);
    const api = grid({ rowDragPolicy: { canDrag } });
    canDrag.mockClear();
    expect(inspectGridRow(api, "0").drag).toMatchObject({ allowed: false, policyEvaluated: true,
      reasons: [{ code: "POLICY_REJECTED", message: "已锁定" }] });
    expect(canDrag).toHaveBeenCalledOnce();
    canDrag.mockImplementation(() => { throw new Error("policy fault"); });
    expect(inspectGridRow(api, "0").drag.reasons).toEqual([{ code: "POLICY_ERROR", message: "业务 canDrag 判定异常：policy fault" }]);
    canDrag.mockImplementation(() => { throw { toString() { throw new Error("nested fault"); } }; });
    expect(inspectGridRow(api, "0").drag.reasons[0].code).toBe("POLICY_ERROR");
  });

  it("invalidates results when a policy synchronously updates the same-ID data", () => {
    let armed = false;
    const api = grid({ rowDragPolicy: { canDrag: ({ api: owner }) => {
      if (armed) { armed = false; owner.rows.transact({ update: [{ id: "0", name: "Replaced", amount: 7 }] }); }
      return true;
    } } });
    armed = true;
    const result = inspectGridRow(api, "0");
    expect(result.drag.allowed).toBeNull();
    expect(result.notes).toContainEqual(expect.objectContaining({ code: "INSPECTION_CHANGED" }));
  });

  it("does not fetch or enumerate a million-row datasource to explain an unloaded ID", async () => {
    const getRows = vi.fn<NonNullable<GridOptions<Row>["datasource"]>["getRows"]>(({ startRow, endRow, onSuccess }) => {
      onSuccess(Array.from({ length: endRow - startRow }, (_, index) => ({ id: String(startRow + index), name: "Remote", amount: 1 })), 1_000_000);
    });
    const api = grid({ rowData: [], datasourceMode: "block", blockSize: 20, blockPrefetch: 0, datasourceRowCount: 1_000_000, datasource: { getRows } });
    await api.rows.ensureLoaded(0, 20);
    const calls = getRows.mock.calls.length;
    const result = inspectGridRow(api, "999999");
    expect(result).toMatchObject({ availability: "missing", visibility: "unknown", execution: { sorting: "datasource", filtering: "datasource" } });
    expect(getRows).toHaveBeenCalledTimes(calls);
  });

  it("uses a generic disabled handle reason where public options cannot explain more", () => {
    const api = grid({ pagination: { mode: "server", total: 1000, pageSize: 20 } });
    expect(inspectGridRow(api, "0").drag).toMatchObject({ allowed: false, reasons: [expect.objectContaining({ code: "HANDLE_DISABLED" })] });
    api.destroy();
    expect(inspectGridRow(api, "0")).toMatchObject({ availability: "destroyed", drag: { allowed: false, policyEvaluated: false } });
  });
});
