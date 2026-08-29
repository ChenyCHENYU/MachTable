import type { ColDef, ColDefGroup, ColumnState, FilterModel, SortModel } from "./colDef";
import type { GridErrorCode, GridEventMap, GridEventType } from "./events";
import type { GridOptions, RowSelectionMode } from "./options";
import type { RowNode } from "./row";
import type { ApplyGridStateOptions, GridState } from "./state";

export interface CsvExportParams {
  includeHeader?: boolean;
  columnSeparator?: string;
  prependBOM?: boolean;
  onlySelected?: boolean;
  onlyAllDisplayed?: boolean;
  protectFormulas?: boolean;
  headersOnly?: boolean;
}

export interface ImportCsvOptions {
  separator?: string;
  mode?: "replace" | "append" | "paste";
  headerRowIndex?: number;
  coerceNumbers?: boolean;
  parseValue?: (params: { value: string; field: string; rowIndex: number; columnIndex: number }) => any;
}

export interface PrintOptions {
  title?: string;
  includeHeader?: boolean;
}

export interface RowTransaction<TData = any> {
  add?: TData[];
  addIndex?: number;
  remove?: TData[];
  update?: TData[];
}

export interface GridCellChange {
  colId: string;
  originalValue: unknown;
  value: unknown;
}

export interface GridChange<TData = any> {
  rowId: string;
  data: TData;
  cells: GridCellChange[];
}

export interface GridDiagnosticError {
  code: GridErrorCode;
  source: string;
  message: string;
  timestamp: number;
  context?: Record<string, unknown>;
}

export interface GridDiagnostics {
  gridId: number;
  version: string;
  destroyed: boolean;
  infinite: boolean;
  loading: boolean;
  rowCount: number;
  renderedRowCount: number;
  columnCount: number;
  selectedRowCount: number;
  dirtyRowCount: number;
  recentErrors: readonly GridDiagnosticError[];
}

export type SaveChangesHandler<TData = any> = (
  changes: readonly GridChange<TData>[]
) => void | Promise<void>;

export interface ScrollToIndexPosition {
  position?: "top" | "bottom" | "middle" | "nearest";
}

export interface GridApi<TData = any> {
  /** Resolves after the first layout frame and gridReady emission. */
  whenReady(): Promise<GridApi<TData>>;
  /** Reads the currently resolved value after application, preset and table overrides. */
  getGridOption<K extends keyof GridOptions<TData>>(key: K): GridOptions<TData>[K];
  /** Typed shorthand for updating one runtime option. */
  setGridOption<K extends keyof GridOptions<TData>>(key: K, value: GridOptions<TData>[K]): void;
  setRowData(rows: TData[] | null | undefined): void;
  applyTransaction(transaction: RowTransaction<TData>): void;
  /** Coalesces rapid transactions and refreshes the row pipeline once per batch. */
  applyTransactionAsync(transaction: RowTransaction<TData>): Promise<void>;
  /** Immediately applies transactions currently waiting in the async queue. */
  flushAsyncTransactions(): void;

  getColumnDefs(): (ColDef<TData> | ColDefGroup<TData>)[] | null;
  setColumnDefs(colDefs: (ColDef<TData> | ColDefGroup<TData>)[] | null | undefined): void;

  getColumnState(): ColumnState[];
  setColumnState(state: ColumnState[]): void;
  resetColumnState(): void;
  setColumnVisibility(colId: string, visible: boolean): void;
  moveColumn(colId: string, toIndex: number): void;
  setColumnPinned(colId: string, pinned: "left" | "right" | null): void;

  sizeColumnsToFit(width?: number): void;
  autoSizeColumn(colId: string, skipHeader?: boolean): void;
  autoSizeAllColumns(skipHeader?: boolean): void;

  getSortModel(): SortModel;
  setSortModel(sortModel: SortModel | null): void;

  getFilterModel(): FilterModel;
  setFilterModel(filterModel: FilterModel | null): void;
  isColumnFilterPresent(colId: string): boolean;

  setQuickFilter(text: string | null | undefined): void;
  getQuickFilter(): string | null;

  getRowSelection(): RowSelectionMode;
  setRowSelection(mode: RowSelectionMode): void;

