import type { AdvancedFilterModel, AdvancedFilterNode, AdvancedFilterGroup, AdvancedFilterCondition } from "../types/advancedFilter";
import type { ColumnFilter } from "../types/colDef";
import { normalizeAdvancedFilterModel } from "../lib/advancedFilter";
import { button, createWorkbench, element, select, type WorkbenchHandle, type WorkbenchOptions } from "./shared";
import { resolveFilterFields, type FilterField, type ResolvedFilterField } from "./filterFields";
import { cloneFilterDraft, countFilterNodes, defaultFilter, FILTER_MATCHES, inspectFilterDraft, MATCH_LABELS } from "./filterDraft";

export interface AdvancedFilterBuilderOptions<TData = any> extends WorkbenchOptions<TData> {
  /** Usually inferred from column definitions; provide only ambiguous/schema-specific fields. */
  fields?: readonly FilterField[];
}

export interface AdvancedFilterBuilder extends WorkbenchHandle {
  getDraft(): AdvancedFilterModel | null;
  setDraft(model: AdvancedFilterModel | null): void;
  apply(): boolean;
  cancel(): void;
}

type ValueFilter = Exclude<ColumnFilter, { type: "set" }>;
type ValueCondition = ValueFilter["conditions"][number];

/** Owns drafts only. Filtering, server requests and persistence remain in the existing GridApi. */
export function mountAdvancedFilterBuilder<TData>(
  host: HTMLElement, options: AdvancedFilterBuilderOptions<TData>
): AdvancedFilterBuilder {
  return new FilterBuilder(host, options);
}

class FilterBuilder<TData> implements AdvancedFilterBuilder {
  private draft: AdvancedFilterModel | null;
  private fields: ResolvedFilterField[] = [];
  private nodeCount = 0;
  private changed = false;
  private external = false;
  private destroyed = false;
  private controls = new Map<string, HTMLElement>();
  private unsubscribes: Array<() => void> = [];
  private panel: ReturnType<typeof createWorkbench>;
  private applyButton: HTMLButtonElement;

  constructor(host: HTMLElement, private options: AdvancedFilterBuilderOptions<TData>) {
    if (options.api.isDestroyed()) throw new Error("Cannot mount a workbench on a destroyed grid");
    this.draft = cloneFilterDraft(options.api.filtering.getAdvancedModel());
    this.panel = createWorkbench(host, "高级筛选", () => this.close(), options.api);
    this.applyButton = button("应用筛选", () => { this.apply(); }, "mach-workbench__button--primary");
    this.panel.footer.append(button("清空草稿", () => this.mutate(() => { this.draft = null; })),
      button("取消", () => this.close()), this.applyButton);
    this.unsubscribes = [
      options.api.on("gridDestroyed", () => this.destroy()),
      options.api.on("displayedColumnsChanged", () => this.refresh()),
      options.api.on("filterChanged", () => {
        if (this.changed) this.external = true;
        else this.draft = cloneFilterDraft(options.api.filtering.getAdvancedModel());
        this.refresh();
      })
    ];
    this.refresh();
    this.panel.root.focus();
  }

  getDraft(): AdvancedFilterModel | null {
    // UI drafts may contain intentionally incomplete values/groups; return a detached JSON snapshot.
    return this.draft == null ? null : JSON.parse(JSON.stringify(this.draft)) as AdvancedFilterModel;
  }

  setDraft(model: AdvancedFilterModel | null): void {
    if (!this.alive()) return;
    this.draft = cloneFilterDraft(model);
    this.changed = true;
    this.refresh();
  }

  apply(): boolean {
    if (!this.alive()) return false;
    this.fields = resolveFilterFields(this.options.api, this.options.fields);
    if (this.updateStatus().length) { this.panel.status.focus(); return false; }
    const model = this.draft == null ? null : normalizeAdvancedFilterModel(this.draft, new Set(this.fields.map((field) => field.colId)));
    this.changed = false;
    this.external = false;
    this.options.api.filtering.setAdvancedModel(model);
    this.draft = cloneFilterDraft(this.options.api.filtering.getAdvancedModel());
    this.refresh();
    this.panel.status.textContent = "筛选已应用";
    return true;
  }

  cancel(): void {
    if (!this.alive()) return;
    this.draft = cloneFilterDraft(this.options.api.filtering.getAdvancedModel());
    this.changed = false;
    this.external = false;
    this.refresh();
  }

