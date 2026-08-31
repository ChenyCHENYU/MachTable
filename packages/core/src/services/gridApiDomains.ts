import type {
  GridColumnsApi,
  GridDiagnosticsApi,
  GridEditingApi,
  GridFilteringApi,
  GridHierarchyApi,
  GridIoApi,
  GridPaginationApi,
  GridRowsApi,
  GridSelectionApi,
  GridSortingApi,
  GridStateApi,
  GridViewApi
} from "../types/api";
import type { GridApiImpl } from "./gridApi";

/** Domain facades are the only public command surface. They own no duplicate state. */
export function createGridRowsApi<TData>(api: GridApiImpl<TData>): GridRowsApi<TData> {
  return {
    setData: (rows) => api.setRowData(rows),
    transact: (transaction) => api.applyTransaction(transaction),
    transactAsync: (transaction, options) => api.applyTransactionAsync(transaction, options),
    flushTransactions: () => api.flushAsyncTransactions(),
    getCount: () => api.getDisplayedRowCount(),
    getAt: (index) => api.getRowNode(index),
    getById: (id) => api.getNodeById(id),
    forEach: (callback) => api.forEachNode(callback),
    forEachDisplayed: (callback) => api.forEachNodeAfterFilterAndSort(callback),
    reorder: (fromIndex, toIndex) => api.reorderRows(fromIndex, toIndex),
    isRemote: () => api.isInfinite(),
    reload: (options) => api.reload(options),
    ensureLoaded: (startRow, endRow, options) => api.ensureRowsLoaded(startRow, endRow, options),
    purgeCache: () => api.purgeDatasourceCache(),
    getCacheSnapshot: () => api.getDatasourceCacheSnapshot()
  };
}

export function createGridColumnsApi<TData>(api: GridApiImpl<TData>): GridColumnsApi<TData> {
  return {
    getDefinitions: () => api.getColumnDefs(),
    setDefinitions: (definitions) => api.setColumnDefs(definitions),
    getState: () => api.getColumnState(),
    setState: (state) => api.setColumnState(state),
    resetState: () => api.resetColumnState(),
    setVisible: (colId, visible) => api.setColumnVisibility(colId, visible),
    setPinned: (colId, pinned) => api.setColumnPinned(colId, pinned),
    move: (colId, toIndex) => api.moveColumn(colId, toIndex),
    setWidth: (colId, width) => api.setColumnWidth(colId, width),
    fit: (width) => api.sizeColumnsToFit(width),
    autoSize: (colId, skipHeader) => api.autoSizeColumn(colId, skipHeader),
    autoSizeAll: (skipHeader) => api.autoSizeAllColumns(skipHeader),
    getWorkbenchItems: () => api.getColumnWorkbenchItems(),
    openWorkbench: (anchor) => api.openColumnWorkbench(anchor),
    closeWorkbench: () => api.closeColumnWorkbench()
  };
}

export function createGridSelectionApi<TData>(api: GridApiImpl<TData>): GridSelectionApi<TData> {
  return {
    getRows: () => api.getSelectedRows(),
    getVisibleRows: () => api.getVisibleSelection(),
    getNodes: () => api.getSelectedNodes(),
    getIds: () => api.getSelectedIds(),
    setRows: (rows, clearOthers) => api.setSelection(rows, clearOthers),
    setById: (nodeId, selected, clearOthers) => api.selectNodeById(nodeId, selected, clearOthers),
    selectAll: (filteredOnly) => api.selectAll(filteredOnly),
    clear: () => api.deselectAll(),
    getMode: () => api.getRowSelection(),
    setMode: (mode) => api.setRowSelection(mode),
    getRange: () => api.getRangeSelection(),
    clearRange: () => api.clearRangeSelection()
  };
}

export function createGridEditingApi<TData>(api: GridApiImpl<TData>): GridEditingApi<TData> {
  return {
    startCell: (params) => api.startEditingCell(params),
    startRow: (rowIndex) => api.startEditingRow(rowIndex),
    isRowActive: (rowIndex) => api.isRowEditing(rowIndex),
    stop: (options) => api.stopEditing(options?.cancel === true),
    getChanges: () => api.getChanges(),
    getDirtyRowIds: () => api.getDirtyRowIds(),
    markSaved: (rowIds) => api.markChangesSaved(rowIds),
    rollback: (rowIds) => api.rollbackChanges(rowIds),
    save: (handler, rowIds) => api.saveEditingChanges(handler, rowIds),
    undo: () => api.undo(),
    redo: () => api.redo(),
    canUndo: () => api.canUndo(),
    canRedo: () => api.canRedo()
  };
}

