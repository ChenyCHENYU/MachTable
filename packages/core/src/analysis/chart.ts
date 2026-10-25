import { element } from "../workbench/shared";
import type { PivotResult } from "./pivot";

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number>, text?: string): SVGElementTagNameMap[K] {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  if (text != null) node.textContent = text;
  return node;
}

/** Native SVG is bounded to 40 groups; the paginated data table remains authoritative. */
export function renderPivotChart(result: PivotResult, columnId: string, kind: "bar" | "line"): HTMLElement {
  const figure = element("figure", "mach-analysis__chart");
  const column = result.columns.find((entry) => entry.id === columnId);
  if (!column) { figure.append(element("p", undefined, "尚无可绘制的指标")); return figure; }
  const rows = result.rows.slice(0, 40);
  const label = `${column.label} · ${kind === "bar" ? "柱状图" : "折线图"}，${rows.length} 组`;
  const chart = svg("svg", { viewBox: "0 0 680 260", role: "img", "aria-label": label });
  chart.append(svg("title", {}, label));
  const numbers = rows.map((row) => row.values[columnId]).filter((value): value is number => value != null && Number.isFinite(value));
  const minimum = Math.min(0, ...numbers);
  const maximum = Math.max(0, ...numbers);
  const scale = Math.max(Math.abs(maximum), Math.abs(minimum)) || 1;
  const span = maximum / scale - minimum / scale || 1;
  const y = (value: number) => 210 - (value / scale - minimum / scale) / span * 180;
  const zero = y(0);
  chart.append(svg("line", { x1: 50, x2: 660, y1: zero, y2: zero, stroke: "currentColor", opacity: ".4" }));
  chart.append(svg("text", { x: 2, y: 25, "font-size": 11 }, String(maximum)), svg("text", { x: 2, y: 212, "font-size": 11 }, String(minimum)));
  const width = 600 / Math.max(rows.length, 1);
  let segment: string[] = [];
  const flush = () => {
    if (segment.length) chart.append(svg("polyline", { points: segment.join(" "), fill: "none", stroke: "currentColor", "stroke-width": 2 }));
    segment = [];
  };
  rows.forEach((row, index) => {
    const value = row.values[columnId];
    if (value == null) { flush(); return; }
    const x = 55 + width * (index + .5);
    const pointY = y(value);
    const name = row.dimensions.map((dimension) => dimension == null ? "空值" : String(dimension)).join(" / ") || "全部";
    const mark = kind === "bar"
      ? svg("rect", { x: x - width * .35, y: Math.min(zero, pointY), width: Math.max(1, width * .7), height: Math.max(1, Math.abs(pointY - zero)), fill: "currentColor", rx: 2 })
      : svg("circle", { cx: x, cy: pointY, r: 3, fill: "currentColor" });
    mark.append(svg("title", {}, `${name}: ${value}`));
    chart.append(mark);
    if (kind === "line") segment.push(`${x},${pointY}`);
    if (rows.length <= 10 || index % Math.ceil(rows.length / 10) === 0) {
      chart.append(svg("text", { x, y: 238, "text-anchor": "middle", "font-size": 10 }, name.slice(0, 12)));
    }
  });
  flush();
  figure.append(chart, element("figcaption", "mach-workbench__hint", `${label}。${result.rows.length > 40 ? "图表仅展示前 40 组，" : ""}完整数值见下方数据表。`));
  return figure;
}
