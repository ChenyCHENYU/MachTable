// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createGrid } from "../index";
import type { GridApi, ColDef } from "../index";

interface Row {
  id: string;
  name: string;
  score: number;
}

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: `r${i}`, name: `n${i}`, score: i + 1 }));
}

function createHost(): HTMLElement {
  const host = document.createElement("div");
  Object.defineProperty(host, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(host, "clientHeight", { value: 400, configurable: true });
  document.body.appendChild(host);
  return host;
}

function editCell(api: GridApi<Row>, host: HTMLElement, row: number, colId: string, value: string): void {
  api.editing.startCell({ rowIndex: row, colId });
  const input = host.querySelector(".mach-editor-input") as HTMLInputElement;
  input.value = value;
  api.editing.stop();
}

function selectRange(host: HTMLElement, r1: number, c1: string, r2: number, c2: string): void {
  const cell = (r: number, c: string) => {
    const el = host.querySelector(`.mach-row[data-index="${r}"]`)?.querySelector(`.mach-cell[data-col-id="${c}"]`);
    if (!el) throw new Error(`cell ${r}/${c} missing`);
    return el as HTMLElement;
  };
  cell(r1, c1).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  if (r2 !== r1 || c2 !== c1) {
    cell(r2, c2).dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  }
  window.dispatchEvent(new MouseEvent("mouseup"));
}

function createUndoGrid() {
  const host = createHost();
  const columnDefs: ColDef<Row>[] = [
    { field: "name", headerName: "Name", width: 120, editable: true },
    { field: "score", headerName: "Score", width: 100, editable: true }
  ];
  const api: GridApi<Row> = createGrid<Row>(host, {
    columnDefs,
    rowData: makeRows(5),
    enableRangeSelection: true,
    rowKey: (row) => row.id
  });
  return { api, host };
}

describe("undo/redo", () => {
  it("undoes and redoes a single cell edit", () => {
    const changed = vi.fn();
    const { api, host } = createUndoGrid();
    api.on("cellValueChanged", changed);

    expect(api.editing.canUndo()).toBe(false);
    editCell(api, host, 0, "name", "edited");
    expect(api.rows.getById("r0")?.data?.name).toBe("edited");
    expect(api.editing.canUndo()).toBe(true);

    expect(api.editing.undo()).toBe(true);
    expect(api.rows.getById("r0")?.data?.name).toBe("n0");
    expect(api.editing.canRedo()).toBe(true);

    expect(api.editing.redo()).toBe(true);
    expect(api.rows.getById("r0")?.data?.name).toBe("edited");
    expect(changed).toHaveBeenCalledTimes(3);
    api.destroy();
  });

  it("undoes a fill operation as one batch", () => {
    const { api, host } = createUndoGrid();
    selectRange(host, 0, "name", 0, "name");
    const handle = host.querySelector(".mach-fill-handle") as HTMLElement;
    handle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientY: 3 * 36 }));
    window.dispatchEvent(new MouseEvent("mouseup", { clientY: 3 * 36 }));

    expect(api.rows.getById("r3")?.data?.name).toBe("n0");

    expect(api.editing.undo()).toBe(true);
    expect(api.rows.getById("r1")?.data?.name).toBe("n1");
    expect(api.rows.getById("r2")?.data?.name).toBe("n2");
    expect(api.rows.getById("r3")?.data?.name).toBe("n3");
    expect(api.editing.canUndo()).toBe(false);
    api.destroy();
  });

  it("undoes a paste as one batch and redo restores all cells", () => {
    const { api, host } = createUndoGrid();
    selectRange(host, 0, "name", 0, "name");
    const pasteEv = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEv, "clipboardData", {
      value: { getData: () => "a\t1\nb\t2" }
    });
    (host.querySelector(".mach-root") as HTMLElement).dispatchEvent(pasteEv);

    expect(api.rows.getById("r0")?.data?.name).toBe("a");
    expect(api.rows.getById("r1")?.data?.name).toBe("b");

    api.editing.undo();
    expect(api.rows.getById("r0")?.data?.name).toBe("n0");
    expect(api.rows.getById("r0")?.data?.score).toBe(1);
    expect(api.rows.getById("r1")?.data?.score).toBe(2);

    api.editing.redo();
    expect(api.rows.getById("r0")?.data?.name).toBe("a");
    expect(api.rows.getById("r1")?.data?.score).toBe(2);
    api.destroy();
  });

  it("undoes delete-range as one batch", () => {
    const { api, host } = createUndoGrid();
    selectRange(host, 0, "name", 1, "score");
    (host.querySelector(".mach-root") as HTMLElement).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true })
    );
    expect(api.rows.getById("r0")?.data?.name).toBeNull();
    expect(api.rows.getById("r1")?.data?.score).toBeNull();

    api.editing.undo();
    expect(api.rows.getById("r0")?.data?.name).toBe("n0");
    expect(api.rows.getById("r1")?.data?.score).toBe(2);
    api.destroy();
  });

  it("branches history on new edit after undo", () => {
    const { api, host } = createUndoGrid();
    editCell(api, host, 0, "name", "first");
    api.editing.undo();
    editCell(api, host, 0, "name", "second");

    expect(api.editing.canRedo()).toBe(false);
    expect(api.rows.getById("r0")?.data?.name).toBe("second");
    api.destroy();
  });

  it("clears history when rowData is replaced", () => {
    const { api, host } = createUndoGrid();
    editCell(api, host, 0, "name", "x");
    expect(api.editing.canUndo()).toBe(true);

    api.rows.setData(makeRows(5));
    expect(api.editing.canUndo()).toBe(false);
    api.destroy();
  });

  it("respects undoStackSize=0 to disable history", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "name", headerName: "Name", editable: true }],
      rowData: makeRows(2),
      undoStackSize: 0,
      rowKey: (row) => row.id
    });
    editCell(api, host, 0, "name", "x");
    expect(api.editing.canUndo()).toBe(false);
    api.destroy();
  });

  it("undo emits cellValueChanged with swapped values", () => {
    const changed = vi.fn();
    const { api, host } = createUndoGrid();
    editCell(api, host, 0, "name", "x");
    api.on("cellValueChanged", changed);
    api.editing.undo();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed.mock.calls[0][0].oldValue).toBe("x");
    expect(changed.mock.calls[0][0].newValue).toBe("n0");
    api.destroy();
  });
});
