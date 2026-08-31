import type { ColDef, ColDefGroup, ColumnState, FilterModel, SortModel } from "./colDef";
import type { GridErrorCode, GridEventMap, GridEventType } from "./events";
import type { GridOptions, RowSelectionMode } from "./options";
import type { RowNode } from "./row";
import type { ApplyGridStateOptions, GridState, GridStateInput } from "./state";
import type { AdvancedFilterModel } from "./advancedFilter";

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

export interface GridPerformanceSnapshot {
  sampleCount: number;
  lastRenderMs: number;
  averageRenderMs: number;
  maxRenderMs: number;
  p95RenderMs: number;
  longRenderCount: number;
  renderedRows: number;
  renderedColumns: number;
  renderedCells: number;
  layoutSampleCount: number;
  p95LayoutMs: number;
  modelSampleCount: number;
  p95ModelMs: number;
  longTaskCount: number;
  longTaskTotalMs: number;
  usedHeapBytes: number | null;
}

export interface GridUpdateSchedulerSnapshot {
  batchDepth: number;
  flushCount: number;
  requestCount: number;
  coalescedRequestCount: number;
  pending: boolean;
}

export interface RemoteBlockCacheSnapshot {
  cachedBlockCount: number;
  loadingBlockCount: number;
  cachedRowCount: number;
  hitCount: number;
  missCount: number;
  evictionCount: number;
}

export interface GridAsyncOptions {
  signal?: AbortSignal;
}

export interface RefreshCellsParams {
  /** Stable row identifiers. Omit together with rowIndexes to target every rendered row. */
  rowIds?: readonly string[];
  /** Displayed row indexes. Omit together with rowIds to target every rendered row. */
  rowIndexes?: readonly number[];
  /** Column IDs. Omit to target every rendered column in matching rows. */
  columns?: readonly string[];
  /** Bypasses renderer refresh hooks and recreates matching cell content. */
  force?: boolean;
  /** Also refreshes pinned rows. Defaults to true only for an unscoped refresh. */
  includePinned?: boolean;
}

export interface ColumnWorkbenchItem {
  colId: string;
  label: string;
  visible: boolean;
  pinned: "left" | "right" | null;
  width: number;
  movable: boolean;
  hideable: boolean;
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
  activeFeatures: ReadonlyArray<{ key: string; version?: string }>;
  performance: GridPerformanceSnapshot;
  updates: GridUpdateSchedulerSnapshot;
  recentErrors: readonly GridDiagnosticError[];
}

export interface GridRowsApi<TData = any> {
  setData(rows: TData[] | null | undefined): void;
  apply(transaction: RowTransaction<TData>): void;
  applyAsync(transaction: RowTransaction<TData>, options?: GridAsyncOptions): Promise<void>;
  getDisplayedCount(): number;
  getById(id: string): RowNode<TData> | undefined;
  scrollTo(index: number, position?: "top" | "bottom" | "middle" | "nearest"): void;
  ensureLoaded(startRow: number, endRow: number, options?: GridAsyncOptions): Promise<void>;
  purgeCache(): void;
  getCacheSnapshot(): RemoteBlockCacheSnapshot;
}

export interface GridColumnsApi {
  getState(): ColumnState[];
  setState(state: ColumnState[]): void;
  resetState(): void;
  setVisible(colId: string, visible: boolean): void;
  setWidth(colId: string, width: number): boolean;
}

export interface GridSelectionApi<TData = any> {
  getRows(): TData[];
  getIds(): string[];
  selectAll(filteredOnly?: boolean): void;
  clear(): void;
}

export interface GridEditingApi<TData = any> {
  getChanges(): GridChange<TData>[];
  rollback(rowIds?: readonly string[]): boolean;
  save(
    handler: SaveChangesHandler<TData>,
    rowIds?: readonly string[]
  ): Promise<GridBatchSaveResult<TData>>;
  stop(cancel?: boolean): Promise<boolean>;
}

export interface GridStateApi {
  get(): GridState;
  apply(state: GridStateInput, options?: ApplyGridStateOptions): void;
}

export interface GridDiagnosticsApi {
  get(): GridDiagnostics;
  getPerformance(): GridPerformanceSnapshot;
  resetPerformance(): void;
}

export interface SaveChangeIssue {
  rowId: string;
  code?: string;
  message: string;
  colIds?: readonly string[];
  retryable?: boolean;
}

export interface SaveChangeConflict<TData = any> extends SaveChangeIssue {
  serverData?: TData;
  serverVersion?: string | number;
}

export interface SaveChangesResult<TData = any> {
  /** Omit to acknowledge every submitted row; return a subset for partial batch success. */
  savedRowIds?: readonly string[];
  failures?: readonly SaveChangeIssue[];
  conflicts?: readonly SaveChangeConflict<TData>[];
}

export interface GridBatchSaveResult<TData = any> {
  submitted: GridChange<TData>[];
  saved: GridChange<TData>[];
  failures: SaveChangeIssue[];
  conflicts: SaveChangeConflict<TData>[];
}

export type SaveChangesHandler<TData = any> = (
  changes: readonly GridChange<TData>[]
) => void | SaveChangesResult<TData> | Promise<void | SaveChangesResult<TData>>;

export interface ScrollToIndexPosition {
  position?: "top" | "bottom" | "middle" | "nearest";
}

