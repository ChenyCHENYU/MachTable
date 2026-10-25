// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGrid } from "../index";
import { createMultiRangeSelection } from "../multiRange";
import type { GridApi } from "../types/api";

interface Row { id: string; name: string; amount: number }
const apis: GridApi<Row>[] = [];
function grid() {
  const host = document.createElement("div");
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 400 } });
  document.body.append(host);
  const ranges = createMultiRangeSelection();
  const api = createGrid<Row>(host, {
    rowKey: "id", pagination: false, enableRangeSelection: true, features: [ranges],
    columnDefs: [{ field: "id" }, { field: "name", editable: true }, {
      field: "amount", editable: true, valueFormatter: ({ value }) => `$${value}`,
      validate: value => value == null ? "Required" : null
    }],
    rowData: [{ id: "a", name: "Alpha", amount: 2 }, { id: "b", name: "Beta", amount: 3 }, { id: "c", name: "Gamma", amount: 4 }]
  });
  apis.push(api);
  const cell = (index: number, column: string) => host.querySelector<HTMLElement>(`.mach-row[data-index="${index}"] .mach-cell[data-col-id="${column}"]`)!;
  const click = (index: number, column: string, ctrlKey = false) => {
    cell(index, column).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, ctrlKey }));
    window.dispatchEvent(new MouseEvent("mouseup"));
  };
  return { api, ranges, host, click };
}

afterEach(() => { apis.splice(0).forEach(api => api.destroy()); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("optional multi-range selection", () => {
  it("adds rectangles with Ctrl/Cmd while preserving Core's active range", () => {
    const { api, ranges, click } = grid();
    click(0, "name");
    click(2, "amount", true);
    expect(ranges.getRanges()).toEqual([
      { row1: 0, row2: 0, colId1: "name", colId2: "name" },
      { row1: 2, row2: 2, colId1: "amount", colId2: "amount" }
    ]);
    expect(api.selection.getRange()?.row1).toBe(2);
    expect(ranges.getText()).toBe("Alpha\n\n$4");
    click(1, "name");
    expect(ranges.getRanges()).toHaveLength(1);
  });

  it("uses the shared formatter and clipboard event without clipboard permissions", () => {
    const { ranges, click, host } = grid();
    click(0, "name");
    click(1, "amount", true);
    const setData = vi.fn();
    const event = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { setData } });
    host.querySelector(".mach-root")!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(setData).toHaveBeenCalledWith("text/plain", ranges.getText());
  });

  it("deduplicates overlapping cells and validates all cleared ranges as one undoable input", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { api, ranges } = grid();
    ranges.setRanges([
      { row1: 0, row2: 1, colId1: "name", colId2: "name" },
      { row1: 1, row2: 1, colId1: "name", colId2: "amount" },
      { row1: 2, row2: 2, colId1: "name", colId2: "name" }
    ]);
    const changed = vi.fn();
    api.on("cellValueChanged", changed);
    ranges.clearValues();
    expect(api.rows.getById("a")?.data?.name).toBeNull();
    expect(api.rows.getById("b")?.data).toMatchObject({ name: "Beta", amount: 3 });
    expect(api.rows.getById("c")?.data?.name).toBeNull();
    expect(changed).toHaveBeenCalledTimes(2);
    expect(api.editing.undo()).toBe(true);
    expect(api.rows.getById("a")?.data?.name).toBe("Alpha");
    expect(api.rows.getById("c")?.data?.name).toBe("Gamma");
    expect(api.editing.canUndo()).toBe(false);
  });

  it("clears multi-ranges with Delete, while editor keys remain editor-owned", () => {
    const { api, ranges, click, host } = grid();
    click(0, "name"); click(2, "name", true);
    host.querySelector(".mach-root")!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Delete" }));
    expect(api.rows.getById("a")?.data?.name).toBeNull();
    expect(api.rows.getById("c")?.data?.name).toBeNull();
    expect(ranges.getRanges()).toHaveLength(2);
    api.editing.undo();
    api.editing.startCell({ rowIndex: 0, colId: "name" });
    const input = host.querySelector<HTMLInputElement>(".mach-editor-input")!;
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Delete" }));
    expect(api.rows.getById("a")?.data?.name).toBe("Alpha");
  });

  it("does not reinterpret stored coordinates after same-ID row replacement", () => {
    const { api, ranges, click } = grid();
    click(0, "name"); click(2, "name", true);
    api.rows.setData([{ id: "a", name: "Replacement", amount: 8 }]);
    expect(ranges.getRanges()).toEqual([]);
    ranges.clearValues();
    expect(api.rows.getById("a")?.data?.name).toBe("Replacement");
  });

  it("bounds explicit selection and releases feature ownership on hot replacement", () => {
    const { api, ranges, host } = grid();
    expect(() => ranges.setRanges(Array.from({ length: 33 }, () => ({ row1: 0, row2: 0, colId1: "name", colId2: "name" })))).toThrow(/32/);
    ranges.setRanges([{ row1: 0, row2: 0, colId1: "name", colId2: "name" }]);
    api.updateOptions({ features: [] });
    expect(ranges.getRanges()).toEqual([]);
    expect(host.querySelector(".mach-cell--multi-range")).toBeNull();
    expect(() => ranges.setRanges([])).toThrow(/Install/);
  });

  it("keeps the installed selection when a replacement exceeds the cell budget", () => {
    const { api, ranges, click } = grid();
    api.rows.setData(Array.from({ length: 33_334 }, (_, index) => ({ id: String(index), name: "Row", amount: index })));
    click(1, "name");
    const before = ranges.getRanges();
    expect(() => ranges.setRanges([{ row1: 0, row2: 33_333, colId1: "id", colId2: "amount" }])).toThrow(/100000/);
    expect(ranges.getRanges()).toEqual(before);
    expect(api.selection.getRange()).toEqual(before[0]);
  });

  it("releases feature state when observer setup fails and permits reinstalling it", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { api, ranges } = grid();
    api.updateOptions({ features: [] });
    const observe = vi.spyOn(MutationObserver.prototype, "observe").mockImplementation(() => { throw new Error("observe failed"); });
    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    api.updateOptions({ features: [ranges] });
    expect(disconnect).toHaveBeenCalledOnce();
    expect(() => ranges.setRanges([])).toThrow(/Install/);
    observe.mockRestore();
    api.updateOptions({ features: [] });
    api.updateOptions({ features: [ranges] });
    expect(() => ranges.setRanges([])).not.toThrow();
  });
});
