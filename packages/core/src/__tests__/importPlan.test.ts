// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GridCore } from "../core/gridCore";
import { createImportPlan } from "../import";
import type { GridOptions } from "../types/options";
interface Row { id: string; amount: number; meta?: { note: string }; day?: Date; extra?: string }
const cores: GridCore<Row>[] = [];
function setup(options: Partial<GridOptions<Row>> = {}) {
  const host = document.createElement("div"); document.body.append(host);
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 400 } });
  const core = new GridCore<Row>(host, { rowKey: "id", pagination: false, columnDefs: [{ field: "id" }, { field: "amount", editable: true, valueParser: ({ value }) => Number(value), validate: value => value < 0 ? "Negative amount" : null }],
    rowData: [{ id: "a", amount: 1 }, { id: "b", amount: 2 }], ...options });
  cores.push(core); return { core, api: core.api };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => resolve = done); return { promise, resolve }; }
beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => { cores.splice(0).forEach(core => core.destroy()); document.body.replaceChildren(); vi.restoreAllMocks(); });
describe("bounded import plans", () => {
  it("previews typed records without changing the grid or caller, preserves extra data, and commits once", async () => {
    const { api } = setup({ columnDefs: [{ field: "amount", valueParser: ({ value }) => Number(value) }, { field: "meta.note", valueParser: ({ value }) => String(value).toUpperCase() }] });
    const source = [{ id: "9007199254740993", amount: "12.50", meta: { note: "hello" }, extra: "keep", day: new Date("2026-10-26") }];
    const plan = createImportPlan(api, { kind: "rows", rows: source as unknown as Row[] });
    const preview = await plan.preview(); expect(preview.status).toBe("ready"); expect(api.rows.getById("a")?.data?.amount).toBe(1);
    expect(source[0].meta.note).toBe("hello"); source[0].meta.note = "outside";
    (preview.cells.find(cell => cell.colId === "meta.note") as { value: unknown }).value = "tampered";
    expect(await plan.commit()).toMatchObject({ status: "applied", importedRowCount: 1 });
    expect(api.rows.getById("9007199254740993")?.data).toEqual({ id: "9007199254740993", amount: 12.5, meta: { note: "HELLO" }, extra: "keep", day: new Date("2026-10-26") });
    expect(await plan.commit()).toMatchObject({ status: "stale", importedRowCount: 0 }); plan.destroy();
  });
  it.each(["replace", "append"] as const)("rejects an invalid %s as a complete batch, including row rules", async mode => {
    const { api } = setup({ rowEditValidator: ({ values }) => values.amount === 7 ? "Reserved amount" : null });
    const plan = createImportPlan(api, { kind: "matrix", rows: [["id", "amount"], ["c", 7], ["d", 4]] }, { mode });
    expect(await plan.preview()).toMatchObject({ status: "invalid", rowCount: 2, issues: [expect.objectContaining({ rowIndex: 0, message: "Reserved amount" })] });
    expect(await plan.commit()).toMatchObject({ status: "invalid", importedRowCount: 0 }); expect(api.rows.getCount()).toBe(2); plan.destroy();
  });
  it("uses the existing row-atomic setters and one undo batch for partially valid paste", async () => {
    const { api } = setup(); const changed = vi.fn(); api.on("cellValueChanged", changed);
    const plan = createImportPlan(api, { kind: "matrix", rows: [[-1], [12.5]] }, { mode: "paste", columns: ["amount"] });
    expect(await plan.preview()).toMatchObject({ status: "invalid", rowCount: 2 });
    expect(await plan.commit()).toMatchObject({ status: "partial", importedRowCount: 1, issues: [expect.objectContaining({ rowIndex: 0, message: "Negative amount" })] });
    expect(api.rows.getById("a")?.data?.amount).toBe(1); expect(api.rows.getById("b")?.data?.amount).toBe(12.5); expect(changed).toHaveBeenCalledTimes(1);
    expect(api.editing.undo()).toBe(true); expect(api.rows.getById("b")?.data?.amount).toBe(2); expect(api.editing.undo()).toBe(false); plan.destroy();
  });
  it.each(["replace", "columns", "input", "newPreview", "destroy"] as const)("blocks late async validation after %s", async action => {
    const wait = deferred<null>(); const { api, core } = setup({ columnDefs: [{ field: "id" }, { field: "amount", editable: true, validate: () => wait.promise }] });
    const plan = createImportPlan(api, { kind: "matrix", rows: [["id", "amount"], ["c", 9]] }); const first = plan.preview();
    if (action === "replace") api.rows.setData([{ id: "fresh", amount: 99 }]);
    if (action === "columns") api.columns.setDefinitions([{ field: "id" }, { field: "amount" }]);
    if (action === "input") core.pasteText("3", 0, 1);
    const next = action === "newPreview" ? plan.preview() : undefined;
    if (action === "destroy") plan.destroy(); wait.resolve(null);
    expect((await first).status).toBe(action === "destroy" ? "destroyed" : "stale");
    if (next) { expect((await next).status).toBe("ready"); plan.destroy(); }
    expect((await plan.commit()).status).not.toBe("applied"); expect(api.rows.getById("c")).toBeUndefined(); plan.destroy();
  });
  it("rejects invalid mappings, duplicate keys, unsafe snapshots and ambiguous custom columns", async () => {
    const { api } = setup();
    for (const source of [{ kind: "matrix" as const, rows: [["missing"], [1]] }, { kind: "matrix" as const, rows: [["id", "amount"], ["x", 1], ["x", 2]] }]) {
      const plan = createImportPlan(api, source); expect((await plan.preview()).status).toBe("invalid"); expect((await plan.commit()).status).toBe("invalid"); plan.destroy();
    }
    const cyclic: any = { id: "x", amount: 1 }; cyclic.self = cyclic;
    const unsafe = createImportPlan(api, { kind: "rows", rows: [cyclic] }); expect((await unsafe.preview()).issues[0].message).toContain("acyclic"); unsafe.destroy();
    api.columns.setDefinitions([{ field: "amount", valueSetter: () => true }]);
    const custom = createImportPlan(api, { kind: "matrix", rows: [[1]] }, { columns: ["amount"] }); expect((await custom.preview()).issues[0].message).toContain("ordinary field"); custom.destroy();
  });
  it("invalidates a plan when the same-ID row is transacted or edited during preview", async () => {
    const { api } = setup(); const plan = createImportPlan(api, { kind: "matrix", rows: [[9]] }, { mode: "paste", columns: ["amount"] });
    expect((await plan.preview()).status).toBe("ready"); api.rows.transact({ update: [{ id: "a", amount: 4 }] });
    expect(await plan.commit()).toMatchObject({ status: "stale", importedRowCount: 0 }); expect(api.rows.getById("a")?.data?.amount).toBe(4); plan.destroy();
  });
  it.each(["cycle", "function", "prototype"])("never commits a preview whose parsed %s value cannot be snapshotted", async kind => {
    const cyclic: any = {}; cyclic.self = cyclic;
    const value = kind === "cycle" ? cyclic : kind === "function" ? () => 1 : new Map([["x", 1]]);
    const { api } = setup({ columnDefs: [{ field: "id" }, { field: "amount", valueParser: () => value }] });
    const plan = createImportPlan(api, { kind: "matrix", rows: [["id", "amount"], ["c", 9]] });
    expect((await plan.preview()).status).toBe("invalid"); expect(await plan.commit()).toMatchObject({ status: "invalid", importedRowCount: 0 }); expect(api.rows.getById("c")).toBeUndefined(); plan.destroy();
  });
  it("keeps snapshot limits independent from the public cell DTO metadata", async () => {
    const { api } = setup({ rowKey: undefined, columnDefs: Array.from({ length: 10 }, (_, index) => ({ field: `c${index}` })) });
    const rows = Array.from({ length: 10_000 }, (_, row) => Array.from({ length: 10 }, (_, column) => row + column));
    const plan = createImportPlan(api, { kind: "matrix", rows }, { columns: Array.from({ length: 10 }, (_, index) => `c${index}`) });
    const preview = await plan.preview(); expect(preview.status).toBe("ready"); expect(preview.rowCount).toBe(10_000); expect(preview.cells).toHaveLength(100_000); plan.destroy();
  });
  it.each(["validator", "rowKey", "sameRowKey"] as const)("keeps the optional guard stale after %s changes", async action => {
    const { api } = setup();
    const plan = createImportPlan(api, { kind: "matrix", rows: [["id", "amount"], ["c", 9]] });
    expect((await plan.preview()).status).toBe("ready");
    if (action === "validator") api.updateOptions({ rowEditValidator: () => "New rule" });
    else api.updateOptions({ rowKey: action === "sameRowKey" ? "id" : data => `new:${data.id}` });
    expect(await plan.commit()).toMatchObject({ status: "stale", importedRowCount: 0 }); expect(api.rows.getById("c")).toBeUndefined(); plan.destroy();
  });
  it("retains local/editor/dirty prechecks in the optional plan", async () => {
    const { api } = setup();
    api.editing.startCell({ rowIndex: 0, colId: "amount" });
    const active = createImportPlan(api, { kind: "matrix", rows: [["id", "amount"], ["c", 9]] });
    expect((await active.preview()).issues[0].message).toContain("active editing"); active.destroy(); await api.editing.stop({ cancel: true });
    const pasted = new Promise<void>(done => api.on("cellValueChanged", () => done())); api.io.importMatrix([[3]], { columns: ["amount"], mode: "paste" }); await pasted;
    const dirty = createImportPlan(api, { kind: "matrix", rows: [["id", "amount"], ["c", 9]] });
    expect((await dirty.preview()).issues[0].message).toContain("pending changes"); dirty.destroy();
    const allowed = createImportPlan(api, { kind: "matrix", rows: [[5]] }, { columns: ["amount"], mode: "paste" });
    expect((await allowed.preview()).status).toBe("ready"); allowed.destroy();
    const remoteApi = setup({ datasource: { getRows: ({ onSuccess }) => onSuccess([], 0) } }).api;
    const remote = createImportPlan(remoteApi, { kind: "matrix", rows: [["id", "amount"], ["c", 9]] });
    expect((await remote.preview()).issues[0].message).toContain("local records"); remote.destroy();
  });
  it.each(["same", "undefined"])("accepts %s paste as a successful no-op without setters, events or undo", async kind => {
    const setter = vi.fn(({ data, newValue }: { data: Row; newValue: number }) => { data.amount = newValue; return true; });
    const { api } = setup({ rowData: [{ id: "a", amount: 5 }], columnDefs: [{ field: "amount", editable: true,
      valueParser: kind === "undefined" ? () => undefined : ({ value }) => Number(value), valueSetter: setter }] });
    const changed = vi.fn(); api.on("cellValueChanged", changed);
    const plan = createImportPlan(api, { kind: "matrix", rows: [[5]] }, { mode: "paste", columns: ["amount"] });
    expect((await plan.preview()).status).toBe("ready"); expect(await plan.commit()).toEqual({ status: "applied", importedRowCount: 0, issues: [] });
    expect(api.rows.getById("a")?.data?.amount).toBe(5); expect(setter).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled(); expect(api.editing.canUndo()).toBe(false); plan.destroy();
  });
  it.each([false, true])("counts only actual writes and keeps no-op rows out of partial failure (%s)", async invalid => {
    const setter = vi.fn(({ data, newValue }: { data: Row; newValue: number }) => { data.amount = newValue; return true; });
    const { api } = setup({ rowData: [{ id: "a", amount: 5 }, { id: "b", amount: 2 }, { id: "c", amount: 3 }], columnDefs: [{ field: "amount", editable: true, valueSetter: setter, validate: value => value < 0 ? "Negative" : null }] });
    const changed = vi.fn(); api.on("cellValueChanged", changed);
    const plan = createImportPlan(api, { kind: "matrix", rows: invalid ? [[5], [9], [-1]] : [[5], [9]] }, { mode: "paste", columns: ["amount"] });
    await plan.preview(); expect(await plan.commit()).toMatchObject({ status: invalid ? "partial" : "applied", importedRowCount: 1 });
    expect(setter).toHaveBeenCalledTimes(1); expect(changed).toHaveBeenCalledTimes(1); expect(api.rows.getById("a")?.data?.amount).toBe(5); expect(api.rows.getById("b")?.data?.amount).toBe(9); expect(api.rows.getById("c")?.data?.amount).toBe(3); plan.destroy();
  });
  it("still rejects unavailable or read-only paste targets", async () => {
    const { api } = setup({ columnDefs: [{ field: "amount", editable: false }] });
    const readonly = createImportPlan(api, { kind: "matrix", rows: [[1]] }, { mode: "paste", columns: ["amount"] });
    expect((await readonly.preview()).status).toBe("invalid"); expect((await readonly.commit()).status).toBe("invalid"); readonly.destroy();
    api.columns.setDefinitions([{ field: "amount", editable: true }]);
    const missing = createImportPlan(api, { kind: "matrix", rows: [[1], [2], [3]] }, { mode: "paste", columns: ["amount"] });
    expect((await missing.preview()).issues).toContainEqual(expect.objectContaining({ message: "Paste target is not loaded" }));
    expect((await missing.commit()).status).toBe("invalid"); missing.destroy();
  });
  it.each(["invalidChild", "duplicateChild"])("rejects hierarchical record loading before replacing data (%s)", async kind => {
    const { api } = setup({ treeData: true });
    const children = kind === "invalidChild" ? [{ id: "child", amount: -5 }] : [{ id: "child", amount: 3 }, { id: "child", amount: 4 }];
    const rows = [{ id: "newRoot", amount: 1, children }];
    const plan = createImportPlan(api, { kind: "rows", rows });
    expect(await plan.preview()).toMatchObject({ status: "invalid", issues: [expect.objectContaining({ code: "UNSUPPORTED", message: expect.stringContaining("flat-record") })] });
    expect((await plan.commit()).status).toBe("invalid"); expect(api.rows.getById("a")?.data?.amount).toBe(1); expect(api.rows.getById("newRoot")).toBeUndefined(); plan.destroy();
    const append = createImportPlan(api, { kind: "rows", rows }, { mode: "append" });
    expect((await append.preview()).status).toBe("invalid"); expect((await append.commit()).status).toBe("invalid"); expect(api.rows.getById("newRoot")).toBeUndefined(); append.destroy();
    const paste = createImportPlan(api, { kind: "matrix", rows: [[9]] }, { mode: "paste", columns: ["amount"] });
    expect((await paste.preview()).status).toBe("ready"); expect(await paste.commit()).toMatchObject({ status: "applied", importedRowCount: 1 }); expect(api.rows.getById("a")?.data?.amount).toBe(9); paste.destroy();
  });
});
