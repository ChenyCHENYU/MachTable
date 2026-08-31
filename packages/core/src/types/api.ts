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
  activeRequestCount: number;
  queuedRequestCount: number;
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
  transact(transaction: RowTransaction<TData>): void;
  transactAsync(transaction: RowTransaction<TData>, options?: GridAsyncOptions): Promise<void>;
  flushTransactions(): void;
  getCount(): number;
  getAt(index: number): RowNode<TData> | undefined;
  getById(id: string): RowNode<TData> | undefined;
  forEach(callback: (node: RowNode<TData>, index: number) => void): void;
  forEachDisplayed(callback: (node: RowNode<TData>, index: number) => void): void;
  reorder(fromIndex: number, toIndex: number): boolean;
  isRemote(): boolean;
  reload(options?: GridAsyncOptions): Promise<void>;
  ensureLoaded(startRow: number, endRow: number, options?: GridAsyncOptions): Promise<void>;
  purgeCache(): void;
  getCacheSnapshot(): RemoteBlockCacheSnapshot;
}

export interface GridColumnsApi<TData = any> {
  getDefinitions(): (ColDef<TData> | ColDefGroup<TData>)[] | null;
  setDefinitions(definitions: (ColDef<TData> | ColDefGroup<TData>)[] | null | undefined): void;
  getState(): ColumnState[];
  setState(state: ColumnState[]): void;
  resetState(): void;
  setVisible(colId: string, visible: boolean): void;
  setPinned(colId: string, pinned: "left" | "right" | null): void;
  move(colId: string, toIndex: number): void;
  setWidth(colId: string, width: number): boolean;
  fit(width?: number): void;
  autoSize(colId: string, skipHeader?: boolean): void;
  autoSizeAll(skipHeader?: boolean): void;
  getWorkbenchItems(): ColumnWorkbenchItem[];
  openWorkbench(anchor?: HTMLElement): void;
  closeWorkbench(): void;
}

export interface GridSelectionApi<TData = any> {
  getRows(): TData[];
  getVisibleRows(): TData[];
  getNodes(): RowNode<TData>[];
  getIds(): string[];
  setRows(rows: TData[], clearOthers?: boolean): void;
  setById(nodeId: string, selected?: boolean, clearOthers?: boolean): void;
  selectAll(filteredOnly?: boolean): void;
  clear(): void;
  getMode(): RowSelectionMode;
  setMode(mode: RowSelectionMode): void;
  getRange(): import("./events").GridCellRange | null;
  clearRange(): void;
}

export interface GridEditingApi<TData = any> {
  startCell(params: { rowIndex: number; colId: string; keyPress?: string }): boolean;
  startRow(rowIndex: number): boolean;
  isRowActive(rowIndex?: number): boolean;
  stop(options?: { cancel?: boolean }): Promise<boolean>;
  getChanges(): GridChange<TData>[];
  getDirtyRowIds(): string[];
  markSaved(rowIds?: readonly string[]): void;
  rollback(rowIds?: readonly string[]): boolean;
  save(
    handler: SaveChangesHandler<TData>,
    rowIds?: readonly string[]
  ): Promise<GridBatchSaveResult<TData>>;
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
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

/** Filtering owns filter state only; server requests remain in the host query layer. */
export interface GridFilteringApi {
  getModel(): FilterModel;
  setModel(model: FilterModel | null): void;
  getAdvancedModel(): AdvancedFilterModel | null;
  setAdvancedModel(model: AdvancedFilterModel | null): void;
  getQuickText(): string | null;
  setQuickText(text: string | null | undefined): void;
  isPresent(colId?: string): boolean;
}

export interface GridPaginationApi {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  getPage(): number;
  setPage(page: number): void;
  getPageSize(): number;
  setPageSize(size: number): void;
  getPageCount(): number;
  getTotalRowCount(): number;
}

export interface GridSortingApi {
  getModel(): SortModel;
  setModel(model: SortModel | null): void;
}

export interface GridHierarchyApi<TData = any> {
  isRowExpanded(rowId: string): boolean;
  setRowExpanded(rowId: string, expanded: boolean): boolean;
  isTreeRowLoading(rowId: string): boolean;
  loadTreeChildren(rowId: string, options?: { force?: boolean }): Promise<readonly TData[]>;
  isGroupExpanded(groupId: string): boolean;
  setGroupExpanded(groupId: string, expanded: boolean): boolean;
  setAllGroupsExpanded(expanded: boolean): void;
  setAllDetailsExpanded(expanded: boolean): void;
}

export interface GridViewApi<TData = any> {
  getRoot(): HTMLElement | null;
  scrollToRow(index: number, position?: "top" | "bottom" | "middle" | "nearest"): void;
  refreshCells(params?: RefreshCellsParams): void;
  refreshLayout(): void;
  flush(): void;
  setOverlay(type: "loading" | "noRows" | "error" | null): void;
  getPinnedRows(position: "top" | "bottom"): TData[];
  setPinnedRows(position: "top" | "bottom", rows: TData[] | null): void;
}

export interface GridIoApi {
  exportCsv(params?: CsvExportParams): string;
  importCsv(text: string, options?: ImportCsvOptions): boolean;
  print(options?: PrintOptions): boolean;
  copyRange(): Promise<boolean>;
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
  readonly rows: GridRowsApi<TData>;
  readonly columns: GridColumnsApi<TData>;
  readonly selection: GridSelectionApi<TData>;
  readonly editing: GridEditingApi<TData>;
  readonly filtering: GridFilteringApi;
  readonly sorting: GridSortingApi;
  readonly pagination: GridPaginationApi;
  readonly hierarchy: GridHierarchyApi<TData>;
  readonly view: GridViewApi<TData>;
  readonly state: GridStateApi;
  readonly io: GridIoApi;
  readonly diagnostics: GridDiagnosticsApi;
  /** Coalesces model/layout/render work from nested synchronous API calls. */
  batch<TResult>(callback: (api: GridApi<TData>) => TResult): TResult;
  /** Resolves after the first layout frame and gridReady emission. */
  whenReady(): Promise<GridApi<TData>>;
  /** Reads the currently resolved value after application, preset and table overrides. */
  getOption<K extends keyof GridOptions<TData>>(key: K): GridOptions<TData>[K];
  updateOptions(options: Partial<GridOptions<TData>>): void;
  on<K extends GridEventType>(eventType: K, listener: (event: GridEventMap<TData>[K]) => void): () => void;
  destroy(): void;
  isDestroyed(): boolean;
}
