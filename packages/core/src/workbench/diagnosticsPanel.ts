import type { GridOptions } from "../types/options";
import type { MachTableOptionExplanation } from "../lib/configuration";
import { button, createWorkbench, element, errorText, focusControl, select, type WorkbenchHandle, type WorkbenchOptions } from "./shared";
import { inspectGridRow, type GridExecutionMode, type GridRowInspection } from "./inspectGridRow";

export interface DiagnosticsOptions<TData = any> extends WorkbenchOptions<TData> {
  /** Supply the configuration resolver's explain function; absent sources are reported as unknown. */
  explain?: (key: keyof GridOptions<TData> | string) => MachTableOptionExplanation;
}
const OPTIONS = ["theme", "size", "columnLayout", "editType", "pagination", "rowSelection", "applyRowDrag", "rowStyleRules", "persistence", "maxBlocksInCache"] as const;

/** Manual snapshots only: no polling, mutation or automatic full-table rule evaluation. */
export function mountDiagnostics<TData>(host: HTMLElement, options: DiagnosticsOptions<TData>): WorkbenchHandle {
  let destroyed = false;
  let optionKey: string = "theme";
  let rowId = "";
  let inspection: GridRowInspection | null = null;
  let rules: HTMLElement | null = null;
  const panel = createWorkbench(host, "表格诊断", () => { if (destroyed) return; handle.destroy(); options.onClose?.(); }, options.api);
  const alive = () => !destroyed && !options.api.isDestroyed();
  const handle: WorkbenchHandle = {
    refresh(): void {
      if (!alive()) return;
      const focused = panel.body.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
      panel.syncTheme();
      panel.body.replaceChildren();
      const diagnostic = options.api.diagnostics.get();
      const overview = element("dl", "mach-diagnostics__overview");
      for (const [label, value] of Object.entries({ 版本: diagnostic.version, 总行数: diagnostic.rowCount, 已渲染行数: diagnostic.renderedRowCount,
        列数: diagnostic.columnCount, 已选行: diagnostic.selectedRowCount, 待保存行: diagnostic.dirtyRowCount, 数据模式: diagnostic.infinite ? "远程" : "本地" })) {
        overview.append(element("dt", undefined, label), element("dd", undefined, String(value)));
      }
      panel.body.append(overview, section("活动扩展", diagnostic.activeFeatures.length ? printable(diagnostic.activeFeatures) : "无活动扩展"),
        section("性能与调度快照", printable({ performance: diagnostic.performance, updates: diagnostic.updates })));
      renderOption();
      renderRules();
      const errors = element("section", "mach-diagnostics__section");
      errors.append(element("h3", undefined, `最近错误（${diagnostic.recentErrors.length}）`));
      for (const error of diagnostic.recentErrors) {
        errors.append(element("p", "mach-review__issue", `${error.code} · ${error.source} · ${error.message}`));
      }
      if (!diagnostic.recentErrors.length) errors.append(element("p", "mach-workbench__hint", "尚无已记录错误。"));
      panel.body.append(errors);
      panel.status.textContent = "公开诊断 API 手动快照；未提供来源时显示未知。";
      // Repair only focus lost by our body rebuild; host-owned external focus wins.
      if (focused && document.activeElement === document.body) {
        const label = focused.getAttribute("aria-label");
        const replacement = panel.body.contains(focused) ? focused : label
          ? [...panel.body.querySelectorAll<HTMLElement>("[aria-label]")].find(node => node.getAttribute("aria-label") === label) : null;
        (replacement ?? panel.root).focus();
      }
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
      panel.destroy();
      inspection = null;
      rules = null;
    }
  };

  function renderOption(): void {
    const root = element("section", "mach-diagnostics__section");
    root.append(element("h3", undefined, "配置来源"), select("配置项", OPTIONS.map((value) => ({ value, label: value })), optionKey, (value) => { optionKey = value; handle.refresh(); focusControl(panel.body, "配置项"); }));
    try {
      const explanation = options.explain?.(optionKey);
      const value: unknown = explanation ? explanation.value : options.api.getOption(optionKey as keyof GridOptions<TData>);
      root.append(element("p", undefined, `当前值：${printable(value)}`), element("p", undefined, `来源：${explanation?.source ?? "未知（未传入配置解析器的 explain）"}`));
      if (explanation) {
        const layers = element("ol");
        for (const layer of explanation.layers) layers.append(element("li", undefined, `${layer.name}: ${printable(layer.value)}`));
        root.append(layers);
      }
    } catch (error) { root.append(element("p", "mach-review__issue", errorText(error))); }
    panel.body.append(root);
  }

  function renderRules(): void {
    const root = element("section", "mach-diagnostics__section");
    root.append(element("h3", undefined, "记录行为与条件行样式解释"));
    const input = element("input", "mach-workbench__input");
    input.setAttribute("aria-label", "检查记录 ID");
    input.value = rowId;
    input.placeholder = "输入稳定行 ID";
    input.addEventListener("input", () => { rowId = input.value; });
    root.append(input, button("检查记录", () => {
      inspection = inspectGridRow(options.api, rowId);
      rules = explainRules(options, rowId);
      handle.refresh();
      panel.body.querySelector<HTMLElement>(".mach-diagnostics__rules")?.focus();
    }), element("p", "mach-workbench__hint", "仅检查此行 canDrag 和样式条件，可能产生业务副作用。异常隔离，不扫描全表或请求远程数据。结果为上次快照，规则按序首条命中。"));
    if (inspection) root.append(renderInspection(inspection));
    if (rules) root.append(rules);
    panel.body.append(root);
  }

  if (options.api.isDestroyed()) { panel.destroy(); throw new Error("Cannot mount diagnostics on a destroyed grid"); }
  const unsubscribe = options.api.on("gridDestroyed", () => handle.destroy());
  panel.footer.append(button("刷新诊断", () => handle.refresh()));
  handle.refresh();
  panel.root.focus();
  return handle;
}

