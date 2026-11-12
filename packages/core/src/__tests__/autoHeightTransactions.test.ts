// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createGrid } from "../core/createGrid";
import type { GridApi } from "../types/api";

interface Row { id: string; name: string }
const mounted: GridApi<Row>[] = [];

afterEach(() => {
  for (const api of mounted.splice(0)) api.destroy();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function mount(width?: number) {
  const measured: string[] = [];
  const measuredWidths: number[] = [];
  const nativeRect = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const rect = nativeRect.call(this);
    if (this.style.height !== "auto") return rect;
    const text = this.textContent ?? "";
    measured.push(text);
    measuredWidths.push(parseFloat(this.style.width));
    return { ...rect, height: Math.max(20, Math.ceil(text.length * 7 / (parseFloat(this.style.width) || 160)) * 20) };
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const api = createGrid<Row>(host, {
    rowKey: "id", pagination: false, rowHeight: 30,
    columnDefs: [{ field: "name", width, autoHeight: true, wrapText: true, sortable: false, filter: false }],
    rowData: [{ id: "one", name: "short-a" }, { id: "two", name: "short-b" }]
  });
  mounted.push(api);
  const height = () => host.querySelector<HTMLElement>(".mach-row-container")!.style.height;
  return { api, host, measured, measuredWidths, height };
}

it("measures dynamic column/data replacements only after their final widths are computed", () => {
  const f = mount(160);
  f.measured.length = 0;
  f.measuredWidths.length = 0;
  f.api.updateOptions({
    columnDefs: [{ field: "name", width: 200, wrapText: true, autoHeight: true, sortable: false, filter: false }],
    rowData: [{ id: "new", name: "x".repeat(400) }]
  });
  expect(f.measuredWidths).toEqual([200]);
  expect(f.height()).toBe("280px");
});

it("updates fixed-width plain-field row heights for synchronous and batched transactions", async () => {
  const f = mount(160);
  expect(f.height()).toBe("60px");
  const otherMeasurements = () => f.measured.filter(text => text === "short-b").length;
  const before = otherMeasurements();
  f.api.rows.transact({ update: [{ id: "one", name: "long-" + "x".repeat(195) }] });
  expect(f.height()).toBe("210px");
  expect(f.host.querySelector<HTMLElement>(".mach-row[data-id='one']")!.style.height).toBe("180px");
  expect(otherMeasurements()).toBe(before);
  await f.api.rows.transactAsync({ update: [{ id: "one", name: "short-a" }] });
  expect(f.height()).toBe("60px");
  expect(otherMeasurements()).toBe(before);
});

it("uses the newly measured automatic column width before updating wrapped row heights", () => {
  const f = mount();
  expect(f.height()).toBe("60px");
  f.api.rows.transact({ update: [{ id: "one", name: "long-" + "x".repeat(195) }] });
  expect(f.api.columns.getState()[0].width).toBe(360);
  expect(f.height()).toBe("110px");
  expect(f.host.querySelector<HTMLElement>(".mach-row[data-id='one']")!.style.height).toBe("80px");
});
