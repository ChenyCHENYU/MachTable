// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createGrid } from "../index";
import { mountAnalysis, type AnalysisOptions } from "../analysis";

interface Row { id: string; region: string; year: number; amount: number }
const cleanups: Array<() => void> = [];

function setup(options: Partial<Omit<AnalysisOptions<Row>, "api">> = {}, count = 3) {
  const grid = document.createElement("div");
  Object.defineProperties(grid, { clientWidth: { value: 800 }, clientHeight: { value: 400 } });
  const trigger = document.createElement("button");
  const host = document.createElement("div");
  document.body.append(trigger, grid, host);
  const api = createGrid<Row>(grid, {
    columnDefs: [{ field: "region" }, { field: "year", cellEditor: "number" }, { field: "amount", cellEditor: "number" }],
    rowData: Array.from({ length: count }, (_, index) => ({ id: String(index), region: count > 3 ? `Region ${index}` : index < 2 ? "East" : "West", year: 2025 + index % 2, amount: index + 1 })),
    rowKey: (row) => row.id
  });
  trigger.focus();
  const analysis = mountAnalysis(host, { api, ...options });
  cleanups.push(() => { analysis.destroy(); api.destroy(); });
  return { api, host, analysis, trigger };
}

function click(host: HTMLElement, text: string): void {
  const target = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === text);
  if (!target) throw new Error(`Missing ${text}`);
  target.click();
}

