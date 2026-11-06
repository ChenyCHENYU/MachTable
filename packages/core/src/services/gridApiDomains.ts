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
import { showGridOverlay } from "../render/skeleton";
import type { GridCore } from "../core/gridCore";
import type { GridApiImpl } from "./gridApi";

/** Domain facades are the only public command surface. They own no duplicate state. */
export function createGridRowsApi<TData>(api: GridApiImpl<TData>, core: GridCore<TData>): GridRowsApi<TData> {
  return {
    setData: (rows) => api.setRowData(rows),
    transact: (transaction) => api.applyTransaction(transaction),
    transactAsync: (transaction, options) => api.applyTransactionAsync(transaction, options),
    flushTransactions: () => api.flushAsyncTransactions(),
    getCount: () => core.rowModel.getDisplayedRowCount(),
    getAt: (index) => core.rowModel.getDisplayedRow(index),
    getById: (id) => core.rowModel.getNodeById(id),
    forEach: (callback) => core.rowModel.forEachNode(callback),
    forEachDisplayed: (callback) => core.rowModel.forEachNodeAfterFilterAndSort(callback),
    reorder: (fromIndex, toIndex) =>
      !core.isDisposed() && !core.editingService.isEditing() && core.rowModel.reorderRowsByDisplayed(fromIndex, toIndex),
    isRemote: () => core.rowModel.isInfinite,
    reload: (options) => api.reload(options),
    ensureLoaded: (startRow, endRow, options) => api.ensureRowsLoaded(startRow, endRow, options),
    purgeCache: () => {
      if (!core.isDisposed()) core.rowModel.purgeDatasourceCache();
    },
    getCacheSnapshot: () => core.rowModel.getDatasourceCacheSnapshot()
  };
}

export function createGridColumnsApi<TData>(api: GridApiImpl<TData>, core: GridCore<TData>): GridColumnsApi<TData> {
  return {
    getDefinitions: () => core.columnModel.getColumnDefs(),
    setDefinitions: (definitions) => api.setColumnDefs(definitions),
    getState: () => core.columnModel.getColumnState(),
    setState: (state) => api.setColumnState(state),
    resetState: () => api.resetColumnState(),
    setVisible: (colId, visible) => api.setColumnVisibility(colId, visible),
    setPinned: (colId, pinned) => api.setColumnPinned(colId, pinned),
    move: (colId, toIndex) => {
      if (!core.isDisposed()) core.moveColumn(colId, toIndex);
    },
    setWidth: (colId, width) => api.setColumnWidth(colId, width),
    fit: (width) => api.sizeColumnsToFit(width),
    autoSize: (colId) => api.autoSizeColumn(colId),
    autoSizeAll: () => api.autoSizeAllColumns(),
    getWorkbenchItems: () => api.getColumnWorkbenchItems(),
    openWorkbench: (anchor) => {
      if (!core.isDisposed()) core.columnMenu.openStandalone(anchor);
    },
    closeWorkbench: () => core.columnMenu.close()
  };
}

export function createGridSelectionApi<TData>(api: GridApiImpl<TData>, core: GridCore<TData>): GridSelectionApi<TData> {
  return {
    getRows: () => core.selectionService.getSelectedRows(),
    getVisibleRows: () => api.getVisibleSelection(),
    getNodes: () => core.selectionService.getSelectedNodes(),
    getIds: () => core.selectionService.getSelectedIds(),
    setRows: (rows, clearOthers) => api.setSelection(rows, clearOthers),
    setById: (nodeId, selected, clearOthers) => core.selectionService.selectNodeById(nodeId, selected, clearOthers),
    selectAll: (filteredOnly) => core.selectionService.selectAll(filteredOnly),
    clear: () => core.selectionService.deselectAll(),
    getMode: () => core.gridOptions.rowSelection,
    setMode: (mode) => api.setRowSelection(mode),
    getRange: () => core.bodyRenderer.getRangeSelection(),
    clearRange: () => api.clearRangeSelection()
  };
}

export function createGridEditingApi<TData>(api: GridApiImpl<TData>, core: GridCore<TData>): GridEditingApi<TData> {
  return {
    startCell: (params) => api.startEditingCell(params),
    startRow: (rowIndex) => core.editingService.startRow(rowIndex),
    isRowActive: (rowIndex) => core.editingService.isRowEditing(rowIndex),
    stop: (options) => core.editingService.stopAsync(options?.cancel === true),
    getChanges: () => core.changeTracker.getChanges(),
    getDirtyRowIds: () => core.changeTracker.getDirtyRowIds(),
    markSaved: (rowIds) => core.changeTracker.markSaved(rowIds),
    rollback: (rowIds) => core.changeTracker.rollback(rowIds),
    save: (handler, rowIds) => api.saveEditingChanges(handler, rowIds),
    undo: () => !core.isDisposed() && core.undoService.undo(),
    redo: () => !core.isDisposed() && core.undoService.redo(),
    canUndo: () => core.undoService.canUndo(),
    canRedo: () => core.undoService.canRedo()
  };
}

