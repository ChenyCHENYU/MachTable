// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GridCore } from "../core/gridCore";
import type { GridOptions } from "../types/options";
interface Row { id: string; code: string; amount: number | null; day: Date | null; state: number | null }
const cores: GridCore<Row>[] = [];
function setup(options: Partial<GridOptions<Row>> = {}) {
  const host = document.createElement("div");
  Object.defineProperties(host, { clientWidth: { value: 900 }, clientHeight: { value: 400 } });
  document.body.append(host);
  const core = new GridCore<Row>(host, { rowKey: "id", pagination: false,
    columnTypes: {
      id: { valueParser: ({ value }) => value == null ? "" : String(value) },
      decimal: { valueParser: ({ value }) => value == null || value === "" ? null : Number(value), filter: "number" },
      day: { valueParser: ({ value }) => value == null || value === "" ? null : new Date(String(value)), filter: "date" },
      status: { valueParser: ({ value }) => value === "enabled" ? 1 : value === "disabled" ? 0 : null, filter: "set" }
    },
    columnDefs: [{ field: "code", type: "id", editable: true }, { field: "amount", type: "decimal", editable: true },
      { field: "day", type: "day", editable: true }, { field: "state", type: "status", editable: true }],
    rowData: [{ id: "a", code: "001", amount: 1, day: null, state: null }, { id: "b", code: "002", amount: 2, day: null, state: 0 }], ...options });
  cores.push(core); return { core, api: core.api, host };
}
beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => { cores.splice(0).forEach(core => core.destroy()); document.body.replaceChildren(); vi.restoreAllMocks(); });
describe("column value policy", () => {
  it("parses clipboard values before storage, then shares canonical values with sort/filter and undo", () => {
    const { core, api } = setup();
    core.pasteText("9007199254740993\t12.50\t2026-10-26\tenabled", 0, 0);
    const row = api.rows.getById("a")!.data!;
    expect(row).toMatchObject({ code: "9007199254740993", amount: 12.5, state: 1 });
    expect(row.day).toEqual(new Date("2026-10-26"));
    api.sorting.setModel([{ colId: "amount", direction: "desc" }]); expect(api.rows.getAt(0)?.id).toBe("a");
    api.filtering.setModel({ state: { type: "set", values: [1] } }); expect(api.rows.getCount()).toBe(1);
    api.filtering.setModel(null); expect(api.editing.undo()).toBe(true);
    expect(api.rows.getById("a")?.data).toMatchObject({ code: "001", amount: 1, day: null, state: null });
    expect(api.editing.redo()).toBe(true); expect(api.rows.getById("a")?.data?.state).toBe(1);
    api.rows.transact({ update: [{ ...row, state: 99 }] }); expect(api.rows.getById("a")?.data?.state).toBe(99);
  });
  it.each(["cell", "fullRow"] as const)("parses %s editors before validation and preserves rejected drafts", async mode => {
    const validate = vi.fn((value: number) => value >= 0 || "Negative");
    const { api, host } = setup({ editType: mode, columnDefs: [{ field: "amount", editable: true, cellEditor: "text",
      valueParser: ({ value }) => { if (value === "bad") throw new Error("Invalid decimal"); return Number(value); }, validate }] });
    if (mode === "fullRow") api.editing.startRow(0); else api.editing.startCell({ rowIndex: 0, colId: "amount" });
    const input = host.querySelector<HTMLInputElement>(".mach-cell input")!; input.value = "bad";
    expect(await api.editing.stop()).toBe(false); expect(input.isConnected).toBe(true); expect(api.rows.getById("a")?.data?.amount).toBe(1);
    input.value = "12.50"; expect(await api.editing.stop()).toBe(true);
    expect(validate).toHaveBeenLastCalledWith(12.5, expect.any(Object)); expect(api.rows.getById("a")?.data?.amount).toBe(12.5);
  });
  it("serializes outputs explicitly and keeps numeric CSV and display formatter defaults", () => {
    const { core, api, host } = setup({ columnDefs: [{ field: "code", valueFormatter: () => "display", valueSerializer: ({ value, target }) => `${target}:${value}` },
      { field: "amount", valueFormatter: ({ value }) => `$${value}` }] });
    expect(core.buildRangeTsv({ r1: 0, r2: 0, c1: 0, c2: 1 })).toBe("clipboard:001\t$1");
    expect(api.io.exportCsv({ includeHeader: false, prependBOM: false })).toContain("csv:001,1"); expect(host.textContent).toContain("display");
  });
  it("commits the validated canonical row values after an editor is virtualized during async validation", async () => {
    let resolve!: (value: null) => void; const validation = new Promise<null>(done => resolve = done);
    const parser = vi.fn(({ value }: { value: unknown }) => value === "enabled" ? 1 : 0);
    const { api, core, host } = setup({ editType: "fullRow", columnDefs: [{ field: "state", editable: true, cellEditor: "text", valueParser: parser, validate: () => validation }] });
    api.editing.startRow(0); const cell = host.querySelector<HTMLElement>('.mach-row[data-index="0"] .mach-cell[data-col-id="state"]')!;
    cell.querySelector<HTMLInputElement>("input")!.value = "enabled";
    const stop = api.editing.stop(); core.editingService.releaseCell(0, "state", cell); resolve(null);
    expect(await stop).toBe(true); expect(api.rows.getById("a")?.data?.state).toBe(1); expect(parser).toHaveBeenCalledTimes(1);
  });
  it("retries a rejected offscreen row from its original raw draft instead of parsing the enum twice", async () => {
    let invalid = true; const parser = vi.fn(({ value }: { value: unknown }) => value === "enabled" ? 1 : 0);
    const { api, core, host } = setup({ editType: "fullRow", columnDefs: [{ field: "state", editable: true, cellEditor: "text", valueParser: parser, validate: () => invalid ? "Retry" : null }] });
    api.editing.startRow(0); const cell = host.querySelector<HTMLElement>('.mach-row[data-index="0"] .mach-cell[data-col-id="state"]')!;
    cell.querySelector<HTMLInputElement>("input")!.value = "enabled"; expect(await api.editing.stop()).toBe(false);
    core.editingService.releaseCell(0, "state", cell); invalid = false;
    expect(await api.editing.stop()).toBe(true); expect(api.rows.getById("a")?.data?.state).toBe(1);
    expect(parser.mock.calls.map(([params]) => params.value)).toEqual(["enabled", "enabled"]);
  });
});
