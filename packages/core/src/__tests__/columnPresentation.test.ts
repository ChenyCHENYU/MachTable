// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createGrid, createStatusTagRenderer } from "../index";
import type { GridApi } from "../index";

const grids: GridApi[] = [];
function grid(options: Parameters<typeof createGrid>[1]) {
  const host = document.createElement("div");
  document.body.append(host);
  const api = createGrid(host, { pagination: false, ...options });
  grids.push(api);
  return { api, host };
}
const width = (api: GridApi, id: string) => api.columns.getState().find(col => col.colId === id)!.width!;
afterEach(() => { grids.splice(0).forEach(api => api.destroy()); document.body.replaceChildren(); vi.restoreAllMocks(); });

it("defaults to bounded content widths, preserving declared, disabled and manually resized widths", () => {
  const { api } = grid({
    columnDefs: [
      { field: "short", headerName: "短" }, { field: "long" },
      { field: "declared", width: 480 }, { field: "disabled", autoWidth: false },
      { field: "bounded", minWidth: 110, maxWidth: 160 }
    ],
    rowData: [{ short: "A", long: "超长内容".repeat(10_000), bounded: "X".repeat(400) }]
  });
  expect(width(api, "short")).toBe(80);
  expect(width(api, "long")).toBe(360);
  expect(width(api, "declared")).toBe(480);
  expect(width(api, "disabled")).toBe(150);
  expect(width(api, "bounded")).toBe(160);
  api.columns.setWidth("short", 230);
  api.rows.setData([{ short: "新的内容".repeat(20), long: "X" }]);
  expect(width(api, "short")).toBe(230);
  expect(width(api, "long")).toBeLessThan(360);
  api.columns.resetState();
  expect(width(api, "short")).toBe(360);
});

it("measures formatted and status labels without mounting renderers and samples at most 100 loaded rows", () => {
  const measureText = vi.fn((text: string) => ({ width: text.length * 8 }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ measureText } as unknown as CanvasRenderingContext2D);
  const formatter = vi.fn(({ value }: { value: unknown }) => `显示：${value}`);
  const { api, host } = grid({
    columnDefs: [{ field: "code", status: { S1B: { label: "计划待复核", color: "danger" } }, valueFormatter: formatter }],
    rowData: Array.from({ length: 2000 }, (_, id) => ({ id, code: "S1B" }))
  });
  expect(width(api, "code")).toBe(84); // 标签 5 字 × 8 + 内边距 28 + 标签留白 16。
  expect(measureText.mock.calls.length).toBe(101);
  const calls = measureText.mock.calls.length;
  api.view.refreshLayout();
  expect(measureText).toHaveBeenCalledTimes(calls);
  expect(host.querySelector(".mach-tag--danger")?.textContent).toBe("计划待复核");
  expect(api.rows.getAt(0)?.data).toMatchObject({ code: "S1B" });
});

it("handles default, custom and unknown status colors, including zero, false and hostile keys", () => {
  const { host } = grid({
    columnDefs: [{ field: "state", status: { 0: { label: "正常", color: "success" }, false: { label: "人工复核", color: "#8b5cf6" } } }],
    rowData: [0, false, "已完成", "__proto__", "constructor", null].map((state, id) => ({ id, state }))
  });
  const tags = [...host.querySelectorAll<HTMLElement>(".mach-tag")];
  expect(tags.map(tag => tag.textContent)).toEqual(["正常", "人工复核", "已完成", "__proto__", "constructor"]);
  expect(tags[0].className).toContain("success");
  expect(tags[1].style.color).toBe("rgb(139, 92, 246)");
  expect(tags[3].className).toContain("neutral");
});

it("keeps custom renderers in control and keeps sizing local to each grid", () => {
  const first = grid({ columnDefs: [{ field: "value", status: true, cellRenderer: () => "自定义" }], rowData: [{ value: "已完成" }] });
  const second = grid({ columnDefs: [{ field: "value" }], rowData: [{ value: "很长".repeat(100) }] });
  expect(first.host.querySelector(".mach-tag")).toBeNull();
  expect(first.host.textContent).toContain("自定义");
  expect(width(first.api, "value")).toBeLessThan(width(second.api, "value"));
});

it("remeasures changed formatter definitions without replacing consumer data", () => {
  const { api } = grid({ columnDefs: [{ field: "name", headerName: "名称" }], rowData: [{ name: "A" }] });
  const before = width(api, "name");
  api.columns.setDefinitions([{ field: "name", headerName: "名称", valueFormatter: () => "很长的格式化客户名称" }]);
  expect(width(api, "name")).toBeGreaterThan(before);
});

it("retains explicitly neutral legacy status maps even when their label suggests success", () => {
  const { host } = grid({ columnDefs: [{ field: "state", cellRenderer: createStatusTagRenderer({ variantMap: { X: "neutral" }, labelMap: { X: "已完成" } }) }], rowData: [{ state: "X" }] });
  expect(host.querySelector(".mach-tag--neutral")?.textContent).toBe("已完成");
});