function input(host: HTMLElement, label: string, value: string): void {
  const target = host.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`)!;
  target.value = value;
  target.dispatchEvent(new Event(target.tagName === "INPUT" ? "input" : "change", { bubbles: true }));
}

afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()); document.body.replaceChildren(); });

describe("optional analysis workbench", () => {
  it("renders pivot configuration, native chart and complete accessible table", () => {
    const { host } = setup({ pivot: { rowFields: ["region"], columnFields: ["year"], values: [{ field: "amount", aggregate: "sum" }] } });
    expect(host.querySelector('svg[role="img"]')).not.toBeNull();
    expect(host.querySelector("svg title")?.textContent).toContain("柱状图");
    expect(host.querySelector("table caption")?.textContent).toContain("透视结果数据表");
    expect(host.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(host.querySelector("tfoot")?.textContent).toContain("合计");
    expect(host.querySelector(".mach-workbench__status")?.textContent).toContain("分析已加载的 3 行");
    input(host, "图表类型", "line");
    expect(host.querySelector("svg title")?.textContent).toContain("折线图");
  });

  it("edits pivot dimensions and measures through the live UI", () => {
    const { host } = setup();
    const rows = host.querySelector<HTMLSelectElement>('[aria-label="行维度"]')!;
    [...rows.options].forEach((option) => { option.selected = option.value === "region"; });
    rows.dispatchEvent(new Event("change", { bubbles: true }));
    input(host, "指标字段", "amount");
    input(host, "聚合方式", "avg");
    click(host, "运行分析");
    expect(host.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(host.querySelector("table")?.textContent).toContain("avg");
    expect(host.querySelector("tfoot")?.textContent).toContain("2");
  });

  it("calculates formula columns and makes them available for pivoting", () => {
    const { host, api } = setup({ formulas: { doubled: "[amount] * 2" }, pivot: { rowFields: ["region"], values: [{ field: "doubled", aggregate: "sum" }] } });
    expect(host.querySelector("tfoot")?.textContent).toContain("12");
    expect(api.rows.getById("0")?.data).not.toHaveProperty("doubled");
    const field = host.querySelector<HTMLSelectElement>('[aria-label="指标字段"]')!;
    expect([...field.options].some((option) => option.value === "doubled")).toBe(true);
  });

  it("lets users author a new formula without mutating the underlying grid", () => {
    const { host, api } = setup();
    click(host, "添加公式");
    input(host, "公式结果列", "calculated");
    input(host, "公式表达式", "SUM([amount], 10)");
    click(host, "运行分析");
    input(host, "指标字段", "calculated");
    input(host, "聚合方式", "sum");
    click(host, "运行分析");
    expect(host.querySelector("tfoot")?.textContent).toContain("36");
    expect(api.rows.getById("0")?.data).not.toHaveProperty("calculated");
  });

  it("rejects nested output IDs and pivots a corrected flat result without touching nested input", () => {
    const { host, api } = setup();
    const tax = Object.freeze({ total: 7 });
    const source = Object.freeze({ id: "nested", region: "East", year: 2026, amount: 1, tax });
    api.rows.setData([source]);
    expect(host.querySelector("table")).not.toBeNull();
    click(host, "添加公式");
    input(host, "公式结果列", "tax.total");
    input(host, "公式表达式", "[tax.total] * 2");
    click(host, "运行分析");
    expect(host.querySelector("[role='alert']")?.textContent).toContain("single-level ID");
    expect(host.querySelector("table")).toBeNull();
    expect(source.tax).toBe(tax);
    expect(tax.total).toBe(7);
    input(host, "公式结果列", "税额");
    click(host, "运行分析");
    input(host, "指标字段", "税额");
    input(host, "聚合方式", "sum");
    click(host, "运行分析");
    expect(host.querySelector("tfoot")?.textContent).toContain("14");
    expect(host.querySelector("svg[role='img']")).not.toBeNull();
    expect(source).not.toHaveProperty("税额");
    expect(api.rows.getById("nested")?.data).toBe(source);
    expect(tax.total).toBe(7);
  });

  it("shows formula errors with row/column locations and removes misleading stale results", () => {
    const { host } = setup({ formulas: { broken: "1 / 0" } });
    expect(host.querySelector("[role='alert']")?.textContent).toContain("第 1 行 / broken：DIV_ZERO");
    expect(host.querySelector("table")).toBeNull();
    input(host, "公式表达式", "[amount] * 2");
    click(host, "运行分析");
    expect(host.querySelector("table")).not.toBeNull();
    expect(host.querySelector(".mach-workbench__status--error")).toBeNull();
  });

  it("paginates all groups while keeping SVG marks bounded", () => {
    const { host } = setup({ pivot: { rowFields: ["region"], values: [{ field: "amount", aggregate: "sum" }] } }, 120);
    expect(host.querySelectorAll("tbody tr")).toHaveLength(50);
    expect(host.querySelectorAll("svg rect")).toHaveLength(40);
    expect(host.querySelector("figcaption")?.textContent).toContain("前 40 组");
    click(host, "下一页");
    expect(host.querySelector('nav[aria-label="分析结果分页"]')?.textContent).toContain("第 2 / 3 页");
    click(host, "下一页");
    expect(host.querySelectorAll("tbody tr")).toHaveLength(20);
  });

  it("reports stale results and missing schema instead of silently pruning configuration", () => {
    const { host, api } = setup({ pivot: { rowFields: ["region"], values: [{ field: "amount", aggregate: "sum" }] } });
    api.rows.setData([{ id: "x", region: "Updated", amount: 9, year: 2026 }]);
    expect(host.querySelector(".mach-workbench__status")?.textContent).toContain("重新运行分析");
    api.columns.setDefinitions([{ field: "region" }]);
    click(host, "运行分析");
    expect(host.querySelector("[role='alert']")?.textContent).toContain("字段已移除或不可分析：amount");
    expect(host.querySelector("table")).toBeNull();
  });

  it("does not generate invalid SVG geometry for extreme numeric values", () => {
    const { host, api } = setup({ pivot: { rowFields: ["region"], values: [{ field: "amount", aggregate: "max" }] } });
    api.rows.setData([{ id: "a", region: "A", year: 1, amount: -1e308 }, { id: "b", region: "B", year: 1, amount: 1e308 }]);
    click(host, "运行分析");
    expect(host.querySelector("svg")?.outerHTML).not.toMatch(/NaN|Infinity/);
  });

  it("restores focus on Escape and cannot repaint after grid destruction", () => {
    const { host, api, analysis, trigger } = setup();
    host.querySelector<HTMLElement>(".mach-workbench")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.activeElement).toBe(trigger);
    expect(host.children).toHaveLength(0);
    api.destroy();
    analysis.refresh();
    analysis.destroy();
    expect(host.children).toHaveLength(0);
  });
});
