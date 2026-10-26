// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGrid } from "../../packages/core/src/core/createGrid";
import type { GridApi } from "../../packages/core/src/types/api";
import { buildDefs, makeRows } from "../../examples/bench/src/data";

const grids: GridApi[] = [];
afterEach(() => {
  grids.splice(0).forEach(api => api.destroy());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("wide benchmark viewport", () => {
  it.each(["normal", "autoHeight"] as const)("renders newly exposed columns without a vertical move in %s layout", async domLayout => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(640);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const host = document.createElement("div");
    document.body.append(host);
    const api = createGrid(host, {
      columnDefs: buildDefs(500), rowData: makeRows(domLayout === "normal" ? 10_000 : 10),
      rowKey: "id", pagination: false, domLayout
    });
    grids.push(api);
    const action = host.querySelector('.mach-row[data-index="0"] .mach-cell[data-col-id="op"] button');
    const viewport = host.querySelector<HTMLElement>(".mach-body-viewport--scroll")!;
    viewport.scrollLeft = 59_000;
    viewport.dispatchEvent(new Event("scroll"));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const cells = [...host.querySelectorAll<HTMLElement>('.mach-row[data-index] .mach-cell[data-col-id^="x"]')];
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      const rowIndex = Number(cell.closest<HTMLElement>(".mach-row")!.dataset.index);
      const columnIndex = Number(cell.dataset.colId!.slice(1));
      expect(cell.textContent).toBe(String((rowIndex + columnIndex) % 997));
    }
    const empty = [...host.querySelectorAll<HTMLElement>('.mach-cell[data-col-id^="x"]')].filter(cell => cell.textContent === "");
    if (domLayout === "normal") expect(empty.length).toBeGreaterThan(0);
    for (const cell of empty) {
      const row = cell.closest<HTMLElement>(".mach-row")!;
      expect(row.hasAttribute("data-index")).toBe(false);
      expect(getComputedStyle(row).display).toBe("none");
    }
    expect(host.querySelector('.mach-row[data-index="0"] .mach-cell[data-col-id="op"] button')).toBe(action);
    expect(api.rows.getCount()).toBe(domLayout === "normal" ? 10_000 : 10);
  });
});