  getSelectedNodes(): RowNode<TData>[];
  getSelectedRows(): TData[];
  selectNodeById(nodeId: string, selected?: boolean, clearOthers?: boolean): void;
  selectAll(filteredOnly?: boolean): void;
  deselectAll(): void;

  getDisplayedRowCount(): number;
  getRowNode(rowIndex: number): RowNode<TData> | undefined;
  getNodeById(id: string): RowNode<TData> | undefined;
  forEachNode(callback: (node: RowNode<TData>, index: number) => void): void;
  forEachNodeAfterFilterAndSort(callback: (node: RowNode<TData>, index: number) => void): void;

  scrollToIndex(rowIndex: number, position?: "top" | "bottom" | "middle" | "nearest"): void;

  expandRow(rowId: string): boolean;
  collapseRow(rowId: string): boolean;
  toggleDetailRow(rowId: string): boolean;
  isRowExpanded(rowId: string): boolean;
  expandAllDetails(): void;
  collapseAllDetails(): void;

  toggleRowGroup(groupId: string): boolean;
  isGroupExpanded(groupId: string): boolean;
  expandAllGroups(): void;
  collapseAllGroups(): void;

  reorderRows(fromIndex: number, toIndex: number): boolean;

  setSelection(rows: TData[], clearOthers?: boolean): void;
  getVisibleSelection(): TData[];
  getSelectedIds(): string[];

  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  getDirtyRowIds(): string[];
  getChanges(): GridChange<TData>[];
  markChangesSaved(rowIds?: readonly string[]): void;
  /** Saves a stable change snapshot and safely preserves edits made while the request is in flight. */
  saveChanges(handler: SaveChangesHandler<TData>, rowIds?: readonly string[]): Promise<GridChange<TData>[]>;
  rollbackChanges(rowIds?: readonly string[]): boolean;

  setPinnedTopRowData(rows: TData[] | null): void;
  getPinnedTopRowData(): TData[];
  setPinnedBottomRowData(rows: TData[] | null): void;
  getPinnedBottomRowData(): TData[];

  getRangeSelection(): import("./events").GridCellRange | null;
  clearRangeSelection(): void;
  copyRangeToClipboard(): Promise<boolean>;

  openColumnPanel(anchor?: HTMLElement): void;

  refreshLayout(): void;

  isInfinite(): boolean;
  reload(): Promise<void>;

  paginationEnabled(): boolean;
  setPaginationEnabled(enabled: boolean): void;
  getPage(): number;
  setPage(page: number): void;
  getPageSize(): number;
  setPageSize(size: number): void;
  getPageCount(): number;
  getTotalRowCount(): number;

  importCsv(text: string, options?: ImportCsvOptions): boolean;
  print(options?: PrintOptions): boolean;

  startEditingCell(params: { rowIndex: number; colId: string; keyPress?: string }): boolean;
  /** Starts staged editing for every editable cell in one displayed row. */
  startEditingRow(rowIndex: number): boolean;
  /** Returns whether any row, or the requested displayed row, is in full-row edit mode. */
  isRowEditing(rowIndex?: number): boolean;
  stopEditing(cancel?: boolean): void;
  /** Stops editing and resolves after synchronous or asynchronous validation. */
  stopEditingAsync(cancel?: boolean): Promise<boolean>;
  /** Explicit full-row counterpart; aliases stopEditingAsync when a row is active. */
  stopEditingRow(cancel?: boolean): Promise<boolean>;

  refreshCells(): void;
  updateOptions(options: Partial<GridOptions<TData>>): void;

  getDataAsCsv(params?: CsvExportParams): string;

  getState(): GridState;
  applyState(state: GridState, options?: ApplyGridStateOptions): void;
  /** Lightweight runtime snapshot suitable for support logs and health panels. */
  getDiagnostics(): GridDiagnostics;

  setOverlay(type: "loading" | "noRows" | null): void;
  hideOverlays(): void;

  addEventListener<K extends GridEventType>(eventType: K, listener: (event: GridEventMap<TData>[K]) => void): () => void;
  removeEventListener<K extends GridEventType>(eventType: K, listener: (event: GridEventMap<TData>[K]) => void): void;

  destroy(): void;
  isDestroyed(): boolean;
}
