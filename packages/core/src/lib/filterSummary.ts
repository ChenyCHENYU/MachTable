import type { ColumnFilter } from "../types/colDef";

const MATCH_LABELS: Record<string, string> = {
  contains: "包含",
  notContains: "不包含",
  equals: "=",
  notEquals: "≠",
  startsWith: "开头",
  endsWith: "结尾",
  blank: "为空",
  notBlank: "非空",
  lessThan: "<",
  lessThanOrEqual: "≤",
  greaterThan: ">",
  greaterThanOrEqual: "≥",
  inRange: "范围"
};

export function describeFilter(filter: ColumnFilter): string {
  if (!filter) return "";
  if (filter.type === "set") {
    const count = filter.values.length;
    return `已选 ${count} 项`;
  }
  const parts: string[] = [];
  for (const condition of filter.conditions) {
    const label = MATCH_LABELS[condition.match] ?? condition.match;
    const value = condition.value;
    const value2 = "value2" in condition ? condition.value2 : undefined;
    if (condition.match === "blank" || condition.match === "notBlank") {
      parts.push(label);
    } else if (condition.match === "inRange" && value != null) {
      parts.push(`${label} ${value}~${value2 ?? value}`);
    } else if (value != null && String(value) !== "") {
      parts.push(`${label} ${value}`);
    } else {
      parts.push(label);
    }
  }
  const operator = filter.operator === "or" ? " 或 " : " 且 ";
  return parts.join(operator);
}
