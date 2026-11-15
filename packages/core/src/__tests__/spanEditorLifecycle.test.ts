// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGrid, type ColDef, type GridApi, type GridOptions } from "../index";

interface SpanRow {
  id: string;
  c0: string;
  c200: string;
  span: number;
}

const grids: GridApi<SpanRow>[] = [];
afterEach(() => {
  grids.splice(0).forEach((api) => api.destroy());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function columns(first: Partial<ColDef<SpanRow>> = {}): ColDef<SpanRow>[] {
  return Array.from<unknown, ColDef<SpanRow>>({ length: 500 }, (_, index) => ({
    field: `c${index}`,
    width: 80,
    editable: index === 0 || index === 200,
    ...(index === 0 ? { colSpan: ({ data }) => data?.span ?? 1, ...first } : {})
  }));
}

function grid(first: Partial<ColDef<SpanRow>> = {}, options: Partial<GridOptions<SpanRow>> = {}) {
  const host = document.createElement("div");
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 400 } });
  document.body.appendChild(host);
  const api = createGrid<SpanRow>(host, {
    rowKey: "id", rowNumber: false, pagination: false,
    columnDefs: columns(first),
    rowData: [{ id: "one", c0: "before", c200: "visible", span: 110 }],
    ...options
  });
  grids.push(api);
  const viewport = host.querySelector<HTMLElement>(".mach-body-viewport--scroll")!;
  Object.defineProperty(viewport, "clientWidth", { value: 400 });
  const cell = (colId: string) => host.querySelector<HTMLElement>(`.mach-pane--center .mach-row[data-index="0"] [data-col-id="${colId}"]`);
  const scroll = (left: number) => { viewport.scrollLeft = left; api.view.refreshLayout(); };
  const start = () => {
    expect(api.editing.startCell({ rowIndex: 0, colId: "c0" })).toBe(true);
    return cell("c0")!.querySelector<HTMLInputElement>("input")!;
  };
  return { api, host, cell, scroll, start };
}