  refresh(): void {
    if (!this.alive()) return;
    this.fields = resolveFilterFields(this.options.api, this.options.fields);
    this.panel.syncTheme();
    this.controls.clear();
    this.nodeCount = this.draft ? countFilterNodes(this.draft.root) : 0;
    this.panel.body.replaceChildren();
    if (this.draft) this.panel.body.append(this.renderNode(this.draft.root, "root", 0, () => { this.draft = null; }));
    else {
      const empty = element("div", "mach-workbench__empty", "尚无高级筛选；添加条件后应用。");
      empty.append(this.addButton("添加条件", () => { this.draft = { version: 1, root: this.condition() }; }),
        this.addButton("添加条件组", () => { this.draft = { version: 1, root: { kind: "group", operator: "and", children: [] } }; }));
      this.panel.body.append(empty);
    }
    this.panel.status.tabIndex = -1;
    this.updateStatus();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const unsubscribe of this.unsubscribes.splice(0)) unsubscribe();
    this.panel.destroy();
    this.controls.clear();
  }

  private close(): void {
    if (this.destroyed) return;
    this.destroy();
    this.options.onClose?.();
  }

  private alive(): boolean { return !this.destroyed && !this.options.api.isDestroyed(); }

  private updateStatus(): string[] {
    const errors = inspectFilterDraft(this.draft, this.fields);
    this.panel.status.textContent = errors.length ? errors.join("；")
      : this.external ? "筛选已外部更新；当前草稿已保留，取消可重载。" : "AND / OR 组合条件，NOT 排除整组。";
    this.panel.status.classList.toggle("mach-workbench__status--error", errors.length > 0);
    this.panel.status.setAttribute("role", errors.length ? "alert" : "status");
    this.applyButton.disabled = errors.length > 0;
    return errors;
  }

  private condition(): AdvancedFilterCondition {
    return { kind: "condition", colId: this.fields[0]?.colId ?? "", filter: defaultFilter(this.fields[0]) };
  }

  private mutate(change: () => void, focus?: string): void {
    if (!this.alive()) return;
    change();
    this.changed = true;
    this.refresh();
    (focus ? this.controls.get(focus) : this.panel.body.querySelector<HTMLElement>("button,select,input"))?.focus();
  }

  private remember<T extends HTMLElement>(control: T, key: string): T {
    this.controls.set(key, control);
    return control;
  }

  private addButton(label: string, change: () => void): HTMLButtonElement {
    const control = button(label, () => this.mutate(change));
    control.disabled = !this.fields.length || this.nodeCount >= 512;
    return control;
  }

  private renderNode(node: AdvancedFilterNode, path: string, depth: number, remove: () => void): HTMLElement {
    return node.kind === "group" ? this.renderGroup(node, path, depth, remove) : this.renderCondition(node, path, remove);
  }

  private renderGroup(group: AdvancedFilterGroup, path: string, depth: number, remove: () => void): HTMLElement {
    const root = element("fieldset", "mach-workbench__group");
    root.append(element("legend", undefined, `条件组 ${depth + 1}`));
    const tools = element("div", "mach-workbench__tools");
    tools.append(this.remember(select("条件组关系", [{ value: "and", label: "全部满足 AND" }, { value: "or", label: "任一满足 OR" }], group.operator,
      (value) => this.mutate(() => { group.operator = value as "and" | "or"; }, `${path}.operator`)), `${path}.operator`));
    const not = element("input");
    not.type = "checkbox";
    not.checked = group.not === true;
    not.addEventListener("change", () => { group.not = not.checked; this.changed = true; this.updateStatus(); });
    const label = element("label", "mach-workbench__check", "排除整组 NOT");
    label.prepend(not);
    tools.append(label, button("删除条件组", () => this.mutate(remove)));
    root.append(tools);
    group.children.forEach((child, index) => root.append(this.renderNode(child, `${path}.${index}`, depth + 1, () => { group.children.splice(index, 1); })));
    const addGroup = this.addButton("添加子组", () => { group.children.push({ kind: "group", operator: "and", children: [] }); });
    addGroup.disabled ||= depth >= 15;
    root.append(this.addButton("添加条件", () => { group.children.push(this.condition()); }), addGroup);
    return root;
  }

  private renderCondition(node: AdvancedFilterCondition, path: string, remove: () => void): HTMLElement {
    const root = element("div", "mach-workbench__condition");
    const field = this.fields.find((candidate) => candidate.colId === node.colId);
    const choices = this.fields.map((entry) => ({ value: entry.colId, label: entry.label }));
    if (!field) choices.unshift({ value: node.colId, label: `已移除字段：${node.colId}` });
    root.append(this.remember(select("筛选字段", choices, node.colId, (value) => this.mutate(() => {
      node.colId = value;
      node.filter = defaultFilter(this.fields.find((entry) => entry.colId === value));
    }, `${path}.field`)), `${path}.field`));
    root.append(button("删除条件", () => this.mutate(remove)));
    if (field && field.type !== node.filter.type) root.append(button("重置字段条件", () => this.mutate(() => { node.filter = defaultFilter(field); })));
    if (node.filter.type === "set") this.renderSet(root, node.filter, field);
    else this.renderValues(root, node.filter, path);
    return root;
  }

  private renderSet(root: HTMLElement, filter: Extract<ColumnFilter, { type: "set" }>, field?: ResolvedFilterField): void {
    const choices = [...(field?.options ?? [])];
    for (const value of filter.values) {
      if (!choices.some((choice) => Object.is(choice.value, value))) choices.push({ value, label: `${String(value ?? "空值")}（当前字典外）` });
    }
    const control = element("select", "mach-workbench__input mach-workbench__dictionary");
    control.multiple = true;
    control.setAttribute("aria-label", "字典选项（支持多选）");
    choices.forEach((choice, index) => {
      const option = element("option", undefined, choice.label);
      option.value = String(index);
      option.selected = filter.values.some((value) => Object.is(value, choice.value));
      control.append(option);
    });
    control.addEventListener("change", () => {
      filter.values = [...control.selectedOptions].map((option) => choices[Number(option.value)].value);
      this.changed = true;
      this.updateStatus();
    });
    root.append(control, element("small", "mach-workbench__hint", choices.length ? "可多选；未选择时不会匹配任何记录。" : "请在列定义或 fields.options 配置字典。"));
  }

  private renderValues(root: HTMLElement, filter: ValueFilter, path: string): void {
    if (filter.conditions.length > 1) root.append(select("字段条件关系", [{ value: "and", label: "并且 AND" }, { value: "or", label: "或者 OR" }], filter.operator ?? "and", (value) => {
      filter.operator = value as "and" | "or";
      this.changed = true;
    }));
    filter.conditions.forEach((condition, index) => {
      const row = element("div", "mach-workbench__values");
      row.append(this.remember(select("匹配方式", FILTER_MATCHES[filter.type].map((value) => ({ value, label: MATCH_LABELS[value] })), condition.match,
        (value) => this.mutate(() => { condition.match = value as ValueCondition["match"]; }, `${path}.${index}.match`)), `${path}.${index}.match`));
      this.renderInputs(row, condition, filter.type);
      if (filter.conditions.length > 1) row.append(button("删除字段条件", () => this.mutate(() => { filter.conditions.splice(index, 1); })));
      root.append(row);
    });
    const add = button("添加字段条件", () => this.mutate(() => {
      (filter.conditions as ValueCondition[]).push({ match: filter.type === "text" ? "contains" : "equals" });
    }));
    add.disabled = filter.conditions.length >= 20;
    root.append(add);
  }

  private renderInputs(row: HTMLElement, condition: ValueCondition, type: ValueFilter["type"]): void {
    if (condition.match === "blank" || condition.match === "notBlank") return;
    const values = condition as { value?: string | number; value2?: string | number };
    const keys = condition.match === "inRange" ? ["value", "value2"] as const : ["value"] as const;
    for (const key of keys) {
      const input = element("input", "mach-workbench__input");
      input.type = type === "text" ? "text" : type;
      if (type === "number") input.step = "any";
      input.setAttribute("aria-label", key === "value2" ? "区间终点" : "筛选值");
      input.value = values[key] == null ? "" : String(values[key]);
      input.addEventListener("input", () => {
        if (!input.value) delete values[key];
        else values[key] = type === "number" ? input.valueAsNumber : input.value;
        this.changed = true;
        this.updateStatus();
      });
      row.append(input);
    }
  }
}
