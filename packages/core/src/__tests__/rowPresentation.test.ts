// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGrid, dragColumn } from "../index";
import type { GridApi, GridOptions } from "../index";

interface Row { id: string; status: string }
let api: GridApi<Row>;
let host: HTMLElement;

function setup(options: GridOptions<Row> = {}) {
  host = document.createElement("div");
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 400 } });
  document.body.append(host);
  api = createGrid(host, {
    rowKey: "id", pagination: false,
    columnDefs: [dragColumn(), { field: "id", pinned: "left" }, { field: "status" }, { colId: "right", valueGetter: () => "", pinned: "right" }],
    rowData: [{ id: "a", status: "queued" }, { id: "b", status: "failed" }, { id: "c", status: "plain" }],
    ...options
  });
  const rect = { left: 0, right: 800, top: 0, bottom: 400, width: 800, height: 400, x: 0, y: 0, toJSON: () => ({}) };
  for (const element of host.querySelectorAll<HTMLElement>(".mach-root, .mach-body, .mach-body-viewport")) {
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue(rect);
  }
}

afterEach(() => { api?.destroy(); host?.remove(); vi.restoreAllMocks(); });

describe("managed row ordering", () => {
  it("rejects ordering under column sorting instead of reporting a successful invisible move", () => {
    setup();
    api.sorting.setModel([{ colId: "id", direction: "asc" }]);
    expect(api.rows.reorder(0, 2)).toBe(false);
    expect(api.rows.getAt(0)?.id).toBe("a");
  });

  it("rejects fractional and non-finite indexes", () => {
    setup();
    for (const index of [NaN, Infinity, -1, 0.5, 99]) expect(api.rows.reorder(index, 1)).toBe(false);
  });
});

describe("opt-in row appearance", () => {
  it("applies the first matching rule once across all panes and leaves other rows alone", () => {
    const when = vi.fn(({ data }: { data: Row }) => data.status === "queued");
    setup({ rowStyleRules: [{ when, tone: "warning" }, { when: () => true, backgroundColor: "#ffeeee" }] });
    when.mockClear();
    api.view.refreshCells();
    expect(when).toHaveBeenCalledTimes(3);
    const rows = host.querySelectorAll<HTMLElement>('.mach-row[data-id="a"]');
    expect(rows.length).toBe(3);
    for (const row of rows) expect(row.dataset.rowTone).toBe("warning");
    expect(host.querySelector<HTMLElement>('.mach-row[data-id="b"]')?.style.getPropertyValue("--mach-row-rule-bg")).toBe("#ffeeee");
  });

  it("recalculates on transactions and scoped cell refresh and clears removed rules", () => {
    setup({ rowStyleRules: [{ when: ({ data }) => data.status === "queued", tone: "warning" }] });
    expect(host.querySelector('.mach-row[data-id="c"]')?.classList.contains("mach-row--styled")).toBe(false);
    api.rows.transact({ update: [{ id: "a", status: "plain" }] });
    expect(host.querySelector('.mach-row[data-id="a"]')?.classList.contains("mach-row--styled")).toBe(false);
    api.rows.getById("a")!.data!.status = "queued";
    api.view.refreshCells({ rowIds: ["a"], columns: ["status"] });
    expect(host.querySelector<HTMLElement>('.mach-row[data-id="a"]')?.dataset.rowTone).toBe("warning");
    api.updateOptions({ rowStyleRules: [{ when: () => true, backgroundColor: "pink", color: "navy" }] });
    api.updateOptions({ rowStyleRules: [] });
    for (const row of host.querySelectorAll<HTMLElement>(".mach-row")) {
      expect(row.classList.contains("mach-row--styled")).toBe(false);
      expect(row.dataset.rowTone).toBeUndefined();
      expect(row.style.getPropertyValue("--mach-row-rule-bg")).toBe("");
      expect(row.style.getPropertyValue("--mach-row-rule-fg")).toBe("");
    }
  });

  it("supports pinned rows explicitly and refreshes them when configuration changes", () => {
    setup({
      pinnedTopRowData: [{ id: "p", status: "queued" }],
      rowStyleRules: [{ when: ({ rowPinned }) => rowPinned === "top", tone: "info" }]
    });
    expect(host.querySelectorAll('.mach-pinned-row[data-row-tone="info"]').length).toBe(3);
    expect(host.querySelectorAll(".mach-row--styled").length).toBe(3);
    api.updateOptions({ rowStyleRules: [] });
    expect(host.querySelectorAll(".mach-row--styled").length).toBe(0);
  });

  it("isolates failing predicates and excludes synthetic group rows", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setup({ rowStyleRules: [
      { when: () => { throw new Error("invalid rule"); }, tone: "danger" },
      { when: ({ data }) => data.id === "a", tone: "success" }
    ] });
    expect(host.querySelector<HTMLElement>('.mach-row[data-id="a"]')?.dataset.rowTone).toBe("success");
    api.updateOptions({ columnDefs: [{ field: "status", rowGroup: true }, { field: "id" }] });
    for (const row of host.querySelectorAll<HTMLElement>(".mach-row[aria-expanded]")) {
      expect(row.classList.contains("mach-row--styled")).toBe(false);
    }
  });
});

