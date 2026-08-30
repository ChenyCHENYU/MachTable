import type { ColumnFilter, FilterModel, TextFilterCondition, NumberFilterCondition, DateFilterCondition } from "../types/colDef";
import type { AdvancedFilterModel, AdvancedFilterNode } from "../types/advancedFilter";
import type { RowNode } from "../types/row";
import type { Column } from "./column";

function textOf(value: any): string {
  return value == null ? "" : String(value).toLowerCase();
}

export function evaluateTextFilter(value: any, conditions: TextFilterCondition[], operator: "and" | "or"): boolean {
  const v = textOf(value);
  const results = conditions.map((c) => {
    const fv = (c.value ?? "").toLowerCase();
    switch (c.match) {
      case "contains":
        return v.includes(fv);
      case "notContains":
        return !v.includes(fv);
      case "equals":
        return v === fv;
      case "notEquals":
        return v !== fv;
      case "startsWith":
        return v.startsWith(fv);
      case "endsWith":
        return v.endsWith(fv);
      case "blank":
        return v === "";
      case "notBlank":
        return v !== "";
      default:
        return true;
    }
  });
  if (results.length === 0) return true;
  return operator === "or" ? results.some(Boolean) : results.every(Boolean);
}

export function evaluateNumberFilter(value: any, conditions: NumberFilterCondition[], operator: "and" | "or"): boolean {
  const results = conditions.map((c) => {
    const isBlank = value == null || value === "";
    if (c.match === "blank") return isBlank;
    if (c.match === "notBlank") return !isBlank;
    if (isBlank) return false;
    const n = typeof value === "number" ? value : Number(value);
    if (isNaN(n)) return false;
    const f = c.value;
    if (f == null || isNaN(f)) return false;
    switch (c.match) {
      case "equals":
        return n === f;
      case "notEquals":
        return n !== f;
      case "lessThan":
        return n < f;
      case "lessThanOrEqual":
        return n <= f;
      case "greaterThan":
        return n > f;
      case "greaterThanOrEqual":
        return n >= f;
      case "inRange":
        return n >= f && n <= (c.value2 ?? f);
      default:
        return true;
    }
  });
  if (results.length === 0) return true;
  return operator === "or" ? results.some(Boolean) : results.every(Boolean);
}

function toTime(value: any): number | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === "number") return value;
  const t = Date.parse(String(value));
  return isNaN(t) ? null : t;
}

export function evaluateDateFilter(value: any, conditions: DateFilterCondition[], operator: "and" | "or"): boolean {
  const results = conditions.map((c) => {
    const isBlank = toTime(value) == null;
    if (c.match === "blank") return isBlank;
    if (c.match === "notBlank") return !isBlank;
    if (isBlank) return false;
    const t = toTime(value)!;
    const f = c.value != null ? toTime(c.value) : null;
    if (f == null) return false;
    switch (c.match) {
      case "equals":
        return t === f;
      case "notEquals":
        return t !== f;
      case "lessThan":
        return t < f;
      case "greaterThan":
        return t > f;
      case "inRange": {
        const f2 = c.value2 != null ? toTime(c.value2) : null;
        return f2 != null ? t >= f && t <= f2 : t >= f;
      }
      default:
        return true;
    }
  });
  if (results.length === 0) return true;
  return operator === "or" ? results.some(Boolean) : results.every(Boolean);
}

export function evaluateSetFilter(value: any, filterValues: (string | number | null)[]): boolean {
  if (filterValues.length === 0) return true;
  return filterValues.some((v) => (v == null && value == null) || v === value);
}

export function evaluateColumnFilter(value: any, filter: ColumnFilter): boolean {
  const operator = filter.type !== "set" && filter.operator === "or" ? "or" : "and";
  switch (filter.type) {
    case "text":
      return evaluateTextFilter(value, filter.conditions, operator);
    case "number":
      return evaluateNumberFilter(value, filter.conditions, operator);
    case "date":
      return evaluateDateFilter(value, filter.conditions, operator);
    case "set":
      return evaluateSetFilter(value, filter.values);
    default:
      return true;
  }
}

function evaluateAdvancedNode(
  node: AdvancedFilterNode,
  columns: ReadonlyMap<string, Column>,
  row: RowNode<any>,
  getCellValue: (row: RowNode<any>, column: Column) => any
): boolean {
  if (node.kind === "condition") {
    const column = columns.get(node.colId);
    return !column || evaluateColumnFilter(getCellValue(row, column), node.filter);
  }
  const passed = node.operator === "or"
    ? node.children.some((child) => evaluateAdvancedNode(child, columns, row, getCellValue))
    : node.children.every((child) => evaluateAdvancedNode(child, columns, row, getCellValue));
  return node.not ? !passed : passed;
}

export function evaluateAdvancedFilter(
  row: RowNode<any>,
  columns: Column[],
  model: AdvancedFilterModel | null,
  getCellValue: (row: RowNode<any>, column: Column) => any
): boolean {
  if (!model) return true;
  return evaluateAdvancedNode(model.root, new Map(columns.map((column) => [column.id, column])), row, getCellValue);
}

export function doesNodePassFilters(
  node: RowNode<any>,
  columns: Column[],
  filterModel: FilterModel,
  advancedFilterModel: AdvancedFilterModel | null,
  quickFilter: string | null,
  getCellValue: (node: RowNode<any>, column: Column) => any
): boolean {
  for (const colId of Object.keys(filterModel)) {
    const filter = filterModel[colId];
    const column = columns.find((c) => c.id === colId);
    if (!column) continue;
    const value = getCellValue(node, column);
    if (!evaluateColumnFilter(value, filter)) return false;
  }

  if (!evaluateAdvancedFilter(node, columns, advancedFilterModel, getCellValue)) return false;

  if (quickFilter && quickFilter.trim() !== "") {
    const tokens = quickFilter.trim().toLowerCase().split(/\s+/);
    for (const token of tokens) {
      const hit = columns.some((column) => textOf(getCellValue(node, column)).includes(token));
      if (!hit) return false;
    }
  }

  return true;
}
