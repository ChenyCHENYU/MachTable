import { normalizeGridState } from "../lib/gridState";
import { normalizeColumnFilter } from "../lib/advancedFilter";
import type { AdvancedFilterNode } from "../types/advancedFilter";
import type { ColumnFilter, FilterType } from "../types/colDef";
import type { GridStateMigrationIssue, GridStateMigrationOptions, GridStateMigrationResult } from "./types";

const MAX_COLUMNS = 2_000;
const MAX_REPORT = 256;
const MAX_NODES = 512;
type ObjectValue = Record<string, unknown>;

function object(value: unknown): ObjectValue | null {
  return value != null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : null;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 512 && value.trim().length > 0
    && !["__proto__", "prototype", "constructor"].includes(value);
}

/** Reports are bounded even when a hostile payload contains millions of invalid entries. */
function issue(report: GridStateMigrationIssue[], entry: GridStateMigrationIssue): void {
  if (report.length < MAX_REPORT - 1) report.push(entry);
  else if (report.length === MAX_REPORT - 1) report.push({ code: "LIMIT_EXCEEDED", path: "report" });
}

function columnResolver(options: GridStateMigrationOptions, report: GridStateMigrationIssue[]) {
  if (options.columns.length > MAX_COLUMNS || options.columns.some(id => !validId(id) || id !== id.trim())) {
    throw new TypeError("[MachTable] Preference columns must contain at most 2000 valid stable IDs.");
  }
  const columns = new Set(options.columns);
  if (columns.size !== options.columns.length) throw new TypeError("[MachTable] Preference column IDs must be unique.");
  const renames = new Map(Object.entries(options.renameColumns ?? {}));
  if (renames.size > MAX_COLUMNS || [...renames].some(([from, to]) => !validId(from) || !columns.has(to))) {
    throw new TypeError("[MachTable] Preference rename targets must identify current columns.");
  }
  return (input: unknown, path: string): string | null => {
    if (!validId(input)) { issue(report, { code: "REMOVED_COLUMN", path }); return null; }
    const from = input.trim();
    const to = renames.get(from) ?? from;
    if (!columns.has(to)) { issue(report, { code: "REMOVED_COLUMN", path, from }); return null; }
    if (from !== to) issue(report, { code: "RENAMED_COLUMN", path, from, to });
    return to;
  };
}

function filterTypes(options: GridStateMigrationOptions): ReadonlyMap<string, FilterType | false> {
  const entries = Object.entries(options.columnTypes ?? {});
  const columns = new Set(options.columns);
  if (entries.length > MAX_COLUMNS || entries.some(([id, type]) => !columns.has(id)
    || !["text", "number", "date", "set", false].includes(type))) {
    throw new TypeError("[MachTable] Preference filter types must identify current columns and supported types.");
  }
  return new Map(entries);
}

function conditionValid(type: string, value: ObjectValue): boolean {
  if (value.match === "blank" || value.match === "notBlank") return true;
  if (type === "number") {
    if (typeof value.value !== "number" || !Number.isFinite(value.value)) return false;
    return value.match !== "inRange" || (typeof value.value2 === "number" && Number.isFinite(value.value2) && value.value2 >= value.value);
  }
  if (typeof value.value !== "string") return false;
  if (type === "text") return true;
  if (!Number.isFinite(Date.parse(value.value))) return false;
  return value.match !== "inRange" || (typeof value.value2 === "string" && Number.isFinite(Date.parse(value.value2)) && Date.parse(value.value2) >= Date.parse(value.value));
}

function reserveFilterValue(value: unknown, context: MigrationContext): boolean {
  const size = typeof value === "string" ? value.length : 0;
  if (size > 1_024 || context.filterCharacters < size) return false;
  context.filterCharacters -= size;
  return true;
}

function reserveFilterItem(values: unknown[], context: MigrationContext): boolean {
  if (context.filterItems <= 0) return false;
  context.filterItems--;
  return values.every(value => reserveFilterValue(value, context));
}

function boundedFilter(input: unknown): ColumnFilter | null {
  const source = object(input);
  if (source?.operator !== undefined && source.operator !== "and" && source.operator !== "or") {
    return null;
  }
  return normalizeColumnFilter(source && {
    type: source.type, operator: source.operator,
    values: Array.isArray(source.values) ? source.values.slice(0, 2_000) : undefined,
    conditions: Array.isArray(source.conditions) ? source.conditions.slice(0, 20) : undefined
  });
}

