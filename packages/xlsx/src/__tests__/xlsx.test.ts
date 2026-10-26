// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createXlsxExtension, exportGridToXlsx, importGridFromXlsx, type XlsxEngine } from "../index";
import { createGrid, type GridApi } from "@agile-team/mach-table";
function engine(): XlsxEngine {
  return { utils: { book_new: () => ({ SheetNames: [], Sheets: {} }), aoa_to_sheet: rows => rows,
    book_append_sheet: (book, sheet, name = "Sheet1") => { book.SheetNames.push(name); book.Sheets[name] = sheet; }, sheet_to_json: sheet => sheet as unknown[][] },
    writeFileXLSX: vi.fn(), read: data => data as ReturnType<XlsxEngine["utils"]["book_new"]> };
}
function grid(matrix: unknown[][] = [["A"], [1]]) {
  const listeners = new Map<string, Set<() => void>>(); let destroyed = false, generation = 0;
  const exportMatrix = vi.fn(() => matrix), importMatrix = vi.fn<GridApi["io"]["importMatrix"]>(() => true);
  const api = { io: { exportMatrix, importMatrix }, isDestroyed: () => destroyed,
    on: (type: string, listener: () => void) => { const list = listeners.get(type) ?? new Set<() => void>(); list.add(listener); listeners.set(type, list); return () => { list.delete(listener); if (!list.size) listeners.delete(type); }; } } as unknown as GridApi;
  Object.defineProperty(api, Symbol.for("mach-table.adapter.lifecycle.v1"), { value: { canReplaceData: () => true } });
  Object.defineProperty(api, Symbol.for("mach-table.import.v1"), { value: { begin: () => { const serial = ++generation; return () => serial === generation && !destroyed; } } });
  return { api, exportMatrix, importMatrix, interrupt: () => generation++, changed: (type = "modelUpdated") => listeners.get(type)?.forEach(listener => listener()), destroy: () => { destroyed = true; }, listeners };
}
afterEach(() => { document.body.replaceChildren(); });
describe("typed optional XLSX extension", () => {
  it("loads on demand and preserves typed cells without a CSV allocation", async () => {
    const adapter = engine(), loader = vi.fn(async () => ({ default: adapter }));
    const matrix = [["code", "amount", "date", "enabled"], ["9007199254740993", 12.5, new Date("2026-10-26"), true], ["0012", null, null, false]];
    const { api, exportMatrix } = grid(matrix); const workbook = await exportGridToXlsx(api, loader, { fileName: "report", sheetName: "B/Data" });
    expect(loader).toHaveBeenCalledOnce(); expect(exportMatrix).toHaveBeenCalledWith({ fileName: "report", sheetName: "B/Data", target: "xlsx" });
    expect(workbook.Sheets["B Data"]).toBe(matrix); expect(adapter.writeFileXLSX).toHaveBeenCalledWith(workbook, "report.xlsx", undefined);
  });
  it("reads raw typed cells directly and enables Date decoding by default", async () => {
    const adapter = engine(); const rows = [["code", "amount", "day", "enabled"], ["9007199254740993", 12.5, new Date("2026-10-26"), true]];
    const workbook = { SheetNames: ["Data"], Sheets: { Data: rows } }; adapter.read = vi.fn(() => workbook); adapter.utils.sheet_to_json = vi.fn(() => rows);
    const { api, importMatrix } = grid(); expect(await importGridFromXlsx(api, adapter, workbook, { mode: "append" })).toBe(true);
    expect(adapter.read).toHaveBeenCalledWith(workbook, { cellDates: true }); expect(adapter.utils.sheet_to_json).toHaveBeenCalledWith(rows, { header: 1, raw: true });
    expect(importMatrix).toHaveBeenCalledWith(rows, expect.objectContaining({ mode: "append" }));
  });
  it("uses column parsers and serializers end to end while keeping formula-injection protection", async () => {
    const host = document.createElement("div"); document.body.append(host);
    const api = createGrid<{ id: string; amount: number; day: Date; state: number }>(host, { rowKey: "id", pagination: false,
      columnDefs: [{ field: "id", valueParser: ({ value }) => String(value) }, { field: "amount", valueParser: ({ value }) => Number(value) },
        { field: "day", valueParser: ({ value }) => value instanceof Date ? value : new Date(String(value)) },
        { field: "state", valueParser: ({ value }) => value === "Enabled" ? 1 : 0, valueSerializer: ({ value }) => value === 1 ? "Enabled" : "Disabled" }] });
    const adapter = engine(), date = new Date("2026-10-26");
    await importGridFromXlsx(api, adapter, { SheetNames: ["Data"], Sheets: { Data: [["id", "amount", "day", "state"], ["9007199254740993", 12.5, date, "Enabled"]] } });
    expect(api.rows.getById("9007199254740993")?.data).toEqual({ id: "9007199254740993", amount: 12.5, day: date, state: 1 });
    const workbook = await exportGridToXlsx(api, adapter); expect((workbook.Sheets.Data as unknown[][])[1]).toEqual(["9007199254740993", 12.5, date, "Enabled"]);
    api.rows.setData([{ id: "=ALERT()", amount: 1, day: date, state: 0 }]);
    expect((await exportGridToXlsx(api, adapter)).Sheets.Data).toEqual([["id", "amount", "day", "state"], ["'=ALERT()", 1, date, "Disabled"]]); api.destroy();
  });
  it("keeps explicit legacy string transforms and supports generic writers", async () => {
    const adapter = engine(), writeFile = vi.fn(); delete adapter.writeFileXLSX; adapter.writeFile = writeFile;
    const transformCell = vi.fn((value: string, row: number) => row === 1 ? Number(value) + 1 : value);
    const workbook = await exportGridToXlsx(grid([["Value"], [42]]).api, adapter, { fileName: "../report.XLSX", sheetName: "/?:*[]", transformCell });
    expect(workbook.Sheets.Data).toEqual([["Value"], [43]]); expect(writeFile).toHaveBeenCalledWith(workbook, ".. report.XLSX", undefined);
    const { api, importMatrix } = grid(); const parseValue = vi.fn(({ value }: { value: string }) => value);
    await importGridFromXlsx(api, adapter, { SheetNames: ["Data"], Sheets: { Data: [["x"], [12]] } }, { parseValue, columns: ["x"], headerRowIndex: -1, readOptions: { cellDates: false } });
    const options = importMatrix.mock.calls[0][1]!; expect(options.columns).toEqual(["x"]); expect(options.parseValue!({ value: 12, field: "x", rowIndex: 0, columnIndex: 0 })).toBe("12");
  });
  it.each([
    { returned: undefined, expected: "12.5" },
    { returned: null, expected: "12.5" },
    { returned: false, expected: false },
    { returned: 0, expected: 0 },
    { returned: "", expected: "" }
  ])("preserves the legacy transform fallback for $returned", async ({ returned, expected }) => {
    const transformCell = vi.fn((value: string, row: number) => row === 1 ? returned : value);
    const workbook = await exportGridToXlsx(grid([["Value"], [12.5]]).api, engine(), { transformCell });
    expect(transformCell).toHaveBeenNthCalledWith(2, "12.5", 1, 0);
    expect(workbook.Sheets.Data).toEqual([["Value"], [expected]]);
  });
  it("creates a reusable lazy extension", async () => {
    const loader = vi.fn(async () => engine()), extension = createXlsxExtension(loader), { api } = grid(); expect(loader).not.toHaveBeenCalled();
    await extension.export(api); await extension.import(api, { SheetNames: ["Data"], Sheets: { Data: [["A"], [1]] } }); expect(loader).toHaveBeenCalledTimes(2);
  });
  it.each(["modelUpdated", "cellValueChanged", "cellEditingStarted", "rowEditingStarted", "destroy"])("ignores a late engine after %s changes and releases listeners", async action => {
    let resolve!: (value: XlsxEngine) => void; const loaded = new Promise<XlsxEngine>(done => resolve = done); const state = grid();
    const result = importGridFromXlsx(state.api, () => loaded, {}); if (action === "destroy") state.destroy(); else state.changed(action); resolve(engine());
    expect(await result).toBe(false); expect(state.importMatrix).not.toHaveBeenCalled(); expect(state.listeners.size).toBe(0);
  });
  it("cancels an older lazy import when another input or import begins", async () => {
    let resolve!: (value: XlsxEngine) => void; const loaded = new Promise<XlsxEngine>(done => resolve = done), state = grid();
    const workbook = { SheetNames: ["Data"], Sheets: { Data: [["A"], [1]] } };
    const first = importGridFromXlsx(state.api, () => loaded, workbook); state.interrupt(); resolve(engine());
    expect(await first).toBe(false); expect(state.importMatrix).not.toHaveBeenCalled();
    let complete!: (value: XlsxEngine) => void; const waiting = new Promise<XlsxEngine>(done => complete = done);
    const older = importGridFromXlsx(state.api, () => waiting, workbook), newer = importGridFromXlsx(state.api, engine(), workbook);
    expect(await newer).toBe(true); complete(engine()); expect(await older).toBe(false); expect(state.importMatrix).toHaveBeenCalledTimes(1);
  });
  it("preserves a later pending paste and a currently active editor", async () => {
    const host = document.createElement("div"); document.body.append(host);
    let validate!: (value: null) => void; const check = new Promise<null>(done => validate = done);
    const api = createGrid<{ id: string; amount: number }>(host, { rowKey: "id", pagination: false,
      columnDefs: [{ field: "id" }, { field: "amount", editable: true, cellEditor: "text", validate: () => check }], rowData: [{ id: "a", amount: 1 }] });
    let resolve!: (value: XlsxEngine) => void; const loaded = new Promise<XlsxEngine>(done => resolve = done);
    const result = importGridFromXlsx(api, () => loaded, { SheetNames: ["Data"], Sheets: { Data: [["id", "amount"], ["x", 9]] } });
    expect(api.editing.startCell({ rowIndex: 0, colId: "amount" })).toBe(true);
    const input = host.querySelector<HTMLInputElement>("input")!; input.value = "5"; const stop = api.editing.stop(); resolve(engine());
    expect(await result).toBe(false); validate(null); expect(await stop).toBe(true); expect(api.rows.getById("a")?.data?.amount).toBe("5"); api.destroy();
  });
  it("cancels on engine read reentrancy and accepts no writes from an already destroyed API", async () => {
    const state = grid(), adapter = engine(); adapter.read = () => { state.changed("cellValueChanged"); return { SheetNames: ["Data"], Sheets: { Data: [["A"], [1]] } }; };
    expect(await importGridFromXlsx(state.api, adapter, {})).toBe(false); expect(state.importMatrix).not.toHaveBeenCalled(); state.destroy();
    expect(await importGridFromXlsx(state.api, adapter, {})).toBe(false);
  });
  it("does not replace a later paste whose async validation has not emitted value events yet", async () => {
    const host = document.createElement("div"); document.body.append(host);
    let validate!: (value: null) => void; const check = new Promise<null>(done => validate = done);
    const api = createGrid<{ id: string; amount: number }>(host, { rowKey: "id", pagination: false,
      columnDefs: [{ field: "id" }, { field: "amount", editable: true, validate: () => check }], rowData: [{ id: "a", amount: 1 }] });
    let resolve!: (value: XlsxEngine) => void; const loaded = new Promise<XlsxEngine>(done => resolve = done);
    const result = importGridFromXlsx(api, () => loaded, { SheetNames: ["Data"], Sheets: { Data: [["id", "amount"], ["x", 9]] } });
    expect(api.io.importMatrix([[5]], { columns: ["amount"], mode: "paste" })).toBe(true); expect(api.editing.getDirtyRowIds()).toEqual([]);
    const applied = new Promise<void>(done => api.on("cellValueChanged", () => done()));
    resolve(engine()); expect(await result).toBe(false); validate(null); await applied;
    expect(api.rows.getById("a")?.data?.amount).toBe(5); expect(api.rows.getById("x")).toBeUndefined(); api.destroy();
  });
  it("rejects invalid engines, workbooks, worksheets and rows", async () => {
    const { api } = grid(); await expect(exportGridToXlsx(api, null as unknown as XlsxEngine)).rejects.toThrow("Invalid XLSX engine");
    const adapter = engine(); delete adapter.writeFileXLSX; await expect(exportGridToXlsx(api, adapter)).rejects.toThrow("must expose");
    delete adapter.read; await expect(importGridFromXlsx(api, adapter, {})).rejects.toThrow("requires engine.read");
    adapter.read = () => null as any; await expect(importGridFromXlsx(api, adapter, {})).rejects.toThrow("invalid workbook");
    adapter.read = () => ({ SheetNames: ["Data"], Sheets: { Data: [] } }); await expect(importGridFromXlsx(api, adapter, {}, { sheet: "Missing" })).rejects.toThrow("Worksheet not found");
    adapter.utils.sheet_to_json = () => null as any; await expect(importGridFromXlsx(api, adapter, {})).rejects.toThrow("array of rows");
  });
});
