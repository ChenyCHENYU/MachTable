import type { ColumnState, SortModel } from "../types/colDef";
import type { GridState, GridStateInput, GridStateSection } from "../types/state";
import { normalizeAdvancedFilterModel, normalizeFilterModel } from "./advancedFilter";

const MAX_COLUMNS = 2_000;
const MAX_ROW_IDS = 100_000;
const MAX_ID_LENGTH = 512;
const MAX_QUICK_FILTER_LENGTH = 10_000;

function stringIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, MAX_ROW_IDS).filter((entry): entry is string =>
    typeof entry === "string" && entry.length > 0 && entry.length <= MAX_ID_LENGTH
  ))];
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : fallback;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function addColumnSizing(state: ColumnState, source: Record<string, unknown>): void {
  const width = positiveNumber(source.width);
  const flex = positiveNumber(source.flex);
  if (width !== undefined) state.width = width;
  if (source.flex === null) state.flex = null;
  else if (flex !== undefined) state.flex = flex;
  if (source.widthMode === "auto" || source.widthMode === "manual") state.widthMode = source.widthMode;
}

function addColumnLayout(state: ColumnState, source: Record<string, unknown>): void {
  if (typeof source.hide === "boolean") state.hide = source.hide;
  if (source.pinned === null || source.pinned === "left" || source.pinned === "right") state.pinned = source.pinned;
}

function normalizeColumnEntry(input: unknown, seen: Set<string>): ColumnState | null {
  if (input == null || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;
  const colId = typeof source.colId === "string" ? source.colId.trim() : "";
  if (!colId || colId.length > MAX_ID_LENGTH || seen.has(colId)) return null;
  seen.add(colId);
  const state: ColumnState = { colId };
  addColumnLayout(state, source);
  addColumnSizing(state, source);
  return state;
}

function normalizeColumns(value: unknown): ColumnState[] {
  if (!Array.isArray(value)) return [];
  const output: ColumnState[] = [];
  const seen = new Set<string>();
  for (const input of value.slice(0, MAX_COLUMNS)) {
    const state = normalizeColumnEntry(input, seen);
    if (state) output.push(state);
  }
  return output;
}

function normalizeSortModel(value: unknown): SortModel {
  if (!Array.isArray(value)) return [];
  const output: SortModel = [];
  const seen = new Set<string>();
  for (const input of value.slice(0, MAX_COLUMNS)) {
    if (input == null || typeof input !== "object") continue;
    const source = input as Record<string, unknown>;
    const colId = typeof source.colId === "string" ? source.colId.trim() : "";
    if (!colId || colId.length > MAX_ID_LENGTH || seen.has(colId)) continue;
    if (source.direction !== "asc" && source.direction !== "desc") continue;
    seen.add(colId);
    output.push({ colId, direction: source.direction });
  }
  return output;
}

/** Validates and bounds persisted state before it mutates a live grid. */
export function normalizeGridState(input: unknown): GridState | null {
  if (input == null || typeof input !== "object") return null;
  const state = input as Partial<GridStateInput> & Record<string, unknown>;
  if (state.version !== 2) return null;
  if (!Array.isArray(state.columns) || !Array.isArray(state.sortModel)) return null;
  const pagination = state.pagination != null && typeof state.pagination === "object"
    ? state.pagination as Record<string, unknown>
    : {};
  return {
    version: 2,
    columns: normalizeColumns(state.columns),
    sortModel: normalizeSortModel(state.sortModel),
    filterModel: normalizeFilterModel(state.filterModel),
    advancedFilterModel: normalizeAdvancedFilterModel(state.advancedFilterModel),
    quickFilterText: typeof state.quickFilterText === "string" && state.quickFilterText.trim()
      ? state.quickFilterText.slice(0, MAX_QUICK_FILTER_LENGTH)
      : null,
    pagination: {
      enabled: pagination.enabled === true,
      page: positiveInteger(pagination.page, 1),
      pageSize: positiveInteger(pagination.pageSize, 20)
    },
    selectedRowIds: stringIds(state.selectedRowIds),
    expandedRowIds: stringIds(state.expandedRowIds),
    expandedGroupIds: stringIds(state.expandedGroupIds)
  };
}

/**
 * Produces a bounded snapshot that contains only the sections a persistence
 * store is allowed to retain. The result stays a valid GridState so custom
 * stores never need a second partial-state schema.
 */
export function selectGridStateSections(
  state: GridStateInput,
  sections: readonly GridStateSection[]
): GridState {
  const normalized = normalizeGridState(state);
  if (!normalized) throw new TypeError("[MachTable] Cannot persist an invalid GridState snapshot.");
  const selected = new Set(sections);
  return {
    version: 2,
    columns: selected.has("columns") ? normalized.columns : [],
    sortModel: selected.has("sort") ? normalized.sortModel : [],
    filterModel: selected.has("filter") ? normalized.filterModel : {},
    advancedFilterModel: selected.has("filter") ? normalized.advancedFilterModel : null,
    quickFilterText: selected.has("filter") ? normalized.quickFilterText : null,
    pagination: selected.has("pagination")
      ? normalized.pagination
      : { enabled: false, page: 1, pageSize: 20 },
    selectedRowIds: selected.has("selection") ? normalized.selectedRowIds : [],
    expandedRowIds: selected.has("expansion") ? normalized.expandedRowIds : [],
    expandedGroupIds: selected.has("expansion") ? normalized.expandedGroupIds : []
  };
}
