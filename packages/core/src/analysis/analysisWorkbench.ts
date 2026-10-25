import type { ColDef, ColDefGroup } from "../types/colDef";
import { getByPath } from "../lib/path";
import { button, createWorkbench, element, focusControl, select, type WorkbenchHandle, type WorkbenchOptions } from "../workbench/shared";
import { createPivot, type PivotAggregate, type PivotOptions, type PivotResult, type PivotValue } from "./pivot";
import { evaluateFormulas } from "./formulas";
import { renderPivotChart } from "./chart";

export interface AnalysisOptions<TData extends object = Record<string, unknown>> extends WorkbenchOptions<TData> {
  pivot?: PivotOptions;
  formulas?: Readonly<Record<string, string>>;
}
interface AnalysisField { field: string; label: string; numeric: boolean }
interface DraftFormula { field: string; expression: string }
const AGGREGATE_LABELS: Record<PivotAggregate, string> = { sum: "求和", count: "记录数", avg: "平均值", min: "最小值", max: "最大值" };

/** Optional analysis UI. Loaded-row scope and truncation are always visible, never server-wide claims. */
export function mountAnalysis<TData extends object>(host: HTMLElement, options: AnalysisOptions<TData>): WorkbenchHandle {
  return new AnalysisWorkbench(host, options);
}

class AnalysisWorkbench<TData extends object> implements WorkbenchHandle {
  private panel: ReturnType<typeof createWorkbench>;
  private config: PivotOptions;
  private formulas: DraftFormula[];
  private fields: AnalysisField[] = [];
  private result: PivotResult | null = null;
  private results = element("div", "mach-analysis__results");
  private page = 0;
  private chart: "bar" | "line" = "bar";
  private chartColumn = "";
  private destroyed = false;
  private unsubscribes: Array<() => void>;

  constructor(host: HTMLElement, private options: AnalysisOptions<TData>) {
    if (options.api.isDestroyed()) throw new Error("Cannot mount analysis on a destroyed grid");
    this.config = { rowFields: [...(options.pivot?.rowFields ?? [])], columnFields: [...(options.pivot?.columnFields ?? [])],
      values: options.pivot?.values.map((value) => ({ ...value })) ?? [{ aggregate: "count" }] };
    this.formulas = Object.entries(options.formulas ?? {}).map(([field, expression]) => ({ field, expression }));
    this.panel = createWorkbench(host, "数据分析", () => { this.destroy(); options.onClose?.(); }, options.api);
    this.panel.footer.append(button("运行分析", () => this.run(), "mach-workbench__button--primary"));
    this.unsubscribes = [options.api.on("gridDestroyed", () => this.destroy()), options.api.on("modelUpdated", () => {
      if (!this.destroyed && this.result) this.panel.status.textContent = "表格数据已更新；重新运行分析以刷新结果。";
    })];
    this.refresh();
    this.run();
    this.panel.root.focus();
  }

  refresh(): void {
    if (!this.alive()) return;
    this.fields = this.collectFields();
    this.panel.syncTheme();
    this.panel.body.replaceChildren();
    this.renderConfiguration();
    this.panel.body.append(this.results);
    this.renderResult();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribes.splice(0).forEach((unsubscribe) => unsubscribe());
    this.panel.destroy();
  }

  private alive(): boolean { return !this.destroyed && !this.options.api.isDestroyed(); }

  private collectFields(): AnalysisField[] {
    const output: AnalysisField[] = [];
    const visit = (columns: readonly (ColDef<TData> | ColDefGroup<TData>)[]): void => {
      for (const column of columns) {
        if ("children" in column) { visit(column.children); continue; }
        if (!column.field) continue;
        const value: unknown = getByPath(this.options.api.rows.getAt(0)?.data, column.field);
        output.push({ field: column.field, label: column.headerName ?? column.field,
          numeric: typeof value === "number" || column.cellEditor === "number" || column.filter === "number" });
      }
    };
    visit(this.options.api.columns.getDefinitions() ?? []);
    for (const formula of this.formulas) {
      if (formula.field && !output.some((field) => field.field === formula.field)) output.push({ field: formula.field, label: `${formula.field}（公式）`, numeric: true });
    }
    return output;
  }

