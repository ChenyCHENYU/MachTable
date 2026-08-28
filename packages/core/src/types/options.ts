import type {
  CellEditorFactory,
  CellRendererFn,
  ColDef,
  ColDefGroup,
  ColumnState,
  FilterModel,
  SortModel
} from "./colDef";
import type { GridEventMap } from "./events";
import type { GetRowIdParams } from "./params";
import type { RowNode } from "./row";
import type { GridState } from "./state";

export interface ColumnStateStore {
  load(key: string): ColumnState[] | null | Promise<ColumnState[] | null>;
  save(key: string, state: ColumnState[]): void | Promise<void>;
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
  reportError(error: unknown, source: string, context?: Record<string, unknown>): void;
}

/** Composable extension point; feature instances are scoped to one grid. */
export interface GridFeature<TData = any> {
  readonly key: string;
  setup(context: GridFeatureContext<TData>): void | (() => void);
  destroy?(): void;
}

/**
 * Safe overlay content. Strings render as text unless
 * `allowUnsafeOverlayHtml` is explicitly enabled.
 */
export type OverlayTemplate = string | HTMLElement | (() => string | HTMLElement);

export type StatusBarPanel = "rowCount" | "selectedRowCount" | "rangeAggregate";

export interface StatusBarConfig {
  panels?: StatusBarPanel[];
}

export interface InfiniteGetRowsParams<TData = any> {
  startRow: number;
  endRow: number;
  sortModel: SortModel;
  filterModel: FilterModel;
  quickFilterText: string | null;
  signal: AbortSignal;
  onSuccess(rows: TData[], lastRow?: number): void;
  fail(reason?: unknown): void;
}

export interface GridDatasource<TData = any> {
  getRows(params: InfiniteGetRowsParams<TData>): void | Promise<void>;
}

export type EventHandlers<TData = any> = {
  [K in keyof GridEventMap<TData> as `on${Capitalize<K & string>}`]?: (event: GridEventMap<TData>[K]) => void;
};

export type RowSelectionMode = "none" | "single" | "multiple";
export type GridSize = "compact" | "normal" | "large";
export type ThemeMode = "light" | "dark" | "auto";

export interface DetailRowRendererParams<TData = any> {
  data: TData | null;
  node: RowNode<TData>;
  api: import("./api").GridApi<TData>;
}

export interface PaginationConfig {
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

export interface GridOptions<TData = any> extends EventHandlers<TData> {
  columnDefs?: (ColDef<TData> | ColDefGroup<TData>)[] | null;
  rowData?: TData[] | null;
  defaultColDef?: Partial<ColDef<TData>>;
  getRowId?: (params: GetRowIdParams<TData>) => string;
  rowHeight?: number;
  headerHeight?: number;
  rowBuffer?: number;
  rowSelection?: RowSelectionMode;
  multiSort?: boolean;
  size?: GridSize;
  stripedRows?: boolean;
  showCellBorders?: boolean;
  theme?: ThemeMode;
  quickFilterText?: string | null;
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
  features?: readonly GridFeature<TData>[];
  /** State restored atomically after columns and initial rows are available. */
  initialState?: GridState;
  locale?: import("../lib/locale").RgLocale;
  singleClickEdit?: boolean;
  manualSorting?: boolean;
  manualFiltering?: boolean;
  showSummary?: boolean;
  summaryMethod?: (params: { colId: string; column: import("../services/column").Column<any>; values: any[] }) => string;
  treeData?: boolean;
  childrenKey?: string;
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
  blockSize?: number;
  infiniteBufferRows?: number;
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
  overlayNoRowsTemplate?: OverlayTemplate;
  overlayLoadingTemplate?: OverlayTemplate;
  /** Opt in only for trusted overlay strings. Prefer HTMLElement factories. */
  allowUnsafeOverlayHtml?: boolean;
  className?: string;
}

export interface ResolvedGridOptions<TData = any> extends EventHandlers<TData> {
  columnDefs: (ColDef<TData> | ColDefGroup<TData>)[];
  rowData: TData[];
  defaultColDef: Partial<ColDef<TData>>;
  getRowId?: (params: GetRowIdParams<TData>) => string;
  rowHeight: number;
  headerHeight: number;
  rowBuffer: number;
  rowSelection: RowSelectionMode;
  multiSort: boolean;
  size: GridSize;
  stripedRows: boolean;
  showCellBorders: boolean;
  theme: ThemeMode;
  quickFilterText: string | null;
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
  features: readonly GridFeature<TData>[];
  initialState?: GridState;
  locale: import("../lib/locale").RgLocale;
  singleClickEdit: boolean;
  manualSorting: boolean;
  manualFiltering: boolean;
  showSummary: boolean;
  summaryMethod?: (params: { colId: string; column: import("../services/column").Column<any>; values: any[] }) => string;
  treeData: boolean;
  childrenKey: string;
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
  blockSize: number;
  infiniteBufferRows: number;
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
  overlayNoRowsTemplate: OverlayTemplate;
  overlayLoadingTemplate: OverlayTemplate;
  allowUnsafeOverlayHtml: boolean;
  className: string;
}