function migrateFilter(input: unknown, colId: string, path: string, context: MigrationContext): ColumnFilter | null {
  const report = context.report;
  if (context.filterItems <= 0) { issue(report, { code: "LIMIT_EXCEEDED", path }); return null; }
  const filter = boundedFilter(input);
  if (!filter) { issue(report, { code: "INVALID_FILTER", path }); return null; }
  const targetType = context.types.get(colId);
  if (targetType !== undefined && targetType !== filter.type) {
    issue(report, { code: "TYPE_CHANGED", path, from: filter.type, to: targetType === false ? "disabled" : targetType });
    return null;
  }
  if (filter.type === "set") {
    const values = filter.values.filter(value => (value === null || typeof value === "string" || typeof value === "number")
      && reserveFilterItem([value], context));
    const raw = object(input)?.values;
    if (Array.isArray(raw) && raw.length !== values.length) issue(report, { code: "NORMALIZED", path });
    return { type: "set", values };
  }
  const conditions = filter.conditions.filter(condition => reserveFilterItem(Object.values(condition), context)
    && conditionValid(filter.type, condition as unknown as ObjectValue));
  const raw = object(input)?.conditions;
  if (Array.isArray(raw) && raw.length !== conditions.length) issue(report, { code: "INVALID_FILTER", path });
  if (!conditions.length) return null;
  return { ...filter, conditions } as ColumnFilter;
}

interface MigrationContext {
  report: GridStateMigrationIssue[];
  resolve: ReturnType<typeof columnResolver>;
  types: ReadonlyMap<string, FilterType | false>;
  ancestors: WeakSet<object>;
  nodes: number;
  filterItems: number;
  filterCharacters: number;
}

function migrateCondition(source: ObjectValue, path: string, context: MigrationContext): AdvancedFilterNode | null {
  const colId = context.resolve(source.colId, `${path}.colId`);
  if (!colId) return null;
  const filter = migrateFilter(source.filter, colId, `${path}.filter`, context);
  return filter ? { kind: "condition", colId, filter } : null;
}

function migrateGroup(source: ObjectValue, path: string, depth: number, context: MigrationContext): AdvancedFilterNode | null {
  if (!Array.isArray(source.children) || !["and", "or"].includes(source.operator as string)) {
    issue(context.report, { code: "INVALID_FILTER", path });
    return null;
  }
  const children: AdvancedFilterNode[] = [];
  for (let index = 0; index < Math.min(source.children.length, MAX_NODES); index++) {
    const child = migrateNode(source.children[index], `${path}.children[${index}]`, depth + 1, context);
    if (child) children.push(child);
  }
  if (source.children.length > MAX_NODES) issue(context.report, { code: "LIMIT_EXCEEDED", path });
  return children.length ? { kind: "group", operator: source.operator as "and" | "or", children,
    ...(source.not === true ? { not: true } : {}) } : null;
}

function migrateNode(input: unknown, path: string, depth: number, context: MigrationContext): AdvancedFilterNode | null {
  const source = object(input);
  if (!source || depth > 16 || context.nodes >= MAX_NODES || context.ancestors.has(source)) {
    issue(context.report, { code: "LIMIT_EXCEEDED", path });
    return null;
  }
  context.nodes++;
  context.ancestors.add(source);
  let node: AdvancedFilterNode | null = null;
  if (source.kind === "condition") node = migrateCondition(source, path, context);
  else if (source.kind === "group") node = migrateGroup(source, path, depth, context);
  else issue(context.report, { code: "INVALID_FILTER", path });
  context.ancestors.delete(source);
  return node;
}

function mapEntries<T extends { colId: string }>(entries: T[], path: string, context: MigrationContext): T[] {
  const seen = new Set<string>();
  return entries.flatMap((entry, index) => {
    const colId = context.resolve(entry.colId, `${path}[${index}]`);
    if (!colId) return [];
    if (seen.has(colId)) { issue(context.report, { code: "DUPLICATE_COLUMN", path, from: entry.colId, to: colId }); return []; }
    seen.add(colId);
    return [{ ...entry, colId }];
  });
}