function pointer(type: string, y: number, x = 20, id = 1): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
  Object.defineProperty(event, "pointerId", { value: id });
  return event;
}

function startDrag() {
  host.querySelector('.mach-row[data-id="a"] .mach-row-drag-handle')!.dispatchEvent(pointer("pointerdown", 18));
  window.dispatchEvent(pointer("pointermove", 100));
}

describe("row drag interaction", () => {
  it("moves to the last position and emits after applying with a final index", () => {
    const onRowDragEnd = vi.fn(() => expect(api.rows.getAt(2)?.id).toBe("a"));
    setup({ onRowDragEnd });
    startDrag();
    expect(host.querySelectorAll(".mach-row--drag-source").length).toBe(3);
    window.dispatchEvent(pointer("pointerup", 100));
    expect(onRowDragEnd).toHaveBeenCalledWith(expect.objectContaining({ fromIndex: 0, toIndex: 3, targetIndex: 2, applied: true }));
    expect(host.querySelector(".mach-row-drop-indicator")).toBeNull();
    expect(host.querySelector(".mach-row-drag-preview")).toBeNull();
    expect(host.querySelector(".mach-row--drag-source")).toBeNull();
  });

  it("supports event-only moves for externally managed data", () => {
    const onRowDragEnd = vi.fn();
    setup({ applyRowDrag: false, onRowDragEnd });
    startDrag();
    window.dispatchEvent(pointer("pointerup", 100));
    expect(api.rows.getAt(0)?.id).toBe("a");
    expect(onRowDragEnd).toHaveBeenCalledWith(expect.objectContaining({ targetIndex: 2, applied: false }));
  });

  it.each(["escape", "blur", "pointercancel", "outside", "destroy"])("cancels and cleans feedback on %s", (reason) => {
    const onRowDragEnd = vi.fn();
    setup({ onRowDragEnd });
    startDrag();
    if (reason === "escape") window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    if (reason === "blur") window.dispatchEvent(new Event("blur"));
    if (reason === "pointercancel") window.dispatchEvent(pointer("pointercancel", 100));
    if (reason === "outside") window.dispatchEvent(pointer("pointerup", 100, 900));
    if (reason === "destroy") api.destroy();
    window.dispatchEvent(pointer("pointerup", 100));
    expect(onRowDragEnd).not.toHaveBeenCalled();
    expect(host.querySelector(".mach-row-drop-indicator, .mach-row-drag-preview, .mach-root--row-dragging")).toBeNull();
  });

  it("ignores other pointers and cancels when the data order changes during dragging", () => {
    const onRowDragEnd = vi.fn();
    setup({ onRowDragEnd });
    startDrag();
    window.dispatchEvent(pointer("pointerup", 100, 20, 2));
    expect(host.querySelector(".mach-row-drop-indicator")).not.toBeNull();
    api.rows.setData([{ id: "d", status: "plain" }]);
    window.dispatchEvent(pointer("pointerup", 100));
    expect(onRowDragEnd).not.toHaveBeenCalled();
  });

  it("moves with Alt+Arrow and disables handles under sorting", () => {
    const onRowDragEnd = vi.fn();
    setup({ onRowDragEnd });
    host.querySelector('.mach-row[data-id="a"] .mach-row-drag-handle')!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown", altKey: true }));
    expect(api.rows.getAt(1)?.id).toBe("a");
    expect(onRowDragEnd).toHaveBeenCalledWith(expect.objectContaining({ targetIndex: 1, applied: true }));
    api.sorting.setModel([{ colId: "id", direction: "asc" }]);
    expect(Array.from(host.querySelectorAll<HTMLButtonElement>(".mach-row-drag-handle")).every(handle => handle.disabled)).toBe(true);
    api.updateOptions({ applyRowDrag: false });
    expect(host.querySelector<HTMLButtonElement>(".mach-row-drag-handle")?.disabled).toBe(false);
  });

  it("keeps expanded master/detail pairs together and reports the actual final index", () => {
    const onRowDragEnd = vi.fn();
    setup({ masterDetail: true, detailRowHeight: 36, detailRowRenderer: () => "Detail", onRowDragEnd });
    api.hierarchy.setRowExpanded("a", true);
    api.hierarchy.setRowExpanded("b", true);
    startDrag();
    window.dispatchEvent(pointer("pointerup", 140));
    expect(api.rows.getAt(0)?.id).toBe("b");
    expect(api.rows.getAt(1)?.isDetail).toBe(true);
    expect(api.rows.getAt(2)?.id).toBe("a");
    expect(api.rows.getAt(3)?.isDetail).toBe(true);
    expect(onRowDragEnd).toHaveBeenCalledWith(expect.objectContaining({ targetIndex: 2, applied: true }));
  });
});
