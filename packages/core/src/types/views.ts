import type { ColumnState, FilterModel, SortModel } from "./colDef";
import type { AdvancedFilterModel } from "./advancedFilter";

/** Portable user preference snapshot. Selection and row expansion are deliberately excluded. */
export interface GridViewState {
  version: 1;
  columns: ColumnState[];
  sortModel: SortModel;
  filterModel: FilterModel;
  advancedFilterModel: AdvancedFilterModel | null;
  quickFilterText: string | null;
  pageSize: number;
}

export interface SavedGridView {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  state: GridViewState;
}

export interface GridViewStore {
  list(scope: string): readonly SavedGridView[] | Promise<readonly SavedGridView[]>;
  save(scope: string, view: SavedGridView): void | Promise<void>;
  remove(scope: string, id: string): void | Promise<void>;
}

export interface GridViewManager {
  list(): Promise<SavedGridView[]>;
  save(name: string, id?: string): Promise<SavedGridView>;
  apply(viewOrId: SavedGridView | string, options?: { emitEvents?: boolean }): Promise<SavedGridView>;
  remove(id: string): Promise<void>;
}
