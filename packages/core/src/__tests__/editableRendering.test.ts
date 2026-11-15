// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGrid } from "../core/createGrid";

afterEach(() => { vi.unstubAllGlobals(); });

describe("cell editability rendering", () => {
  it.each(["always", "hover"] as const)("evaluates editability once for matching ARIA and %s indicators before rendering content", async (editableIndicator) => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    const row = { id: "one", value: 1, enabled: true };
    const order: string[] = [];
    const editable = vi.fn(({ data, value }) => {
      order.push("editable");
      expect(data).toBe(row);
      expect(value).toBe(row.value);
      return data.enabled;
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const api = createGrid(host, {
      rowData: [row], rowKey: "id", editableIndicator, pagination: false,
      columnDefs: [{
        field: "value", editable,
        cellRenderer: () => { order.push("renderer"); return document.createElement("span"); }
      }]
    });
    try {
      await api.whenReady();
      for (const enabled of [true, false]) {
        row.enabled = enabled;
        editable.mockClear();
        order.length = 0;
        api.view.refreshCells();
        const cell = host.querySelector(".mach-cell[data-col-id='value']")!;
        expect(editable).toHaveBeenCalledOnce();
        expect(order).toEqual(["editable", "renderer"]);
        expect(cell.getAttribute("aria-readonly")).toBe(String(!enabled));
        expect(cell.querySelector(".mach-cell-edit-trigger") !== null).toBe(enabled);
      }
    } finally { api.destroy(); host.remove(); }
  });
});
