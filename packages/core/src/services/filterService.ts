import type { ColumnFilter, FilterModel, TextFilterCondition, NumberFilterCondition, DateFilterCondition } from "../types/colDef";
import type { AdvancedFilterModel, AdvancedFilterNode } from "../types/advancedFilter";
import type { RowNode } from "../types/row";
import type { Column } from "./column";

function textOf(value: any): string {
  return value == null ? "" : String(value).toLowerCase();
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
  return conditions.length === 0 || (operator === "or" ? conditions.some(matches) : conditions.every(matches));
}

function compareNumberCondition(
  numericValue: number,
  filterValue: number,
  condition: NumberFilterCondition
): boolean {
  switch (condition.match) {
    case "equals": return numericValue === filterValue;
    case "notEquals": return numericValue !== filterValue;
    case "lessThan": return numericValue < filterValue;
    case "lessThanOrEqual": return numericValue <= filterValue;
    case "greaterThan": return numericValue > filterValue;
    case "greaterThanOrEqual": return numericValue >= filterValue;
    case "inRange": return numericValue >= filterValue && numericValue <= (condition.value2 ?? filterValue);
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
  return compareNumberCondition(numericValue, filterValue, condition);
}

export function evaluateNumberFilter(value: any, conditions: NumberFilterCondition[], operator: "and" | "or"): boolean {
  const matches = (condition: NumberFilterCondition) => evaluateNumberCondition(value, condition);
  return conditions.length === 0 || (operator === "or" ? conditions.some(matches) : conditions.every(matches));
}

function toTime(value: any): number | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === "number") return value;
  const t = Date.parse(String(value));
  return isNaN(t) ? null : t;
}

export function evaluateDateFilter(value: any, conditions: DateFilterCondition[], operator: "and" | "or"): boolean {
  const time = toTime(value);
  const matches = (c: DateFilterCondition): boolean => {
    const isBlank = time == null;
    if (c.match === "blank") return isBlank;
    if (c.match === "notBlank") return !isBlank;
    if (isBlank) return false;
    const t = time;
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
  };
  return conditions.length === 0 || (operator === "or" ? conditions.some(matches) : conditions.every(matches));
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

/** Resolves column identities once per pipeline, without caching application values. */
function compileAdvancedFilter(
  node: AdvancedFilterNode,
  columns: ReadonlyMap<string, Column>,
  read: CellValueReader
): RowFilter {
  if (node.kind === "condition") {
    const column = columns.get(node.colId);
    return column ? (row) => evaluateColumnFilter(read(row, column), node.filter) : () => true;
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
 * but keep getters live so external dictionaries/context never become stale.
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
    return column ? [{ column, filter }] : [];
  });
  const advanced = advancedFilterModel ? compileAdvancedFilter(advancedFilterModel.root, byId, read) : () => true;
  const tokens = quickFilter?.trim().toLowerCase().split(/\s+/).filter(Boolean) ?? [];
  return (node) => {
    if (!filters.every(({ column, filter }) => evaluateColumnFilter(read(node, column), filter))) return false;
    if (!advanced(node)) return false;
    return tokens.every((token) => columns.some((column) => textOf(read(node, column)).includes(token)));
  };
}