  private renderConfiguration(): void {
    const settings = element("div", "mach-analysis__settings");
    settings.append(this.dimensions("行维度", this.config.rowFields, (value) => { this.config.rowFields = value; }),
      this.dimensions("列维度", this.config.columnFields ?? [], (value) => { this.config.columnFields = value; }));
    const measures = element("fieldset", "mach-workbench__group");
    measures.append(element("legend", undefined, "聚合指标"));
    this.config.values.forEach((measure, index) => measures.append(this.measure(measure, index)));
    const add = button("添加指标", () => { this.config.values = [...this.config.values, { aggregate: "count" }]; this.refresh(); });
    add.disabled = this.config.values.length >= 16;
    measures.append(add);
    settings.append(measures, this.formulaEditor());
    this.panel.body.append(settings);
  }

  private dimensions(label: string, selected: readonly string[], change: (fields: string[]) => void): HTMLElement {
    const root = element("label", "mach-analysis__dimension", label);
    const control = element("select", "mach-workbench__input");
    control.multiple = true;
    control.setAttribute("aria-label", label);
    const fields = [...this.fields];
    for (const field of selected) if (!fields.some((entry) => entry.field === field)) fields.push({ field, label: `${field}（已移除）`, numeric: false });
    for (const field of fields) {
      const option = element("option", undefined, field.label);
      option.value = field.field;
      option.selected = selected.includes(field.field);
      control.append(option);
    }
    control.addEventListener("change", () => change([...control.selectedOptions].map((option) => option.value)));
    root.append(control, element("small", "mach-workbench__hint", "支持多选；不选择表示全部记录。"));
    return root;
  }

  private measure(value: PivotValue, index: number): HTMLElement {
    const root = element("div", "mach-workbench__values");
    const choices = [{ value: "", label: "全部记录" }, ...this.fields.map((field) => ({ value: field.field, label: field.label }))];
    if (value.field && !choices.some((entry) => entry.value === value.field)) choices.push({ value: value.field, label: `${value.field}（已移除）` });
    root.append(select("指标字段", choices, value.field ?? "", (field) => { value.field = field || undefined; }),
      select("聚合方式", Object.entries(AGGREGATE_LABELS).map(([aggregate, label]) => ({ value: aggregate, label })), value.aggregate,
        (aggregate) => { value.aggregate = aggregate as PivotAggregate; }),
      button("删除指标", () => { this.config.values = this.config.values.filter((_, offset) => offset !== index); this.refresh(); }));
    return root;
  }

  private formulaEditor(): HTMLElement {
    const root = element("fieldset", "mach-workbench__group");
    root.append(element("legend", undefined, "公式列"), element("p", "mach-workbench__hint", "使用 [字段]、+ - * / % ^、括号和 SUM / MIN / MAX / AVG。结果列使用单层 ID，不含 . 或 []；嵌套输入可引用 [tax.total]。只计算当前记录，不支持脚本或跨行引用。"));
    this.formulas.forEach((formula, index) => {
      const row = element("div", "mach-workbench__values");
      const field = element("input", "mach-workbench__input");
      field.setAttribute("aria-label", "公式结果列");
      field.placeholder = "如 total";
      field.value = formula.field;
      field.addEventListener("input", () => { formula.field = field.value.trim(); });
      const expression = element("input", "mach-workbench__input");
      expression.setAttribute("aria-label", "公式表达式");
      expression.placeholder = "如 [quantity] * [price]";
      expression.value = formula.expression;
      expression.addEventListener("input", () => { formula.expression = expression.value; });
      row.append(field, expression, button("删除公式", () => { this.formulas.splice(index, 1); this.refresh(); }));
      root.append(row);
    });
    const add = button("添加公式", () => { this.formulas.push({ field: "", expression: "" }); this.refresh(); });
    add.disabled = this.formulas.length >= 32;
    root.append(add);
    return root;
  }

  private run(): void {
    if (!this.alive()) return;
    const data: TData[] = [];
    let loaded = 0;
    this.options.api.rows.forEach((node) => {
      if (node.data == null || node.isGroup || node.isDetail) return;
      loaded++;
      if (data.length < 10_000) data.push(node.data);
    });
    try {
      const formulas = this.formulaMap();
      const calculated = evaluateFormulas(data, formulas);
      if (calculated.errors.length) {
        const descriptions = calculated.errors.slice(0, 20).map((issue) => `第 ${issue.rowIndex + 1} 行 / ${issue.colId}：${issue.code} ${issue.message}`);
        throw new Error(`公式错误 ${calculated.errors.length} 项${calculated.errors.length > 20 ? "（显示前 20 项）" : ""}：\n${descriptions.join("\n")}`);
      }
      this.assertFields(formulas);
      this.result = createPivot(calculated.rows, this.config);
      this.page = 0;
      this.refresh();
      const remote = this.options.api.rows.isRemote() ? "远程模式仅包含已加载行，不代表服务端全量。" : "";
      const limit = loaded > data.length ? `已加载 ${loaded} 行，本次仅分析前 ${data.length} 行。` : `分析已加载的 ${data.length} 行。`;
      this.panel.status.textContent = `${limit}${remote} 生成 ${this.result.rows.length} 个行组、${this.result.columns.length} 个结果列。`;
      this.panel.status.classList.remove("mach-workbench__status--error");
      this.panel.status.setAttribute("role", "status");
    } catch (error) {
      this.result = null;
      this.results.replaceChildren();
      this.panel.status.textContent = error instanceof Error ? error.message : String(error);
      this.panel.status.classList.add("mach-workbench__status--error");
      this.panel.status.setAttribute("role", "alert");
    }
  }

