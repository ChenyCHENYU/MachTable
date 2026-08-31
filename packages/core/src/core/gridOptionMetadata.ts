import type { GridOptions } from "../types/options";
import type { GridEventType } from "../types/events";

export type GridOptionValueKind =
  | "array"
  | "boolean"
  | "boolean-object"
  | "function"
  | "number"
  | "object"
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
export const GRID_OPTION_META = {
  columnDefs: { kind: "array", update: "columnDefs" },
  rowData: { kind: "array", update: "rowData" },
  defaultColDef: { kind: "object", update: "options" },
  columnTypes: { kind: "object", update: "options" },
  getRowId: { kind: "function", update: "options" },
  rowKey: { kind: "unknown", update: "options" },
  rowHeight: { kind: "number", update: "options" },
  headerHeight: { kind: "number", update: "options" },
  rowBuffer: { kind: "number", update: "options" },
  columnLayout: { kind: "string", update: "options" },
  enableColumnResize: { kind: "boolean", update: "options" },
  domLayout: { kind: "string", update: "options" },
  rowSelection: { kind: "string", update: "options" },
  multiSort: { kind: "boolean", update: "options" },
  size: { kind: "string", update: "options" },
  stripedRows: { kind: "boolean", update: "options" },
  showCellBorders: { kind: "boolean", update: "options" },
  theme: { kind: "string", update: "options" },
  quickFilterText: { kind: "string", update: "quickFilter" },
  advancedFilterModel: { kind: "object", update: "options" },
  masterDetail: { kind: "boolean", update: "options" },
  detailRowHeight: { kind: "number", update: "options" },
  detailRowRenderer: { kind: "function", update: "options" },
  isRowExpandable: { kind: "function", update: "options" },
  detailToggleColumn: { kind: "boolean", update: "options" },
  columnMenu: { kind: "boolean", update: "options" },
  columnStateKey: { kind: "string", update: "options" },
  columnStateStore: { kind: "object", update: "options" },
  aggFuncs: { kind: "object", update: "options" },
  components: { kind: "object", update: "options" },
  actionPolicy: { kind: "object", update: "options" },
  features: { kind: "array", update: "options" },
  initialState: { kind: "object", update: "options" },
  stateKey: { kind: "string", update: "options" },
  stateStore: { kind: "object", update: "options" },
  stateSaveDebounceMs: { kind: "number", update: "options" },
  locale: { kind: "object", update: "options" },
  editType: { kind: "string", update: "options" },
  editableIndicator: { kind: "string", update: "options" },
  rowEditValidator: { kind: "function", update: "options" },
  singleClickEdit: { kind: "boolean", update: "options" },
  manualSorting: { kind: "boolean", update: "options" },
  manualFiltering: { kind: "boolean", update: "options" },
  showSummary: { kind: "boolean", update: "options" },
  summaryMethod: { kind: "function", update: "options" },
  treeData: { kind: "boolean", update: "options" },
  childrenKey: { kind: "string", update: "options" },
  isTreeRowExpandable: { kind: "function", update: "options" },
  loadTreeChildren: { kind: "function", update: "options" },
  autoCheckedChildren: { kind: "boolean", update: "options" },
  defaultExpandAll: { kind: "boolean", update: "options" },
  indexOffset: { kind: "number", update: "options" },
  applyRowDrag: { kind: "boolean", update: "options" },
  undoStackSize: { kind: "number", update: "options" },
  asyncTransactionWaitMillis: { kind: "number", update: "options" },
  getRowHeight: { kind: "function", update: "options" },
  pinnedTopRowData: { kind: "array", update: "options" },
  pinnedBottomRowData: { kind: "array", update: "options" },
  pagination: { kind: "boolean-object", update: "options" },
  watermark: { kind: "boolean-object", update: "options" },
  suppressWarnings: { kind: "boolean", update: "options" },
  enableRangeSelection: { kind: "boolean", update: "options" },
  suppressClipboard: { kind: "boolean", update: "options" },
  contextMenu: { kind: "boolean", update: "options" },
  getContextMenuItems: { kind: "function", update: "options" },
  tooltipComponent: { kind: "function", update: "options" },
  tooltipShowDelay: { kind: "number", update: "options" },
  flashCells: { kind: "boolean", update: "options" },
  fillHandle: { kind: "boolean", update: "options" },
  statusBar: { kind: "boolean-object", update: "options" },
  datasource: { kind: "object", update: "options" },
  datasourceMode: { kind: "string", update: "options" },
  blockSize: { kind: "number", update: "options" },
  infiniteBufferRows: { kind: "number", update: "options" },
  maxBlocksInCache: { kind: "number", update: "options" },
  blockPrefetch: { kind: "number", update: "options" },
  datasourceRowCount: { kind: "number", update: "options" },
  dataProcessor: { kind: "object", update: "options" },
  dataProcessorMinRows: { kind: "number", update: "options" },
  datasourceRetryCount: { kind: "number", update: "options" },
  datasourceRetryDelay: { kind: "number", update: "options" },
  suppressCellFocus: { kind: "boolean", update: "options" },
  suppressRowHoverHighlight: { kind: "boolean", update: "options" },
  suppressNoRowsOverlay: { kind: "boolean", update: "options" },
  suppressHeaderFocus: { kind: "boolean", update: "options" },
  ariaLabel: { kind: "string", update: "options" },
  ariaLabelledBy: { kind: "string", update: "options" },
  ariaDescribedBy: { kind: "string", update: "options" },
  loading: { kind: "boolean", update: "options" },
  error: { kind: "unknown", update: "options" },
  overlayNoRowsTemplate: { kind: "unknown", update: "options" },
  overlayLoadingTemplate: { kind: "unknown", update: "options" },
  overlayErrorTemplate: { kind: "unknown", update: "options" },
  allowUnsafeOverlayHtml: { kind: "boolean", update: "options" },
  className: { kind: "string", update: "options" }
} as const satisfies { [K in GridOptionKey]: GridOptionMetadata };

export const GRID_OPTION_KEYS = Object.freeze(Object.keys(GRID_OPTION_META) as GridOptionKey[]);

export const DIRECT_GRID_OPTION_KEYS = Object.freeze(
  GRID_OPTION_KEYS.filter((key) => GRID_OPTION_META[key].update === "options")
);
