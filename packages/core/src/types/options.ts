import type {
  CellEditorFactory,
  CellRendererFn,
  ColDef,
  ColDefGroup,
  ColumnState,
  FilterModel,
  SortModel
} from "./colDef";
import type { AdvancedFilterModel } from "./advancedFilter";
import type { GridEventMap } from "./events";
import type { CellRendererParams, GetRowIdParams } from "./params";
import type { RowNode } from "./row";
import type { GridStateInput } from "./state";
import type { FieldPath } from "./path";

export interface ColumnStateStore {
  load(key: string): ColumnState[] | null | Promise<ColumnState[] | null>;
  save(key: string, state: ColumnState[]): void | Promise<void>;
}

export interface GridStateStore {
  load(key: string): GridStateInput | null | Promise<GridStateInput | null>;
  save(key: string, state: GridStateInput): void | Promise<void>;
  clear?(key: string): void | Promise<void>;
}

/** Per-grid component overrides. These take precedence over the global registry. */
export interface GridComponents {
  cellRenderers?: Readonly<Record<string, CellRendererFn>>;
  cellEditors?: Readonly<Record<string, CellEditorFactory>>;
}

export interface GridFeatureContext<TData = any> {
  readonly api: import("./api").GridApi<TData>;
  readonly root: HTMLElement;
  getOptions(): Readonly<ResolvedGridOptions<TData>>;
  addEventListener<K extends keyof GridEventMap<TData>>(
    type: K,
    listener: (event: GridEventMap<TData>[K]) => void
  ): () => void;
  /** Registers cleanup even when setup later throws or the feature is hot-replaced. */
  onCleanup(cleanup: () => void): void;
  addManagedDomListener(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): () => void;
  setManagedTimeout(handler: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  createAbortController(): AbortController;
  reportError(error: unknown, source: string, context?: Record<string, unknown>): void;
}

export interface GridFeatureRequirement {
  key: string;
  /** Semver range, for example `>=0.18 <1`, `^0.18.0` or an exact version. */
  version?: string;
}

/** Composable extension point; feature instances are scoped to one grid. */
export interface GridFeature<TData = any> {
  readonly key: string;
  /** Informational extension version exposed through diagnostics. */
  readonly version?: string;
  /** Feature keys that must be initialised before this feature. */
  readonly requires?: readonly (string | GridFeatureRequirement)[];
  /** Mutually exclusive feature keys. Conflicting features are not initialised. */
  readonly conflicts?: readonly string[];
  setup(context: GridFeatureContext<TData>): void | (() => void);
  destroy?(): void;
}

/**
 * Safe overlay content. Strings render as text unless
 * `allowUnsafeOverlayHtml` is explicitly enabled.
 */
export type OverlayContent = string | HTMLElement | import("./params").ICellRendererResult;
export type OverlayTemplate = OverlayContent | (() => OverlayContent);

export type StatusBarPanel = "rowCount" | "selectedRowCount" | "rangeAggregate";

export interface StatusBarConfig {
  panels?: StatusBarPanel[];
}

export interface InfiniteGetRowsParams<TData = any> {
  startRow: number;
  endRow: number;
  sortModel: SortModel;
  filterModel: FilterModel;
  advancedFilterModel: AdvancedFilterModel | null;
  quickFilterText: string | null;
  signal: AbortSignal;
  onSuccess(rows: TData[], lastRow?: number): void;
  fail(reason?: unknown): void;
}

export interface GridDatasource<TData = any> {
  getRows(params: InfiniteGetRowsParams<TData>): void | Promise<void>;
}

export type DatasourceMode = "sequential" | "block";

export interface GridDataProcessorColumn {
  colId: string;
  /** Serializable field path when the column has one. */
  field?: string;
}

export interface GridDataProcessorRow<TData = any> {
  id: string;
  data: TData;
}

export interface GridDataProcessorRequest<TData = any> {
  rows: readonly GridDataProcessorRow<TData>[];
  columns: readonly GridDataProcessorColumn[];
  sortModel: SortModel;
  filterModel: FilterModel;
  advancedFilterModel: AdvancedFilterModel | null;
  quickFilterText: string | null;
  signal: AbortSignal;
}

export interface GridDataProcessorResult {
  /** Filtered and sorted stable row IDs, in final display order. */
  rowIds: readonly string[];
}

/** Optional async/Worker boundary for expensive local filtering and sorting. */
export interface GridDataProcessor<TData = any> {
  process(request: GridDataProcessorRequest<TData>): Promise<GridDataProcessorResult>;
  destroy?(): void;
}

export type EventHandlers<TData = any> = {
  [K in keyof GridEventMap<TData> as `on${Capitalize<K & string>}`]?: (event: GridEventMap<TData>[K]) => void;
};

export type RowSelectionMode = "none" | "single" | "multiple";
export type GridSize = "compact" | "normal" | "large";
export type ColumnLayoutMode = "normal" | "fit";
export type DomLayoutMode = "normal" | "autoHeight";
export type ThemeMode = "light" | "dark" | "auto";
export type GridEditType = "cell" | "fullRow";
export type EditableIndicator = "hover" | "always" | "none";

export interface RowEditValidationParams<TData = any> {
  data: TData;
  node: RowNode<TData>;
  /** Draft values keyed by colId, including unchanged editable cells. */
  values: Readonly<Record<string, unknown>>;
  changes: readonly import("./events").RowEditChange[];
  api: import("./api").GridApi<TData>;
}

export type RowEditValidationResult =
  | true
  | null
  | undefined
  | string
  | Readonly<Record<string, string>>;

export interface DetailRowRendererParams<TData = any> {
  data: TData | null;
  node: RowNode<TData>;
  api: import("./api").GridApi<TData>;
}

export interface TreeDataLoadParams<TData = any> {
  data: TData;
  node: RowNode<TData>;
  api: import("./api").GridApi<TData>;
  signal: AbortSignal;
}

export interface PaginationConfig {
  /** `server` displays the supplied page as-is and uses `total` for navigation. */
  mode?: "client" | "server";
  /** Controlled current page for server mode. */
  page?: number;
  /** Total rows across all server pages. */
  total?: number;
  pageSize?: number;
  pageSizeOptions?: number[];
  showTotal?: boolean;
  showPageSizeSelector?: boolean;
}

export interface WatermarkConfig {
  text: string;
  fontSize?: number;
  color?: string;
  opacity?: number;
  gap?: number;
  angle?: number;
}

export interface ActionPolicyContext<TData = any> {
  /** Stable business action identifier, for example `order.delete`. */
  actionId?: string;
  permissions: readonly string[];
  message?: string;
  params: CellRendererParams<TData>;
}

/**
 * Application-wide UI action policy. This centralises permission, confirmation
 * and error handling while the backend remains the final security boundary.
 */
export interface ActionPolicy<TData = any> {
  canAccess?(context: ActionPolicyContext<TData>): boolean;
  confirm?(context: ActionPolicyContext<TData>): boolean | Promise<boolean>;
  onError?(error: unknown, context: ActionPolicyContext<TData>): void;
}

export interface GridOptions<TData = any> extends EventHandlers<TData> {
  columnDefs?: (ColDef<TData> | ColDefGroup<TData>)[] | null;
  rowData?: TData[] | null;
  defaultColDef?: Partial<ColDef<TData>>;
  /** Reusable semantic column definitions referenced through `colDef.type`. */
  columnTypes?: Readonly<Record<string, Partial<ColDef<TData>>>>;
  getRowId?: (params: GetRowIdParams<TData>) => string;
  /** Stable business key shorthand. `getRowId` takes precedence when both are set. */
  rowKey?: FieldPath<TData> | ((row: TData) => string | number);
  rowHeight?: number;
  headerHeight?: number;
  rowBuffer?: number;
  /** `fit` continuously fills the container without grid-ready glue code. */
  columnLayout?: ColumnLayoutMode;
  /** Enables pointer, double-click and Alt+Arrow column resizing. Disabled by default. */
  enableColumnResize?: boolean;
  /** Lets small grids grow with their rows. Avoid for large or infinite datasets. */
  domLayout?: DomLayoutMode;
  rowSelection?: RowSelectionMode;
  multiSort?: boolean;
  size?: GridSize;
  stripedRows?: boolean;
  showCellBorders?: boolean;
  theme?: ThemeMode;
  quickFilterText?: string | null;
  /** Nested AND/OR filter expression, safe for local evaluation and backend serialization. */
  advancedFilterModel?: AdvancedFilterModel | null;
  masterDetail?: boolean;
  detailRowHeight?: number;
  detailRowRenderer?: (params: DetailRowRendererParams<TData>) => string | HTMLElement | import("./params").ICellRendererResult | null | undefined;
  isRowExpandable?: (params: DetailRowRendererParams<TData>) => boolean;
  detailToggleColumn?: boolean;
  columnMenu?: boolean;
  columnStateKey?: string | null;
  columnStateStore?: ColumnStateStore;
  aggFuncs?: Record<string, (values: any[]) => any>;
  components?: GridComponents;
  /** Shared policy consumed by action column helpers. */
  actionPolicy?: ActionPolicy<TData>;
  features?: readonly GridFeature<TData>[];
  /** State restored atomically after columns and initial rows are available. */
  initialState?: GridStateInput;
  /** Persist the complete user-visible GridState with a versioned store. */
  stateKey?: string | null;
  stateStore?: GridStateStore;
  stateSaveDebounceMs?: number;
  locale?: import("../lib/locale").RgLocale;
  /** Cell editing is isolated; fullRow stages every editable cell and commits them together. */
  editType?: GridEditType;
  /** Visibility of the subtle pencil affordance on editable cells. */
  editableIndicator?: EditableIndicator;
  /** Cross-field full-row validation. Return a message or a colId -> message map. */
  rowEditValidator?: (
    params: RowEditValidationParams<TData>
  ) => RowEditValidationResult | Promise<RowEditValidationResult>;
  singleClickEdit?: boolean;
  manualSorting?: boolean;
  manualFiltering?: boolean;
  showSummary?: boolean;
  summaryMethod?: (params: { colId: string; column: import("../services/column").Column<any>; values: any[] }) => string;
  treeData?: boolean;
  childrenKey?: string;
  /** Marks rows that can load children even when `childrenKey` is currently empty. */
  isTreeRowExpandable?: (params: Omit<TreeDataLoadParams<TData>, "signal">) => boolean;
  /** Loads children once on first expansion; use the API retry/force methods to reload. */
  loadTreeChildren?: (params: TreeDataLoadParams<TData>) => Promise<readonly TData[]>;
  autoCheckedChildren?: boolean;
  defaultExpandAll?: boolean;
  indexOffset?: number;
  applyRowDrag?: boolean;
  undoStackSize?: number;
  /** Milliseconds used to coalesce applyTransactionAsync calls. */
  asyncTransactionWaitMillis?: number;
  getRowHeight?: (params: import("./params").GetRowHeightParams<TData>) => number;
  pinnedTopRowData?: TData[] | null;
  pinnedBottomRowData?: TData[] | null;
  pagination?: boolean | PaginationConfig;
  watermark?: boolean | WatermarkConfig;
  suppressWarnings?: boolean;
  enableRangeSelection?: boolean;
  suppressClipboard?: boolean;
  contextMenu?: boolean;
  getContextMenuItems?: (params: import("./params").ContextMenuParams<TData>) => import("./params").ContextMenuItem[] | null;
  tooltipComponent?: (params: import("./params").TooltipParams<TData>) => string | HTMLElement;
  tooltipShowDelay?: number;
  flashCells?: boolean;
  fillHandle?: boolean;
  statusBar?: boolean | StatusBarConfig;
  datasource?: GridDatasource<TData>;
  /** Sequential append is the compatibility default; block enables random-access cached loading. */
  datasourceMode?: DatasourceMode;
  blockSize?: number;
  infiniteBufferRows?: number;
  /** Maximum retained blocks in random-access mode. */
  maxBlocksInCache?: number;
  /** Number of adjacent blocks prefetched around a requested viewport. */
  blockPrefetch?: number;
  /** Optional initial total enables immediate scrollbar range before the first response. */
  datasourceRowCount?: number;
  /** Opt-in async processor for large local filter/sort pipelines. */
  dataProcessor?: GridDataProcessor<TData>;
  /** Minimum local row count before dataProcessor is used. Defaults to 5,000. */
  dataProcessorMinRows?: number;
  /** Number of automatic retries after an infinite datasource request fails. */
  datasourceRetryCount?: number;
  /** Base retry delay in milliseconds. Retries use capped exponential backoff. */
  datasourceRetryDelay?: number;
  suppressCellFocus?: boolean;
  suppressRowHoverHighlight?: boolean;
  suppressNoRowsOverlay?: boolean;
  suppressHeaderFocus?: boolean;
  /** Accessible name applied to the element with role="grid"/"treegrid". */
  ariaLabel?: string;
  /** ID of an external element that labels the grid. Takes precedence over ariaLabel. */
  ariaLabelledBy?: string;
  /** ID of an external element that provides additional grid instructions. */
  ariaDescribedBy?: string;
  loading?: boolean;
  /** Non-null errors take precedence over the empty state and remain retryable by the host. */
  error?: unknown | null;
  overlayNoRowsTemplate?: OverlayTemplate;
  overlayLoadingTemplate?: OverlayTemplate;
  overlayErrorTemplate?: OverlayTemplate;
  /** Opt in only for trusted overlay strings. Prefer HTMLElement factories. */
  allowUnsafeOverlayHtml?: boolean;
  className?: string;
}

export interface ResolvedGridOptions<TData = any> extends EventHandlers<TData> {
  columnDefs: (ColDef<TData> | ColDefGroup<TData>)[];
  rowData: TData[];
  defaultColDef: Partial<ColDef<TData>>;
  columnTypes: Readonly<Record<string, Partial<ColDef<TData>>>>;
  getRowId?: (params: GetRowIdParams<TData>) => string;
  rowKey?: FieldPath<TData> | ((row: TData) => string | number);
  rowHeight: number;
  headerHeight: number;
  rowBuffer: number;
  columnLayout: ColumnLayoutMode;
  enableColumnResize: boolean;
  domLayout: DomLayoutMode;
  rowSelection: RowSelectionMode;
  multiSort: boolean;
  size: GridSize;
  stripedRows: boolean;
  showCellBorders: boolean;
  theme: ThemeMode;
  quickFilterText: string | null;
  advancedFilterModel: AdvancedFilterModel | null;
  masterDetail: boolean;
  detailRowHeight: number;
  detailRowRenderer?: (params: DetailRowRendererParams<TData>) => string | HTMLElement | import("./params").ICellRendererResult | null | undefined;
  isRowExpandable?: (params: DetailRowRendererParams<TData>) => boolean;
  detailToggleColumn: boolean;
  columnMenu: boolean;
  columnStateKey: string | null;
  columnStateStore?: ColumnStateStore;
  aggFuncs?: Record<string, (values: any[]) => any>;
  components?: GridComponents;
  actionPolicy?: ActionPolicy<TData>;
  features: readonly GridFeature<TData>[];
  initialState?: GridStateInput;
  stateKey: string | null;
  stateStore?: GridStateStore;
  stateSaveDebounceMs: number;
  locale: import("../lib/locale").RgLocale;
  editType: GridEditType;
  editableIndicator: EditableIndicator;
  rowEditValidator?: (
    params: RowEditValidationParams<TData>
  ) => RowEditValidationResult | Promise<RowEditValidationResult>;
  singleClickEdit: boolean;
  manualSorting: boolean;
  manualFiltering: boolean;
  showSummary: boolean;
  summaryMethod?: (params: { colId: string; column: import("../services/column").Column<any>; values: any[] }) => string;
  treeData: boolean;
  childrenKey: string;
  isTreeRowExpandable?: (params: Omit<TreeDataLoadParams<TData>, "signal">) => boolean;
  loadTreeChildren?: (params: TreeDataLoadParams<TData>) => Promise<readonly TData[]>;
  autoCheckedChildren: boolean;
  defaultExpandAll: boolean;
  indexOffset: number;
  applyRowDrag: boolean;
  undoStackSize: number;
  asyncTransactionWaitMillis: number;
  getRowHeight?: (params: import("./params").GetRowHeightParams<TData>) => number;
  pinnedTopRowData: TData[];
  pinnedBottomRowData: TData[];
  paginationEnabled: boolean;
  paginationMode: "client" | "server";
  paginationPage: number;
  paginationTotal: number;
  paginationPageSize: number;
  paginationPageSizeOptions: number[];
  paginationShowTotal: boolean;
  paginationShowSizeSelector: boolean;
  watermarkEnabled: boolean;
  watermarkConfig: WatermarkConfig | null;
  suppressWarnings: boolean;
  enableRangeSelection: boolean;
  suppressClipboard: boolean;
  contextMenu: boolean;
  getContextMenuItems?: (params: import("./params").ContextMenuParams<TData>) => import("./params").ContextMenuItem[] | null;
  tooltipComponent?: (params: import("./params").TooltipParams<TData>) => string | HTMLElement;
  tooltipShowDelay: number;
  flashCells: boolean;
  fillHandle: boolean;
  statusBarEnabled: boolean;
  statusBarPanels: StatusBarPanel[];
  datasource?: GridDatasource<TData>;
  datasourceMode: DatasourceMode;
  blockSize: number;
  infiniteBufferRows: number;
  maxBlocksInCache: number;
  blockPrefetch: number;
  datasourceRowCount: number | null;
  dataProcessor?: GridDataProcessor<TData>;
  dataProcessorMinRows: number;
  datasourceRetryCount: number;
  datasourceRetryDelay: number;
  suppressCellFocus: boolean;
  suppressRowHoverHighlight: boolean;
  suppressNoRowsOverlay: boolean;
  suppressHeaderFocus: boolean;
  ariaLabel: string;
  ariaLabelledBy: string;
  ariaDescribedBy: string;
  loading: boolean;
  error: unknown | null;
  overlayNoRowsTemplate: OverlayTemplate;
  overlayLoadingTemplate: OverlayTemplate;
  overlayErrorTemplate: OverlayTemplate;
  allowUnsafeOverlayHtml: boolean;
  className: string;
}
