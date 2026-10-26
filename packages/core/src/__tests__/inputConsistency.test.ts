// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GridCore } from "../core/gridCore";
import type { GridOptions } from "../types/options";
import type { ColDef } from "../types/colDef";

interface Row { id: string; lower: number; upper: number }
const cores: GridCore<Row>[] = [];

function grid(options: Partial<GridOptions<Row>> = {}) {
  const host = document.createElement("div");
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 400 } });
  document.body.appendChild(host);
  const core = new GridCore<Row>(host, {
    columnDefs: [{ field: "lower", editable: true, cellEditor: "number" }, { field: "upper", editable: true, cellEditor: "number" }],
    rowData: [{ id: "1", lower: 1, upper: 5 }, { id: "2", lower: 2, upper: 8 }],
    rowKey: (row) => row.id,
    enableRangeSelection: true,
    ...options
  });
  cores.push(core);
  return { core, api: core.api, host };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function flush(): Promise<void> { return new Promise((resolve) => setTimeout(resolve, 0)); }

function select(host: HTMLElement, row: number, colId: string): void {
  host.querySelector<HTMLElement>(`.mach-row[data-index="${row}"] .mach-cell[data-col-id="${colId}"]`)!
    .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  window.dispatchEvent(new MouseEvent("mouseup"));
}

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => {
  for (const core of cores.splice(0)) core.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("consistent user input", () => {
  it("rejects the invalid row atomically and batches all successful rows for undo", () => {
    const changed = vi.fn();
    const error = vi.fn();
    const { core, api } = grid({
      columnDefs: [{ field: "lower", editable: true }, {
        field: "upper", editable: true, validate: (value) => value >= 0 || "Must be positive"
      }],
      onCellValueChanged: changed,
      onGridError: error
    });
    core.pasteText("3\t-1\n4\t10", 0, 0);
    expect(api.rows.getById("1")?.data).toMatchObject({ lower: 1, upper: 5 });
    expect(api.rows.getById("2")?.data).toMatchObject({ lower: 4, upper: 10 });
    expect(changed).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ code: "VALIDATION_ERROR", context: expect.objectContaining({ rowId: "1" }) }));
    expect(api.editing.undo()).toBe(true);
    expect(api.rows.getById("2")?.data).toMatchObject({ lower: 2, upper: 8 });
    expect(api.editing.undo()).toBe(false);
    expect(api.editing.redo()).toBe(true);
    expect(api.rows.getById("2")?.data).toMatchObject({ lower: 4, upper: 10 });
  });

  it("evaluates cross-field rules against the complete proposed row, including read-only fields", () => {
    const validator = vi.fn(({ values }) => Number(values.lower) <= Number(values.upper) || "Invalid interval");
    const { core, api } = grid({
      columnDefs: [{ field: "lower", editable: true }, { field: "upper" }],
      rowEditValidator: validator
    });
    core.pasteText("9", 0, 0);
    expect(api.rows.getById("1")?.data?.lower).toBe(1);
    expect(validator.mock.calls[0][0].values).toMatchObject({ lower: 9, upper: 5 });
    core.pasteText("4\t999", 0, 0);
    expect(api.rows.getById("1")?.data).toMatchObject({ lower: 4, upper: 5 });
  });

  it("checks the final row draft rather than rejecting a valid intermediate field order", () => {
    const { core, api } = grid({ rowEditValidator: ({ values }) => Number(values.lower) <= Number(values.upper) || "Invalid interval" });
    core.pasteText("10\t20", 0, 0);
    expect(api.rows.getById("1")?.data).toMatchObject({ lower: 10, upper: 20 });
  });

  it("routes clear and trusted row transactions through their distinct contracts", () => {
    const validate = vi.fn((value: unknown) => value != null || "Required");
    const { core, api } = grid({ columnDefs: [{ field: "lower", editable: true, validate }, { field: "upper", editable: true }] });
    core.clearRangeValues({ r1: 0, r2: 0, c1: 0, c2: 1 });
    expect(api.rows.getById("1")?.data).toMatchObject({ lower: 1, upper: 5 });
    const count = validate.mock.calls.length;
    api.rows.transact({ update: [{ id: "1", lower: -2, upper: 5 }] });
    expect(api.rows.getById("1")?.data?.lower).toBe(-2);
    expect(validate).toHaveBeenCalledTimes(count);
  });

  it("keeps explicit numeric columns numeric after clearing their previous value", () => {
    const { core, api } = grid();
    core.clearRangeValues({ r1: 0, r2: 0, c1: 0, c2: 0 });
    expect(api.rows.getById("1")?.data?.lower).toBeNull();
    core.pasteText("42", 0, 0);
    expect(api.rows.getById("1")?.data?.lower).toBe(42);
  });

  it("keeps wide-row validation and commit getter work linear", () => {
    const width = 160;
    let reads = 0;
    const values = Array<number>(width).fill(1);
    const columnDefs: ColDef<Row>[] = values.map((_, index) => ({
      colId: `c${index}`, editable: true, validate: () => true,
      valueGetter: () => { reads++; return values[index]; },
      valueSetter: ({ newValue }) => { values[index] = newValue; return true; }
    }));
    const { core } = grid({ columnDefs, rowEditValidator: () => true });
    reads = 0;
    core.pasteText(values.map(() => "2").join("\t"), 0, 0);
    expect(values.every((value) => value === 2)).toBe(true);
    expect(reads).toBeLessThan(width * 16);
  });

  it.each(["vertical", "horizontal"])("validates %s fill before changing data", (direction) => {
    const validate = vi.fn(() => "Locked value");
    const { api, host } = grid({ columnDefs: [{ field: "lower", editable: true, validate }, { field: "upper", editable: true, validate }] });
    select(host, 0, "lower");
    host.querySelector<HTMLElement>(".mach-fill-handle")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    const point = direction === "vertical" ? { clientY: 50, clientX: 10 } : { clientY: 10, clientX: 250 };
    window.dispatchEvent(new MouseEvent("mousemove", point));
    window.dispatchEvent(new MouseEvent("mouseup", point));
    expect(validate).toHaveBeenCalled();
    expect(api.rows.getById("1")?.data).toMatchObject({ lower: 1, upper: 5 });
    expect(api.rows.getById("2")?.data).toMatchObject({ lower: 2, upper: 8 });
  });

  it("rolls back earlier fields if a setter refuses a row", () => {
    const changed = vi.fn();
    const { core, api } = grid({ columnDefs: [{ field: "lower", editable: true }, {
      field: "upper", editable: true, valueSetter: () => false
    }], onCellValueChanged: changed });
    core.pasteText("3\t7", 0, 0);
    expect(api.rows.getById("1")?.data).toMatchObject({ lower: 1, upper: 5 });
    expect(changed).not.toHaveBeenCalled();
    expect(api.editing.undo()).toBe(false);
  });

  it("waits for async cell and row validation before publishing one undoable batch", async () => {
    const cell = deferred<true>();
    const row = deferred<true>();
    const validateRow = vi.fn(() => row.promise);
    const { core, api } = grid({ columnDefs: [{ field: "lower", editable: true, validate: () => cell.promise }], rowEditValidator: validateRow });
    core.pasteText("3\n4", 0, 0);
    expect(api.rows.getById("1")?.data?.lower).toBe(1);
    expect(validateRow).not.toHaveBeenCalled();
    cell.resolve(true);
    await flush();
    expect(validateRow).toHaveBeenCalledTimes(2);
    expect(api.rows.getById("1")?.data?.lower).toBe(1);
    row.resolve(true);
    await flush();
    expect(api.rows.getById("1")?.data?.lower).toBe(3);
    expect(api.rows.getById("2")?.data?.lower).toBe(4);
    expect(api.editing.undo()).toBe(true);
    expect(api.rows.getById("1")?.data?.lower).toBe(1);
    expect(api.rows.getById("2")?.data?.lower).toBe(2);
  });

  it.each(["escape", "undo", "redo", "newInput", "startEditor", "replace", "remove", "destroy", "mutate"])("ignores late validation after %s", async (action) => {
    const pending = deferred<true>();
    const changed = vi.fn();
    const { core, api, host } = grid({ columnDefs: [{ field: "lower", editable: true, validate: (value) => value === 9 ? pending.promise : true }, { field: "upper" }], onCellValueChanged: changed });
    const original = api.rows.getById("1")!.data!;
    core.pasteText("9", 0, 0);
    if (action === "escape") host.querySelector<HTMLElement>(".mach-root")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    if (action === "undo") api.editing.undo();
    if (action === "redo") api.editing.redo();
    if (action === "newInput") core.clearRangeValues({ r1: 0, r2: 0, c1: 0, c2: 0 });
    if (action === "startEditor") api.editing.startCell({ rowIndex: 0, colId: "lower" });
    if (action === "replace") api.rows.setData([{ id: "1", lower: 6, upper: 8 }]);
    if (action === "remove") api.rows.transact({ remove: [original] });
    if (action === "destroy") api.destroy();
    if (action === "mutate") original.upper = 100;
    pending.resolve(true);
    await flush();
    expect(original.lower).toBe(action === "newInput" ? null : 1);
    expect(changed).toHaveBeenCalledTimes(action === "newInput" ? 1 : 0);
    if (action === "replace") expect(api.rows.getById("1")?.data?.lower).toBe(6);
  });

  it("rechecks dynamic editability when async validation completes", async () => {
    const pending = deferred<true>();
    let editable = true;
    const { core, api } = grid({ columnDefs: [{ field: "lower", editable: () => editable, validate: () => pending.promise }] });
    core.pasteText("9", 0, 0);
    editable = false;
    pending.resolve(true);
    await flush();
    expect(api.rows.getById("1")?.data?.lower).toBe(1);
  });

  it("ignores a validator result after columns are replaced", async () => {
    const pending = deferred<true>();
    const { core, api } = grid({ columnDefs: [{ field: "lower", editable: true, validate: () => pending.promise }] });
    core.pasteText("9", 0, 0);
    api.columns.setDefinitions([{ field: "lower", editable: true }]);
    pending.resolve(true);
    await flush();
    expect(api.rows.getById("1")?.data?.lower).toBe(1);
  });

  it.each(["replace", "escape", "newInput", "focus", "destroy"])("discards a delayed clipboard read after %s", async (action) => {
    const read = deferred<string>();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText: () => read.promise } });
    const { core, api, host } = grid();
    select(host, 0, "lower");
    const original = api.rows.getById("1")!.data!;
    const pending = core.pasteFromSystemClipboard();
    if (action === "replace") api.rows.setData([{ id: "1", lower: 6, upper: 8 }]);
    if (action === "escape") host.querySelector<HTMLElement>(".mach-root")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    if (action === "newInput") core.pasteText("3", 0, 0);
    if (action === "focus") select(host, 1, "lower");
    if (action === "destroy") api.destroy();
    read.resolve("9");
    await pending;
    expect(original.lower).toBe(action === "newInput" ? 3 : 1);
    if (action === "replace") expect(api.rows.getById("1")?.data?.lower).toBe(6);
    if (action === "focus") expect(api.rows.getById("2")?.data?.lower).toBe(2);
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it.each(["cellThrow", "cellReject", "rowThrow", "rowReject"])("reports %s and leaves the row unchanged", async (failure) => {
    const reject = () => {
      if (failure.endsWith("Throw")) throw new Error("Validation unavailable");
      return Promise.reject(new Error("Validation unavailable"));
    };
    const error = vi.fn();
    const { core, api } = grid({
      columnDefs: [{ field: "lower", editable: true, ...(failure.startsWith("cell") ? { validate: reject } : {}) }],
      ...(failure.startsWith("row") ? { rowEditValidator: reject } : {}),
      onGridError: error
    });
    core.pasteText("9", 0, 0);
    await flush();
    expect(api.rows.getById("1")?.data?.lower).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(api.editing.undo()).toBe(false);
  });

  it("does not continue a row after a setter synchronously replaces its target", () => {
    const upperSetter = vi.fn(() => true);
    const { core, api } = grid({ columnDefs: [{ field: "lower", editable: true, valueSetter: () => { replace(); return true; } }, {
      field: "upper", editable: true, valueSetter: upperSetter
    }] });
    const replace = () => api.rows.setData([{ id: "1", lower: 30, upper: 40 }]);
    core.pasteText("3\t7", 0, 0);
    expect(upperSetter).not.toHaveBeenCalled();
    expect(api.rows.getById("1")?.data).toMatchObject({ lower: 30, upper: 40 });
  });

  it("rechecks targets after reentrant value-change handlers replace the remaining rows", () => {
    const changed = vi.fn(() => api.rows.setData([{ id: "2", lower: 30, upper: 40 }]));
    const { core, api } = grid({ onCellValueChanged: changed });
    const original = api.rows.getById("2")!.data!;
    core.pasteText("3\t7\n4\t10", 0, 0);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(original).toMatchObject({ lower: 2, upper: 8 });
    expect(api.rows.getById("2")?.data).toMatchObject({ lower: 30, upper: 40 });
  });

  it("applies row rules to cell editors and restores controls after async rejection", async () => {
    const pending = deferred<string>();
    const { api, host } = grid({ rowEditValidator: () => pending.promise });
    api.editing.startCell({ rowIndex: 0, colId: "lower" });
    host.querySelector<HTMLInputElement>(".mach-editor-input")!.value = "9";
    const stopped = api.editing.stop();
    expect(host.querySelector<HTMLButtonElement>(".mach-edit-control--confirm")!.disabled).toBe(true);
    pending.resolve("Invalid interval");
    expect(await stopped).toBe(false);
    expect(host.querySelector<HTMLButtonElement>(".mach-edit-control--confirm")!.disabled).toBe(false);
    expect(host.querySelector("[aria-invalid='true']")?.getAttribute("title")).toBe("Invalid interval");
    expect(api.rows.getById("1")?.data?.lower).toBe(1);
  });

  it.each(["cancel", "replace", "destroy"])("does not commit editor validation after %s", async (action) => {
    const pending = deferred<true>();
    const { api, host } = grid({ columnDefs: [{ field: "lower", editable: true, cellEditor: "number", validate: () => pending.promise }] });
    const original = api.rows.getById("1")!.data!;
    api.editing.startCell({ rowIndex: 0, colId: "lower" });
    host.querySelector<HTMLInputElement>(".mach-editor-input")!.value = "9";
    const stopped = api.editing.stop();
    if (action === "cancel") await api.editing.stop({ cancel: true });
    if (action === "replace") api.rows.setData([{ id: "1", lower: 6, upper: 8 }]);
    if (action === "destroy") api.destroy();
    pending.resolve(true);
    await stopped;
    expect(original.lower).toBe(1);
  });

  it("keeps full-row commits synchronous when all validators are synchronous", () => {
    const { api, host } = grid({ editType: "fullRow", rowEditValidator: ({ values }) => Number(values.lower) <= Number(values.upper) || "Invalid interval" });
    api.editing.startRow(0);
    const inputs = host.querySelectorAll<HTMLInputElement>(".mach-row-editor-shell .mach-editor-input");
    inputs[0].value = "10";
    inputs[1].value = "20";
    void api.editing.stop();
    expect(api.rows.getById("1")?.data).toMatchObject({ lower: 10, upper: 20 });
    expect(api.editing.isRowActive(0)).toBe(false);
  });

  it.each(["cancel", "replace", "destroy"])("discards an async full-row draft after %s", async (action) => {
    const pending = deferred<true>();
    const { api, host } = grid({ editType: "fullRow", rowEditValidator: () => pending.promise });
    const original = api.rows.getById("1")!.data!;
    api.editing.startRow(0);
    host.querySelector<HTMLInputElement>(".mach-row-editor-shell .mach-editor-input")!.value = "3";
    const stopped = api.editing.stop();
    if (action === "cancel") await api.editing.stop({ cancel: true });
    if (action === "replace") api.rows.setData([{ id: "1", lower: 6, upper: 8 }]);
    if (action === "destroy") api.destroy();
    pending.resolve(true);
    await stopped;
    expect(original.lower).toBe(1);
  });
});
