// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGrid, type GridApi } from "../index";

type Row = { id: string; group: string; offset: string; name: string };
let api: GridApi<Row> | undefined;
afterEach(() => { api?.destroy(); api = undefined; document.body.textContent = ""; vi.restoreAllMocks(); });

function createSpanGrid() {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(192);
  const host = document.createElement("div");
  document.body.appendChild(host);
  api = createGrid<Row>(host, {
    rowKey: "id", pagination: false, rowHeight: 32, rowBuffer: 4,
    columnDefs: [
      { field: "group", pinned: "left", autoRowSpan: true, cellStyle: ({ data }) => data?.id === "r0" ? { zIndex: "7" } : undefined },
      { field: "offset", autoRowSpan: true },
      { field: "name" }
    ],
    rowData: Array.from({ length: 80 }, (_, index) => ({
      id: `r${index}`, group: `A${Math.floor(index / 4)}`,
      offset: index === 0 ? "single" : `B${Math.floor((index - 1) / 5)}`, name: `row ${index}`
    }))
  });
  return { host, api };
}

describe("merged row painting", () => {
  it("orders every logical row across panes and preserves a caller's cell z-index", async () => {
    const { host, api } = createSpanGrid();
    const checkOrder = () => {
      const rows = host.querySelectorAll<HTMLElement>(".mach-row[data-index]");
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row.style.zIndex).toBe(String(-Number(row.dataset.index)));
    };
    checkOrder();
    const anchor = host.querySelector<HTMLElement>('.mach-pane--left .mach-row[data-index="0"] [data-col-id="group"]')!;
    expect(anchor.getAttribute("aria-rowspan")).toBe("4");
    expect(anchor.style.zIndex).toBe("7");
    api.view.scrollToRow(40);
    await vi.waitFor(() => expect(host.querySelector('.mach-row[data-index="40"]')).not.toBeNull());
    checkOrder();
    expect(host.querySelectorAll('.mach-pane--left .mach-cell[style*="z-index"]').length).toBe(0);
    api.view.scrollToRow(0);
    await vi.waitFor(() => expect(host.querySelector('.mach-row[data-index="0"]')).not.toBeNull());
    checkOrder();
    expect(host.querySelector<HTMLElement>('.mach-pane--left .mach-row[data-index="0"] [data-col-id="group"]')?.style.zIndex).toBe("7");
  });
});
