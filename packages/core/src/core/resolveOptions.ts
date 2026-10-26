import type { GridOptions, GridSize, ResolvedGridOptions } from "../types/options";
import type { ColDef } from "../types/colDef";
import { getByPath } from "../lib/path";
import { normalizeAdvancedFilterModel } from "../lib/advancedFilter";
import { normalizeFinite, normalizePersistence } from "../lib/optionValues";

export const DEFAULT_COL_DEF: Partial<ColDef> = {
  align: "center",
  sortable: true,
  resizable: true,
  movable: true,
  filter: false,
  minWidth: 80
};

export interface GridSizePreset {
  rowHeight: number;
  headerHeight: number;
  fontSize: number;
  cellPadding: number;
}

export const GRID_SIZE_PRESETS: Record<GridSize, GridSizePreset> = {
  compact: { rowHeight: 30, headerHeight: 34, fontSize: 12, cellPadding: 6 },
  normal: { rowHeight: 36, headerHeight: 40, fontSize: 13, cellPadding: 9 },
  large: { rowHeight: 44, headerHeight: 48, fontSize: 14, cellPadding: 12 }
};

// Primitive defaults share one immutable schema; object defaults remain grid-local.
export const VALUE_DEFAULTS = {
  multiSort: true,
  stripedRows: false,
  showCellBorders: false,
  quickFilterText: null,
  suppressCellFocus: false,
  suppressRowHoverHighlight: false,
  suppressNoRowsOverlay: false,
  suppressHeaderFocus: false,
  loading: false,
  error: null,
  className: "",
  singleClickEdit: false,
  manualSorting: false,
  manualFiltering: false,
  showSummary: false,
  indexOffset: 0,
  applyRowDrag: true,
  masterDetail: false,
  detailToggleColumn: true,
  treeData: false,
  childrenKey: "children",
  autoCheckedChildren: true,
  defaultExpandAll: false,
  columnMenu: false,
  suppressWarnings: false,
  enableRangeSelection: false,
  suppressClipboard: false,
  contextMenu: false,
  flashCells: true,
  fillHandle: true,
  ariaLabel: "MachTable data grid",
  ariaLabelledBy: "",
  ariaDescribedBy: "",
  overlayNoRowsTemplate: "",
  overlayLoadingTemplate: "",
  overlayErrorTemplate: "",
  allowUnsafeOverlayHtml: false,
} as const;
const VALUE_DEFAULT_KEYS = Object.keys(VALUE_DEFAULTS) as (keyof typeof VALUE_DEFAULTS)[];

function resolveValueDefaults(options: GridOptions): Pick<ResolvedGridOptions, keyof typeof VALUE_DEFAULTS> {
  const values: Record<string, unknown> = {};
  for (const key of VALUE_DEFAULT_KEYS) values[key] = options[key] ?? VALUE_DEFAULTS[key];
  return values as Pick<ResolvedGridOptions, keyof typeof VALUE_DEFAULTS>;
}

function finiteAtLeast(value: unknown, fallback: number, min: number, integer = false): number {
  return normalizeFinite(value, min, integer) ?? fallback;
}

function resolveSize(value: GridOptions["size"]): GridSize {
  return value && Object.prototype.hasOwnProperty.call(GRID_SIZE_PRESETS, value) ? value : "normal";
}

function resolveTheme(options: GridOptions): ResolvedGridOptions["theme"] {
  if (options.theme === "light" || options.theme === "dark" || options.theme === "auto") return options.theme;
  return "light";
}

function resolvePageSizeOptions<TData>(options: GridOptions<TData>, pageSize: number): number[] {
  const requested =
    typeof options.pagination === "object" && Array.isArray(options.pagination.pageSizeOptions)
      ? options.pagination.pageSizeOptions
      : undefined;
  const values = requested
    ? [...new Set(requested.map((value) => finiteAtLeast(value, 0, 1, true)).filter(Boolean))]
    : [10, 20, 50, 100];
  if (!values.includes(pageSize)) values.push(pageSize);
  return values.sort((left, right) => left - right);
}

export function rowIdFromKey<TData>(rowKey: NonNullable<GridOptions<TData>["rowKey"]>, data: TData): string {
  const value = typeof rowKey === "function" ? rowKey(data) : getByPath(data, rowKey);
  return value == null ? "" : String(value);
}

