import type { ColumnFilter } from "../types/colDef";
import type {
  AdvancedFilterCondition,
  AdvancedFilterGroup,
  AdvancedFilterModel,
  AdvancedFilterNode
} from "../types/advancedFilter";

const MAX_DEPTH = 16;
const MAX_NODES = 512;
const MAX_CONDITIONS = 20;
const MAX_SET_VALUES = 2_000;
const MAX_FILTER_COLUMNS = 2_000;

const TEXT_MATCHES = new Set([
  "contains", "notContains", "equals", "notEquals", "startsWith", "endsWith", "blank", "notBlank"
]);
const NUMBER_MATCHES = new Set([
  "equals", "notEquals", "lessThan", "lessThanOrEqual", "greaterThan", "greaterThanOrEqual", "inRange", "blank", "notBlank"
]);
const DATE_MATCHES = new Set(["equals", "notEquals", "lessThan", "greaterThan", "inRange", "blank", "notBlank"]);

function primitive(value: unknown): value is string | number | null {
  return value == null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

function matchesFor(type: "text" | "number" | "date"): ReadonlySet<string> {
  if (type === "text") return TEXT_MATCHES;
  return type === "number" ? NUMBER_MATCHES : DATE_MATCHES;
}

function normalizedCondition(
  entry: unknown,
  type: "text" | "number" | "date",
  matches: ReadonlySet<string>
): Record<string, unknown> | null {
  if (entry == null || typeof entry !== "object") return null;
  const condition = entry as Record<string, unknown>;
  if (typeof condition.match !== "string" || !matches.has(condition.match)) return null;
  return { match: condition.match, ...conditionValues(condition, type) };
}

function conditionValues(
  condition: Record<string, unknown>,
  type: "text" | "number" | "date"
): Record<string, unknown> {
  const value = type === "number"
    ? finiteNumber(condition.value)
    : typeof condition.value === "string" ? condition.value : undefined;
  const value2 = type === "number"
    ? finiteNumber(condition.value2)
    : typeof condition.value2 === "string" ? condition.value2 : undefined;
  return { ...(value !== undefined ? { value } : {}), ...(value2 !== undefined ? { value2 } : {}) };
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizedConditions(
  input: unknown[],
  type: "text" | "number" | "date"
): Array<Record<string, unknown>> {
  const output: Array<Record<string, unknown>> = [];
  const matches = matchesFor(type);
  for (const entry of input.slice(0, MAX_CONDITIONS)) {
    const condition = normalizedCondition(entry, type, matches);
    if (condition) output.push(condition);
  }
  return output;
}

export function normalizeColumnFilter(input: unknown): ColumnFilter | null {
  if (input == null || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;
  if (source.type === "set") {
    if (!Array.isArray(source.values)) return null;
    return { type: "set", values: source.values.filter(primitive).slice(0, MAX_SET_VALUES) };
  }
  if (source.type !== "text" && source.type !== "number" && source.type !== "date") return null;
  if (!Array.isArray(source.conditions)) return null;
  return {
    type: source.type,
    ...(source.operator === "or" || source.operator === "and" ? { operator: source.operator } : {}),
    conditions: normalizedConditions(source.conditions, source.type)
  } as unknown as ColumnFilter;
}

interface AdvancedNormalizationContext {
  ancestors: WeakSet<object>;
  nodes: number;
  validColumnIds?: ReadonlySet<string>;
}

function normalizeConditionNode(
  node: Record<string, unknown>,
  context: AdvancedNormalizationContext
): AdvancedFilterCondition | null {
  if (typeof node.colId !== "string" || !node.colId.trim()) return null;
  const colId = node.colId.trim();
  if (context.validColumnIds?.has(colId) === false) return null;
  const filter = normalizeColumnFilter(node.filter);
  return filter ? { kind: "condition", colId, filter } : null;
}

function normalizeGroupNode(
  node: Record<string, unknown>,
  depth: number,
  context: AdvancedNormalizationContext
): AdvancedFilterGroup | null {
  if (!Array.isArray(node.children)) return null;
  const children: AdvancedFilterNode[] = [];
  for (const child of node.children) {
    const normalized = normalizeAdvancedNode(child, depth + 1, context);
    if (normalized) children.push(normalized);
  }
  if (children.length === 0) return null;
  return {
    kind: "group",
    operator: node.operator === "or" ? "or" : "and",
    children,
    ...(node.not === true ? { not: true } : {})
  };
}

function canNormalizeNode(value: unknown, depth: number, context: AdvancedNormalizationContext): value is object {
  return depth <= MAX_DEPTH && context.nodes < MAX_NODES && value != null && typeof value === "object";
}

function normalizeAdvancedNode(
  value: unknown,
  depth: number,
  context: AdvancedNormalizationContext
): AdvancedFilterNode | null {
  if (!canNormalizeNode(value, depth, context)) return null;
  if (context.ancestors.has(value)) return null;
  context.ancestors.add(value);
  context.nodes++;
  const node = value as Record<string, unknown>;
  const result = node.kind === "condition"
    ? normalizeConditionNode(node, context)
    : node.kind === "group" ? normalizeGroupNode(node, depth, context) : null;
  context.ancestors.delete(value);
  return result;
}

/** Clones and bounds untrusted JSON before it reaches the row pipeline. */
export function normalizeAdvancedFilterModel(
  input: unknown,
  validColumnIds?: ReadonlySet<string>
): AdvancedFilterModel | null {
  if (input == null || typeof input !== "object") return null;
  const source = input as Partial<AdvancedFilterModel>;
  if (source.version !== 1 || source.root == null) return null;
  const root = normalizeAdvancedNode(source.root, 0, {
    ancestors: new WeakSet<object>(), nodes: 0, validColumnIds
  });
  return root ? { version: 1, root } : null;
}

export function advancedFilterCondition(colId: string, filter: ColumnFilter): AdvancedFilterCondition {
  return { kind: "condition", colId, filter };
}

export function normalizeFilterModel(
  input: unknown,
  validColumnIds?: ReadonlySet<string>
): import("../types/colDef").FilterModel {
  if (input == null || typeof input !== "object" || Array.isArray(input)) return {};
  const output: import("../types/colDef").FilterModel = {};
  for (const [rawId, value] of Object.entries(input).slice(0, MAX_FILTER_COLUMNS)) {
    const colId = rawId.trim();
    if (!colId || validColumnIds?.has(colId) === false) continue;
    const filter = normalizeColumnFilter(value);
    if (filter) output[colId] = filter;
  }
  return output;
}

export function advancedFilterGroup(
  operator: "and" | "or",
  children: AdvancedFilterNode[],
  options: { not?: boolean } = {}
): AdvancedFilterGroup {
  return { kind: "group", operator, children, ...(options.not ? { not: true } : {}) };
}
