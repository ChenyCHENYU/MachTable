// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GridCore } from "../core/gridCore";
import { resolveOptions } from "../core/resolveOptions";
import type { GridOptions } from "../types/options";

const cores: GridCore[] = [];
function setup(options: GridOptions = {}) {
  const host = document.createElement("div"); document.body.append(host);
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 400 } });
  const core = new GridCore(host, { columnDefs: [{ field: "id" }, { field: "value", editable: true }], rowData: [{ id: "a", value: "old" }], rowKey: "id", pagination: false, ...options });
  cores.push(core); return { core, api: core.api, host };
}
beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => undefined); vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => { cores.splice(0).forEach(core => core.destroy()); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("shared option normalization", () => {
  it.each([
    { key: "rowHeight", initial: 36, previous: 48, accepted: 1.25, result: 1.25, rejected: 0.5 },
    { key: "rowBuffer", initial: 8, previous: 12, accepted: 0.75, result: 0, rejected: -1 },
    { key: "undoStackSize", initial: 100, previous: 12, accepted: 3.75, result: 3, rejected: -1 },
    { key: "tooltipShowDelay", initial: 600, previous: 12, accepted: 0.75, result: 0.75, rejected: -1 },
    { key: "blockSize", initial: 100, previous: 12, accepted: 1.75, result: 1, rejected: 0.5 },
    { key: "dataProcessorMinRows", initial: 5000, previous: 12, accepted: 1.75, result: 1, rejected: 0.5 }
  ] as const)("keeps initial fallbacks and patch ignore/floor semantics for $key", ({ key, initial, previous, accepted, result, rejected }) => {
    const { api } = setup({ [key]: previous });
    for (const value of [undefined, null, NaN, Infinity, -Infinity, "12", rejected]) {
      const patch = { [key]: value } as unknown as GridOptions;
      expect(resolveOptions(patch)[key]).toBe(initial);
      api.updateOptions(patch); expect(api.getOption(key)).toBe(previous);
    }
    expect(resolveOptions({ [key]: accepted })[key]).toBe(result);
    api.updateOptions({ [key]: accepted }); expect(api.getOption(key)).toBe(result);
  });
  it("preserves zero and clamps retry jitter consistently", () => {
    expect(Object.is(resolveOptions({ rowBuffer: -0 }).rowBuffer, -0)).toBe(true);
    const { api } = setup({ datasourceRetryJitter: 0.5 });
    for (const [value, expected] of [[0, 0], [0.25, 0.25], [1.5, 1], [-1, 1], [Infinity, 1]] as const) {
      api.updateOptions({ datasourceRetryJitter: value }); expect(api.getOption("datasourceRetryJitter")).toBe(expected);
    }
  });
  it("normalizes persistence identically without sharing section arrays or replacing stores", () => {
    const store = { load: vi.fn(() => null), save: vi.fn() }, sections = ["columns", "sort", "columns"] as const;
    const value = { key: "  orders  ", debounceMs: 1.75, sections, store };
    const initial = resolveOptions({ persistence: value }).persistence;
    const { api } = setup(); api.updateOptions({ persistence: value }); const updated = api.getOption("persistence");
    expect(initial).toEqual({ key: "orders", debounceMs: 1, sections: ["columns", "sort"], store }); expect(updated).toEqual(initial);
    expect(initial?.sections).not.toBe(sections); expect(initial?.store).toBe(store);
    for (const debounceMs of [undefined, null, NaN, Infinity, -1, "3"]) {
      const persistence = { key: "orders", debounceMs } as unknown as NonNullable<GridOptions["persistence"]>;
      api.updateOptions({ persistence }); expect(api.getOption("persistence")).toMatchObject({ debounceMs: 160 });
      expect(resolveOptions({ persistence }).persistence).toMatchObject({ debounceMs: 160 });
    }
    for (const persistence of [undefined, null, false, { key: " " }]) {
      api.updateOptions({ persistence } as unknown as GridOptions); expect(api.getOption("persistence")).toBeNull();
      expect(resolveOptions({ persistence } as unknown as GridOptions).persistence).toBeNull();
    }
  });
  it("copies false values but ignores nullish booleans, while explicit callback undefined clears", () => {
    const validator = vi.fn(() => null), menu = vi.fn(() => []);
    const { api } = setup({ multiSort: true, singleClickEdit: true, manualSorting: true, manualFiltering: true, rowEditValidator: validator, getContextMenuItems: menu });
    api.updateOptions({ multiSort: false, singleClickEdit: false, manualSorting: false, manualFiltering: false });
    expect(["multiSort", "singleClickEdit", "manualSorting", "manualFiltering"].map(key => api.getOption(key as keyof GridOptions))).toEqual([false, false, false, false]);
    api.updateOptions({ multiSort: null, singleClickEdit: undefined } as unknown as GridOptions); expect(api.getOption("multiSort")).toBe(false); expect(api.getOption("singleClickEdit")).toBe(false);
    api.updateOptions({ rowHeight: 40 }); expect(api.getOption("rowEditValidator")).toBe(validator); expect(api.getOption("getContextMenuItems")).toBe(menu);
    api.updateOptions({ rowEditValidator: undefined, getContextMenuItems: undefined }); expect(api.getOption("rowEditValidator")).toBeUndefined(); expect(api.getOption("getContextMenuItems")).toBeUndefined();
  });
  it("retains observable edit-cancel ordering before plain editing policies change", () => {
    const { api } = setup({ manualSorting: false }); let observed: unknown;
    api.on("cellEditingStopped", () => { observed = api.getOption("manualSorting"); });
    expect(api.editing.startCell({ rowIndex: 0, colId: "value" })).toBe(true);
    api.updateOptions({ editType: "fullRow", manualSorting: true });
    expect(observed).toBe(false); expect(api.getOption("manualSorting")).toBe(true);
  });
});
