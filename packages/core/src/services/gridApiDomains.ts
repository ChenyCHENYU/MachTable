import type {
  GridApi,
  GridColumnsApi,
  GridDiagnosticsApi,
  GridEditingApi,
  GridRowsApi,
  GridSelectionApi,
  GridStateApi
} from "../types/api";

export interface GridApiDomains<TData> {
  rows: GridRowsApi<TData>;
  columns: GridColumnsApi;
  selection: GridSelectionApi<TData>;
  editing: GridEditingApi<TData>;
  state: GridStateApi;
  diagnostics: GridDiagnosticsApi;
}

/** Stable domain facades keep discovery manageable without removing the concise flat API. */
export function createGridApiDomains<TData>(api: GridApi<TData>): GridApiDomains<TData> {
  return {
    rows: {
      setData: (rows) => api.setRowData(rows),
      apply: (transaction) => api.applyTransaction(transaction),
      applyAsync: (transaction, options) => api.applyTransactionAsync(transaction, options),
      getDisplayedCount: () => api.getDisplayedRowCount(),
      getById: (id) => api.getNodeById(id),
      scrollTo: (index, position) => api.scrollToIndex(index, position),
      ensureLoaded: (startRow, endRow, options) => api.ensureRowsLoaded(startRow, endRow, options),
      purgeCache: () => api.purgeDatasourceCache(),
      getCacheSnapshot: () => api.getDatasourceCacheSnapshot()
    },
    columns: {
      getState: () => api.getColumnState(),
      setState: (state) => api.setColumnState(state),
      resetState: () => api.resetColumnState(),
      setVisible: (colId, visible) => api.setColumnVisibility(colId, visible),
      setWidth: (colId, width) => api.setColumnWidth(colId, width)
    },
    selection: {
      getRows: () => api.getSelectedRows(),
      getIds: () => api.getSelectedIds(),
      selectAll: (filteredOnly) => api.selectAll(filteredOnly),
      clear: () => api.deselectAll()
    },
    editing: {
      getChanges: () => api.getChanges(),
      rollback: (rowIds) => api.rollbackChanges(rowIds),
      save: (handler, rowIds) => api.saveChangesDetailed(handler, rowIds),
      stop: (cancel) => api.stopEditingAsync(cancel)
    },
    state: {
      get: () => api.getState(),
      apply: (state, options) => api.applyState(state, options)
    },
    diagnostics: {
      get: () => api.getDiagnostics(),
      getPerformance: () => api.getPerformanceSnapshot(),
      resetPerformance: () => api.resetPerformanceMetrics()
    }
  };
}
