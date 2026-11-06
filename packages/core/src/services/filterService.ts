import type { ColumnFilter, FilterModel, TextFilterCondition, NumberFilterCondition, DateFilterCondition } from "../types/colDef";
import type { AdvancedFilterModel, AdvancedFilterNode } from "../types/advancedFilter";
import type { RowNode } from "../types/row";
import type { Column } from "./column";

function textOf(value: any): string {
  return value == null ? "" : String(value).toLowerCase();
}

function matchConditions<T>(conditions: T[], operator: "and" | "or", match: (condition: T) => boolean): boolean {
  return conditions.length === 0 || (operator === "or" ? conditions.some(match) : conditions.every(match));
}

export function evaluateTextFilter(value: any, conditions: TextFilterCondition[], operator: "and" | "or"): boolean {
  const v = textOf(value);
  const matches = (c: TextFilterCondition): boolean => {
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
  };
  return matchConditions(conditions, operator, matches);
}

function compareOrderedCondition(
  numericValue: number,
  filterValue: number,
  match: NumberFilterCondition["match"] | DateFilterCondition["match"],
  upper: number
): boolean {
  switch (match) {
    case "equals": return numericValue === filterValue;
    case "notEquals": return numericValue !== filterValue;
    case "lessThan": return numericValue < filterValue;
    case "lessThanOrEqual": return numericValue <= filterValue;
    case "greaterThan": return numericValue > filterValue;
    case "greaterThanOrEqual": return numericValue >= filterValue;
    case "inRange": return numericValue >= filterValue && numericValue <= upper;
    default: return true;
  }
}

function evaluateNumberCondition(value: any, condition: NumberFilterCondition): boolean {
  const blank = value == null || value === "";
  if (condition.match === "blank") return blank;
  if (condition.match === "notBlank") return !blank;
  if (blank) return false;
  const numericValue = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(numericValue)) return false;
  const filterValue = condition.value;
  if (filterValue == null || Number.isNaN(filterValue)) return false;
  return compareOrderedCondition(numericValue, filterValue, condition.match, condition.value2 ?? filterValue);
}

export function evaluateNumberFilter(value: any, conditions: NumberFilterCondition[], operator: "and" | "or"): boolean {
  const matches = (condition: NumberFilterCondition) => evaluateNumberCondition(value, condition);
  return matchConditions(conditions, operator, matches);
}

function toTime(value: any): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return value;
  const t = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return isNaN(t) ? null : t;
}

export function evaluateDateFilter(value: any, conditions: DateFilterCondition[], operator: "and" | "or"): boolean {
  const time = toTime(value);
  const matches = (c: DateFilterCondition): boolean => {
    const isBlank = time == null;
    if (c.match === "blank") return isBlank;
    if (c.match === "notBlank") return !isBlank;
    if (isBlank) return false;
    const f = toTime(c.value);
    if (f == null) return false;
    const upper = c.match === "inRange" ? toTime(c.value2) ?? Infinity : f;
    return compareOrderedCondition(time, f, c.match, upper);
  };
  return matchConditions(conditions, operator, matches);
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

type RowFilter = (node: RowNode<any>) => boolean;
type CellValueReader = (node: RowNode<any>, column: Column) => any;

function compileColumnFilter(column: Column, filter: ColumnFilter, read: CellValueReader): RowFilter {
  return (node) => evaluateColumnFilter(read(node, column), filter);
}

/** Resolves column identities once per pipeline, without caching application values. */
function compileAdvancedFilter(
  node: AdvancedFilterNode,
  columns: ReadonlyMap<string, Column>,
  read: CellValueReader
): RowFilter {
  if (node.kind === "condition") {
    const column = columns.get(node.colId);
    return column ? compileColumnFilter(column, node.filter, read) : () => true;
  }
  const children = node.children.map((child) => compileAdvancedFilter(child, columns, read));
  return (row) => {
    const passed = node.operator === "or"
      ? children.some((test) => test(row))
      : children.every((test) => test(row));
    return node.not ? !passed : passed;
  };
}

/**
 * A filter plan belongs to one refresh. Compile metadata and search tokens once,
 * but keep getters live so external context never become stale.
 */
export function createRowFilter(
  columns: readonly Column[],
  filterModel: FilterModel,
  advancedFilterModel: AdvancedFilterModel | null,
  quickFilter: string | null,
  read: CellValueReader
): RowFilter {
  const byId = new Map(columns.map((column) => [column.id, column]));
  const filters = Object.entries(filterModel).flatMap(([id, filter]) => {
    const column = byId.get(id);
    return column ? [compileColumnFilter(column, filter, read)] : [];
  });
  if (advancedFilterModel) filters.push(compileAdvancedFilter(advancedFilterModel.root, byId, read));
  const tokens = quickFilter?.trim().toLowerCase().split(/\s+/).filter(Boolean) ?? [];
  return (node) => filters.every((filter) => filter(node)) &&
    tokens.every((token) => columns.some((column) => textOf(read(node, column)).includes(token)));
}
