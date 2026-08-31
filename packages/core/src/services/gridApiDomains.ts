import type {
  GridApi,
  GridColumnsApi,
  GridDiagnosticsApi,
  GridEditingApi,
  GridFilteringApi,
  GridPaginationApi,
  GridRowsApi,
  GridSelectionApi,
  GridStateApi
} from "../types/api";

export function createGridRowsApi<TData>(api: GridApi<TData>): GridRowsApi<TData> {
  return {
    setData: (rows) => api.setRowData(rows),
    apply: (transaction) => api.applyTransaction(transaction),
    applyAsync: (transaction, options) => api.applyTransactionAsync(transaction, options),
    getDisplayedCount: () => api.getDisplayedRowCount(),
    getById: (id) => api.getNodeById(id),
    scrollTo: (index, position) => api.scrollToIndex(index, position),
    ensureLoaded: (startRow, endRow, options) => api.ensureRowsLoaded(startRow, endRow, options),
    purgeCache: () => api.purgeDatasourceCache(),
    getCacheSnapshot: () => api.getDatasourceCacheSnapshot()
  };
}

export function createGridColumnsApi<TData>(api: GridApi<TData>): GridColumnsApi {
  return {
    getState: () => api.getColumnState(),
    setState: (state) => api.setColumnState(state),
    resetState: () => api.resetColumnState(),
    setVisible: (colId, visible) => api.setColumnVisibility(colId, visible),
    setWidth: (colId, width) => api.setColumnWidth(colId, width)
  };
}

export function createGridSelectionApi<TData>(api: GridApi<TData>): GridSelectionApi<TData> {
  return {
    getRows: () => api.getSelectedRows(),
    getIds: () => api.getSelectedIds(),
    selectAll: (filteredOnly) => api.selectAll(filteredOnly),
    clear: () => api.deselectAll()
  };
}

export function createGridEditingApi<TData>(api: GridApi<TData>): GridEditingApi<TData> {
  return {
    getChanges: () => api.getChanges(),
    rollback: (rowIds) => api.rollbackChanges(rowIds),
    save: (handler, rowIds) => api.saveChangesDetailed(handler, rowIds),
    stop: (cancel) => api.stopEditingAsync(cancel)
  };
}

export function createGridStateApi<TData>(api: GridApi<TData>): GridStateApi {
  return {
    get: () => api.getState(),
    apply: (state, options) => api.applyState(state, options)
  };
}

export function createGridDiagnosticsApi<TData>(api: GridApi<TData>): GridDiagnosticsApi {
  return {
    get: () => api.getDiagnostics(),
    getPerformance: () => api.getPerformanceSnapshot(),
    resetPerformance: () => api.resetPerformanceMetrics()
  };
}

export function createGridFilteringApi<TData>(api: GridApi<TData>): GridFilteringApi {
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

export function createGridPaginationApi<TData>(api: GridApi<TData>): GridPaginationApi {
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
