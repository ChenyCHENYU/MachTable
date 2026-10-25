import type { GridApi } from "../types/api";
import type { ColDef, FilterType } from "../types/colDef";
import { getByPath } from "../lib/path";
import { leafColumns } from "./columns";

export interface FilterField {
  colId: string;
  label?: string;
  type?: FilterType;
  options?: readonly { label: string; value: string | number | null }[];
}

export interface ResolvedFilterField extends FilterField { label: string; type: FilterType }

/** Column definitions stay the source of truth; descriptors fill in ambiguous schema only. */
export function resolveFilterFields<TData>(api: GridApi<TData>, configured?: readonly FilterField[]): ResolvedFilterField[] {
  const output: ResolvedFilterField[] = [];
  const available = new Set(api.columns.getState().map((column) => column.colId));
  const defaults = api.getOption("defaultColDef");
  for (const definition of leafColumns(api.columns.getDefinitions() ?? [])) {
    const column = { ...defaults, ...definition };
    const colId = column.colId ?? column.field;
    if (colId && available.has(colId) && definition.filter !== false) output.push(resolveField(column, colId, api));
  }
  if (!configured) return output;
  return configured.filter((field) => available.has(field.colId)).map((field) => {
    const inferred = output.find((entry) => entry.colId === field.colId);
    return { label: field.colId, type: "text", ...inferred, ...field };
  });
}

function resolveField<TData>(column: ColDef<TData>, colId: string, api: GridApi<TData>): ResolvedFilterField {
  const options = dictionaryOptions(column) ?? sampledOptions(column, api);
  const value = column.field ? getByPath(api.rows.getAt(0)?.data, column.field) : undefined;
  const inferred = column.cellEditor === "number" || typeof value === "number" ? "number" : "text";
  const type = typeof column.filter === "string" ? column.filter
    : options ? "set" : column.cellEditor === "date" ? "date" : inferred;
  return { colId, label: column.headerName ?? colId, type, ...(options ? { options } : {}) };
}

function dictionaryOptions<TData>(column: ColDef<TData>): FilterField["options"] {
  return column.cellEditorParams?.options
    ?? (column.filterParams?.values ?? column.cellEditorParams?.values)?.map((value) => ({ label: String(value ?? "空值"), value }));
}

/** Set fields without an explicit dictionary use a bounded sample of the current view. */
function sampledOptions<TData>(column: ColDef<TData>, api: GridApi<TData>): FilterField["options"] {
  if (column.filter !== "set" || !column.field) return undefined;
  const values = new Map<string, { label: string; value: string | number | null }>();
  for (let index = 0; index < Math.min(api.rows.getCount(), 2000); index++) {
    const node = api.rows.getAt(index);
    if (!node || node.data == null || node.isGroup || node.isDetail) continue;
    const value: unknown = getByPath(node.data, column.field);
    if (value !== null && typeof value !== "string" && typeof value !== "number") continue;
    if (typeof value === "number" && !Number.isFinite(value)) continue;
    const key = JSON.stringify([typeof value, value]);
    values.set(key, { label: String(value ?? "空值"), value });
  }
  return [...values.values()];
}