  private formulaMap(): Record<string, string> {
    const result: Record<string, string> = Object.create(null);
    for (const formula of this.formulas) {
      if (!formula.field || Object.prototype.hasOwnProperty.call(result, formula.field)) throw new Error("公式结果列不能为空或重复");
      result[formula.field] = formula.expression;
    }
    return result;
  }

  private assertFields(formulas: Record<string, string>): void {
    const fields = new Set([...this.collectFields().map((entry) => entry.field), ...Object.keys(formulas)]);
    const used = [...this.config.rowFields, ...(this.config.columnFields ?? []), ...this.config.values.flatMap((value) => value.field ? [value.field] : [])];
    for (const field of used) if (!fields.has(field)) throw new Error(`字段已移除或不可分析：${field}`);
  }

  private renderResult(): void {
    this.results.replaceChildren();
    if (!this.result) return;
    const result = this.result;
    if (!result.columns.some((column) => column.id === this.chartColumn)) this.chartColumn = result.columns[0]?.id ?? "";
    const chartTools = element("div", "mach-workbench__tools");
    chartTools.append(select("图表类型", [{ value: "bar", label: "柱状图" }, { value: "line", label: "折线图" }], this.chart,
      (value) => { this.chart = value as "bar" | "line"; this.renderResult(); focusControl(this.results, "图表类型"); }),
      select("图表指标", result.columns.map((column) => ({ value: column.id, label: column.label })), this.chartColumn,
        (value) => { this.chartColumn = value; this.renderResult(); focusControl(this.results, "图表指标"); }));
    this.results.append(chartTools, renderPivotChart(result, this.chartColumn, this.chart), this.table(result));
    const pages = Math.max(1, Math.ceil(result.rows.length / 50));
    const navigation = element("nav", "mach-workbench__tools");
    navigation.setAttribute("aria-label", "分析结果分页");
    const previous = button("上一页", () => { this.page--; this.renderResult(); focusControl(this.results.querySelector("nav")!, "上一页"); });
    const next = button("下一页", () => { this.page++; this.renderResult(); focusControl(this.results.querySelector("nav")!, "下一页"); });
    previous.disabled = this.page <= 0;
    next.disabled = this.page >= pages - 1;
    navigation.append(previous, element("span", undefined, `第 ${this.page + 1} / ${pages} 页 · 每页 50 组`), next);
    this.results.append(navigation);
  }

  private table(result: PivotResult): HTMLElement {
    const wrap = element("div", "mach-analysis__table-wrap");
    const table = element("table", "mach-analysis__table");
    table.append(element("caption", undefined, "透视结果数据表（完整结果可分页查看）"));
    const head = element("thead");
    const header = element("tr");
    for (const label of ["行维度", ...result.columns.map((column) => column.label)]) { const cell = element("th", undefined, label); cell.scope = "col"; header.append(cell); }
    head.append(header);
    const body = element("tbody");
    for (const row of result.rows.slice(this.page * 50, (this.page + 1) * 50)) {
      body.append(this.tableRow(row.dimensions.map((value) => value == null ? "空值" : String(value)).join(" / ") || "全部", result, row.values));
    }
    const foot = element("tfoot");
    foot.append(this.tableRow("合计", result, result.totals));
    table.append(head, body, foot);
    wrap.append(table);
    return wrap;
  }

  private tableRow(label: string, result: PivotResult, values: Record<string, number | null>): HTMLTableRowElement {
    const row = element("tr");
    const heading = element("th", undefined, label);
    heading.scope = "row";
    row.append(heading);
    for (const column of result.columns) {
      const value = values[column.id];
      const cell = element("td", undefined, value == null ? "—" : value.toLocaleString("zh-CN", { maximumFractionDigits: 6 }));
      cell.title = value == null ? "无数值" : String(value);
      row.append(cell);
    }
    return row;
  }
}
