// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGrid, type GridApi, type GridOptions } from "../index";

interface TreeRow { id?: string; value: number; children?: TreeRow[]; alternate?: TreeRow[] }
const mounted: GridApi<TreeRow>[] = [];

function mount(options: Partial<GridOptions<TreeRow>> = {}) {
  const host = document.createElement("div");
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 360 } });
  document.body.appendChild(host);
  const api = createGrid<TreeRow>(host, {
    treeData: true, rowKey: "id", pagination: false, rowSelection: "multiple",
    columnDefs: [{ field: "value", editable: true }],
    rowData: [{ id: "old", value: 1 }], ...options
  });
  mounted.push(api);
  return { api, host };
}

function chain(levels: number, prefix = "deep"): TreeRow {
  let row: TreeRow = { id: `${prefix}-${levels - 1}`, value: levels - 1 };
  for (let index = levels - 2; index >= 0; index--) row = { id: `${prefix}-${index}`, value: index, children: [row] };
  return row;
}

afterEach(() => {
  for (const api of mounted.splice(0)) api.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("tree replacement preparation", () => {
  it("rejects an invalid row-data option patch before changing other options or the reload source", async () => {
    const { api } = mount();
    const source = api.getOption("rowData");
    const size = api.getOption("size");
    expect(() => api.updateOptions({ rowData: [chain(257)], size: "large", rowSelection: "single" })).toThrow(/256/);
    expect(api.getOption("size")).toBe(size);
    expect(api.selection.getMode()).toBe("multiple");
    expect(api.getOption("rowData")).toBe(source);
    await api.rows.reload();
    expect(api.rows.getById("old")?.data?.value).toBe(1);
  });

  it("validates stored rows before enabling tree data", () => {
    const cycle: TreeRow = { id: "flat", value: 1 };
    cycle.children = [cycle];
    const { api } = mount({ treeData: false, rowData: [cycle] });
    expect(() => api.updateOptions({ treeData: true, rowSelection: "single" })).toThrow(/cyclic object graph/);
    expect(api.getOption("treeData")).toBe(false);
    expect(api.selection.getMode()).toBe("multiple");
    expect(api.view.getRoot()?.getAttribute("role")).toBe("grid");
    expect(api.rows.getById("flat")?.data).toBe(cycle);
  });

  it("validates stored rows with the candidate children key", () => {
    const cycle: TreeRow = { id: "flat", value: 1 };
    cycle.alternate = [cycle];
    const { api } = mount({ rowData: [cycle] });
    const size = api.getOption("size");
    expect(() => api.updateOptions({ childrenKey: "alternate", size: "large" })).toThrow(/cyclic object graph/);
    expect(api.getOption("childrenKey")).toBe("children");
    expect(api.getOption("size")).toBe(size);
    expect(api.rows.getById("flat")?.data).toBe(cycle);
  });

  it("uses the complete candidate when row data, tree mode and children key change together", () => {
    const cycle: TreeRow = { id: "flat", value: 1 };
    cycle.children = [cycle];
    const { api } = mount({ treeData: false, rowData: [cycle], defaultExpandAll: true });
    api.updateOptions({
      treeData: true, childrenKey: "alternate",
      rowData: [{ id: "next", value: 2, alternate: [{ id: "child", value: 3 }] }]
    });
    expect(api.getOption("treeData")).toBe(true);
    expect(api.getOption("childrenKey")).toBe("alternate");
    expect(api.rows.getCount()).toBe(2);
    expect(api.rows.getAt(1)?.id).toBe("child");
  });

  it("does not validate child graphs when the candidate disables tree mode", () => {
    const cycle: TreeRow = { id: "flat", value: 1 };
    cycle.children = [cycle];
    const { api } = mount();
    api.updateOptions({ treeData: false, rowData: [cycle] });
    expect(api.getOption("treeData")).toBe(false);
    expect(api.rows.getCount()).toBe(1);
    expect(api.rows.getById("flat")?.data).toBe(cycle);
  });

  it("retains edited data, selection and undo when a deep candidate is rejected", async () => {
    const { api, host } = mount();
    api.selection.setById("old", true);
    api.editing.startCell({ rowIndex: 0, colId: "value" });
    host.querySelector<HTMLInputElement>(".mach-editor-input")!.value = "2";
    await api.editing.stop();
    const previous = api.rows.getById("old");

    expect(() => api.rows.setData([chain(5001)])).toThrow(RangeError);
    expect(api.rows.getById("old")).toBe(previous);
    expect(api.rows.getById("old")?.data?.value).toBe(2);
    expect(api.selection.getIds()).toEqual(["old"]);
    expect(api.editing.getDirtyRowIds()).toEqual(["old"]);
    expect(api.editing.canUndo()).toBe(true);
    expect(api.editing.undo()).toBe(true);
    expect(api.rows.getById("old")?.data?.value).toBe(1);
  });

  it("leaves the current row editor mounted until a candidate has been prepared", () => {
    const { api, host } = mount({ editType: "fullRow" });
    api.editing.startRow(0);
    const input = host.querySelector<HTMLInputElement>(".mach-editor-input")!;
    input.value = "123";

    expect(() => api.rows.setData([chain(5001)])).toThrow(RangeError);
    expect(api.editing.isRowActive(0)).toBe(true);
    expect(host.querySelector(".mach-editor-input")).toBe(input);
    expect(input.value).toBe("123");
    expect(api.rows.getById("old")?.data?.value).toBe(1);
  });

  it("rejects ancestor cycles before replacing a generated-id tree", () => {
    const { api } = mount({ rowKey: undefined });
    const previous = api.rows.getAt(0);
    const cycle: TreeRow = { value: 9 };
    cycle.children = [cycle];

    expect(() => api.rows.setData([cycle])).toThrow(/cyclic object graph/);
    expect(api.rows.getAt(0)).toBe(previous);
    expect(api.rows.getCount()).toBe(1);
  });

  it("keeps duplicate-ID reporting for shared non-cyclic children", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onGridError = vi.fn();
    const { api } = mount({ onGridError, defaultExpandAll: true });
    const shared: TreeRow = { id: "shared", value: 3 };
    expect(() => api.rows.setData([
      { id: "left", value: 1, children: [shared] },
      { id: "right", value: 2, children: [shared] }
    ])).not.toThrow();
    expect(api.rows.getCount()).toBe(3);
    expect(onGridError).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ message: "Duplicate row id: shared" }) }));
  });

  it("supports shared non-cyclic child objects with generated IDs", () => {
    const { api } = mount({ rowKey: undefined, defaultExpandAll: true });
    const shared: TreeRow = { value: 3 };
    api.rows.setData([{ value: 1, children: [shared] }, { value: 2, children: [shared] }]);
    expect(api.rows.getCount()).toBe(4);
    expect(Array.from({ length: 4 }, (_, index) => api.rows.getAt(index)?.data?.value)).toEqual([1, 3, 2, 3]);
  });

  it("checks lazy children against their parent's depth before removing an old subtree", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { api } = mount({ rowData: [chain(256)], loadTreeChildren: async () => [chain(2, "lazy")] });
    const oldLeaf = api.rows.getById("deep-255");
    await expect(api.hierarchy.loadTreeChildren("deep-254", { force: true })).rejects.toThrow(/256/);
    expect(api.rows.getById("deep-255")).toBe(oldLeaf);
    expect(api.rows.getById("lazy-0")).toBeUndefined();
  });

  it("allows all 256 supported levels and rejects the next level before replacement", () => {
    const { api } = mount({ defaultExpandAll: true });
    api.rows.setData([chain(256)]);
    expect(api.rows.getCount()).toBe(256);
    expect(api.rows.getAt(255)?.id).toBe("deep-255");
    api.filtering.setQuickText("255");
    expect(api.rows.getCount()).toBe(256);
    expect(() => api.rows.setData([chain(257)])).toThrow(/256/);
    expect(api.rows.getAt(255)?.id).toBe("deep-255");
  });

  it("allows shared non-cyclic lazy children without a stable row key", async () => {
    const shared: TreeRow = { value: 7 };
    const { api } = mount({ rowKey: undefined, loadTreeChildren: async () => [shared, shared] });
    const parent = api.rows.getAt(0)!;
    await api.hierarchy.loadTreeChildren(parent.id);
    const values: (number | undefined)[] = [];
    api.rows.forEach(node => values.push(node.data?.value));
    expect(values).toEqual([1, 7, 7]);
  });

  it("retains the last accepted data snapshot for a reload after rejecting a candidate", async () => {
    const { api } = mount();
    expect(() => api.rows.setData([chain(257)])).toThrow(/256/);
    await api.rows.reload();
    expect(api.rows.getById("old")?.data?.value).toBe(1);
    expect(api.rows.getCount()).toBe(1);
  });

  it("does not invalidate queued writes when candidate preparation fails", async () => {
    const { api } = mount();
    const pending = api.rows.transactAsync({ update: [{ id: "old", value: 8 }] });
    expect(() => api.rows.setData([chain(257)])).toThrow(/256/);
    await pending;
    expect(api.rows.getById("old")?.data?.value).toBe(8);
  });

  it("validates added trees before applying any part of a transaction", () => {
    const { api } = mount();
    expect(() => api.rows.transact({ remove: [{ id: "old", value: 1 }], add: [chain(5001)] })).toThrow(RangeError);
    expect(api.rows.getById("old")?.data?.value).toBe(1);
    expect(api.rows.getCount()).toBe(1);
  });
});
