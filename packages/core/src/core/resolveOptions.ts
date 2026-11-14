import type { GridOptions, GridSize, ResolvedGridOptions } from "../types/options";
import type { ColDef } from "../types/colDef";
import { getByPath } from "../lib/path";
import { normalizeAdvancedFilterModel } from "../lib/advancedFilter";
import { finiteAtLeast, hasOwnOption, normalizeFinite, normalizePersistence } from "../lib/optionValues";

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
  rowNumber: false,
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

function resolveSize(value: GridOptions["size"]): GridSize {
  return value && hasOwnOption(GRID_SIZE_PRESETS, value) ? value : "normal";
}

function resolvePageSizeOptions<TData>(options: GridOptions<TData>, pageSize: number): number[] {
  const requested =
    typeof options.pagination === "object" && Array.isArray(options.pagination?.pageSizeOptions)
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

function resolveDataAndLayout<TData>(options: GridOptions<TData>, size: GridSize) {
  const preset = GRID_SIZE_PRESETS[size];
  const rowKey = options.rowKey;
  return {
    columnDefs: Array.isArray(options.columnDefs) ? options.columnDefs : [],
    rowData: Array.isArray(options.rowData) ? options.rowData : [],
    defaultColDef: { ...DEFAULT_COL_DEF, ...(options.defaultColDef ?? {}) },
    columnTypes: options.columnTypes ?? {},
    ...(rowKey ? { resolveRowId: ({ data }: { data: TData }) => rowIdFromKey(rowKey, data), rowKey } : {}),
    rowHeight: finiteAtLeast(options.rowHeight, preset.rowHeight, 1),
    detailRowHeight: finiteAtLeast(options.detailRowHeight, 240, 1),
    headerHeight: finiteAtLeast(options.headerHeight, preset.headerHeight, 1),
    rowBuffer: finiteAtLeast(options.rowBuffer, 8, 0, true),
    columnLayout: options.columnLayout === "fit" || options.columnLayout === "normal" ? options.columnLayout : "auto" as const,
    enableColumnResize: options.enableColumnResize === true,
    domLayout: options.domLayout === "autoHeight" ? "autoHeight" as const : "normal" as const,
    maxBodyHeight: normalizeFinite(options.maxBodyHeight, 1),
    rowSelection:
      options.rowSelection === "single" || options.rowSelection === "multiple"
        ? options.rowSelection
        : "none" as const,
    size,
    pinnedTopRowData: Array.isArray(options.pinnedTopRowData) ? options.pinnedTopRowData : [],
    pinnedBottomRowData: Array.isArray(options.pinnedBottomRowData) ? options.pinnedBottomRowData : []
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
  const watermarkConfig = options.watermark == null || options.watermark === false
    ? null : options.watermark === true ? { text: "MachTable" } : options.watermark;
  return {
    watermarkEnabled: watermarkConfig !== null,
    watermarkConfig
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

const BLOCK_CACHE_DEFAULTS = { blockSize: 100, maxBlocksInCache: 12, datasourceMaxConcurrentRequests: 4 };
const DATASOURCE_SOFT_DEFAULTS = { infiniteBufferRows: 40, blockPrefetch: 1, datasourceRetryCount: 2, datasourceRetryDelay: 300 };
const BLOCK_CACHE_KEYS = Object.keys(BLOCK_CACHE_DEFAULTS) as (keyof typeof BLOCK_CACHE_DEFAULTS)[];
const DATASOURCE_SOFT_KEYS = Object.keys(DATASOURCE_SOFT_DEFAULTS) as (keyof typeof DATASOURCE_SOFT_DEFAULTS)[];
type DatasourceTuning = typeof BLOCK_CACHE_DEFAULTS & typeof DATASOURCE_SOFT_DEFAULTS & { datasourceRetryJitter: number };

function copyDatasourceIntegers(
  options: Partial<DatasourceTuning>, target: DatasourceTuning,
  keys: readonly (keyof DatasourceTuning)[], min: number
): boolean {
  let changed = false;
  for (const key of keys) {
    const value = normalizeFinite(options[key], min, true);
    if (value === undefined || value === target[key]) continue;
    target[key] = value;
    changed = true;
  }
  return changed;
}

/** Normalize initial and updated options alike. Only cache geometry/concurrency restarts the block model. */
export function updateDatasourceTuning(options: Partial<DatasourceTuning>, target: DatasourceTuning): boolean {
  const cacheChanged = copyDatasourceIntegers(options, target, BLOCK_CACHE_KEYS, 1);
  copyDatasourceIntegers(options, target, DATASOURCE_SOFT_KEYS, 0);
  const retryJitter = normalizeFinite(options.datasourceRetryJitter, 0);
  if (retryJitter !== undefined) target.datasourceRetryJitter = Math.min(1, retryJitter);
  return cacheChanged;
}

function resolveDatasource(options: GridOptions) {
  const tuning = { ...BLOCK_CACHE_DEFAULTS, ...DATASOURCE_SOFT_DEFAULTS, datasourceRetryJitter: 0.15 };
  updateDatasourceTuning(options, tuning);
  return {
    ...tuning,
    datasourceMode: options.datasourceMode === "block" ? "block" as const : "sequential" as const,
    datasourceRowCount: options.datasourceRowCount == null
      ? null
      : finiteAtLeast(options.datasourceRowCount, 0, 0, true),
    dataProcessorMinRows: finiteAtLeast(options.dataProcessorMinRows, 5_000, 1, true)
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

export function resolveOptions<TData>(userOptions: GridOptions<TData>): ResolvedGridOptions<TData> {
  const size = resolveSize(userOptions.size);
  const resolved = {
    ...resolveValueDefaults(userOptions),
    ...resolveDataAndLayout(userOptions, size),
    rowStyleRules: Array.isArray(userOptions.rowStyleRules) ? userOptions.rowStyleRules : [],
    theme: userOptions.theme === "dark" || userOptions.theme === "auto" ? userOptions.theme : "light",
    editType: userOptions.editType === "fullRow" ? "fullRow" : "cell",
    editableIndicator: userOptions.editableIndicator === "always" || userOptions.editableIndicator === "none"
      ? userOptions.editableIndicator : "hover",
    rowDragPolicy: userOptions.rowDragPolicy,
    undoStackSize: finiteAtLeast(userOptions.undoStackSize, 100, 0, true),
    asyncTransactionWaitMillis: finiteAtLeast(userOptions.asyncTransactionWaitMillis, 16, 0, true),
    ...resolvePagination(userOptions),
    ...resolveWatermark(userOptions),
    ...resolveInteraction(userOptions),
    ...resolveDatasource(userOptions),
    features: Array.isArray(userOptions.features) ? userOptions.features : []
  } as ResolvedGridOptions<TData>;

  for (const key of OPTIONAL_OPTION_KEYS) {
    if (userOptions[key]) Reflect.set(resolved, key, userOptions[key]);
  }
  for (const key of Object.keys(userOptions) as (keyof GridOptions<TData>)[]) {
    if (key.startsWith("on") && typeof userOptions[key] === "function") Reflect.set(resolved, key, userOptions[key]);
  }

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
  const typedDefaults: Partial<ColDef<TData>> = colDef.checkboxSelection || colDef.rowDrag || hasColumnType(colDef, "index")
    ? { resizable: false, suppressSizeToFit: true } : {};
  for (const name of columnTypeNames(colDef.type)) {
    if (name === "rightAligned") typedDefaults.align = "right";
    const definition = columnTypes[name];
    if (definition) Object.assign(typedDefaults, definition);
  }
  const merged = { ...defaults, ...typedDefaults, ...colDef } as ColDef<TData>;
  merged.align ??= defaults.align ?? "center";
  if (merged.status && !merged.cellRenderer) merged.cellRenderer = "statusTag";
  return merged;
}