function resolveRowIdentity<TData>(options: GridOptions<TData>): Pick<ResolvedGridOptions<TData>, "resolveRowId" | "rowKey"> {
  const rowKey = options.rowKey;
  const resolveRowId = rowKey
    ? ({ data }: { data: TData }) => rowIdFromKey(rowKey, data)
    : undefined;
  return {
    ...(resolveRowId ? { resolveRowId } : {}),
    ...(rowKey ? { rowKey } : {})
  };
}

function resolveDataAndLayout<TData>(options: GridOptions<TData>, size: GridSize) {
  const preset = GRID_SIZE_PRESETS[size];
  return {
    columnDefs: Array.isArray(options.columnDefs) ? options.columnDefs : [],
    rowData: Array.isArray(options.rowData) ? options.rowData : [],
    defaultColDef: { ...DEFAULT_COL_DEF, ...(options.defaultColDef ?? {}) },
    columnTypes: options.columnTypes ?? {},
    ...resolveRowIdentity(options),
    rowHeight: finiteAtLeast(options.rowHeight, preset.rowHeight, 1),
    headerHeight: finiteAtLeast(options.headerHeight, preset.headerHeight, 1),
    rowBuffer: finiteAtLeast(options.rowBuffer, 8, 0, true),
    columnLayout: options.columnLayout === "fit" ? "fit" as const : "normal" as const,
    enableColumnResize: options.enableColumnResize === true,
    domLayout: options.domLayout === "autoHeight" ? "autoHeight" as const : "normal" as const,
    rowSelection:
      options.rowSelection === "single" || options.rowSelection === "multiple"
        ? options.rowSelection
        : "none" as const,
    size,
    pinnedTopRowData: Array.isArray(options.pinnedTopRowData) ? options.pinnedTopRowData : [],
    pinnedBottomRowData: Array.isArray(options.pinnedBottomRowData) ? options.pinnedBottomRowData : []
  };
}

function resolveAppearance(options: GridOptions) {
  return {
    rowStyleRules: Array.isArray(options.rowStyleRules) ? options.rowStyleRules : [],
    theme: resolveTheme(options),
  };
}

function resolveEditingAndHistory(options: GridOptions) {
  return {
    editType: options.editType === "fullRow" ? "fullRow" as const : "cell" as const,
    editableIndicator:
      options.editableIndicator === "always" || options.editableIndicator === "none"
        ? options.editableIndicator
        : "hover" as const,
    rowDragPolicy: options.rowDragPolicy,
    undoStackSize: finiteAtLeast(options.undoStackSize, 100, 0, true),
    asyncTransactionWaitMillis: finiteAtLeast(options.asyncTransactionWaitMillis, 16, 0, true)
  };
}

function resolveHierarchy(options: GridOptions) {
  return {
    detailRowHeight: finiteAtLeast(options.detailRowHeight, 240, 1),
  };
}

function resolvePagination<TData>(options: GridOptions<TData>) {
  const config = typeof options.pagination === "object" ? options.pagination : undefined;
  const pageSize = finiteAtLeast(
    config?.pageSize,
    20,
    1,
    true
  );
  return {
    paginationEnabled: options.pagination !== false && options.datasource == null,
    paginationMode: config?.mode === "server" ? "server" as const : "client" as const,
    paginationPage: finiteAtLeast(config?.page, 1, 1, true),
    paginationTotal: finiteAtLeast(config?.total, 0, 0, true),
    paginationPageSize: pageSize,
    paginationPageSizeOptions: resolvePageSizeOptions(options, pageSize),
    paginationShowTotal: config ? config.showTotal !== false : true,
    paginationShowSizeSelector: config ? config.showPageSizeSelector !== false : true
  };
}

export function resolveWatermark(options: GridOptions) {
  return {
    watermarkEnabled: options.watermark != null && options.watermark !== false,
    watermarkConfig:
      options.watermark == null || options.watermark === false
        ? null
        : options.watermark === true
          ? { text: "MachTable" }
          : options.watermark
  };
}

function resolveInteraction(options: GridOptions) {
  return {
    advancedFilterModel: normalizeAdvancedFilterModel(options.advancedFilterModel),
    persistence: normalizePersistence(options.persistence),
    locale: options.locale ?? {},
    tooltipShowDelay: finiteAtLeast(options.tooltipShowDelay, 600, 0),
    statusBarEnabled:
      options.statusBar === true || (typeof options.statusBar === "object" && options.statusBar != null),
    statusBarPanels:
      typeof options.statusBar === "object" && options.statusBar?.panels
        ? options.statusBar.panels
        : ["rowCount", "selectedRowCount", "rangeAggregate"] as const
  };
}

