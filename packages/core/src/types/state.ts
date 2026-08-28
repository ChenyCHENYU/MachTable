import type { ColumnState, FilterModel, SortModel } from "./colDef";

/** Serializable snapshot of user-visible grid state. */
export interface GridState {
  /** State schema version, independent from the package version. */
  version: 1;
  columns: ColumnState[];
  sortModel: SortModel;
  filterModel: FilterModel;
  quickFilterText: string | null;
  pagination: {
    enabled: boolean;
    page: number;
    pageSize: number;
  };
  selectedRowIds: string[];
  expandedRowIds: string[];
  expandedGroupIds: string[];
}

export type GridStateSection =
  | "columns"
  | "sort"
  | "filter"
  | "pagination"
  | "selection"
  | "expansion";

export interface ApplyGridStateOptions {
  /** Applies all sections when omitted. */
  sections?: readonly GridStateSection[];
  /** Emit the standard sort/filter/pagination events after restoration. */
  emitEvents?: boolean;
}
