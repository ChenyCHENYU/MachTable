import type { GridApi } from "../types/api";
import type { FilterModel, SortModel } from "../types/colDef";
import type { AdvancedFilterModel } from "../types/advancedFilter";
import { normalizeAdvancedFilterModel, normalizeFilterModel } from "./advancedFilter";

export type RemoteExportScope = "filtered" | "selected";

export type RemoteExportSelection =
  | { mode: "explicit"; selectedKeys: string[] }
  | { mode: "allMatching"; excludedKeys: string[] };

export interface RemoteExportRequestOptions {
  scope: RemoteExportScope;
  /** Supply useMachTableQuery().selectionState for cross-page or all-matching selection. */
  selection?: RemoteExportSelection;
}

/** Serializable grid criteria for an application-owned server export endpoint. */
export interface RemoteExportRequest {
  version: 1;
  scope: RemoteExportScope;
  columnIds: string[];
  sortModel: SortModel;
  filterModel: FilterModel;
  advancedFilterModel: AdvancedFilterModel | null;
  quickFilterText: string | null;
  selection?: RemoteExportSelection;
}

function copySelection(selection: RemoteExportSelection): RemoteExportSelection {
  return selection.mode === "allMatching"
    ? { mode: "allMatching", excludedKeys: [...selection.excludedKeys] }
    : { mode: "explicit", selectedKeys: [...selection.selectedKeys] };
}

/** Takes a detached snapshot; it never traverses loaded rows or changes the grid. */
export function createRemoteExportRequest<TData>(
  api: GridApi<TData>,
  options: RemoteExportRequestOptions
): RemoteExportRequest {
  if (options.scope !== "filtered" && options.scope !== "selected") {
    throw new TypeError("[MachTable] Remote export scope must be filtered or selected.");
  }
  const state = api.state.get();
  return {
    version: 1,
    scope: options.scope,
    columnIds: state.columns.filter((column) => !column.hide).map((column) => column.colId),
    sortModel: state.sortModel.map((entry) => ({ ...entry })),
    filterModel: normalizeFilterModel(state.filterModel),
    advancedFilterModel: normalizeAdvancedFilterModel(state.advancedFilterModel),
    quickFilterText: state.quickFilterText,
    ...(options.scope === "selected"
      ? { selection: copySelection(options.selection ?? { mode: "explicit", selectedKeys: state.selectedRowIds }) }
      : {})
  };
}
