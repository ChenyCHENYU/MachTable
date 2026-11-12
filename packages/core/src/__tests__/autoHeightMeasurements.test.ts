// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createGrid } from "../core/createGrid";
import type { ValueGetterParams } from "../types/params";

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

it("keeps plain-field auto-height updates local and caches exact text measurements", () => {
  const nativeRect = HTMLElement.prototype.getBoundingClientRect;
  let temporaryCells = 0;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const rect = nativeRect.call(this);
    if (this.style.height !== "auto") return rect;
    temporaryCells = Math.max(temporaryCells, document.querySelectorAll(".mach-cell[aria-hidden='true']").length);
    return { ...rect, height: this.textContent?.startsWith("long") ? 80 : 20 };
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const rows = Array.from({ length: 256 }, (_, index) => ({ id: String(index), name: `long text ${index}`, note: index % 2 ? "short" : "" }));
  const getRowHeight = vi.fn(() => 90);
  const api = createGrid(host, {
    rowKey: "id", pagination: false, getRowHeight,
    columnDefs: [
      { field: "name", width: 120, autoHeight: true, wrapText: true },
      { field: "note", width: 120, autoHeight: true, wrapText: true }
    ],
    rowData: rows
  });
  expect(host.querySelector<HTMLElement>(".mach-row-container")!.style.height).toBe(`${256 * 90}px`);
  expect(getRowHeight).toHaveBeenCalledTimes(256);
  expect(temporaryCells).toBe(1);
  expect(host.querySelectorAll(".mach-cell[aria-hidden='true']")).toHaveLength(1);
  api.view.refreshLayout();
  expect(getRowHeight).toHaveBeenCalledTimes(256);
  api.rows.transact({ update: [{ ...rows[0], name: "updated" }] });
  expect(getRowHeight).toHaveBeenCalledTimes(257);
  api.view.refreshLayout();
  expect(getRowHeight).toHaveBeenCalledTimes(257);
  api.rows.setData([rows[0]]);
  expect(host.querySelector<HTMLElement>(".mach-row-container")!.style.height).toBe("90px");
  api.destroy();
  expect(host.querySelectorAll(".mach-cell[aria-hidden='true']")).toHaveLength(0);
});

it.each(["getter", "formatter"])("invalidates contextual auto-height %s results when another row changes", (kind) => {
  const nativeRect = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const rect = nativeRect.call(this);
    return this.style.height === "auto"
      ? { ...rect, height: this.textContent?.startsWith("long") ? 80 : 20 }
      : rect;
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const contextualText = (params: ValueGetterParams<{ id: string; name: string }>) => params.api.rows.getById("source")?.data?.name ?? "";
  const api = createGrid(host, {
    rowKey: "id", pagination: false, rowHeight: 32,
    columnDefs: [{
      field: "name", width: 160, autoHeight: true, wrapText: true,
      ...(kind === "getter"
        ? { valueGetter: contextualText }
        : { valueFormatter: contextualText })
    }],
    rowData: [{ id: "source", name: "short" }, { id: "dependent", name: "short" }]
  });
  const container = host.querySelector<HTMLElement>(".mach-row-container")!;
  expect(container.style.height).toBe("64px");
  api.rows.transact({ update: [{ id: "source", name: "long contextual value" }] });
  expect(container.style.height).toBe("160px");
  api.destroy();
});
