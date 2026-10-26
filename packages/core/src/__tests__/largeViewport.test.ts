// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { GridCore } from "../core/gridCore";
import type { GridOptions } from "../types/options";

interface Row { id: string; name: string }
const grids: GridCore<Row>[] = [];
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
function mount(extra: Partial<GridOptions<Row>> = {}) {
  const host = document.createElement("div"); document.body.append(host);
  const grid = new GridCore<Row>(host, {
    columnDefs: [{ colId: "order", rowDrag: true, width: 48 }, { field: "id", pinned: "left" }, { field: "name", editable: true }],
    rowKey: "id", rowHeight: 32, rowBuffer: 1, pagination: false,
    datasourceMode: "block", datasourceRowCount: 10_000_000, blockSize: 20, maxBlocksInCache: 2, blockPrefetch: 0,
    datasource: { getRows({ startRow, endRow, onSuccess }) { onSuccess(Array.from({ length: endRow - startRow }, (_, offset) => ({ id: String(startRow + offset), name: `Row ${startRow + offset}` })), 10_000_000); } },
    ...extra
  });
  grids.push(grid);
  const viewport = grid.skeleton.bodyViewports.center;
  Object.defineProperties(viewport, { clientHeight: { value: 320, configurable: true }, clientWidth: { value: 800 } });
  grid.api.view.refreshLayout();
  return { grid, viewport, host, api: grid.api };
}
afterEach(() => { grids.splice(0).forEach(grid => grid.destroy()); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("large logical viewport integration", () => {
  it("bounds physical height and reaches the ten-millionth remote row with sparse storage", async () => {
    const { api, grid, viewport, host } = mount();
    await tick();
    expect(parseFloat(grid.skeleton.rowContainers.center.style.height)).toBeLessThanOrEqual(16_000_000);
    api.view.scrollToRow(9_999_999, "bottom");
    await tick();
    expect(api.rows.getAt(9_999_999)?.data?.id).toBe("9999999");
    expect(api.rows.getCacheSnapshot().cachedRowCount).toBeLessThanOrEqual(60);
    expect(host.querySelectorAll(".mach-row[data-index]").length).toBeLessThan(40);
    const center = grid.skeleton.rowContainers.center.querySelector<HTMLElement>('.mach-row[data-index="9999999"]')!;
    const left = grid.skeleton.rowContainers.left.querySelector<HTMLElement>('.mach-row[data-index="9999999"]')!;
    const y = parseFloat(center.style.transform.slice("translateY(".length));
    expect(y - viewport.scrollTop).toBeCloseTo(288);
    expect(left.style.transform).toBe(center.style.transform);
    expect(grid.skeleton.rowContainers.left.style.top).toBe(`${-viewport.scrollTop}px`);
    expect(grid.skeleton.rowContainers.left.style.transform).toBe("");
  });

  it("clips end buffers so transformed rows cannot extend the physical scrollbar range", async () => {
    const { api, grid } = mount({ rowBuffer: 2 }); await tick();
    api.view.scrollToRow(9_999_989, "top"); await tick();
    const container = grid.skeleton.rowContainers.center;
    const buffered = container.querySelector<HTMLElement>('.mach-row[data-index="9999999"]')!;
    expect(parseFloat(buffered.style.transform.slice(11)) + parseFloat(buffered.style.height)).toBeGreaterThan(parseFloat(container.style.height));
    // JSDOM does not calculate scrollHeight. The real three-engine case below
    // checks that this clipping boundary keeps the native scrollbar at 16M.
    for (const pane of ["left", "center", "right"] as const) expect(grid.skeleton.rowContainers[pane].style.overflow).toBe("hidden");
    api.updateOptions({ rowHeight: 1 });
    expect(container.style.overflow).toBe("");
  });

  it("maps a native scrollbar jump and keeps API navigation exact at fractional physical positions", async () => {
    const { api, grid, viewport } = mount(); await tick();
    viewport.scrollTop = (16_000_000 - 320) / 2;
    grid.bodyRenderer.syncScroll(); await tick();
    expect(grid.bodyRenderer.getRenderedRowRange().first).toBe(4_999_994);
    api.view.scrollToRow(123_457, "top"); await tick();
    const row = grid.skeleton.rowContainers.center.querySelector<HTMLElement>('.mach-row[data-index="123457"]')!;
    expect(parseFloat(row.style.transform.slice(11)) - viewport.scrollTop).toBeCloseTo(0);
    api.view.scrollToRow(123_458, "nearest");
    expect(grid.bodyRenderer.getRenderedRowRange().first).toBe(123_456);
  });

  it("uses logical wheel deltas, retaining horizontal and browser zoom behavior", async () => {
    const { api, grid, viewport } = mount(); await tick();
    api.view.scrollToRow(100_000, "top");
    const wheel = new WheelEvent("wheel", { deltaY: 32, deltaX: 7, bubbles: true, cancelable: true });
    viewport.dispatchEvent(wheel);
    grid.bodyRenderer.syncScroll();
    expect(wheel.defaultPrevented).toBe(true);
    expect(grid.bodyRenderer.getRenderedRowRange().first).toBe(100_000);
    expect(viewport.scrollLeft).toBe(7);
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
      const event = new WheelEvent("wheel", { deltaY: 32, bubbles: true, cancelable: true, ...modifier });
      viewport.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    api.view.scrollToRow(0);
    const boundary = new WheelEvent("wheel", { deltaY: -32, bubbles: true, cancelable: true });
    viewport.dispatchEvent(boundary);
    expect(boundary.defaultPrevented).toBe(false);
  });

  it("shares mapped row offsets with range fill and hides distant handles without extending the spacer", async () => {
    const { api, grid, viewport, host } = mount({ enableRangeSelection: true }); await tick();
    grid.bodyRenderer.startRange(9_999_999, 2, false);
    expect(host.querySelector<HTMLElement>(".mach-fill-handle")!.style.display).toBe("none");
    api.view.scrollToRow(100_000, "top"); await tick();
    grid.bodyRenderer.startRange(100_000, 2, false);
    vi.spyOn(grid.skeleton.rowContainers.center, "getBoundingClientRect").mockImplementation(() => ({ top: -viewport.scrollTop, left: 0 } as DOMRect));
    const handle = host.querySelector<HTMLElement>(".mach-fill-handle")!;
    expect(parseFloat(handle.style.top) - viewport.scrollTop).toBeCloseTo(28);
    handle.dispatchEvent(new MouseEvent("mousedown", { button: 0, clientX: 100, clientY: 30, bubbles: true }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 100, clientY: 95 }));
    window.dispatchEvent(new MouseEvent("mouseup", { clientX: 100, clientY: 95 }));
    expect(api.rows.getAt(100_001)?.data?.name).toBe("Row 100000");
    expect(api.rows.getAt(100_002)?.data?.name).toBe("Row 100000");
    expect(api.selection.getRange()).toMatchObject({ row1: 100_000, row2: 100_002 });
  });

  it("keeps the entire last-column fill handle inside a clipped compressed container", async () => {
    const { api, grid, host } = mount({ enableRangeSelection: true }); await tick();
    api.columns.setWidth("name", 1000);
    api.view.scrollToRow(100_000, "top"); await tick();
    grid.bodyRenderer.startRange(100_000, 2, false);
    const handle = host.querySelector<HTMLElement>(".mach-fill-handle")!;
    const width = parseFloat(grid.skeleton.rowContainers.center.style.width);
    expect(parseFloat(handle.style.left) + 8).toBeLessThanOrEqual(width);
    api.updateOptions({ rowHeight: 1 });
    expect(parseFloat(handle.style.left)).toBe(width - 4);
  });

  it("maps variable heights and returns to direct coordinates after their height shrinks", () => {
    const rows = Array.from({ length: 2000 }, (_, index) => ({ id: String(index), name: `Row ${index}` }));
    const { api, grid, viewport } = mount({ datasource: undefined, datasourceMode: "sequential", rowData: rows,
      getRowHeight: ({ data }) => Number(data!.id) % 2 ? 15_000 : 10_000 });
    api.view.scrollToRow(1333, "top");
    const row = grid.skeleton.rowContainers.center.querySelector<HTMLElement>('.mach-row[data-index="1333"]')!;
    expect(parseFloat(row.style.transform.slice(11)) - viewport.scrollTop).toBeCloseTo(0);
    expect(row.style.height).toBe("15000px");
    expect(grid.skeleton.rowContainers.left.style.top).toBe(`${-viewport.scrollTop}px`);
    api.updateOptions({ getRowHeight: () => 32 });
    expect(grid.skeleton.rowContainers.center.style.height).toBe("64000px");
    expect(viewport.scrollTop).toBe(63680);
    for (const pane of ["left", "right"] as const) {
      expect(grid.skeleton.rowContainers[pane].style.top).toBe("");
      expect(grid.skeleton.rowContainers[pane].style.transform).toBe(`translate3d(0, ${-viewport.scrollTop}px, 0)`);
    }
    const wheel = new WheelEvent("wheel", { deltaY: -32, cancelable: true });
    viewport.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
  });
});
