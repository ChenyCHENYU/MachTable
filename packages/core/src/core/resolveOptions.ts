import type { GridOptions, GridSize, ResolvedGridOptions } from "../types/options";
import type { ColDef } from "../types/colDef";

export const DEFAULT_COL_DEF: Partial<ColDef> = {
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

function finiteAtLeast(value: unknown, fallback: number, min: number, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min) return fallback;
  return integer ? Math.floor(value) : value;
}

function resolveSize(value: GridOptions["size"]): GridSize {
  return value && Object.prototype.hasOwnProperty.call(GRID_SIZE_PRESETS, value) ? value : "normal";
}

function resolveTheme(options: GridOptions): ResolvedGridOptions["theme"] {
  if (options.theme === "light" || options.theme === "dark" || options.theme === "auto") return options.theme;
  return options.className?.includes("mach-theme-dark") ? "dark" : "light";
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

function resolveDataAndLayout<TData>(options: GridOptions<TData>, size: GridSize) {
  const preset = GRID_SIZE_PRESETS[size];
  return {
    columnDefs: Array.isArray(options.columnDefs) ? options.columnDefs : [],
    rowData: Array.isArray(options.rowData) ? options.rowData : [],
    defaultColDef: { ...DEFAULT_COL_DEF, ...(options.defaultColDef ?? {}) },
    columnTypes: options.columnTypes ?? {},
    rowHeight: finiteAtLeast(options.rowHeight, preset.rowHeight, 1),
    headerHeight: finiteAtLeast(options.headerHeight, preset.headerHeight, 1),
    rowBuffer: finiteAtLeast(options.rowBuffer, 8, 0, true),
    columnLayout: options.columnLayout === "fit" ? "fit" as const : "normal" as const,
    rowSelection:
      options.rowSelection === "single" || options.rowSelection === "multiple"
        ? options.rowSelection
        : "none" as const,
    multiSort: options.multiSort ?? true,
    size,
    pinnedTopRowData: Array.isArray(options.pinnedTopRowData) ? options.pinnedTopRowData : [],
    pinnedBottomRowData: Array.isArray(options.pinnedBottomRowData) ? options.pinnedBottomRowData : []
  };
}

function resolveAppearance(options: GridOptions) {
  return {
    stripedRows: options.stripedRows ?? false,
    showCellBorders: options.showCellBorders ?? false,
    theme: resolveTheme(options),
    quickFilterText: options.quickFilterText ?? null,
    suppressCellFocus: options.suppressCellFocus ?? false,
    suppressRowHoverHighlight: options.suppressRowHoverHighlight ?? false,
    suppressNoRowsOverlay: options.suppressNoRowsOverlay ?? false,
    suppressHeaderFocus: options.suppressHeaderFocus ?? false,
    loading: options.loading ?? false,
    className: options.className ?? ""
  };
}

function resolveEditingAndHistory(options: GridOptions) {
  return {
    editType: options.editType === "fullRow" ? "fullRow" as const : "cell" as const,
    editableIndicator:
      options.editableIndicator === "always" || options.editableIndicator === "none"
        ? options.editableIndicator
        : "hover" as const,
    singleClickEdit: options.singleClickEdit ?? false,
    manualSorting: options.manualSorting ?? false,
    manualFiltering: options.manualFiltering ?? false,
    showSummary: options.showSummary ?? false,
    indexOffset: options.indexOffset ?? 0,
    applyRowDrag: options.applyRowDrag ?? true,
    undoStackSize: finiteAtLeast(options.undoStackSize, 100, 0, true),
    asyncTransactionWaitMillis: finiteAtLeast(options.asyncTransactionWaitMillis, 16, 0, true)
  };
}

function resolveHierarchy(options: GridOptions) {
  return {
    masterDetail: options.masterDetail ?? false,
    detailRowHeight: finiteAtLeast(options.detailRowHeight, 240, 1),
    detailToggleColumn: options.detailToggleColumn ?? true,
    treeData: options.treeData ?? false,
    childrenKey: options.childrenKey ?? "children",
    autoCheckedChildren: options.autoCheckedChildren ?? true,
    defaultExpandAll: options.defaultExpandAll ?? false
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

function resolveWatermark(options: GridOptions) {
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
    columnMenu: options.columnMenu ?? false,
    columnStateKey: options.columnStateKey ?? null,
    locale: options.locale ?? {},
    suppressWarnings: options.suppressWarnings ?? false,
    enableRangeSelection: options.enableRangeSelection ?? false,
    suppressClipboard: options.suppressClipboard ?? false,
    contextMenu: options.contextMenu ?? false,
    tooltipShowDelay: finiteAtLeast(options.tooltipShowDelay, 600, 0),
    flashCells: options.flashCells ?? true,
    fillHandle: options.fillHandle ?? true,
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
    blockSize: finiteAtLeast(options.blockSize, 100, 1, true),
    infiniteBufferRows: finiteAtLeast(options.infiniteBufferRows, 40, 0, true),
    datasourceRetryCount: finiteAtLeast(options.datasourceRetryCount, 2, 0, true),
    datasourceRetryDelay: finiteAtLeast(options.datasourceRetryDelay, 300, 0, true)
  };
}

function resolveAccessibility(options: GridOptions) {
  return {
    ariaLabel: options.ariaLabel ?? "MachTable data grid",
    ariaLabelledBy: options.ariaLabelledBy ?? "",
    ariaDescribedBy: options.ariaDescribedBy ?? "",
    overlayNoRowsTemplate: options.overlayNoRowsTemplate ?? "",
    overlayLoadingTemplate: options.overlayLoadingTemplate ?? "",
    allowUnsafeOverlayHtml: options.allowUnsafeOverlayHtml ?? false
  };
}

const OPTIONAL_OPTION_KEYS = [
  "getRowId",
  "detailRowRenderer",
  "isRowExpandable",
  "columnStateStore",
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
  "loadTreeChildren"
] as const;

function copyOptionalOptions<TData>(
  source: GridOptions<TData>,
  target: ResolvedGridOptions<TData>
): void {
  for (const key of OPTIONAL_OPTION_KEYS) {
    if (source[key]) Object.assign(target, { [key]: source[key] });
  }
}

function copyEventHandlers<TData>(source: GridOptions<TData>, target: ResolvedGridOptions<TData>): void {
  for (const key of Object.keys(source) as (keyof GridOptions<TData>)[]) {
    if (key.startsWith("on") && typeof source[key] === "function") {
      Object.assign(target, { [key]: source[key] });
    }
  }
}

export function resolveOptions<TData>(userOptions: GridOptions<TData>): ResolvedGridOptions<TData> {
  const size = resolveSize(userOptions.size);
  const resolved = {
    ...resolveDataAndLayout(userOptions, size),
    ...resolveAppearance(userOptions),
    ...resolveEditingAndHistory(userOptions),
    ...resolveHierarchy(userOptions),
    ...resolvePagination(userOptions),
    ...resolveWatermark(userOptions),
    ...resolveInteraction(userOptions),
    ...resolveDatasource(userOptions),
    ...resolveAccessibility(userOptions),
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