export function createGridStateApi<TData>(api: GridApiImpl<TData>): GridStateApi {
  return { get: () => api.getState(), apply: (state, options) => api.applyState(state, options) };
}

export function createGridDiagnosticsApi<TData>(_api: GridApiImpl<TData>, core: GridCore<TData>): GridDiagnosticsApi {
  return {
    get: () => core.getDiagnostics(),
    getPerformance: () => core.performanceMonitor.snapshot(),
    resetPerformance: () => core.performanceMonitor.reset()
  };
}

export function createGridFilteringApi<TData>(api: GridApiImpl<TData>, core: GridCore<TData>): GridFilteringApi {
  return {
    getModel: () => core.rowModel.getFilterModel(),
    setModel: (model) => api.setFilterModel(model),
    getAdvancedModel: () => core.rowModel.getAdvancedFilterModel(),
    setAdvancedModel: (model) => api.setAdvancedFilterModel(model),
    getQuickText: () => core.rowModel.getQuickFilter(),
    setQuickText: (text) => api.setQuickFilter(text),
    isPresent: (colId) => colId == null
      ? core.rowModel.isFilterPresent()
      : Object.prototype.hasOwnProperty.call(core.rowModel.getFilterModel(), colId)
  };
}

export function createGridSortingApi<TData>(api: GridApiImpl<TData>, core: GridCore<TData>): GridSortingApi {
  return { getModel: () => core.columnModel.getSortModel(), setModel: (model) => api.setSortModel(model) };
}

export function createGridPaginationApi<TData>(_api: GridApiImpl<TData>, core: GridCore<TData>): GridPaginationApi {
  return {
    isEnabled: () => core.rowModel.paginationActive,
    setEnabled: (enabled) => {
      if (!core.isDisposed()) core.rowModel.setPaginationEnabled(enabled);
    },
    getPage: () => core.rowModel.getCurrentPage(),
    setPage: (page) => {
      if (!core.isDisposed()) core.rowModel.setPage(page);
    },
    getPageSize: () => core.gridOptions.paginationPageSize,
    setPageSize: (size) => {
      if (!core.isDisposed()) core.rowModel.setPageSize(size);
    },
    getPageCount: () => core.rowModel.getPageCount(),
    getTotalRowCount: () => core.rowModel.getTotalRowCount()
  };
}

export function createGridHierarchyApi<TData>(_api: GridApiImpl<TData>, core: GridCore<TData>): GridHierarchyApi<TData> {
  return {
    isRowExpanded: (rowId) => core.rowModel.isRowExpanded(rowId),
    setRowExpanded: (rowId, expanded) => {
      if (core.isDisposed() || core.rowModel.isRowExpanded(rowId) === expanded) return false;
      if (expanded) core.rowModel.expandRow(rowId);
      else core.rowModel.collapseRow(rowId);
      return core.rowModel.isRowExpanded(rowId) === expanded;
    },
    isTreeRowLoading: (rowId) => !core.isDisposed() && core.rowModel.isTreeRowLoading(rowId),
    loadTreeChildren: (rowId, options) => core.isDisposed()
      ? Promise.resolve([])
      : core.rowModel.loadTreeChildren(rowId, options?.force === true),
    isGroupExpanded: (groupId) => core.rowModel.isGroupExpanded(groupId),
    setGroupExpanded: (groupId, expanded) => {
      if (core.isDisposed() || core.rowModel.isGroupExpanded(groupId) === expanded) return false;
      core.rowModel.toggleGroup(groupId);
      return core.rowModel.isGroupExpanded(groupId) === expanded;
    },
    setAllGroupsExpanded: (expanded) => {
      if (!core.isDisposed()) core.rowModel.setAllGroupsExpanded(expanded);
    },
    setAllDetailsExpanded: (expanded) => {
      if (!core.isDisposed()) core.rowModel.setAllDetailsExpanded(expanded);
    }
  };
}

export function createGridViewApi<TData>(api: GridApiImpl<TData>, core: GridCore<TData>): GridViewApi<TData> {
  return {
    getRoot: () => core.isDisposed() ? null : core.skeleton.root,
    scrollToRow: (index, position) => core.bodyRenderer.scrollToIndex(index, position),
    refreshCells: (params) => api.refreshCells(params),
    refreshLayout: () => api.refreshLayout(),
    flush: () => core.updateScheduler.flush(),
    setOverlay: (type) => showGridOverlay(core, type),
    getPinnedRows: (position) => core.pinnedRowsRenderer.getRows(position),
    setPinnedRows: (position, rows) => api.setPinnedRows(position, rows)
  };
}

export function createGridIoApi<TData>(api: GridApiImpl<TData>, core: GridCore<TData>): GridIoApi {
  return {
    exportCsv: (params) => api.getDataAsCsv(params),
    importCsv: (value, options) => api.importCsv(value, options),
    exportMatrix: (params) => api.getDataAsMatrix(params),
    importMatrix: (rows, options) => api.importMatrix(rows, options),
    print: (options) => api.print(options),
    copyRange: () => core.isDisposed() ? Promise.resolve(false) : core.copyActiveRange()
  };
}
