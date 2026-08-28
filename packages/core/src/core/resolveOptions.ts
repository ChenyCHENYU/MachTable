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

export function resolveOptions<TData>(userOptions: GridOptions<TData>): ResolvedGridOptions<TData> {
  const size: GridSize = userOptions.size && Object.prototype.hasOwnProperty.call(GRID_SIZE_PRESETS, userOptions.size)
    ? userOptions.size
    : "normal";
  const preset = GRID_SIZE_PRESETS[size];
  const pageSize = finiteAtLeast(
    typeof userOptions.pagination === "object" ? userOptions.pagination.pageSize : undefined,
    20,
    1,
    true
  );
  const requestedPageSizes = typeof userOptions.pagination === "object" && Array.isArray(userOptions.pagination.pageSizeOptions)
    ? userOptions.pagination.pageSizeOptions
    : undefined;
  const pageSizeOptions = requestedPageSizes
    ? [...new Set(requestedPageSizes.map((value) => finiteAtLeast(value, 0, 1, true)).filter(Boolean))]
    : [10, 20, 50, 100];
  if (!pageSizeOptions.includes(pageSize)) pageSizeOptions.push(pageSize);
  pageSizeOptions.sort((a, b) => a - b);

  const resolved: ResolvedGridOptions<TData> = {
    columnDefs: Array.isArray(userOptions.columnDefs) ? userOptions.columnDefs : [],
    rowData: Array.isArray(userOptions.rowData) ? userOptions.rowData : [],
    defaultColDef: { ...DEFAULT_COL_DEF, ...(userOptions.defaultColDef ?? {}) },
    rowHeight: finiteAtLeast(userOptions.rowHeight, preset.rowHeight, 1),
    headerHeight: finiteAtLeast(userOptions.headerHeight, preset.headerHeight, 1),
    rowBuffer: finiteAtLeast(userOptions.rowBuffer, 8, 0, true),
    rowSelection: userOptions.rowSelection === "single" || userOptions.rowSelection === "multiple"
      ? userOptions.rowSelection
      : "none",
    multiSort: userOptions.multiSort ?? true,
    size,
    stripedRows: userOptions.stripedRows ?? false,
    showCellBorders: userOptions.showCellBorders ?? false,
    theme: userOptions.theme === "light" || userOptions.theme === "dark" || userOptions.theme === "auto"
      ? userOptions.theme
      : (userOptions.className?.includes("mach-theme-dark") ? "dark" : "light"),
    quickFilterText: userOptions.quickFilterText ?? null,
    masterDetail: userOptions.masterDetail ?? false,
    detailRowHeight: finiteAtLeast(userOptions.detailRowHeight, 240, 1),
    detailToggleColumn: userOptions.detailToggleColumn ?? true,
    columnMenu: userOptions.columnMenu ?? false,
    columnStateKey: userOptions.columnStateKey ?? null,
    locale: userOptions.locale ?? {},
    singleClickEdit: userOptions.singleClickEdit ?? false,
    manualSorting: userOptions.manualSorting ?? false,
    manualFiltering: userOptions.manualFiltering ?? false,
    showSummary: userOptions.showSummary ?? false,
    treeData: userOptions.treeData ?? false,
    childrenKey: userOptions.childrenKey ?? "children",
    autoCheckedChildren: userOptions.autoCheckedChildren ?? true,
    defaultExpandAll: userOptions.defaultExpandAll ?? false,
    indexOffset: userOptions.indexOffset ?? 0,
    applyRowDrag: userOptions.applyRowDrag ?? true,
    undoStackSize: finiteAtLeast(userOptions.undoStackSize, 100, 0, true),
    pinnedTopRowData: Array.isArray(userOptions.pinnedTopRowData) ? userOptions.pinnedTopRowData : [],
    pinnedBottomRowData: Array.isArray(userOptions.pinnedBottomRowData) ? userOptions.pinnedBottomRowData : [],
    paginationEnabled:
      userOptions.pagination !== false && userOptions.datasource == null ? true : false,
    paginationPageSize: pageSize,
    paginationPageSizeOptions: pageSizeOptions,
    paginationShowTotal:
      typeof userOptions.pagination === "object"
        ? userOptions.pagination.showTotal !== false
        : true,
    paginationShowSizeSelector:
      typeof userOptions.pagination === "object"
        ? userOptions.pagination.showPageSizeSelector !== false
        : true,
    watermarkEnabled: userOptions.watermark != null && userOptions.watermark !== false,
    watermarkConfig:
      userOptions.watermark == null || userOptions.watermark === false
        ? null
        : userOptions.watermark === true
          ? { text: "MachTable" }
          : userOptions.watermark,
    suppressWarnings: userOptions.suppressWarnings ?? false,
    enableRangeSelection: userOptions.enableRangeSelection ?? false,
    suppressClipboard: userOptions.suppressClipboard ?? false,
    contextMenu: userOptions.contextMenu ?? false,
    tooltipShowDelay: finiteAtLeast(userOptions.tooltipShowDelay, 600, 0),
    flashCells: userOptions.flashCells ?? true,
    fillHandle: userOptions.fillHandle ?? true,
    statusBarEnabled: userOptions.statusBar === true || (typeof userOptions.statusBar === "object" && userOptions.statusBar != null),
    statusBarPanels:
      typeof userOptions.statusBar === "object" && userOptions.statusBar?.panels
        ? userOptions.statusBar.panels
        : ["rowCount", "selectedRowCount", "rangeAggregate"],
    blockSize: finiteAtLeast(userOptions.blockSize, 100, 1, true),
    infiniteBufferRows: finiteAtLeast(userOptions.infiniteBufferRows, 40, 0, true),
    suppressCellFocus: userOptions.suppressCellFocus ?? false,
    suppressRowHoverHighlight: userOptions.suppressRowHoverHighlight ?? false,
    suppressNoRowsOverlay: userOptions.suppressNoRowsOverlay ?? false,
    suppressHeaderFocus: userOptions.suppressHeaderFocus ?? false,
    loading: userOptions.loading ?? false,
    overlayNoRowsTemplate: userOptions.overlayNoRowsTemplate ?? "",
    overlayLoadingTemplate: userOptions.overlayLoadingTemplate ?? "",
    allowUnsafeOverlayHtml: userOptions.allowUnsafeOverlayHtml ?? false,
    className: userOptions.className ?? "",
    features: Array.isArray(userOptions.features) ? userOptions.features : []
  };

  if (userOptions.getRowId) resolved.getRowId = userOptions.getRowId;
  if (userOptions.detailRowRenderer) resolved.detailRowRenderer = userOptions.detailRowRenderer;
  if (userOptions.isRowExpandable) resolved.isRowExpandable = userOptions.isRowExpandable;
  if (userOptions.columnStateStore) resolved.columnStateStore = userOptions.columnStateStore;
  if (userOptions.aggFuncs) resolved.aggFuncs = userOptions.aggFuncs;
  if (userOptions.components) resolved.components = userOptions.components;
  if (userOptions.summaryMethod) resolved.summaryMethod = userOptions.summaryMethod;
  if (userOptions.datasource) resolved.datasource = userOptions.datasource;
  if (userOptions.getRowHeight) resolved.getRowHeight = userOptions.getRowHeight;
  if (userOptions.tooltipComponent) resolved.tooltipComponent = userOptions.tooltipComponent;
  if (userOptions.getContextMenuItems) resolved.getContextMenuItems = userOptions.getContextMenuItems;

  for (const key of Object.keys(userOptions) as (keyof GridOptions<TData>)[]) {
    if (key.startsWith("on") && typeof userOptions[key] === "function") {
      Object.assign(resolved, { [key]: userOptions[key] });
    }
  }

  return resolved;
}

export function mergeColDef<TData>(colDef: ColDef<TData>, defaults: Partial<ColDef<TData>>): ColDef<TData> {
  return { ...defaults, ...colDef } as ColDef<TData>;
}
