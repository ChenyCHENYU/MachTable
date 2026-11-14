// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { GridCore } from "../core/gridCore";
import { createImportPlan } from "../import";
import type { GridOptions } from "../types/options";

interface Row { id: string; value: number; other: number }
const cores: GridCore<Row>[] = [];

function grid(count = 3, options: Partial<GridOptions<Row>> = {}) {
  const host = document.createElement("div");
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 400 } });
  document.body.appendChild(host);
  const core = new GridCore<Row>(host, {
    columnDefs: [{ field: "value", editable: true, cellEditor: "number" }, { field: "other", editable: true, cellEditor: "number" }],
    rowData: Array.from({ length: count }, (_, index) => ({ id: String(index), value: index, other: index + 1 })),
    rowKey: "id",
    pagination: false,
    enableRangeSelection: true,
    ...options
  });
  cores.push(core);
  return { core, api: core.api, host };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => { resolve = finish; });
  return { promise, resolve };
}

function edit(host: HTMLElement, core: GridCore<Row>, rowIndex: number, value: string): void {
  expect(core.api.editing.startCell({ rowIndex, colId: "value" })).toBe(true);
  host.querySelector<HTMLInputElement>(".mach-editor-input")!.value = value;
  void core.api.editing.stop();
}

afterEach(() => {
  for (const core of cores.splice(0)) core.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("batch dirty-state notifications", () => {
  it("materializes one dirty snapshot for 2000 pasted rows and each undo/redo", () => {
    const count = 2000;
    const changed = vi.fn();
    const dirty = vi.fn();
    const { core, api } = grid(count, { onCellValueChanged: changed, onDirtyStateChanged: dirty });
    const snapshots = vi.spyOn(core.changeTracker, "getDirtyRowIds");

    core.pasteText(Array.from({ length: count }, (_, index) => String(index + count)).join("\n"), 0, 0);
    expect(changed).toHaveBeenCalledTimes(count);
    expect(dirty).toHaveBeenCalledTimes(1);
    expect(dirty.mock.calls[0][0].dirtyRowIds).toEqual(Array.from({ length: count }, (_, index) => String(index)));
    expect(snapshots).toHaveBeenCalledTimes(1);
    expect(snapshots.mock.results.reduce((total, result) => total + result.value.length, 0)).toBe(count);

    expect(api.editing.undo()).toBe(true);
    expect(changed).toHaveBeenCalledTimes(count * 2);
    expect(dirty).toHaveBeenCalledTimes(2);
    expect(dirty.mock.calls[1][0].dirtyRowIds).toEqual([]);
    expect(api.rows.getById("1999")?.data?.value).toBe(1999);
    expect(api.editing.redo()).toBe(true);
    expect(changed).toHaveBeenCalledTimes(count * 3);
    expect(dirty).toHaveBeenCalledTimes(3);
    expect(snapshots).toHaveBeenCalledTimes(3);
    expect(api.rows.getById("1999")?.data?.value).toBe(3999);
    expect(api.editing.canRedo()).toBe(false);
  });

  it("keeps ordinary single-cell edits and dirty reads synchronous", () => {
    const order: string[] = [];
    const { core, host } = grid(1, {
      onDirtyStateChanged: () => { order.push("dirty"); },
      onCellValueChanged: ({ api }) => {
        order.push("cell");
        expect(api.editing.getDirtyRowIds()).toEqual(["0"]);
      }
    });
    edit(host, core, 0, "7");
    expect(order).toEqual(["dirty", "cell"]);
    expect(core.api.editing.getChanges()[0].cells[0]).toMatchObject({ originalValue: 0, value: 7 });
  });

  it("publishes full-row commits, clear and fill as single dirty notifications", () => {
    const dirty = vi.fn();
    const changed = vi.fn();
    const { core, api, host } = grid(3, { editType: "fullRow", onDirtyStateChanged: dirty, onCellValueChanged: changed });
    expect(api.editing.startRow(0)).toBe(true);
    const inputs = host.querySelectorAll<HTMLInputElement>(".mach-row-editor-shell .mach-editor-input");
    inputs[0].value = "10";
    inputs[1].value = "20";
    void api.editing.stop();
    expect(dirty).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledTimes(2);

    core.clearRangeValues({ r1: 1, r2: 2, c1: 0, c2: 1 });
    expect(dirty).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenCalledTimes(6);
    host.querySelector<HTMLElement>('.mach-row[data-index="0"] .mach-cell[data-col-id="value"]')!
      .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    window.dispatchEvent(new MouseEvent("mouseup"));
    host.querySelector<HTMLElement>(".mach-fill-handle")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientY: 2 * 36 }));
    window.dispatchEvent(new MouseEvent("mouseup", { clientY: 2 * 36 }));
    expect(api.rows.getById("2")?.data?.value).toBe(10);
    expect(dirty).toHaveBeenCalledTimes(3);
    expect(changed).toHaveBeenCalledTimes(8);
  });

  it("starts the dirty batch only after async validation and excludes rejected rows", async () => {
    const pending = deferred<true>();
    const dirty = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { core, api } = grid(3, {
      columnDefs: [{ field: "value", editable: true, validate: (_value, { node }) => node.id === "2" ? "Rejected" : pending.promise }],
      onDirtyStateChanged: dirty
    });
    core.pasteText("10\n11\n12", 0, 0);
    expect(dirty).not.toHaveBeenCalled();
    api.editing.markSaved();
    expect(dirty).toHaveBeenCalledTimes(1);
    dirty.mockClear();
    pending.resolve(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dirty).toHaveBeenCalledTimes(1);
    expect(dirty.mock.calls[0][0].dirtyRowIds).toEqual(["0", "1"]);
    expect(api.rows.getById("2")?.data?.value).toBe(2);
    expect(api.editing.undo()).toBe(true);
    expect(api.rows.getById("0")?.data?.value).toBe(0);
    expect(api.rows.getById("1")?.data?.value).toBe(1);
  });

  it("preserves live cell callbacks that save one row or replace the input targets", () => {
    const dirty = vi.fn();
    const reads: string[][] = [];
    const { core, api } = grid(3, {
      onDirtyStateChanged: dirty,
      onCellValueChanged: ({ api, rowNode }) => {
        reads.push(api.editing.getDirtyRowIds());
        if (rowNode.id === "0") api.editing.markSaved(["0"]);
        if (rowNode.id === "1") api.rows.setData([{ id: "replacement", value: 99, other: 100 }]);
      }
    });
    const original = api.rows.getById("2")!.data!;
    core.pasteText("10\n11\n12", 0, 0);
    expect(reads).toEqual([["0"], ["1"]]);
    expect(original.value).toBe(2);
    expect(api.rows.getById("replacement")?.data?.value).toBe(99);
    expect(dirty).toHaveBeenCalledTimes(1);
    expect(dirty.mock.calls[0][0].dirtyRowIds).toEqual([]);
    expect(api.editing.canUndo()).toBe(false);
  });

  it("flushes and closes dirty batches when commit side effects throw", () => {
    const dirty = vi.fn();
    const { core, host } = grid(2, { onDirtyStateChanged: dirty });
    const notify = core.notifyCellValueChanged.bind(core);
    vi.spyOn(core, "notifyCellValueChanged").mockImplementationOnce((...args) => {
      notify(...args);
      throw new Error("Commit side effect failed");
    });
    expect(() => core.pasteText("10\n11", 0, 0)).toThrow("Commit side effect failed");
    expect(dirty).toHaveBeenCalledTimes(1);
    expect(dirty.mock.calls[0][0].dirtyRowIds).toEqual(["0"]);
    edit(host, core, 1, "12");
    expect(dirty).toHaveBeenCalledTimes(2);
    expect(dirty.mock.calls[1][0].dirtyRowIds).toEqual(["0", "1"]);
  });

  it("keeps partial save acknowledgements and newer edits after a batched paste", async () => {
    const saved = deferred<{ savedRowIds: string[] }>();
    const dirty = vi.fn();
    const { core, api } = grid(2, { onDirtyStateChanged: dirty });
    core.pasteText("10\n11", 0, 0);
    const saving = api.editing.save(() => saved.promise);
    core.pasteText("20", 0, 0);
    saved.resolve({ savedRowIds: ["0"] });
    await saving;
    expect(api.editing.getChanges()).toEqual([
      expect.objectContaining({ rowId: "0", cells: [expect.objectContaining({ originalValue: 10, value: 20 })] }),
      expect.objectContaining({ rowId: "1", cells: [expect.objectContaining({ originalValue: 1, value: 11 })] })
    ]);
    expect(dirty).toHaveBeenCalledTimes(3);
  });

  it("coalesces a nested paste started by a cell callback without continuing stale rows", () => {
    const dirty = vi.fn();
    let nested = false;
    const { core, api } = grid(3, {
      onDirtyStateChanged: dirty,
      onCellValueChanged: () => {
        if (nested) return;
        nested = true;
        core.pasteText("99", 2, 0);
      }
    });
    core.pasteText("10\n11\n12", 0, 0);
    expect(dirty).toHaveBeenCalledTimes(1);
    expect(dirty.mock.calls[0][0].dirtyRowIds).toEqual(["0", "2"]);
    expect(api.rows.getById("1")?.data?.value).toBe(1);
    expect(api.editing.undo()).toBe(true);
    expect(api.rows.getById("0")?.data?.value).toBe(0);
    expect(api.rows.getById("2")?.data?.value).toBe(2);
    expect(api.editing.canUndo()).toBe(false);
  });

  it("closes the dirty replay batch even when an undo refresh throws", () => {
    const dirty = vi.fn();
    const { core, api, host } = grid(3, { onDirtyStateChanged: dirty });
    core.pasteText("10\n11", 0, 0);
    const refresh = vi.spyOn(core.bodyRenderer, "refreshRows").mockImplementationOnce(() => { throw new Error("Refresh failed"); });
    expect(() => api.editing.undo()).toThrow("Refresh failed");
    expect(dirty).toHaveBeenCalledTimes(2);
    expect(dirty.mock.calls[1][0].dirtyRowIds).toEqual([]);
    refresh.mockRestore();
    edit(host, core, 2, "12");
    expect(dirty).toHaveBeenCalledTimes(3);
    expect(dirty.mock.calls[2][0].dirtyRowIds).toEqual(["2"]);
  });

  it("notifies for optional import-plan commits through the same input boundary", async () => {
    const dirty = vi.fn();
    const { api } = grid(3, { onDirtyStateChanged: dirty });
    const plan = createImportPlan(api, { kind: "matrix", rows: [[10, 20], [11, 21]] }, { mode: "paste", columns: ["value", "other"] });
    try {
      expect((await plan.preview()).status).toBe("ready");
      expect(dirty).not.toHaveBeenCalled();
      expect((await plan.commit()).status).toBe("applied");
      expect(dirty).toHaveBeenCalledTimes(1);
      expect(dirty.mock.calls[0][0].dirtyRowIds).toEqual(["0", "1"]);
      expect(api.editing.undo()).toBe(true);
      expect(dirty).toHaveBeenCalledTimes(2);
    } finally { plan.destroy(); }
  });

  it("does not notify for rejected/no-op batches and still batches with history disabled", () => {
    const dirty = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { core, api } = grid(3, {
      undoStackSize: 0,
      onDirtyStateChanged: dirty,
      columnDefs: [{ field: "value", editable: true, validate: (value) => value === 99 ? "Rejected" : true }]
    });
    core.pasteText("0\n1\n2", 0, 0);
    core.pasteText("99\n99\n99", 0, 0);
    expect(dirty).not.toHaveBeenCalled();
    core.pasteText("10\n11\n12", 0, 0);
    expect(dirty).toHaveBeenCalledTimes(1);
    expect(api.editing.canUndo()).toBe(false);
  });

  it("does not publish a pending dirty notification after a cell callback destroys the grid", () => {
    const dirty = vi.fn();
    const changed = vi.fn(({ api }) => api.destroy());
    const { core, api } = grid(2, { onDirtyStateChanged: dirty, onCellValueChanged: changed });
    const original = api.rows.getById("1")!.data!;
    core.pasteText("10\n11", 0, 0);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(dirty).not.toHaveBeenCalled();
    expect(original.value).toBe(1);
  });
});