export function createGridStateApi<TData>(api: GridApiImpl<TData>): GridStateApi {
  return { get: () => api.getState(), apply: (state, options) => api.applyState(state, options) };
}

export function createGridDiagnosticsApi<TData>(api: GridApiImpl<TData>): GridDiagnosticsApi {
  return {
    get: () => api.getDiagnostics(),
    getPerformance: () => api.getPerformanceSnapshot(),
    resetPerformance: () => api.resetPerformanceMetrics()
  };
}

export function createGridFilteringApi<TData>(api: GridApiImpl<TData>): GridFilteringApi {
  return {
    getModel: () => api.getFilterModel(),
    setModel: (model) => api.setFilterModel(model),
    getAdvancedModel: () => api.getAdvancedFilterModel(),
    setAdvancedModel: (model) => api.setAdvancedFilterModel(model),
    getQuickText: () => api.getQuickFilter(),
    setQuickText: (text) => api.setQuickFilter(text),
    isPresent: (colId) => colId == null
      ? Object.keys(api.getFilterModel()).length > 0 || api.getAdvancedFilterModel() != null || api.getQuickFilter() != null
      : api.isColumnFilterPresent(colId)
  };
}

export function createGridSortingApi<TData>(api: GridApiImpl<TData>): GridSortingApi {
  return { getModel: () => api.getSortModel(), setModel: (model) => api.setSortModel(model) };
}

export function createGridPaginationApi<TData>(api: GridApiImpl<TData>): GridPaginationApi {
  return {
    isEnabled: () => api.paginationEnabled(),
    setEnabled: (enabled) => api.setPaginationEnabled(enabled),
    getPage: () => api.getPage(),
    setPage: (page) => api.setPage(page),
    getPageSize: () => api.getPageSize(),
    setPageSize: (size) => api.setPageSize(size),
    getPageCount: () => api.getPageCount(),
    getTotalRowCount: () => api.getTotalRowCount()
  };
}

export function createGridHierarchyApi<TData>(api: GridApiImpl<TData>): GridHierarchyApi<TData> {
  return {
    isRowExpanded: (rowId) => api.isRowExpanded(rowId),
    setRowExpanded: (rowId, expanded) => {
      if (api.isRowExpanded(rowId) === expanded) return false;
      if (expanded) api.expandRow(rowId);
      else api.collapseRow(rowId);
      return api.isRowExpanded(rowId) === expanded;
    },
    isTreeRowLoading: (rowId) => api.isTreeRowLoading(rowId),
    loadTreeChildren: (rowId, options) => api.loadTreeChildren(rowId, options),
    isGroupExpanded: (groupId) => api.isGroupExpanded(groupId),
    setGroupExpanded: (groupId, expanded) => {
      if (api.isGroupExpanded(groupId) === expanded) return false;
      api.toggleRowGroup(groupId);
      return api.isGroupExpanded(groupId) === expanded;
    },
    setAllGroupsExpanded: (expanded) => expanded ? api.expandAllGroups() : api.collapseAllGroups(),
    setAllDetailsExpanded: (expanded) => expanded ? api.expandAllDetails() : api.collapseAllDetails()
  };
}

export function createGridViewApi<TData>(api: GridApiImpl<TData>): GridViewApi<TData> {
  return {
    getRoot: () => api.getRootElement(),
    scrollToRow: (index, position) => api.scrollToIndex(index, position),
    refreshCells: (params) => api.refreshCells(params),
    refreshLayout: () => api.refreshLayout(),
    flush: () => api.flushUpdates(),
    setOverlay: (type) => api.setOverlay(type),
    getPinnedRows: (position) => position === "top" ? api.getPinnedTopRowData() : api.getPinnedBottomRowData(),
    setPinnedRows: (position, rows) => position === "top"
      ? api.setPinnedTopRowData(rows)
      : api.setPinnedBottomRowData(rows)
  };
}

export function createGridIoApi<TData>(api: GridApiImpl<TData>): GridIoApi {
  return {
    exportCsv: (params) => api.getDataAsCsv(params),
    importCsv: (value, options) => api.importCsv(value, options),
    print: (options) => api.print(options),
    copyRange: () => api.copyRangeToClipboard()
  };
}
