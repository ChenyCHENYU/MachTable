import type { AdvancedFilterModel, AdvancedFilterNode } from "../types/advancedFilter";
import type { ColumnFilter } from "../types/colDef";
import { normalizeAdvancedFilterModel } from "../lib/advancedFilter";
import type { ResolvedFilterField } from "./filterFields";

export { FILTER_MATCHES } from "../lib/filterMatches";

export const MATCH_LABELS: Record<string, string> = {
  contains: "包含", notContains: "不包含", equals: "等于", notEquals: "不等于", startsWith: "开头为", endsWith: "结尾为",
  blank: "为空", notBlank: "不为空", lessThan: "小于", lessThanOrEqual: "小于或等于", greaterThan: "大于", greaterThanOrEqual: "大于或等于", inRange: "介于"
};

function signature(value: unknown): string {
  return JSON.stringify(value, (key, entry: unknown) => {
    if (key === "not" && entry === false) return undefined;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    return Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left.localeCompare(right)));
  });
}

/** Reject lossy imports instead of silently dropping invalid/over-budget nodes. */
export function cloneFilterDraft(input: AdvancedFilterModel | null): AdvancedFilterModel | null {
  if (input === null) return null;
  const normalized = normalizeAdvancedFilterModel(input);
  if (!normalized || signature(input) !== signature(normalized)) {
    throw new TypeError("筛选表达式无效或超过限制，草稿未被替换");
  }
  return normalized;
}

export function defaultFilter(field?: ResolvedFilterField): ColumnFilter {
  const type = field?.type ?? "text";
  if (type === "set") return { type, values: [] };
  if (type === "text") return { type, conditions: [{ match: "contains", value: "" }] };
  return { type, conditions: [{ match: "equals" }] };
}

export function inspectFilterDraft(model: AdvancedFilterModel | null, fields: readonly ResolvedFilterField[]): string[] {
  if (!model) return [];
  const errors: string[] = [];
  const byId = new Map(fields.map((field) => [field.colId, field]));
  let count = 0;
  const visit = (node: AdvancedFilterNode, depth: number): void => {
    count++;
    if (depth > 16 || count > 512) { errors.push("最多支持 16 层、512 个条件节点"); return; }
    if (node.kind === "group") {
      if (!node.children.length) errors.push("条件组不能为空");
      for (const child of node.children) visit(child, depth + 1);
      return;
    }
    const field = byId.get(node.colId);
    if (!field) { errors.push(`字段已移除或不可筛选：${node.colId}`); return; }
    if (field.type !== node.filter.type) errors.push(`${field.label} 的字段类型已改变，请重置条件`);
    errors.push(...filterValueErrors(node.filter, field.label));
  };
  visit(model.root, 0);
  return [...new Set(errors)];
}

function filterValueErrors(filter: ColumnFilter, label: string): string[] {
  if (filter.type === "set") return [];
  if (!filter.conditions.length) return [`${label} 至少需要一个条件`];
  if (filter.conditions.length > 20) return [`${label} 最多支持 20 个条件`];
  return filter.conditions.flatMap((condition) => {
    if (condition.match === "blank" || condition.match === "notBlank") return [];
    const values = condition.match === "inRange"
      ? [condition.value, (condition as { value2?: string | number }).value2] : [condition.value];
    if (values.some((value) => !validValue(value, filter.type))) return [`请填写 ${label} 的有效筛选值`];
    if (values.length === 2 && values[0]! > values[1]!) return [`${label} 的区间起点不能大于终点`];
    return [];
  });
}

function validValue(value: unknown, type: string): boolean {
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (typeof value !== "string" || !value.trim()) return false;
  return type !== "date" || /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}

export function countFilterNodes(node: AdvancedFilterNode): number {
  return node.kind === "group" ? 1 + node.children.reduce((sum, child) => sum + countFilterNodes(child), 0) : 1;
}