describe("merged cell editor virtual release", () => {
  it("commits a synchronous valid edit when the whole span leaves the virtual window", () => {
    const stopped = vi.fn();
    const g = grid({}, { onCellEditingStopped: stopped });
    const input = g.start();
    input.value = "after";
    g.scroll(16005);
    expect(g.api.rows.getById("one")!.data!.c0).toBe("after");
    expect(stopped).toHaveBeenCalledTimes(1);
    expect(g.cell("c0")!.style.display).toBe("none");
    expect(input.isConnected).toBe(false);
    expect(g.cell("c0")!.querySelector(".mach-cell-editor-shell")).toBeNull();
    expect(g.host.querySelector(".mach-cell-editor-controls")).toBeNull();
    g.scroll(0);
    expect(g.cell("c0")!.textContent).toBe("after");
    expect(g.cell("c0")!.querySelector("input")).toBeNull();
  });

  it("cancels an invalid hidden edit and allows editing a visible cell", () => {
    const g = grid({ validate: () => "invalid" });
    const input = g.start();
    input.value = "invalid value";
    g.scroll(16005);
    expect(g.api.rows.getById("one")!.data!.c0).toBe("before");
    expect(input.isConnected).toBe(false);
    expect(g.cell("c0")!.querySelector(".mach-cell-editor-shell")).toBeNull();
    expect(g.host.querySelector(".mach-cell-editor-controls")).toBeNull();
    expect(g.api.editing.startCell({ rowIndex: 0, colId: "c200" })).toBe(true);
    expect(g.cell("c200")!.querySelector("input")).not.toBeNull();
  });

  it("ignores asynchronous validation that settles after the span has been released", async () => {
    let resolve!: (result: true) => void;
    const g = grid({ validate: () => new Promise<true>((done) => { resolve = done; }) });
    const input = g.start();
    input.value = "late";
    const pending = g.api.editing.stop();
    g.scroll(16005);
    expect(input.isConnected).toBe(false);
    expect(g.cell("c0")!.querySelector(".mach-cell-editor-shell")).toBeNull();
    resolve(true);
    expect(await pending).toBe(false);
    expect(g.api.rows.getById("one")!.data!.c0).toBe("before");
    expect(g.host.querySelector(".mach-cell-editor-controls")).toBeNull();
  });

  it("captures and remounts a full-row draft without committing when its span is hidden", async () => {
    const destroyed = vi.fn();
    const g = grid({ cellEditor: ({ value }) => {
      const input = document.createElement("input");
      input.value = value;
      return { el: input, getValue: () => input.value, destroy: destroyed };
    } }, { editType: "fullRow" });
    expect(g.api.editing.startRow(0)).toBe(true);
    const input = g.cell("c0")!.querySelector<HTMLInputElement>("input")!;
    input.value = "draft";
    g.scroll(16005);
    expect(destroyed).toHaveBeenCalledTimes(1);
    expect(input.isConnected).toBe(false);
    expect(g.cell("c0")!.querySelector(".mach-row-editor-shell")).toBeNull();
    expect(g.api.editing.isRowActive(0)).toBe(true);
    expect(g.api.rows.getById("one")!.data!.c0).toBe("before");
    g.scroll(0);
    const restored = g.cell("c0")!.querySelector<HTMLInputElement>("input")!;
    expect(restored).not.toBe(input);
    expect(restored.value).toBe("draft");
    expect(await g.api.editing.stop()).toBe(true);
    expect(g.api.rows.getById("one")!.data!.c0).toBe("draft");
    expect(destroyed).toHaveBeenCalledTimes(2);
  });

  it("tolerates destroying the grid from a release callback", () => {
    const g = grid({}, { onCellEditingStopped: ({ api }) => api.destroy() });
    g.start().value = "after";
    expect(() => g.scroll(16005)).not.toThrow();
    expect(g.host.querySelector(".mach-root")).toBeNull();
  });

  it("does not create overlays or call pinned/summary renderers after a release callback destroys the grid", () => {
    let disposed = false;
    const lateCallbacks: string[] = [];
    const g = grid({ cellRenderer: ({ data }) => {
      if (disposed) lateCallbacks.push(data?.id === "pinned" ? "pinned" : "cell");
      return data?.c0 ?? "";
    } }, {
      pinnedTopRowData: [{ id: "pinned", c0: "pinned", c200: "pinned", span: 1 }],
      showSummary: true,
      summaryMethod: () => { if (disposed) lateCallbacks.push("summary"); return ""; },
      overlayNoRowsTemplate: () => { if (disposed) lateCallbacks.push("overlay"); return document.createElement("div"); },
      onCellEditingStopped: ({ api }) => { api.destroy(); disposed = true; }
    });
    g.start().value = "after";
    g.scroll(16005);
    expect(g.api.isDestroyed()).toBe(true);
    expect(lateCallbacks).toEqual([]);
  });

  it("preserves new columns installed from a release callback", () => {
    const g = grid({}, { onCellEditingStopped: ({ api }) => api.columns.setDefinitions([{ field: "c200", width: 80 }]) });
    g.start().value = "after";
    expect(() => g.scroll(16005)).not.toThrow();
    expect(g.cell("c0")).toBeNull();
    expect(g.cell("c200")!.style.display).toBe("");
    expect(g.cell("c200")!.textContent).toBe("visible");
  });

  it("preserves a replacement row whose span becomes visible during the release callback", () => {
    const g = grid({}, { onCellEditingStopped: ({ api }) => api.rows.setData([{ id: "one", c0: "replacement", c200: "visible", span: 500 }]) });
    g.start().value = "after";
    expect(() => g.scroll(16005)).not.toThrow();
    expect(g.cell("c0")!.style.display).toBe("");
    expect(g.cell("c0")!.getAttribute("aria-colspan")).toBe("500");
    expect(g.cell("c0")!.textContent).toBe("replacement");
  });

  it("preserves a span updated on the same row by the release callback", () => {
    const g = grid({}, { onCellEditingStopped: ({ rowNode }) => { rowNode.data!.span = 500; } });
    g.start().value = "after";
    g.scroll(16005);
    expect(g.cell("c0")!.style.display).toBe("");
    expect(g.cell("c0")!.getAttribute("aria-colspan")).toBe("500");
    expect(g.cell("c0")!.textContent).toBe("after");
  });

  it("releases a visible editor when another column expands over it", () => {
    const stopped = vi.fn();
    const g = grid({}, { onCellEditingStopped: stopped });
    g.scroll(16005);
    expect(g.api.editing.startCell({ rowIndex: 0, colId: "c200" })).toBe(true);
    const input = g.cell("c200")!.querySelector<HTMLInputElement>("input")!;
    input.value = "covered";
    g.api.rows.getById("one")!.data!.span = 250;
    g.api.view.refreshCells();
    expect(g.api.rows.getById("one")!.data!.c200).toBe("covered");
    expect(stopped).toHaveBeenCalledTimes(1);
    expect(g.cell("c200")!.style.display).toBe("none");
    expect(input.isConnected).toBe(false);
    expect(g.cell("c200")!.querySelector(".mach-cell-editor-shell")).toBeNull();
    expect(g.host.querySelector(".mach-cell-editor-controls")).toBeNull();
  });
});