const EXECUTION_LABELS: Record<GridExecutionMode, string> = {
  client: "客户端执行", host: "宿主手动处理", datasource: "datasource 远程处理", "client-or-processor": "客户端或 dataProcessor（实际分支未公开）"
};

function renderInspection(inspection: GridRowInspection): HTMLElement {
  const root = element("section", "mach-diagnostics__inspection");
  root.append(element("h4", undefined, `记录 ${inspection.rowId} 的检查快照`),
    element("p", undefined, `模型：${inspection.availability} · 显示：${inspection.visibility} · DOM：${inspection.rendered ? "已渲染" : "未渲染"}`),
    element("p", undefined, `拖拽：${inspection.drag.allowed === null ? "无法确认，可能未渲染手柄" : inspection.drag.allowed ? "当前手柄可用" : "不可用"} · 业务判定：${inspection.drag.policyEvaluated ? "已执行" : "未执行"}`));
  for (const diagnostic of [...inspection.drag.reasons, ...inspection.notes]) root.append(element("p", "mach-workbench__hint", `${diagnostic.code} · ${diagnostic.message}`));
  const modes = inspection.execution;
  if (modes) root.append(element("p", undefined, `排序：${EXECUTION_LABELS[modes.sorting]}（${modes.sortActive ? "有条件" : "无条件"}）；过滤：${EXECUTION_LABELS[modes.filtering]}（${modes.filterActive ? "有条件" : "无条件"}）。`));
  return root;
}

function section(title: string, content: string): HTMLElement {
  const root = element("section", "mach-diagnostics__section");
  root.append(element("h3", undefined, title), element("pre", undefined, content));
  return root;
}

function printable(value: unknown): string {
  if (typeof value === "function") return "[函数]";
  const seen = new WeakSet<object>();
  try {
    return (JSON.stringify(value, (_, entry: unknown) => {
      if (typeof entry === "function") return "[函数]";
      if (entry && typeof entry === "object") {
        if (seen.has(entry)) return "[重复或循环引用]";
        seen.add(entry);
      }
      return entry;
    }, 2) ?? "未设置").slice(0, 6000);
  } catch { return "[无法序列化]"; }
}

function explainRules<TData>(options: DiagnosticsOptions<TData>, rowId: string): HTMLElement {
  const root = element("ol", "mach-diagnostics__rules");
  root.tabIndex = -1;
  const node = options.api.rows.getById(rowId);
  if (node?.data == null || node.isGroup || node.isDetail || node.loading) { root.append(element("li", undefined, "记录不存在或不适用条件行样式。")); return root; }
  let matched = false;
  for (const [index, rule] of (options.api.getOption("rowStyleRules") ?? []).entries()) {
    let outcome = "未运行（前序规则已命中）";
    if (!matched) {
      try { matched = rule.when({ data: node.data, node, api: options.api, rowPinned: null }) === true; outcome = matched ? "命中" : "未命中"; }
      catch (error) { outcome = `条件函数异常：${errorText(error)}`; }
    }
    const details = [rule.tone, rule.backgroundColor, rule.color].filter(Boolean).join(" / ") || "未指定颜色";
    root.append(element("li", undefined, `规则 ${index + 1} · ${details} · ${outcome}`));
  }
  if (!root.children.length) root.append(element("li", undefined, "未配置条件行样式规则。"));
  return root;
}