export interface GridApi<TData = any> {
  /** Optional namespaced facade. Existing flat methods remain supported. */
  readonly rows: GridRowsApi<TData>;
  readonly columns: GridColumnsApi;
  readonly selection: GridSelectionApi<TData>;
  readonly editing: GridEditingApi<TData>;
  readonly state: GridStateApi;
  readonly diagnostics: GridDiagnosticsApi;
  /** Coalesces model/layout/render work from nested synchronous API calls. */
  batch<TResult>(callback: (api: GridApi<TData>) => TResult): TResult;
  /** Flushes deferred work; normally only needed by tests and imperative measurements. */
  flushUpdates(): void;
  /** Resolves after the first layout frame and gridReady emission. */
  whenReady(): Promise<GridApi<TData>>;
  /** Stable grid root for portals, measurements and fullscreen targets; null after destroy. */
  getRootElement(): HTMLElement | null;
  /** Reads the currently resolved value after application, preset and table overrides. */
  getGridOption<K extends keyof GridOptions<TData>>(key: K): GridOptions<TData>[K];
  /** Typed shorthand for updating one runtime option. */
  setGridOption<K extends keyof GridOptions<TData>>(key: K, value: GridOptions<TData>[K]): void;
  setRowData(rows: TData[] | null | undefined): void;
  applyTransaction(transaction: RowTransaction<TData>): void;
  /** Coalesces rapid transactions and refreshes the row pipeline once per batch. */
  applyTransactionAsync(transaction: RowTransaction<TData>, options?: GridAsyncOptions): Promise<void>;
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
  /** Sets one width without replacing the rest of the column state. */
  setColumnWidth(colId: string, width: number): boolean;

  sizeColumnsToFit(width?: number): void;
  autoSizeColumn(colId: string, skipHeader?: boolean): void;
  autoSizeAllColumns(skipHeader?: boolean): void;

  getSortModel(): SortModel;
  setSortModel(sortModel: SortModel | null): void;

  getFilterModel(): FilterModel;
  setFilterModel(filterModel: FilterModel | null): void;
  getAdvancedFilterModel(): AdvancedFilterModel | null;
  setAdvancedFilterModel(model: AdvancedFilterModel | null): void;
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

  /** Loads and caches lazy tree children. Concurrent calls for one row are deduplicated. */
  loadTreeChildren(rowId: string, options?: { force?: boolean }): Promise<readonly TData[]>;
  retryTreeChildren(rowId: string): Promise<readonly TData[]>;
  isTreeRowLoading(rowId: string): boolean;

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
  /** Saves a stable snapshot; supports partial success and preserves edits made in flight. */
  saveChanges(handler: SaveChangesHandler<TData>, rowIds?: readonly string[]): Promise<GridChange<TData>[]>;
  saveChangesDetailed(
    handler: SaveChangesHandler<TData>,
    rowIds?: readonly string[]
  ): Promise<GridBatchSaveResult<TData>>;
  rollbackChanges(rowIds?: readonly string[]): boolean;

  setPinnedTopRowData(rows: TData[] | null): void;
  getPinnedTopRowData(): TData[];
  setPinnedBottomRowData(rows: TData[] | null): void;
  getPinnedBottomRowData(): TData[];

  getRangeSelection(): import("./events").GridCellRange | null;
  clearRangeSelection(): void;
  copyRangeToClipboard(): Promise<boolean>;

  /** Opens the built-in searchable column workbench. */
  openColumnWorkbench(anchor?: HTMLElement): void;
  closeColumnWorkbench(): void;
  getColumnWorkbenchItems(): ColumnWorkbenchItem[];
  /** @deprecated Use openColumnWorkbench. Kept during the 0.x compatibility window. */
  openColumnPanel(anchor?: HTMLElement): void;

  refreshLayout(): void;

  isInfinite(): boolean;
  reload(options?: GridAsyncOptions): Promise<void>;
  /** Ensures an inclusive/exclusive remote row range is cached in random-access block mode. */
  ensureRowsLoaded(startRow: number, endRow: number, options?: GridAsyncOptions): Promise<void>;
  /** Aborts block requests and removes all random-access datasource blocks. */
  purgeDatasourceCache(): void;
  getDatasourceCacheSnapshot(): RemoteBlockCacheSnapshot;

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

  refreshCells(params?: RefreshCellsParams): void;
  updateOptions(options: Partial<GridOptions<TData>>): void;

  getDataAsCsv(params?: CsvExportParams): string;

  getState(): GridState;
  applyState(state: GridStateInput, options?: ApplyGridStateOptions): void;
  /** Lightweight runtime snapshot suitable for support logs and health panels. */
  getDiagnostics(): GridDiagnostics;
  /** Rolling viewport-render metrics for diagnostics and reproducible benchmarks. */
  getPerformanceSnapshot(): GridPerformanceSnapshot;
  resetPerformanceMetrics(): void;

  setOverlay(type: "loading" | "noRows" | "error" | null): void;
  hideOverlays(): void;

  addEventListener<K extends GridEventType>(eventType: K, listener: (event: GridEventMap<TData>[K]) => void): () => void;
  removeEventListener<K extends GridEventType>(eventType: K, listener: (event: GridEventMap<TData>[K]) => void): void;

  destroy(): void;
  isDestroyed(): boolean;
}