function migrateFilters(source: ObjectValue, context: MigrationContext): import("../types/colDef").FilterModel {
  const filters = object(source.filterModel);
  const output: import("../types/colDef").FilterModel = Object.create(null);
  if (!filters) return output;
  let count = 0;
  for (const from in filters) {
    if (!Object.prototype.hasOwnProperty.call(filters, from)) continue;
    if (count++ >= MAX_COLUMNS) { issue(context.report, { code: "LIMIT_EXCEEDED", path: "filterModel" }); break; }
    const path = `filterModel.${from.slice(0, 512)}`;
    const colId = context.resolve(from, path);
    if (!colId) continue;
    if (Object.prototype.hasOwnProperty.call(output, colId)) { issue(context.report, { code: "DUPLICATE_COLUMN", path: "filterModel", from, to: colId }); continue; }
    const filter = migrateFilter(filters[from], colId, path, context);
    if (filter) output[colId] = filter;
  }
  return output;
}

function validLegacy(source: ObjectValue): boolean {
  const pagination = object(source.pagination);
  return object(source.filterModel) !== null && pagination !== null
    && typeof pagination.enabled === "boolean" && typeof pagination.page === "number"
    && typeof pagination.pageSize === "number"
    && (source.quickFilterText === null || typeof source.quickFilterText === "string")
    && [source.selectedRowIds, source.expandedRowIds, source.expandedGroupIds].every(Array.isArray);
}

function migrateAdvanced(source: ObjectValue, context: MigrationContext): import("../types/advancedFilter").AdvancedFilterModel | null {
  if (source.version !== 2 || source.advancedFilterModel == null) return null;
  const advanced = object(source.advancedFilterModel);
  if (advanced?.version !== 1) {
    issue(context.report, { code: "INVALID_FILTER", path: "advancedFilterModel" });
    return null;
  }
  const root = migrateNode(advanced.root, "advancedFilterModel.root", 0, context);
  return root ? { version: 1, root } : null;
}

function boundedEntries(input: unknown): unknown {
  return Array.isArray(input) ? input.slice(0, MAX_COLUMNS).filter(entry => {
    const id = object(entry)?.colId;
    return typeof id !== "string" || id.length <= 512;
  }) : input;
}

/** Opt-in v1→v2 and current-column migration; the default Core remains strict v2. */
export function migrateGridState(input: unknown, options: GridStateMigrationOptions): GridStateMigrationResult {
  const report: GridStateMigrationIssue[] = [];
  const source = object(input);
  const resolve = columnResolver(options, report);
  const types = filterTypes(options);
  if (!source || ![1, 2].includes(source.version as number)) {
    issue(report, { code: "UNSUPPORTED_VERSION", path: "version" });
    return { state: null, report };
  }
  // v1 is the published 0.14/0.15 shape: v2 adds advancedFilterModel only.
  const state = normalizeGridState({ version: 2, columns: boundedEntries(source.columns), sortModel: boundedEntries(source.sortModel),
    filterModel: {}, advancedFilterModel: null,
    quickFilterText: typeof source.quickFilterText === "string" ? source.quickFilterText.slice(0, 10_000) : source.quickFilterText,
    pagination: source.pagination,
    selectedRowIds: source.selectedRowIds, expandedRowIds: source.expandedRowIds, expandedGroupIds: source.expandedGroupIds });
  if (!state || !Array.isArray(source.columns) || !Array.isArray(source.sortModel)) {
    issue(report, { code: "INVALID_STATE", path: "state" });
    return { state: null, report };
  }
  if (source.version === 1 && !validLegacy(source)) return { state: null, report: [{ code: "INVALID_STATE", path: "state" }] };
  if (source.version === 1) issue(report, { code: "VERSION_MIGRATED", path: "version", from: "1", to: "2" });
  const context: MigrationContext = { report, resolve, types, ancestors: new WeakSet(), nodes: 0,
    filterItems: 10_000, filterCharacters: 64_000 };
  for (const field of ["columns", "sortModel"] as const) {
    if ((source[field] as unknown[]).length !== state[field].length) issue(report, { code: "NORMALIZED", path: field });
  }
  state.columns = mapEntries(state.columns, "columns", context);
  state.sortModel = mapEntries(state.sortModel, "sortModel", context);
  state.filterModel = migrateFilters(source, context);
  state.advancedFilterModel = migrateAdvanced(source, context);
  return { state, report };
}