function resolveDatasource(options: GridOptions) {
  return {
    datasourceMode: options.datasourceMode === "block" ? "block" as const : "sequential" as const,
    blockSize: finiteAtLeast(options.blockSize, 100, 1, true),
    infiniteBufferRows: finiteAtLeast(options.infiniteBufferRows, 40, 0, true),
    maxBlocksInCache: finiteAtLeast(options.maxBlocksInCache, 12, 1, true),
    datasourceMaxConcurrentRequests: finiteAtLeast(options.datasourceMaxConcurrentRequests, 4, 1, true),
    blockPrefetch: finiteAtLeast(options.blockPrefetch, 1, 0, true),
    datasourceRowCount: options.datasourceRowCount == null
      ? null
      : finiteAtLeast(options.datasourceRowCount, 0, 0, true),
    dataProcessorMinRows: finiteAtLeast(options.dataProcessorMinRows, 5_000, 1, true),
    datasourceRetryCount: finiteAtLeast(options.datasourceRetryCount, 2, 0, true),
    datasourceRetryDelay: finiteAtLeast(options.datasourceRetryDelay, 300, 0, true),
    datasourceRetryJitter: Math.min(1, finiteAtLeast(options.datasourceRetryJitter, 0.15, 0))
  };
}

const OPTIONAL_OPTION_KEYS = [
  "detailRowRenderer",
  "isRowExpandable",
  "aggFuncs",
  "components",
  "actionPolicy",
  "summaryMethod",
  "datasource",
  "getRowHeight",
  "tooltipComponent",
  "getContextMenuItems",
  "initialState",
  "rowEditValidator",
  "isTreeRowExpandable",
  "loadTreeChildren",
  "dataProcessor"
] as const;

function copyOptionalOptions<TData>(
  source: GridOptions<TData>,
  target: ResolvedGridOptions<TData>
): void {
  for (const key of OPTIONAL_OPTION_KEYS) {
    if (source[key]) Reflect.set(target, key, source[key]);
  }
}

function copyEventHandlers<TData>(source: GridOptions<TData>, target: ResolvedGridOptions<TData>): void {
  for (const key of Object.keys(source) as (keyof GridOptions<TData>)[]) {
    if (key.startsWith("on") && typeof source[key] === "function") {
      Reflect.set(target, key, source[key]);
    }
  }
}

export function resolveOptions<TData>(userOptions: GridOptions<TData>): ResolvedGridOptions<TData> {
  const size = resolveSize(userOptions.size);
  const resolved = {
    ...resolveValueDefaults(userOptions),
    ...resolveDataAndLayout(userOptions, size),
    ...resolveAppearance(userOptions),
    ...resolveEditingAndHistory(userOptions),
    ...resolveHierarchy(userOptions),
    ...resolvePagination(userOptions),
    ...resolveWatermark(userOptions),
    ...resolveInteraction(userOptions),
    ...resolveDatasource(userOptions),
    features: Array.isArray(userOptions.features) ? userOptions.features : []
  } as ResolvedGridOptions<TData>;

  copyOptionalOptions(userOptions, resolved);
  copyEventHandlers(userOptions, resolved);

  return resolved;
}

export function columnTypeNames(type: ColDef["type"]): readonly string[] {
  if (Array.isArray(type)) return type.filter((name): name is string => typeof name === "string" && name.length > 0);
  return typeof type === "string" && type.length > 0 ? [type] : [];
}

export function hasColumnType(colDef: Pick<ColDef, "type">, name: string): boolean {
  return columnTypeNames(colDef.type).includes(name);
}

export function mergeColDef<TData>(
  colDef: ColDef<TData>,
  defaults: Partial<ColDef<TData>>,
  columnTypes: Readonly<Record<string, Partial<ColDef<TData>>>> = {}
): ColDef<TData> {
  const typedDefaults: Partial<ColDef<TData>> = {};
  for (const name of columnTypeNames(colDef.type)) {
    const definition = columnTypes[name];
    if (definition) Object.assign(typedDefaults, definition);
  }
  return { ...defaults, ...typedDefaults, ...colDef } as ColDef<TData>;
}
