// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createGrid, type GridApi, type GridOptions } from "../index";

interface Row { id: string; a: string; b: string }
interface EditorRecord {
  rowId: string;
  input: HTMLInputElement;
  getValue: Mock<() => string>;
  destroy: Mock<() => void>;
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
});
afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

function grid(
  hooks: {
    getValue?(editor: EditorRecord, api: GridApi<Row>): string;
    destroy?(editor: EditorRecord, api: GridApi<Row>): void;
  },
  options: Partial<GridOptions<Row>> = {}
) {
  const host = document.createElement("div");
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 400 } });
  document.body.appendChild(host);
  const editors: EditorRecord[] = [];
  const stopped = vi.fn();
  const api: GridApi<Row> = createGrid(host, {
    rowKey: "id", rowNumber: false, pagination: false, editType: "fullRow", rowBuffer: 0,
    rowData: Array.from({ length: 100 }, (_, index) => ({ id: String(index), a: `a-${index}`, b: `b-${index}` })),
    columnDefs: (["a", "b"] as const).map((field) => ({
      field, editable: true,
      cellEditor: (params) => {
        const input = document.createElement("input");
        input.value = params.value;
        const editor: EditorRecord = {
          rowId: params.data!.id, input,
          getValue: vi.fn(() => hooks.getValue ? hooks.getValue(editor, api) : input.value),
          destroy: vi.fn(() => hooks.destroy?.(editor, api))
        };
        editors.push(editor);
        return { el: input, getValue: editor.getValue, destroy: editor.destroy };
      }
    })),
    onRowEditingStopped: stopped,
    ...options
  });
  const viewport = host.querySelector<HTMLElement>(".mach-body-viewport--scroll")!;
  Object.defineProperties(viewport, { clientWidth: { value: 400 }, clientHeight: { value: 140 } });
  return { api, host, editors, stopped };
}

