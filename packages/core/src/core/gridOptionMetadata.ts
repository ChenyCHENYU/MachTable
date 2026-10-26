import type { GridOptions } from "../types/options";
import type { GridEventType } from "../types/events";

export type GridOptionValueKind =
  | "array"
  | "boolean"
  | "boolean-object"
  | "function"
  | "number"
  | "object"
  | "object-function"
  | "string"
  | "unknown";

export type GridOptionUpdateMode = "columnDefs" | "options" | "quickFilter" | "rowData";

export interface GridOptionMetadata {
  /** Runtime value category used by framework adapters. */
  kind: GridOptionValueKind;
  /** How a changed framework prop is forwarded to GridApi. */
  update: GridOptionUpdateMode;
}

type EventOptionKey = `on${Capitalize<GridEventType>}`;
export type GridOptionKey = Exclude<keyof GridOptions<any>, EventOptionKey>;

/**
 * Runtime single source of truth for every non-event GridOptions property.
 *
 * The mapped `satisfies` type intentionally makes adding a GridOptions field a
 * compile error until its adapter/update behavior is declared here.
 */
export const GRID_OPTION_KINDS = {
  columnDefs: "array",
  rowData: "array",
  defaultColDef: "object",
  columnTypes: "object",
  rowKey: "unknown",
  rowHeight: "number",
  headerHeight: "number",
  rowBuffer: "number",
  columnLayout: "string",
  enableColumnResize: "boolean",
  domLayout: "string",
  rowSelection: "string",
  multiSort: "boolean",
  size: "string",
  stripedRows: "boolean",
  rowStyleRules: "array",
  showCellBorders: "boolean",
  theme: "string",
  quickFilterText: "string",
  advancedFilterModel: "object",
  masterDetail: "boolean",
  detailRowHeight: "number",
  detailRowRenderer: "function",
  isRowExpandable: "function",
  detailToggleColumn: "boolean",
  columnMenu: "boolean",
  aggFuncs: "object",
  components: "object",
  actionPolicy: "object",
  features: "array",
  initialState: "object",
  persistence: "boolean-object",
  locale: "object",
  editType: "string",
  editableIndicator: "string",
  rowEditValidator: "function",
  singleClickEdit: "boolean",
  manualSorting: "boolean",
  manualFiltering: "boolean",
  showSummary: "boolean",
  summaryMethod: "function",
  treeData: "boolean",
  childrenKey: "string",
  isTreeRowExpandable: "function",
  loadTreeChildren: "function",
  autoCheckedChildren: "boolean",
  defaultExpandAll: "boolean",
  indexOffset: "number",
  applyRowDrag: "boolean",
  rowDragPolicy: "object",
  undoStackSize: "number",
  asyncTransactionWaitMillis: "number",
  getRowHeight: "function",
  pinnedTopRowData: "array",
  pinnedBottomRowData: "array",
  pagination: "boolean-object",
  watermark: "boolean-object",
  suppressWarnings: "boolean",
  enableRangeSelection: "boolean",
  suppressClipboard: "boolean",
  contextMenu: "boolean",
  getContextMenuItems: "function",
  tooltipComponent: "function",
  tooltipShowDelay: "number",
  flashCells: "boolean",
  fillHandle: "boolean",
  statusBar: "boolean-object",
  datasource: "object",
  datasourceMode: "string",
  blockSize: "number",
  infiniteBufferRows: "number",
  maxBlocksInCache: "number",
  datasourceMaxConcurrentRequests: "number",
  blockPrefetch: "number",
  datasourceRowCount: "number",
  dataProcessor: "object-function",
  dataProcessorMinRows: "number",
  datasourceRetryCount: "number",
  datasourceRetryDelay: "number",
  datasourceRetryJitter: "number",
  suppressCellFocus: "boolean",
  suppressRowHoverHighlight: "boolean",
  suppressNoRowsOverlay: "boolean",
  suppressHeaderFocus: "boolean",
  ariaLabel: "string",
  ariaLabelledBy: "string",
  ariaDescribedBy: "string",
  loading: "boolean",
  error: "unknown",
  overlayNoRowsTemplate: "unknown",
  overlayLoadingTemplate: "unknown",
  overlayErrorTemplate: "unknown",
  allowUnsafeOverlayHtml: "boolean",
  className: "string",
} as const satisfies { [K in GridOptionKey]: GridOptionValueKind };

type UpdateMode<K extends GridOptionKey> = K extends "columnDefs" | "rowData" ? K
  : K extends "quickFilterText" ? "quickFilter" : "options";

// Three direct adapters are special; all other values use the options domain.
function createAdapterMetadata() {
  return Object.fromEntries(Object.entries(GRID_OPTION_KINDS).map(([key, kind]) => [key, {
    kind, update: key === "columnDefs" || key === "rowData" ? key : key === "quickFilterText" ? "quickFilter" : "options"
  }])) as { readonly [K in GridOptionKey]: { readonly kind: typeof GRID_OPTION_KINDS[K]; readonly update: UpdateMode<K> } };
}
// Core validates kinds directly; only framework adapters need update routing.
// This static derivation has no external effects and can leave the Core graph.
export const GRID_OPTION_META = /* @__PURE__ */ createAdapterMetadata();

export const GRID_OPTION_KEYS = Object.freeze(Object.keys(GRID_OPTION_KINDS) as GridOptionKey[]);
