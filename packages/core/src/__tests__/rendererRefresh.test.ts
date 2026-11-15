// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGrid } from "../core/createGrid";
import type { CellRendererParams, ColDef, GridApi } from "../index";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
});
afterEach(() => { vi.unstubAllGlobals(); });

function renderer() {
  const refresh = vi.fn(() => true), destroy = vi.fn();
  const create = vi.fn(() => ({ el: document.createElement("span"), refresh, destroy }));
  const clear = () => { refresh.mockClear(); destroy.mockClear(); create.mockClear(); };
  return { create, refresh, destroy, clear };
}

describe("renderer refresh ownership", () => {
  it.each([
    { span: false, scoped: false }, { span: false, scoped: true },
    { span: true, scoped: false }, { span: true, scoped: true }
  ])("preserves refresh hooks and forces only matching columns: %j", async ({ span, scoped }) => {
    const first = renderer(), target = renderer();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const api = createGrid(host, {
      rowData: [{ id: "one", a: 1, b: 2, c: 3 }], rowKey: "id", pagination: false,
      columnDefs: [
        { field: "a", cellRenderer: first.create, ...(span ? { colSpan: () => 2 } : {}) },
        { field: "b" }, { field: "c", cellRenderer: target.create }
      ]
    });
    try {
      await api.whenReady();
      const params = scoped ? { columns: ["c"] } : {};
      first.clear(); target.clear();
      api.view.refreshCells({ ...params, force: false });
      expect(target.refresh).toHaveBeenCalledOnce();
      expect(target.destroy).not.toHaveBeenCalled();
      expect(target.create).not.toHaveBeenCalled();
      first.clear(); target.clear();
      api.view.refreshCells({ ...params, force: true });
      expect(target.refresh).not.toHaveBeenCalled();
      expect(target.destroy).toHaveBeenCalledOnce();
      expect(target.create).toHaveBeenCalledOnce();
      expect(first.destroy).toHaveBeenCalledTimes(scoped ? 0 : 1);
      expect(first.refresh).toHaveBeenCalledTimes(scoped && span ? 1 : 0);
    } finally { api.destroy(); host.remove(); }
  });

  it("preserves the active editor and draft during a forced full refresh", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const api = createGrid(host, {
      rowData: [{ id: "one", value: "saved" }], rowKey: "id", pagination: false,
      columnDefs: [{ field: "value", editable: true }]
    });
    try {
      await api.whenReady();
      expect(api.editing.startCell({ rowIndex: 0, colId: "value" })).toBe(true);
      const input = host.querySelector<HTMLInputElement>(".mach-editor-input")!;
      input.value = "draft";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      api.view.refreshCells({ force: true });
      expect(host.querySelector(".mach-editor-input")).toBe(input);
      expect(input.value).toBe("draft");
      await api.editing.stop();
      expect(api.rows.getById("one")?.data?.value).toBe("draft");
    } finally { api.destroy(); host.remove(); }
  });

  it.each(["destroy", "rows", "columns"] as const)("stops a forced repaint after a destroy callback changes its %s owner", async (action) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    let reenter = false;
    const create = vi.fn((params: CellRendererParams<{ id: string; value: string }>) => {
      const content = document.createElement("span");
      content.textContent = params.data?.value ?? "";
      return {
        el: content,
        destroy: () => {
          if (!reenter) return;
          reenter = false;
          if (action === "destroy") api.destroy();
          else if (action === "rows") api.rows.setData([{ id: "old", value: "replacement" }]);
          else api.columns.setDefinitions([{ field: "id" }] as ColDef<{ id: string; value: string }>[]);
        }
      };
    });
    const api: GridApi<{ id: string; value: string }> = createGrid(host, {
      rowData: [{ id: "old", value: "original" }], rowKey: "id", pagination: false,
      columnDefs: [{ field: "value", cellRenderer: create }]
    });
    try {
      await api.whenReady();
      create.mockClear();
      reenter = true;
      api.view.refreshCells({ force: true });
      expect(create.mock.calls.every(([params]) => params.data?.value !== "original")).toBe(true);
      if (action === "destroy") expect(host.querySelector(".mach-root")).toBeNull();
      else if (action === "rows") expect(host.textContent).toContain("replacement");
      else expect(host.querySelector(".mach-header-cell[data-col-id='id']")).not.toBeNull();
    } finally { api.destroy(); host.remove(); }
  });
});