describe("editor cleanup ownership", () => {
  it.each(["cell", "row"] as const)("preserves a new %s session and its async stop task when the old value setter replaces the edit", async (replacement) => {
    let resolveOld!: (valid: true) => void, resolveNew!: (valid: true) => void;
    const oldValidation = new Promise<true>((resolve) => { resolveOld = resolve; });
    const newValidation = new Promise<true>((resolve) => { resolveNew = resolve; });
    let armed = false, newStop: Promise<boolean> | undefined;
    const starts: boolean[] = [];
    const editors: Array<{ input: HTMLInputElement; destroy: Mock<() => void> }> = [];
    const cellStopped = vi.fn(), rowStopped = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const api = createGrid(host, {
      rowData: [{ id: "old", value: "saved" }, { id: "new", value: "other" }],
      rowKey: "id", rowNumber: false, pagination: false,
      onCellEditingStopped: cellStopped, onRowEditingStopped: rowStopped,
      columnDefs: [{
        field: "value", editable: true,
        validate: (value) => value === "old draft" ? oldValidation : newValidation,
        valueSetter: ({ data, newValue }) => {
          data!.value = newValue;
          if (armed) {
            armed = false;
            void api.editing.stop({ cancel: true });
            starts.push(replacement === "cell"
              ? api.editing.startCell({ rowIndex: 0, colId: "value" }) : api.editing.startRow(1));
            editors[1].input.value = "new draft";
            newStop = api.editing.stop();
          }
          return true;
        },
        cellEditor: ({ value }) => {
          const input = document.createElement("input");
          input.value = value;
          const destroy = vi.fn<() => void>();
          editors.push({ input, destroy });
          return { el: input, getValue: () => input.value, destroy };
        }
      }]
    });
    try {
      await api.whenReady();
      expect(api.editing.startCell({ rowIndex: 0, colId: "value" })).toBe(true);
      editors[0].input.value = "old draft";
      const oldStop = api.editing.stop();
      armed = true;
      resolveOld(true);
      expect(await oldStop).toBe(false);
      expect(starts).toEqual([true]);
      expect(editors[0].destroy).toHaveBeenCalledOnce();
      expect(editors[1].destroy).not.toHaveBeenCalled();
      expect(editors[1].input.isConnected).toBe(true);
      expect(newStop).not.toBe(oldStop);
      expect(api.editing.stop()).toBe(newStop);
      resolveNew(true);
      await newStop;
      expect(api.rows.getById(replacement === "cell" ? "old" : "new")?.data?.value).toBe("new draft");
      expect(editors[1].destroy).toHaveBeenCalledOnce();
      expect(cellStopped).toHaveBeenCalledTimes(replacement === "cell" ? 2 : 1);
      expect(rowStopped).toHaveBeenCalledTimes(replacement === "row" ? 1 : 0);
      expect(host.querySelector("input")).toBeNull();
    } finally { armed = false; api.destroy(); host.remove(); }
  });

  it.each(["cell", "fullRow"] as const)("releases the old stop task before %s destroy starts and submits a new session", async (editType) => {
    let resolveOld!: (valid: true) => void, resolveNew!: (valid: true) => void;
    const oldValidation = new Promise<true>((resolve) => { resolveOld = resolve; });
    const newValidation = new Promise<true>((resolve) => { resolveNew = resolve; });
    let armed = false, newStop: Promise<boolean> | undefined;
    const starts: boolean[] = [];
    const host = document.createElement("div");
    document.body.appendChild(host);
    const api = createGrid(host, {
      rowData: [{ id: "one", value: "saved" }], rowKey: "id", rowNumber: false, pagination: false, editType,
      columnDefs: [{
        field: "value", editable: true,
        validate: (value) => value === "old draft" ? oldValidation : newValidation,
        cellEditor: ({ value }) => {
          const input = document.createElement("input");
          input.value = value;
          return { el: input, getValue: () => input.value, destroy: () => {
            if (!armed) return;
            armed = false;
            starts.push(api.editing.startCell({ rowIndex: 0, colId: "value" }));
            host.querySelector<HTMLInputElement>("input")!.value = "new draft";
            newStop = api.editing.stop();
          } };
        }
      }]
    });
    try {
      await api.whenReady();
      expect(api.editing.startCell({ rowIndex: 0, colId: "value" })).toBe(true);
      host.querySelector<HTMLInputElement>("input")!.value = "old draft";
      const oldStop = api.editing.stop();
      armed = true;
      resolveOld(true);
      await oldStop;
      expect(starts).toEqual([true]);
      expect(newStop).toBeDefined();
      expect(newStop).not.toBe(oldStop);
      expect(api.editing.stop()).toBe(newStop);
      resolveNew(true);
      await newStop;
      expect(api.rows.getById("one")?.data?.value).toBe("new draft");
      expect(host.querySelector("input")).toBeNull();
    } finally { armed = false; api.destroy(); host.remove(); }
  });

  it.each([undefined, 0, 1])("releases old row editors once when destroy cancels and starts replacement row %s", async (replacement) => {
    let armed = false;
    const starts: boolean[] = [];
    const g = grid({ destroy: (_editor, api) => {
      if (!armed) return;
      armed = false;
      void api.editing.stop({ cancel: true });
      if (replacement !== undefined) starts.push(api.editing.startRow(replacement));
    } });
    try {
      await g.api.whenReady();
      g.api.view.refreshLayout();
      expect(g.api.editing.startRow(0)).toBe(true);
      const previous = [...g.editors];
      armed = true;
      await g.api.editing.stop({ cancel: true });
      expect(g.stopped).toHaveBeenCalledOnce();
      for (const editor of previous) {
        expect(editor.getValue).not.toHaveBeenCalled();
        expect(editor.destroy).toHaveBeenCalledOnce();
      }
      if (replacement === undefined) expect(g.api.editing.isRowActive()).toBe(false);
      else {
        expect(starts).toEqual([true]);
        expect(g.api.editing.isRowActive(replacement)).toBe(true);
        const current = g.editors.slice(previous.length);
        expect(current).toHaveLength(2);
        for (const editor of current) {
          expect(editor.destroy).not.toHaveBeenCalled();
          expect(editor.input.isConnected).toBe(true);
          expect(editor.input.closest(".mach-cell")?.classList.contains("mach-cell--row-editing")).toBe(true);
        }
        current[0].input.value = "replacement draft";
        await g.api.editing.stop();
        expect(g.api.rows.getById(String(replacement))?.data?.a).toBe("replacement draft");
        expect(g.stopped).toHaveBeenCalledTimes(2);
        for (const editor of current) expect(editor.destroy).toHaveBeenCalledOnce();
      }
    } finally { armed = false; g.api.destroy(); }
  });

  it("preserves a new row session started by a value-change callback during the old commit", async () => {
    let armed = false;
    const starts: boolean[] = [];
    const g = grid({}, { onCellValueChanged: () => {
      if (!armed) return;
      armed = false;
      void g.api.editing.stop({ cancel: true });
      starts.push(g.api.editing.startRow(1));
    } });
    try {
      await g.api.whenReady();
      g.api.view.refreshLayout();
      expect(g.api.editing.startRow(0)).toBe(true);
      const previous = [...g.editors];
      previous[0].input.value = "committed value";
      armed = true;
      expect(await g.api.editing.stop()).toBe(false);
      expect(starts).toEqual([true]);
      expect(g.api.rows.getById("0")?.data?.a).toBe("committed value");
      expect(g.api.editing.isRowActive(1)).toBe(true);
      expect(g.stopped).toHaveBeenCalledOnce();
      for (const editor of previous) expect(editor.destroy).toHaveBeenCalledOnce();
      for (const editor of g.editors.slice(previous.length)) {
        expect(editor.destroy).not.toHaveBeenCalled();
        expect(editor.input.closest(".mach-cell")?.classList.contains("mach-cell--row-editing")).toBe(true);
      }
    } finally { armed = false; g.api.destroy(); }
  });

  it.each(["destroy", "getValue-error"] as const)("releases a virtual editor once when %s disposes the grid", async (source) => {
    let armed = false;
    const onGridError = vi.fn(() => g.api.destroy());
    const g = grid({
      getValue: (editor) => {
        if (armed && source === "getValue-error") { armed = false; throw new Error("getValue failed"); }
        return editor.input.value;
      },
      destroy: (_editor, api) => {
        if (!armed || source !== "destroy") return;
        armed = false;
        api.destroy();
      }
    }, { onGridError });
    try {
      await g.api.whenReady();
      g.api.view.refreshLayout();
      expect(g.api.editing.startRow(0)).toBe(true);
      armed = true;
      g.api.view.scrollToRow(80, "top");
      expect(g.api.isDestroyed()).toBe(true);
      expect(g.editors).toHaveLength(2);
      for (const editor of g.editors) expect(editor.destroy).toHaveBeenCalledOnce();
      expect(g.editors[0].getValue).toHaveBeenCalledOnce();
      expect(g.editors[1].getValue).not.toHaveBeenCalled();
      expect(g.stopped).not.toHaveBeenCalled();
      expect(onGridError).toHaveBeenCalledTimes(source === "getValue-error" ? 1 : 0);
    } finally { armed = false; g.api.destroy(); }
  });

  it("clears the old cell style before destroy starts a new editor in the same cell", async () => {
    let armed = false;
    const started = vi.fn();
    const g = grid({ destroy: (_editor, api) => {
      if (!armed) return;
      armed = false;
      started(api.editing.startCell({ rowIndex: 0, colId: "a" }));
    } }, { editType: "cell" });
    try {
      await g.api.whenReady();
      expect(g.api.editing.startCell({ rowIndex: 0, colId: "a" })).toBe(true);
      const previous = g.editors[0];
      armed = true;
      await g.api.editing.stop({ cancel: true });
      expect(started).toHaveBeenCalledWith(true);
      expect(previous.destroy).toHaveBeenCalledOnce();
      const current = g.editors[1];
      expect(current.destroy).not.toHaveBeenCalled();
      expect(current.input.isConnected).toBe(true);
      expect(current.input.closest(".mach-cell")?.classList.contains("mach-cell--editing")).toBe(true);
      current.input.value = "new cell draft";
      await g.api.editing.stop();
      expect(g.api.rows.getById("0")?.data?.a).toBe("new cell draft");
      expect(current.destroy).toHaveBeenCalledOnce();
    } finally { armed = false; g.api.destroy(); }
  });
});
