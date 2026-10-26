// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GridCore } from "../core/gridCore";
import type { ColDef } from "../types/colDef";
import type { GridOptions } from "../types/options";
const cores: GridCore[] = [];
function setup(options: GridOptions = {}) {
  const host = document.createElement("div"); document.body.append(host);
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 400 } });
  const core = new GridCore(host, { rowKey: "id", pagination: false, columnDefs: [{ field: "id" }, { field: "amount", editable: true }, { field: "day" }, { field: "state" }], ...options });
  cores.push(core); return { api: core.api, core };
}
beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => { cores.splice(0).forEach(core => core.destroy()); document.body.replaceChildren(); vi.restoreAllMocks(); });
describe("typed grid IO", () => {
  it("keeps long/zero-prefixed identifiers while coercing only finite safe numeric text", () => {
    const { api } = setup(); expect(api.io.importCsv("id,amount,day,state\n9007199254740993,12.50,2026-10-26,0012\n0010,,Infinity,1e309")).toBe(true);
    expect(api.rows.getById("9007199254740993")?.data).toEqual({ id: "9007199254740993", amount: 12.5, day: "2026-10-26", state: "0012" });
    expect(api.rows.getById("0010")?.data).toEqual({ id: "0010", amount: null, day: "Infinity", state: "1e309" });
  });
  it("passes typed dates/booleans/null directly and uses canonical values for XLSX output", () => {
    const { api } = setup({ columnDefs: [{ field: "id" }, { field: "amount", valueFormatter: () => "$ formatted" }, { field: "day" }, { field: "state" }] });
    const day = new Date("2026-10-26"), rows = [["id", "amount", "day", "state"], ["001", 12.5, day, true], ["002", null, null, false]];
    expect(api.io.importMatrix(rows)).toBe(true); expect(api.rows.getById("001")?.data?.day).toBe(day);
    expect(api.io.exportMatrix({ includeHeader: false })).toEqual([["001", 12.5, day, true], ["002", null, null, false]]);
    expect(api.io.exportCsv()).toContain("001,12.5");
  });
  it("uses default -> type list -> explicit hooks, then per-import override", () => {
    const parser = vi.fn<NonNullable<ColDef["valueParser"]>>(() => "column");
    const { api } = setup({ defaultColDef: { valueParser: () => "default" }, columnTypes: { first: { valueParser: () => "first" }, second: { valueParser: () => "second" } },
      columnDefs: [{ field: "id", valueParser: ({ value }) => String(value) }, { field: "amount", type: ["first", "second"] }, { field: "day", type: "first", valueParser: parser }, { field: "state" }] });
    expect(api.io.importMatrix([["a", "raw", "raw", "raw"]], { columns: ["id", "amount", "day", "state"] })).toBe(true);
    expect(api.rows.getById("a")?.data).toEqual({ id: "a", amount: "second", day: "column", state: "default" }); expect(parser.mock.calls[0][0]).toMatchObject({ source: "import", value: "raw" });
    const override = vi.fn(({ value }: { value: unknown }) => value);
    expect(api.io.importMatrix([["b", 2]], { columns: ["id", "amount"], parseValue: override })).toBe(true); expect(api.rows.getById("b")?.data).toEqual({ id: "b", amount: 2 });
  });
  it("keeps the synchronous record-loading bridge separate from interactive validation", () => {
    const validate = vi.fn(() => "Rejected"); const { api } = setup({ columnDefs: [{ field: "id" }, { field: "amount", validate }] });
    expect(api.io.importMatrix([["id", "amount"], ["a", 5]])).toBe(true); expect(validate).not.toHaveBeenCalled(); expect(api.rows.getById("a")?.data?.amount).toBe(5);
    expect(api.io.importMatrix([["b", 6]], { columns: ["id", "amount"], mode: "append" })).toBe(true); expect(api.rows.getCount()).toBe(2);
  });
  it("rejects unsafe/duplicate mappings and parser promises without changing current records", () => {
    const { api } = setup({ rowData: [{ id: "a", amount: 1 }] });
    expect(api.io.importMatrix([[1, 2]], { columns: ["amount", "amount"] })).toBe(false);
    expect(api.io.importMatrix([[1]], { columns: ["missing"] })).toBe(false);
    expect(api.io.importMatrix([[1]], { columns: ["amount"], parseValue: () => Promise.resolve(1) })).toBe(false);
    expect(api.rows.getById("a")?.data?.amount).toBe(1);
  });
  it("rejects a bad clipboard row before setters, preserving other valid rows and read-only fields", () => {
    const readonly = vi.fn(() => { throw new Error("must not parse"); });
    const { api, core } = setup({ rowData: [{ id: "a", amount: 1, day: 1, state: 0 }, { id: "b", amount: 2, day: 2, state: 0 }], columnDefs: [
      { field: "id" }, { field: "amount", editable: true, valueParser: ({ value }) => Number(value) },
      { field: "day", editable: true, valueParser: ({ value }) => { if (value === "bad") throw new Error("bad date"); return Number(value); } }, { field: "state", editable: false, valueParser: readonly }] });
    core.pasteText("9\tbad\tx\n8\t7\tx", 0, 1);
    expect(api.rows.getById("a")?.data).toMatchObject({ amount: 1, day: 1, state: 0 }); expect(api.rows.getById("b")?.data).toMatchObject({ amount: 8, day: 7, state: 0 }); expect(readonly).not.toHaveBeenCalled();
    expect(api.editing.undo()).toBe(true); expect(api.rows.getById("b")?.data?.amount).toBe(2);
  });
  it("preserves serializer output and protects formula strings unless explicitly disabled", () => {
    const { api } = setup({ rowData: [{ id: "a", amount: 1 }], columnDefs: [{ field: "id" }, { field: "amount", valueSerializer: () => "=SUM(A1)" }] });
    expect(api.io.exportMatrix({ includeHeader: false })).toEqual([["a", "'=SUM(A1)"]]);
    expect(api.io.exportMatrix({ includeHeader: false, protectFormulas: false })).toEqual([["a", "=SUM(A1)"]]);
    expect(api.io.exportCsv({ includeHeader: false })).toContain("'=SUM(A1)");
  });
  it.each([false, true])("gives exact colIds priority over another column's field, independent of order (%s)", reverse => {
    const columns: ColDef[] = [{ colId: "amount", field: "rawAmount" }, { colId: "other", field: "amount" }];
    const { api } = setup({ columnDefs: [{ field: "id" }, ...(reverse ? columns.reverse() : columns)] });
    expect(api.io.importMatrix([["a", 7]], { columns: ["id", "amount"] })).toBe(true);
    expect(api.rows.getById("a")?.data).toEqual({ id: "a", rawAmount: 7 });
    api.columns.setDefinitions([{ field: "id" }, { colId: "first", field: "shared" }, { colId: "second", field: "shared" }]);
    expect(api.io.importMatrix([["b", 8]], { columns: ["id", "shared"] })).toBe(false); expect(api.rows.getById("a")).toBeDefined();
  });
});
