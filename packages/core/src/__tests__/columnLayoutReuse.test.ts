// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { GridCore } from "../core/gridCore";
import { ColumnViewportIndex } from "../services/columnViewportIndex";
import type { ColDef, GridOptions } from "../index";

const grids: GridCore[] = [];
afterEach(() => {
  grids.splice(0).forEach((grid) => grid.destroy());
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function mount(options: GridOptions = {}): GridCore {
  const host = document.createElement("div");
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 300 } });
  document.body.appendChild(host);
  const grid = new GridCore(host, {
    rowKey: "id", pagination: false, rowNumber: false,
    columnDefs: Array.from({ length: 100 }, (_, index) => ({ field: `c${index}`, width: 80 })),
    rowData: [{ id: "one", c0: "before" }],
    ...options
  });
  grids.push(grid);
  return grid;
}

function bodyCell(grid: GridCore, colId: string): HTMLElement {
  return grid.skeleton.root.querySelector<HTMLElement>(`.mach-pane--center .mach-cell[data-col-id="${colId}"]`)!;
}

describe("pooled column layout prefix reuse", () => {
  it("lays out the bounded cell pool without rescanning every column", () => {
    const grid = mount();
    const scan = vi.spyOn(ColumnViewportIndex.prototype, "update");
    grid.bodyRenderer.applyCellLayout();
    expect(scan).not.toHaveBeenCalled();
    expect(bodyCell(grid, "c1").style.left).toBe("80px");
    grid.api.columns.setWidth("c0", 160);
    scan.mockClear();
    grid.bodyRenderer.applyCellLayout();
    expect(scan).not.toHaveBeenCalled();
    expect(bodyCell(grid, "c1").style.left).toBe("160px");
  });

  it.each(["valueGetter", "cellRenderer", "getRowHeight"] as const)("uses the current prefix after %s changes columns", (source) => {
    let armed = false;
    const replace = () => {
      if (!armed) return;
      armed = false;
      grid.api.columns.setDefinitions(defs(160));
    };
    const defs = (width: number): ColDef[] => Array.from({ length: 100 }, (_, index) => ({
      field: `c${index}`, width: index === 0 ? width : 80,
      ...(index === 0 && source === "valueGetter" ? { valueGetter: () => { replace(); return "value"; } } : {}),
      ...(index === 0 && source === "cellRenderer" ? { cellRenderer: () => { replace(); return "rendered"; } } : {})
    }));
    const grid = mount({ columnDefs: defs(80), ...(source === "getRowHeight" ? { getRowHeight: () => { replace(); return 30; } } : {}) });
    armed = true;
    grid.api.rows.setData([{ id: "two", c0: "after" }]);
    expect(armed).toBe(false);
    expect(bodyCell(grid, "c0").style.width).toBe("160px");
    expect(bodyCell(grid, "c1").style.left).toBe("160px");
    expect(bodyCell(grid, "c2").style.left).toBe("240px");
  });
});
