import type { GridCore } from "../core/gridCore";
import { attachAdapterLifecycle } from "../lib/adapterLifecycle";
import { attachImportContext, getImportContext } from "../lib/importContext";
import type {
  CsvExportParams,
  GridAsyncOptions,
  ImportCsvOptions,
  ImportMatrixOptions,
  MatrixExportParams,
  RefreshCellsParams,
  RowTransaction
} from "../types/api";
import type { GridApi } from "../types/api";
import type { GridOptions } from "../types/options";
import type { ApplyGridStateOptions, GridState, GridStateInput, GridStateSection } from "../types/state";
import type { AdvancedFilterModel } from "../types/advancedFilter";
import type { Column } from "./column";
import { EVENT_TYPES } from "../types/events";
import type { ColDefOrGroup, ColumnState, FilterModel, SortModel } from "../types/colDef";
import { DEFAULT_COL_DEF, GRID_SIZE_PRESETS, VALUE_DEFAULTS, resolveWatermark, rowIdFromKey } from "../core/resolveOptions";
import { buildCsv, sanitizeFormulaCell } from "../lib/csv";
import { prepareMatrixImport } from "../lib/importData";
import { serializeColumnValue } from "../lib/columnValues";
import { clipboardText, parseCsv } from "../lib/clipboard";
import { escapeHtml } from "../lib/download";
import { formatCellValue } from "../render/cellContent";
import { sanitizeGridOptionPatch } from "../core/gridOptionRuntime";
import { normalizeGridState } from "../lib/gridState";
import { copyOptions, normalizeFinite, normalizePersistence } from "../lib/optionValues";
import { fitColumnWidths } from "../lib/layout";
import { abortable, createAbortError } from "../lib/abortable";
import { createSaveSnapshot, normalizeBatchSaveResult } from "../lib/batchSave";
import {
  createGridColumnsApi,
  createGridDiagnosticsApi,
  createGridEditingApi,
  createGridFilteringApi,
  createGridHierarchyApi,
  createGridIoApi,
  createGridPaginationApi,
  createGridRowsApi,
  createGridSelectionApi,
  createGridSortingApi,
  createGridStateApi,
  createGridViewApi
} from "./gridApiDomains";

interface OptionUpdateEffects {
  datasourceChanged: boolean;
  filterChanged: boolean;
  needsCellRefresh: boolean;
  needsColumnRebuild: boolean;
  needsHeaderRebuild: boolean;
  needsPoolRebuild: boolean;
  needsRelayout: boolean;
  needsRowRebuild: boolean;
  needsStateLoad: boolean;
  needsSummaryRefresh: boolean;
  needsFeatureReload: boolean;
  stateToApply?: GridStateInput;
}

interface AsyncTransactionEntry<TData> {
  transaction: RowTransaction<TData>;
  resolve(): void;
  reject(reason: Error): void;
  signal?: AbortSignal;
  onAbort?: () => void;
  aborted: boolean;
}

function abortError(signal?: AbortSignal): Error {
  return createAbortError(signal?.reason, "The operation was aborted");
}

function withAbort<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
  return abortable(task, signal, () => abortError(signal));
}

function createOptionUpdateEffects(): OptionUpdateEffects {
  return {
    datasourceChanged: false,
    filterChanged: false,
    needsCellRefresh: false,
    needsColumnRebuild: false,
    needsHeaderRebuild: false,
    needsPoolRebuild: false,
    needsRelayout: false,
    needsRowRebuild: false,
    needsStateLoad: false,
    needsSummaryRefresh: false,
    needsFeatureReload: false
  };
}

function hasOwnOption<T extends object>(options: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(options, key);
}

function changedFinite(
  value: unknown,
  current: number,
  min: number,
  integer = false
): number | undefined {
  const normalized = normalizeFinite(value, min, integer);
  return normalized === undefined || normalized === current ? undefined : normalized;
}

/** @internal Only the domain facade, never this implementation instance, crosses the package boundary. */
export class GridApiImpl<TData = any> {
  private asyncTransactions: AsyncTransactionEntry<TData>[] = [];
  private asyncTransactionTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private core: GridCore<TData>) {}

  batch<TResult>(callback: (api: GridApi<TData>) => TResult): TResult {
    return this.core.batchUpdates(() => callback(this.core.api));
  }

  flushUpdates(): void { this.core.updateScheduler.flush(); }

  getRootElement(): HTMLElement | null {
    return this.core.isDisposed() ? null : this.core.skeleton.root;
  }

  setRowData(rows: TData[] | null | undefined): void {
    if (this.core.isDisposed()) return;
    this.core.gridOptions.rowData = rows ?? [];
    if (this.core.rowModel.isInfinite) return;
    this.core.rowModel.setRowData(rows);
    this.core.requestUpdate({ data: true });
  }

  applyTransaction(transaction: RowTransaction<TData>): void {
    if (this.core.isDisposed() || this.core.rowModel.isInfinite) return;
    const impact = this.core.rowModel.applyTransaction(transaction);
    this.requestTransactionRefresh(impact);
  }

  applyTransactionAsync(transaction: RowTransaction<TData>, options: GridAsyncOptions = {}): Promise<void> {
    if (this.core.isDisposed() || this.core.rowModel.isInfinite) return Promise.resolve();
    if (options.signal?.aborted) return Promise.reject(abortError(options.signal));
    const promise = new Promise<void>((resolve, reject) => {
      const entry: AsyncTransactionEntry<TData> = {
        transaction,
        resolve,
        reject,
        signal: options.signal,
        aborted: false
      };
      if (options.signal) {
        entry.onAbort = () => {
          if (entry.aborted) return;
          entry.aborted = true;
          reject(abortError(options.signal));
        };
        options.signal.addEventListener("abort", entry.onAbort, { once: true });
      }
      this.asyncTransactions.push(entry);
    });
    if (this.asyncTransactionTimer == null) {
      this.asyncTransactionTimer = setTimeout(
        () => this.flushAsyncTransactions(),
        this.core.gridOptions.asyncTransactionWaitMillis
      );
    }
    return promise;
  }

  flushAsyncTransactions(): void {
    if (this.asyncTransactionTimer != null) clearTimeout(this.asyncTransactionTimer);
    this.asyncTransactionTimer = null;
    const entries = this.asyncTransactions;
    this.asyncTransactions = [];
    const transactions = entries.filter((entry) => !entry.aborted).map((entry) => entry.transaction);
    if (transactions.length > 0 && !this.core.isDisposed() && !this.core.rowModel.isInfinite) {
      const impact = this.core.rowModel.applyTransactions(transactions);
      this.requestTransactionRefresh(impact);
    }
    for (const entry of entries) {
      if (entry.signal && entry.onAbort) entry.signal.removeEventListener("abort", entry.onAbort);
      if (!entry.aborted) entry.resolve();
    }
  }

  private requestTransactionRefresh(impact: import("./rowModel").RowTransactionImpact): void {
    if (impact.pipelineChanged) {
      this.core.requestUpdate({ data: true });
      return;
    }
    if (impact.updatedRowIds.length === 0) return;
    this.core.requestUpdate({
      cells: { rowIds: impact.updatedRowIds },
      summary: true,
      overlays: true
    });
  }

  getColumnDefs(): ColDefOrGroup<TData>[] | null {
    return this.core.columnModel.getColumnDefs() as ColDefOrGroup<TData>[];
  }

  setColumnDefs(colDefs: ColDefOrGroup<TData>[] | null | undefined): void {
    if (this.core.isDisposed()) return;
    this.core.gridOptions.columnDefs = colDefs ?? [];
    this.core.columnModel.setColumnDefs(colDefs);
    this.core.loadPersistedGridState();
    this.core.onColumnsStructureChanged();
    if (this.core.rowModel.isInfinite) void this.core.rowModel.onServerParamsChanged();
    else {
      this.core.rowModel.refreshPipeline();
      this.core.requestUpdate({ data: true });
    }
  }

  getColumnState(): ColumnState[] {
    return this.core.columnModel.getColumnState();
  }

  setColumnState(state: ColumnState[]): void {
    if (this.core.isDisposed()) return;
    this.core.columnModel.applyColumnState(state);
    this.core.onColumnsStructureChanged();
  }

  resetColumnState(): void {
    if (this.core.isDisposed()) return;
    this.core.columnModel.resetColumnState();
    this.core.onColumnsStructureChanged();
  }

  setColumnVisibility(colId: string, visible: boolean): void {
    if (this.core.isDisposed()) return;
    this.core.columnModel.setColumnVisibility(colId, visible);
    this.core.onColumnsStructureChanged();
    this.core.emit("columnVisibilityChanged", { colId, visible });
  }

  moveColumn(colId: string, toIndex: number): void {
    if (this.core.isDisposed()) return;
    this.core.moveColumn(colId, toIndex);
  }

  setColumnPinned(colId: string, pinned: "left" | "right" | null): void {
    if (this.core.isDisposed()) return;
    this.core.columnModel.setColumnPinned(colId, pinned);
    this.core.onColumnsStructureChanged();
  }

  setColumnWidth(colId: string, width: number): boolean {
    if (this.core.isDisposed()) return false;
    const column = this.core.columnModel.getColumn(colId);
    if (!column || !this.core.columnModel.setColumnWidth(column, width)) return false;
    this.core.relayoutColumns();
    this.core.commitColumnWidths([column]);
    return true;
  }

  sizeColumnsToFit(width?: number): void {
    if (this.core.isDisposed()) return;
    const visible = this.core.columnModel.getOrderedVisible();
    const cols = visible.filter(col => col.pinned === null && !col.colDef.suppressSizeToFit);
    if (cols.length === 0) return;
    const target = width ?? this.core.skeleton.measureViewportWidth();
    if (!Number.isFinite(target) || target <= 0) return;
    const fixedWidth = visible.reduce((sum, col) =>
      sum + (col.pinned !== null || col.colDef.suppressSizeToFit ? col.currentWidth : 0), 0);
    const fitted = fitColumnWidths(cols.map(col => ({
      width: col.currentWidth, minWidth: col.colDef.minWidth, maxWidth: col.colDef.maxWidth
    })), Math.max(0, target - fixedWidth));
    const responsive = this.core.gridOptions.columnLayout === "fit" && width === undefined;
    const changed = cols.filter((col, index) => responsive
      ? this.core.columnModel.setContentWidth(col, fitted[index])
      : this.core.columnModel.setColumnWidth(col, fitted[index]));
    this.core.relayoutColumns();
    this.core.commitColumnWidths(changed);
  }

  autoSizeColumn(colId: string): void {
    if (this.core.isDisposed()) return;
    const column = this.core.columnModel.getColumn(colId);
    if (!column) return;

    if (this.autoSizeColumnInternal(column)) {
      this.core.relayoutColumns();
      this.core.commitColumnWidths([column]);
    }
  }

  private autoSizeColumnInternal(column: Column<TData>): boolean {
    // Display/utility columns keep their configured width in responsive mode.
    if (this.core.gridOptions.columnLayout === "fit" && column.colDef.suppressSizeToFit) return false;
    if (column.hasCheckbox || column.isDetailToggle) {
      return this.core.columnModel.setColumnWidth(column, column.isDetailToggle ? 38 : 46);
    }

    return this.setAutoSizeWidth(column, this.core.columnSizing.measureColumnWidth(column));
  }

  private setAutoSizeWidth(column: Column<TData>, width: number): boolean {
    return this.core.gridOptions.columnLayout === "fit"
      ? this.core.columnModel.setContentWidth(column, width)
      : this.core.columnModel.setColumnWidth(column, width);
  }

  autoSizeAllColumns(): void {
    if (this.core.isDisposed()) return;
    const changed: Column<TData>[] = [];
    for (const col of this.core.columnModel.getOrderedVisible()) {
      if (this.autoSizeColumnInternal(col)) changed.push(col);
    }
    if (changed.length > 0) {
      this.core.relayoutColumns();
      this.core.commitColumnWidths(changed);
    }
  }

  getSortModel(): SortModel {
    return this.core.columnModel.getSortModel();
  }

  setSortModel(sortModel: SortModel | null): void {
    if (this.core.isDisposed()) return;
    this.core.columnModel.applySortModel(sortModel);
    this.core.applySortModel();
  }

  getFilterModel(): FilterModel {
    return this.core.rowModel.getFilterModel();
  }

  setFilterModel(filterModel: FilterModel | null): void {
    if (this.core.isDisposed()) return;
    this.core.rowModel.setFilterModel(filterModel);
    this.core.headerRenderer.refreshFilterIcons();
    this.emitFilterChanged();
    if (this.core.rowModel.isInfinite) {
      void this.core.rowModel.onServerParamsChanged();
      return;
    }
    this.core.rowModel.refreshPipeline();
    this.core.requestUpdate({ data: true });
  }

  getAdvancedFilterModel(): AdvancedFilterModel | null {
    return this.core.rowModel.getAdvancedFilterModel();
  }

  setAdvancedFilterModel(model: AdvancedFilterModel | null): void {
    if (this.core.isDisposed() || !this.core.rowModel.setAdvancedFilterModel(model)) return;
    this.emitFilterChanged();
    if (this.core.rowModel.isInfinite) {
      void this.core.rowModel.onServerParamsChanged();
      return;
    }
    this.core.rowModel.refreshPipeline();
    this.core.requestUpdate({ data: true });
  }

  private emitFilterChanged(): void {
    this.core.emit("filterChanged", {
      filterModel: this.core.rowModel.getFilterModel(),
      advancedFilterModel: this.core.rowModel.getAdvancedFilterModel()
    });
  }

  isColumnFilterPresent(colId: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.core.rowModel.getFilterModel(), colId);
  }

  setQuickFilter(text: string | null | undefined): void {
    if (this.core.isDisposed()) return;
    this.core.gridOptions.quickFilterText = text != null && text.trim() !== "" ? text : null;
    if (this.core.rowModel.setQuickFilter(text)) {
      this.core.applyQuickFilter();
    }
  }

  getQuickFilter(): string | null {
    return this.core.rowModel.getQuickFilter();
  }

  getRowSelection(): "none" | "single" | "multiple" {
    return this.core.gridOptions.rowSelection;
  }

  setRowSelection(mode: "none" | "single" | "multiple"): void {
    if (this.core.isDisposed()) return;
    if (this.core.gridOptions.rowSelection === mode) return;
    this.core.gridOptions.rowSelection = mode;
    if (mode === "none") this.deselectAll();
    this.core.headerRenderer.build();
    this.core.bodyRenderer.rebuildPool();
  }

  getSelectedNodes() {
    return this.core.selectionService.getSelectedNodes();
  }

  getSelectedRows(): TData[] {
    return this.core.selectionService.getSelectedRows();
  }

  selectNodeById(nodeId: string, selected = true, clearOthers = true): void {
    this.core.selectionService.selectNodeById(nodeId, selected, clearOthers);
  }

  selectAll(filteredOnly = true): void {
    this.core.selectionService.selectAll(filteredOnly);
  }

  deselectAll(): void {
    this.core.selectionService.deselectAll();
  }

  getDisplayedRowCount(): number {
    return this.core.rowModel.getDisplayedRowCount();
  }

  getRowNode(rowIndex: number) {
    return this.core.rowModel.getDisplayedRow(rowIndex);
  }

  getNodeById(id: string) {
    return this.core.rowModel.getNodeById(id);
  }

  forEachNode(callback: (node: any, index: number) => void): void {
    this.core.rowModel.forEachNode(callback);
  }

  forEachNodeAfterFilterAndSort(callback: (node: any, index: number) => void): void {
    this.core.rowModel.forEachNodeAfterFilterAndSort(callback);
  }

  scrollToIndex(rowIndex: number, position: "top" | "bottom" | "middle" | "nearest" = "top"): void {
    this.core.bodyRenderer.scrollToIndex(rowIndex, position);
  }

  expandRow(rowId: string): boolean {
    if (this.core.isDisposed()) return false;
    return this.core.rowModel.expandRow(rowId);
  }

  collapseRow(rowId: string): boolean {
    if (this.core.isDisposed()) return false;
    return this.core.rowModel.collapseRow(rowId);
  }

  isRowExpanded(rowId: string): boolean {
    return this.core.rowModel.isRowExpanded(rowId);
  }

  expandAllDetails(): void {
    if (this.core.isDisposed()) return;
    this.core.rowModel.expandAllDetails();
  }

  collapseAllDetails(): void {
    if (this.core.isDisposed()) return;
    this.core.rowModel.collapseAllDetails();
  }

  loadTreeChildren(rowId: string, options: { force?: boolean } = {}): Promise<readonly TData[]> {
    if (this.core.isDisposed()) return Promise.resolve([]);
    return this.core.rowModel.loadTreeChildren(rowId, options.force === true);
  }

  isTreeRowLoading(rowId: string): boolean {
    return !this.core.isDisposed() && this.core.rowModel.isTreeRowLoading(rowId);
  }

  toggleRowGroup(groupId: string): boolean {
    if (this.core.isDisposed()) return false;
    return this.core.rowModel.toggleGroup(groupId);
  }

  reorderRows(fromIndex: number, toIndex: number): boolean {
    if (this.core.isDisposed() || this.core.editingService.isEditing()) return false;
    return this.core.rowModel.reorderRowsByDisplayed(fromIndex, toIndex);
  }

  isGroupExpanded(groupId: string): boolean {
    return this.core.rowModel.isGroupExpanded(groupId);
  }

  expandAllGroups(): void {
    if (this.core.isDisposed()) return;
    this.core.rowModel.expandAllGroups();
  }

  collapseAllGroups(): void {
    if (this.core.isDisposed()) return;
    this.core.rowModel.collapseAllGroups();
  }

  setSelection(rows: TData[], clearOthers = true): void {
    if (this.core.isDisposed()) return;
    const resolveRowId = this.core.gridOptions.resolveRowId;
    const changes: { node: any; selected: boolean }[] = [];
    for (const row of rows) {
      const node = resolveRowId
        ? this.core.rowModel.getNodeById(
            this.core.rowModel.resolveRowId(row, -1, `__missing_selection_${this.core.nextId()}`)
          )
        : this.core.rowModel.getAllNodes().find((n) => n.data === row);
      if (node) changes.push({ node, selected: true });
    }
    if (changes.length > 0) {
      this.core.selectionService.applySelectionPublic(changes, clearOthers);
    } else if (clearOthers) {
      this.deselectAll();
    }
  }

  getVisibleSelection(): TData[] {
    const selectedIds = new Set(this.core.selectionService.getSelectedNodes().map((n) => n.id));
    return this.core.rowModel
      .getDisplayedRows()
      .filter((n) => !n.isDetail && !n.isGroup && selectedIds.has(n.id))
      .map((n) => n.data!)
      .filter(Boolean);
  }

  getSelectedIds(): string[] {
    return this.core.selectionService.getSelectedIds();
  }

  undo(): boolean {
    if (this.core.isDisposed()) return false;
    return this.core.undoService.undo();
  }

  redo(): boolean {
    if (this.core.isDisposed()) return false;
    return this.core.undoService.redo();
  }

  canUndo(): boolean {
    return this.core.undoService.canUndo();
  }

  canRedo(): boolean {
    return this.core.undoService.canRedo();
  }

  getDirtyRowIds(): string[] {
    return this.core.changeTracker.getDirtyRowIds();
  }

  getChanges(): import("../types/api").GridChange<TData>[] {
    return this.core.changeTracker.getChanges();
  }

  markChangesSaved(rowIds?: readonly string[]): void {
    this.core.changeTracker.markSaved(rowIds);
  }

  async saveEditingChanges(
    handler: import("../types/api").SaveChangesHandler<TData>,
    rowIds?: readonly string[]
  ): Promise<import("../types/api").GridBatchSaveResult<TData>> {
    const snapshot = createSaveSnapshot(this.core.changeTracker.getChanges(), rowIds);
    if (snapshot.length === 0) return { submitted: [], saved: [], failures: [], conflicts: [] };
    const revision = this.core.rowModel.getDataRevision();
    const result = normalizeBatchSaveResult(snapshot, await handler(snapshot));
    // A completed request still belongs to its submitted data scope, even when
    // the same grid instance now displays replacement rows with the same IDs.
    if (!this.core.isDisposed() && revision === this.core.rowModel.getDataRevision()) {
      this.core.changeTracker.acknowledge(result.saved);
    }
    return result;
  }

  rollbackChanges(rowIds?: readonly string[]): boolean {
    return this.core.changeTracker.rollback(rowIds);
  }

  setPinnedRows(position: "top" | "bottom", rows: TData[] | null): void {
    if (this.core.isDisposed()) return;
    const key = position === "top" ? "pinnedTopRowData" : "pinnedBottomRowData";
    this.core.gridOptions[key] = rows ?? [];
    this.core.pinnedRowsRenderer.setRows(position, this.core.gridOptions[key]);
  }

  getPinnedRows(position: "top" | "bottom"): TData[] {
    return this.core.pinnedRowsRenderer.getRows(position);
  }

  getRangeSelection(): import("../types/events").GridCellRange | null {
    return this.core.bodyRenderer.getRangeSelection();
  }

  clearRangeSelection(): void {
    if (this.core.isDisposed()) return;
    this.core.bodyRenderer.clearRangeSelection();
  }

  copyRangeToClipboard(): Promise<boolean> {
    if (this.core.isDisposed()) return Promise.resolve(false);
    return this.core.copyActiveRange();
  }

  openColumnWorkbench(anchor?: HTMLElement): void {
    if (this.core.isDisposed()) return;
    this.core.columnMenu.openStandalone(anchor);
  }

  closeColumnWorkbench(): void {
    this.core.columnMenu.close();
  }

  getColumnWorkbenchItems(): import("../types/api").ColumnWorkbenchItem[] {
    return this.core.columnModel.getColumns()
      .filter((column) => !column.isDetailToggle)
      .map((column) => ({
        colId: column.id,
        label: column.colDef.headerName ?? column.colDef.field ?? column.id,
        visible: !column.hide,
        pinned: column.pinned,
        width: column.currentWidth || column.manualWidth || column.colDef.width || 0,
        movable: column.movable,
        hideable: !column.hasCheckbox
      }));
  }

  refreshLayout(): void {
    if (this.core.isDisposed()) return;
    this.core.relayout();
    this.core.bodyRenderer.syncScroll(true);
  }

  isInfinite(): boolean {
    return this.core.rowModel.isInfinite;
  }

  reload(options: GridAsyncOptions = {}): Promise<void> {
    if (this.core.isDisposed()) return Promise.resolve();
    if (options.signal?.aborted) return Promise.reject(abortError(options.signal));
    if (this.core.rowModel.isInfinite) {
      return withAbort(this.core.rowModel.startInfinite(options.signal), options.signal);
    } else {
      this.core.rowModel.setRowData(this.core.gridOptions.rowData);
      this.core.requestUpdate({ data: true });
      return Promise.resolve();
    }
  }

  ensureRowsLoaded(startRow: number, endRow: number, options: GridAsyncOptions = {}): Promise<void> {
    if (this.core.isDisposed()) return Promise.resolve();
    return withAbort(
      this.core.rowModel.ensureRowsLoaded(startRow, endRow, options.signal),
      options.signal
    );
  }

  purgeDatasourceCache(): void {
    if (this.core.isDisposed()) return;
    this.core.rowModel.purgeDatasourceCache();
  }

  getDatasourceCacheSnapshot(): import("../types/api").RemoteBlockCacheSnapshot {
    return this.core.rowModel.getDatasourceCacheSnapshot();
  }

  paginationEnabled(): boolean {
    return this.core.rowModel.paginationActive;
  }

  setPaginationEnabled(enabled: boolean): void {
    if (this.core.isDisposed()) return;
    this.core.rowModel.setPaginationEnabled(enabled);
  }

  getPage(): number {
    return this.core.rowModel.getCurrentPage();
  }

  setPage(page: number): void {
    if (this.core.isDisposed()) return;
    this.core.rowModel.setPage(page);
  }

  getPageSize(): number {
    return this.core.gridOptions.paginationPageSize;
  }

  setPageSize(size: number): void {
    if (this.core.isDisposed()) return;
    this.core.rowModel.setPageSize(size);
  }

  getPageCount(): number {
    return this.core.rowModel.getPageCount();
  }

  getTotalRowCount(): number {
    return this.core.rowModel.getTotalRowCount();
  }

  importCsv(text: string, options: ImportCsvOptions = {}): boolean {
    if (!text) return false;
    const { parseValue, ...rest } = options;
    return this.importMatrix(parseCsv(text, options.separator ?? ","), { ...rest,
      parseValue: parseValue ? (params) => parseValue({ ...params, value: params.value as string }) : undefined });
  }

  importMatrix(matrix: readonly (readonly unknown[])[], options: ImportMatrixOptions = {}): boolean {
    if (this.core.isDisposed() || this.core.rowModel.isInfinite || !Array.isArray(matrix) || !matrix.length) return false;
    try {
      const context = getImportContext(this.core.api);
      const targets = options.mode === "paste" ? context.pasteRows(matrix.length) : undefined;
      const prepared = prepareMatrixImport(context, matrix, options, targets);
      if (prepared.issues.length) {
        this.core.reportError(new Error(prepared.issues.map(issue => issue.message).join("; ")), "import", { issues: prepared.issues });
        return false;
      }
      if (options.mode === "paste") this.core.applyInputChanges(prepared.rows.flatMap(row => row.changes));
      else {
        const data = prepared.rows.map(row => row.data as TData);
        if (options.mode === "append") this.applyTransaction({ add: data });
        else this.setRowData(data);
      }
      return true;
    } catch (error) { this.core.reportError(error, "import"); return false; }
  }

  print(options: import("../types/api").PrintOptions = {}): boolean {
    if (this.core.isDisposed()) return false;
    try {
      const win = window.open("", "_blank", "width=980,height=720");
      if (!win) return false;
      const cols = this.core.columnModel
        .getOrderedVisible()
        .filter((c) => !c.hasCheckbox && !c.isDetailToggle && !c.colDef.rowDrag);
      const nodes = this.core.rowModel.getPipelineRows().filter((n) => !n.isDetail && !n.isGroup);
      const includeHeader = options.includeHeader !== false;
      const headerCells = includeHeader
        ? `<tr>${cols.map((c) => `<th>${escapeHtml(c.colDef.headerName ?? c.colDef.field ?? c.id)}</th>`).join("")}</tr>`
        : "";
      const bodyRows = nodes
        .map(
          (node) =>
            `<tr>${cols
              .map((c) => {
                const v = formatCellValue(this.core, node, c);
                return `<td>${escapeHtml(v)}</td>`;
              })
              .join("")}</tr>`
        )
        .join("");
      const html =
        `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(options.title ?? "MachTable")}</title>` +
        `<style>body{font-family:system-ui,"PingFang SC","Microsoft YaHei",sans-serif;padding:20px}` +
        `h3{margin:0 0 12px;font-size:16px}` +
        `table{border-collapse:collapse;width:100%;font-size:12px}` +
        `th,td{border:1px solid #bbb;padding:5px 8px;text-align:left;word-break:break-all}` +
        `th{background:#f2f5f9;font-weight:600}` +
        `@page{margin:12mm}</style></head><body>` +
        `<h3>${escapeHtml(options.title ?? "")}</h3><table>${headerCells}${bodyRows}</table>` +
        `</body></html>`;
      win.document.write(html);
      win.document.close();
      win.focus();
      win.print();
      return true;
    } catch {
      return false;
    }
  }

  startEditingCell(params: { rowIndex: number; colId: string; keyPress?: string }): boolean {
    const column = this.core.columnModel.getColumn(params.colId);
    if (!column) return false;
    return this.core.editingService.start(params.rowIndex, column, params.keyPress ?? null);
  }

  startEditingRow(rowIndex: number): boolean {
    return this.core.editingService.startRow(rowIndex);
  }

  isRowEditing(rowIndex?: number): boolean {
    return this.core.editingService.isRowEditing(rowIndex);
  }

  stopEditing(cancel?: boolean): Promise<boolean> {
    return this.core.editingService.stopAsync(cancel ?? false);
  }

  refreshCells(params?: RefreshCellsParams): void {
    const unscoped = params == null || (
      params.rowIds == null && params.rowIndexes == null && params.columns == null
    );
    this.core.requestUpdate({
      cells: params ?? true,
      pinned: params?.includePinned ?? unscoped,
      summary: unscoped
    });
  }

  getOption<K extends keyof GridOptions<TData>>(key: K): GridOptions<TData>[K] {
    return (this.core.gridOptions as unknown as GridOptions<TData>)[key];
  }

  updateOptions(options: Partial<GridOptions<TData>>): void {
    if (this.core.isDisposed()) return;
    this.core.checkWarnings(options);
    options = sanitizeGridOptionPatch(options);
    if (Object.keys(options).length === 0) return;
    this.core.batchUpdates(() => {
      const effects = createOptionUpdateEffects();
      const previousColumnMenu = this.core.gridOptions.columnMenu;

      this.updateSourceOptions(options, effects);
      this.updateDimensionOptions(options, effects);
      this.updateEditingOptions(options, effects);
      this.updateInteractionOptions(options, effects);
      this.updatePaginationOptions(options);
      this.updatePresentationOptions(options, effects);
      this.updateAccessibilityOptions(options, effects);
      this.updateRowModelOptions(options, effects);
      this.updateExtensionOptions(options, effects);
      this.updateDatasourceOptions(options, effects);
      this.applyOptionUpdateEffects(options, effects, previousColumnMenu);
    });
  }

  private updateSourceOptions(options: Partial<GridOptions<TData>>, effects: OptionUpdateEffects): void {
    const resolved = this.core.gridOptions;
    if (hasOwnOption(options, "columnDefs") && options.columnDefs !== resolved.columnDefs) {
      resolved.columnDefs = Array.isArray(options.columnDefs) ? options.columnDefs : [];
      effects.needsColumnRebuild = true;
      effects.needsRowRebuild = true;
    }
    if (hasOwnOption(options, "rowData") && options.rowData !== resolved.rowData) {
      resolved.rowData = Array.isArray(options.rowData) ? options.rowData : [];
      effects.needsRowRebuild = true;
    }
    if (hasOwnOption(options, "initialState") && options.initialState) {
      resolved.initialState = options.initialState;
      effects.stateToApply = options.initialState;
    }
    this.updateEventHandlers(options);
  }

  private updateEventHandlers(options: Partial<GridOptions<TData>>): void {
    for (const eventType of EVENT_TYPES) {
      const key = `on${eventType.charAt(0).toUpperCase()}${eventType.slice(1)}` as keyof GridOptions<TData>;
      if (hasOwnOption(options, key)) Object.assign(this.core.gridOptions, { [key]: options[key] });
    }
  }

  private updateDimensionOptions(options: Partial<GridOptions<TData>>, effects: OptionUpdateEffects): void {
    const resolved = this.core.gridOptions;
    for (const key of ["rowHeight", "headerHeight", "rowBuffer"] as const) {
      const next = changedFinite(options[key], resolved[key], key === "rowBuffer" ? 0 : 1, key === "rowBuffer");
      if (next === undefined) continue;
      resolved[key] = next;
      effects.needsRelayout = true;
      if (key === "headerHeight") effects.needsHeaderRebuild = true;
    }
    if (options.columnLayout != null && options.columnLayout !== resolved.columnLayout) {
      resolved.columnLayout = options.columnLayout === "fit" ? "fit" : "normal";
      effects.needsRelayout = true;
    }
    if (options.domLayout != null && options.domLayout !== resolved.domLayout) {
      resolved.domLayout = options.domLayout === "autoHeight" ? "autoHeight" : "normal";
      this.core.skeleton.applyDomLayout(resolved.domLayout);
      effects.needsPoolRebuild = true;
    }
    copyOptions(options, resolved, ["multiSort"]);
    const detailHeight = changedFinite(options.detailRowHeight, resolved.detailRowHeight, 1);
    if (detailHeight !== undefined) {
      resolved.detailRowHeight = detailHeight;
      this.core.bodyRenderer.applyContainerSizes();
      this.core.bodyRenderer.updateRange(true);
    }
  }

  private updateEditingOptions(options: Partial<GridOptions<TData>>, effects: OptionUpdateEffects): void {
    const resolved = this.core.gridOptions;
    if (options.editType != null && options.editType !== resolved.editType) {
      this.core.editingService.stop(true);
      resolved.editType = options.editType === "fullRow" ? "fullRow" : "cell";
      effects.needsCellRefresh = true;
    }
    if (options.editableIndicator != null && options.editableIndicator !== resolved.editableIndicator) {
      resolved.editableIndicator =
        options.editableIndicator === "always" || options.editableIndicator === "none"
          ? options.editableIndicator
          : "hover";
      effects.needsCellRefresh = true;
    }
    copyOptions(options, resolved, ["rowEditValidator"], true);
    copyOptions(options, resolved, ["singleClickEdit", "manualSorting", "manualFiltering"]);
  }

  private updateInteractionOptions(options: Partial<GridOptions<TData>>, effects: OptionUpdateEffects): void {
    const resolved = this.core.gridOptions;
    if (
      typeof options.enableColumnResize === "boolean" &&
      options.enableColumnResize !== resolved.enableColumnResize
    ) {
      this.core.resizeService.cancelResize();
      resolved.enableColumnResize = options.enableColumnResize;
      effects.needsHeaderRebuild = true;
    }
    if (options.locale != null && options.locale !== resolved.locale) {
      resolved.locale = options.locale;
      effects.needsHeaderRebuild = true;
      effects.needsCellRefresh = true;
      this.core.paginationBar.rebuild();
      this.core.statusBarService.rebuild();
    }
    if (options.indexOffset != null && options.indexOffset !== resolved.indexOffset) {
      resolved.indexOffset = options.indexOffset;
      effects.needsCellRefresh = true;
    }
    if (options.showSummary != null && options.showSummary !== resolved.showSummary) {
      resolved.showSummary = options.showSummary;
      effects.needsSummaryRefresh = true;
      effects.needsRelayout = true;
    }
    const undoStackSize = changedFinite(options.undoStackSize, resolved.undoStackSize, 0, true);
    if (undoStackSize !== undefined) {
      resolved.undoStackSize = undoStackSize;
      this.core.undoService.trimToSize();
    }
    const wait = normalizeFinite(options.asyncTransactionWaitMillis, 0, true);
    if (wait !== undefined) resolved.asyncTransactionWaitMillis = wait;
    this.updateDynamicRowHeight(options, effects);
    this.updateRangeAndFeedbackOptions(options);
  }

  private updateDynamicRowHeight(options: Partial<GridOptions<TData>>, effects: OptionUpdateEffects): void {
    if (!hasOwnOption(options, "getRowHeight")) return;
    const changed = this.core.gridOptions.getRowHeight !== options.getRowHeight;
    this.core.gridOptions.getRowHeight = options.getRowHeight;
    if (changed) this.core.bodyRenderer.invalidateAllRowHeights();
    effects.needsRelayout = true;
  }

  private updateRangeAndFeedbackOptions(options: Partial<GridOptions<TData>>): void {
    const resolved = this.core.gridOptions;
    if (options.enableRangeSelection != null) {
      resolved.enableRangeSelection = options.enableRangeSelection;
      if (!options.enableRangeSelection) this.clearRangeSelection();
    }
    copyOptions(options, resolved, ["tooltipComponent"], true);
    const tooltipDelay = normalizeFinite(options.tooltipShowDelay, 0);
    if (tooltipDelay !== undefined) resolved.tooltipShowDelay = tooltipDelay;
    copyOptions(options, resolved, ["flashCells"]);
    copyOptions(options, resolved, ["getContextMenuItems"], true);
    if (options.theme != null && options.theme !== resolved.theme) {
      resolved.theme = options.theme;
      this.core.skeleton.applyTheme(options.theme);
      this.core.watermarkService.refresh();
    }
  }

  private updatePaginationOptions(options: Partial<GridOptions<TData>>): void {
    if (options.pagination === undefined) return;
    const resolved = this.core.gridOptions;
    const config = options.pagination;
    const enabled = config !== false && resolved.datasource == null;
    if (enabled !== resolved.paginationEnabled) this.core.rowModel.setPaginationEnabled(enabled);
    if (typeof config === "object" && config) this.updatePaginationConfig(config);
    if (resolved.paginationEnabled) this.core.rowModel.onPaginationOptionsChanged();
    this.core.paginationBar.rebuild();
  }

  private updatePaginationConfig(config: Exclude<GridOptions<TData>["pagination"], boolean | undefined>): void {
    const resolved = this.core.gridOptions;
    resolved.paginationMode = config.mode === "server" ? "server" : "client";
    const page = normalizeFinite(config.page, 1, true);
    const total = normalizeFinite(config.total, 0, true);
    if (page !== undefined) resolved.paginationPage = page;
    if (total !== undefined) resolved.paginationTotal = total;
    if (config.pageSize != null) resolved.paginationPageSize = config.pageSize;
    if (config.pageSizeOptions != null) resolved.paginationPageSizeOptions = config.pageSizeOptions;
    if (config.showTotal != null) resolved.paginationShowTotal = config.showTotal;
    if (config.showPageSizeSelector != null) {
      resolved.paginationShowSizeSelector = config.showPageSizeSelector;
    }
  }

  private updatePresentationOptions(options: Partial<GridOptions<TData>>, effects: OptionUpdateEffects): void {
    if (hasOwnOption(options, "rowStyleRules")) {
      this.core.gridOptions.rowStyleRules = Array.isArray(options.rowStyleRules) ? options.rowStyleRules : [];
      effects.needsCellRefresh = true;
      this.core.requestUpdate({ pinned: true });
    }
    this.updateWatermarkAndStatus(options, effects);
    this.updateSizePreset(options, effects);
    const resolved = this.core.gridOptions;
    if (options.stripedRows != null && options.stripedRows !== resolved.stripedRows) {
      resolved.stripedRows = options.stripedRows;
      this.core.skeleton.setStriped(options.stripedRows);
    }
    if (options.showCellBorders != null && options.showCellBorders !== resolved.showCellBorders) {
      resolved.showCellBorders = options.showCellBorders;
      this.core.skeleton.setCellBorders(options.showCellBorders);
    }
  }

  private updateWatermarkAndStatus(options: Partial<GridOptions<TData>>, effects: OptionUpdateEffects): void {
    const resolved = this.core.gridOptions;
    if (options.watermark !== undefined) {
      Object.assign(resolved, resolveWatermark(options));
      this.core.watermarkService.refresh();
    }
    this.updateStatusOptions(options);
    if (hasOwnOption(options, "summaryMethod")) {
      resolved.summaryMethod = options.summaryMethod;
      effects.needsSummaryRefresh = true;
    }
  }

  private updateStatusOptions(options: Partial<GridOptions<TData>>): void {
    const resolved = this.core.gridOptions;
    copyOptions(options, resolved, ["suppressClipboard", "contextMenu", "columnMenu", "fillHandle"]);
    if (options.statusBar !== undefined) {
      resolved.statusBarEnabled =
        options.statusBar === true || (typeof options.statusBar === "object" && options.statusBar != null);
      if (typeof options.statusBar === "object" && options.statusBar?.panels) {
        resolved.statusBarPanels = options.statusBar.panels;
      }
      this.core.statusBarService.rebuild();
    }
  }

  private updateSizePreset(options: Partial<GridOptions<TData>>, effects: OptionUpdateEffects): void {
    const { size } = options;
    if (size == null || !hasOwnOption(GRID_SIZE_PRESETS, size) || size === this.core.gridOptions.size) return;
    const preset = GRID_SIZE_PRESETS[size];
    this.core.gridOptions.size = size;
    this.core.gridOptions.rowHeight = options.rowHeight ?? preset.rowHeight;
    this.core.gridOptions.headerHeight = options.headerHeight ?? preset.headerHeight;
    this.core.skeleton.applySize(size);
    effects.needsRelayout = true;
    effects.needsHeaderRebuild = true;
  }

  private updateAccessibilityOptions(options: Partial<GridOptions<TData>>, effects: OptionUpdateEffects): void {
    const resolved = this.core.gridOptions;
    copyOptions(options, resolved, ["suppressCellFocus", "suppressRowHoverHighlight", "suppressNoRowsOverlay"]);
    if (options.suppressHeaderFocus != null && options.suppressHeaderFocus !== resolved.suppressHeaderFocus) {
      resolved.suppressHeaderFocus = options.suppressHeaderFocus;
      effects.needsHeaderRebuild = true;
    }
    this.updateAriaLabels(options);
    this.updateOverlayOptions(options);
  }

  private updateAriaLabels(options: Partial<GridOptions<TData>>): void {
    const resolved = this.core.gridOptions;
    let changed = false;
    for (const key of ["ariaLabel", "ariaLabelledBy", "ariaDescribedBy"] as const) {
      if (!hasOwnOption(options, key)) continue;
      resolved[key] = options[key] ?? VALUE_DEFAULTS[key];
      changed = true;
    }
    if (changed) this.core.skeleton.applyAriaLabels(resolved);
  }

  private updateOverlayOptions(options: Partial<GridOptions<TData>>): void {
    const resolved = this.core.gridOptions;
    for (const key of ["overlayNoRowsTemplate", "overlayLoadingTemplate", "overlayErrorTemplate"] as const) {
      if (hasOwnOption(options, key)) resolved[key] = options[key] ?? VALUE_DEFAULTS[key];
    }
    copyOptions(options, resolved, ["allowUnsafeOverlayHtml"]);
    if (hasOwnOption(options, "className")) {
      resolved.className = options.className ?? "";
      this.core.skeleton.setCustomClass(resolved.className);
    }
    copyOptions(options, resolved, ["loading"]);
    if (hasOwnOption(options, "error")) resolved.error = options.error ?? null;
  }

  private updateRowModelOptions(options: Partial<GridOptions<TData>>, effects: OptionUpdateEffects): void {
    this.updateSelectionAndColumns(options, effects);
    this.updateHierarchyOptions(options, effects);
    const resolved = this.core.gridOptions;
    copyOptions(options, resolved, ["autoCheckedChildren"]);
    if (options.defaultExpandAll != null && options.defaultExpandAll !== resolved.defaultExpandAll) {
      resolved.defaultExpandAll = options.defaultExpandAll;
      effects.needsRowRebuild = true;
    }
    if (hasOwnOption(options, "advancedFilterModel")) {
      effects.filterChanged = this.core.rowModel.setAdvancedFilterModel(options.advancedFilterModel) || effects.filterChanged;
    }
    if (options.applyRowDrag != null) {
      resolved.applyRowDrag = options.applyRowDrag;
      effects.needsCellRefresh = true;
    }
    if (hasOwnOption(options, "rowDragPolicy")) {
      resolved.rowDragPolicy = options.rowDragPolicy;
      effects.needsCellRefresh = true;
    }
    copyOptions(options, resolved, ["suppressWarnings"]);
  }

  private updateSelectionAndColumns(options: Partial<GridOptions<TData>>, effects: OptionUpdateEffects): void {
    const resolved = this.core.gridOptions;
    if (options.rowSelection != null && options.rowSelection !== resolved.rowSelection) {
      resolved.rowSelection = options.rowSelection;
      if (options.rowSelection === "none") this.deselectAll();
      effects.needsHeaderRebuild = true;
      effects.needsPoolRebuild = true;
      this.core.refreshAriaState();
    }
    if (options.quickFilterText !== undefined) this.setQuickFilter(options.quickFilterText);
    if (options.defaultColDef !== undefined && options.defaultColDef !== resolved.defaultColDef) {
      resolved.defaultColDef = { ...DEFAULT_COL_DEF, ...options.defaultColDef };
      effects.needsColumnRebuild = true;
    }
    if (hasOwnOption(options, "columnTypes") && options.columnTypes !== resolved.columnTypes) {
      resolved.columnTypes = options.columnTypes ?? {};
      effects.needsColumnRebuild = true;
    }
    if (hasOwnOption(options, "rowKey")) {
      resolved.rowKey = options.rowKey;
      const rowKey = options.rowKey;
      resolved.resolveRowId = rowKey
        ? ({ data }) => rowIdFromKey(rowKey, data)
        : undefined;
      effects.needsRowRebuild = true;
    }
  }

  private updateHierarchyOptions(options: Partial<GridOptions<TData>>, effects: OptionUpdateEffects): void {
    const resolved = this.core.gridOptions;
    if (options.masterDetail != null && options.masterDetail !== resolved.masterDetail) {
      resolved.masterDetail = options.masterDetail;
      effects.needsColumnRebuild = true;
      effects.needsRowRebuild = true;
    }
    if (options.detailToggleColumn != null && options.detailToggleColumn !== resolved.detailToggleColumn) {
      resolved.detailToggleColumn = options.detailToggleColumn;
      effects.needsColumnRebuild = true;
    }
    if (options.treeData != null && options.treeData !== resolved.treeData) {
      resolved.treeData = options.treeData;
      effects.needsRowRebuild = true;
      effects.needsColumnRebuild = true;
      this.core.refreshAriaState();
    }
    if (options.childrenKey != null && options.childrenKey !== resolved.childrenKey) {
      resolved.childrenKey = options.childrenKey;
      effects.needsRowRebuild = true;
    }
    if (copyOptions(options, resolved, ["isTreeRowExpandable", "loadTreeChildren"], true)) effects.needsCellRefresh = true;
  }

  private updateExtensionOptions(options: Partial<GridOptions<TData>>, effects: OptionUpdateEffects): void {
    const resolved = this.core.gridOptions;
    if (copyOptions(options, resolved, ["aggFuncs"], true)) effects.needsRowRebuild = true;
    if (copyOptions(options, resolved, ["components", "actionPolicy"], true)) effects.needsCellRefresh = true;
    if (hasOwnOption(options, "features")) {
      resolved.features = Array.isArray(options.features) ? options.features : [];
      effects.needsFeatureReload = true;
    }
    this.updateProcessorOptions(options, effects);
    this.updatePersistenceOptions(options, effects);
  }

  private updateProcessorOptions(options: Partial<GridOptions<TData>>, effects: OptionUpdateEffects): void {
    const resolved = this.core.gridOptions;
    if (hasOwnOption(options, "dataProcessor") && this.core.setDataProcessor(options.dataProcessor)) {
      effects.needsRowRebuild = true;
    }
    const processorRows = normalizeFinite(options.dataProcessorMinRows, 1, true);
    if (processorRows !== undefined && processorRows !== resolved.dataProcessorMinRows) {
      resolved.dataProcessorMinRows = processorRows;
      effects.needsRowRebuild = true;
    }
  }

  private updatePersistenceOptions(options: Partial<GridOptions<TData>>, effects: OptionUpdateEffects): void {
    const resolved = this.core.gridOptions;
    if (!hasOwnOption(options, "persistence")) return;
    resolved.persistence = normalizePersistence(options.persistence);
    effects.needsStateLoad = true;
  }

  private updateDatasourceOptions(options: Partial<GridOptions<TData>>, effects: OptionUpdateEffects): void {
    this.updateDatasourceTuning(options, effects);
    this.updateDatasourceMode(options, effects);
    this.updateDatasourceReference(options, effects);
    this.updatePinnedRows(options);
  }

  private updateDatasourceTuning(options: Partial<GridOptions<TData>>, effects: OptionUpdateEffects): void {
    const resolved = this.core.gridOptions;
    // Cache geometry/concurrency changes reset block ownership; soft tuning does not.
    for (const key of ["blockSize", "maxBlocksInCache", "datasourceMaxConcurrentRequests"] as const) {
      const value = normalizeFinite(options[key], 1, true);
      if (value === undefined || value === resolved[key]) continue;
      resolved[key] = value;
      effects.datasourceChanged ||= resolved.datasourceMode === "block";
    }
    for (const key of ["infiniteBufferRows", "blockPrefetch", "datasourceRetryCount", "datasourceRetryDelay"] as const) {
      const value = normalizeFinite(options[key], 0, true);
      if (value !== undefined) resolved[key] = value;
    }
    const retryJitter = normalizeFinite(options.datasourceRetryJitter, 0);
    if (retryJitter !== undefined) resolved.datasourceRetryJitter = Math.min(1, retryJitter);
  }

  private updateDatasourceMode(options: Partial<GridOptions<TData>>, effects: OptionUpdateEffects): void {
    const resolved = this.core.gridOptions;
    if (hasOwnOption(options, "datasourceMode")) {
      const mode = options.datasourceMode === "block" ? "block" : "sequential";
      if (mode !== resolved.datasourceMode) {
        resolved.datasourceMode = mode;
        effects.datasourceChanged = true;
      }
    }
    if (hasOwnOption(options, "datasourceRowCount")) {
      const rowCount = options.datasourceRowCount == null
        ? null
        : normalizeFinite(options.datasourceRowCount, 0, true) ?? null;
      if (rowCount !== resolved.datasourceRowCount) {
        resolved.datasourceRowCount = rowCount;
        effects.datasourceChanged = true;
      }
    }
  }

  private updateDatasourceReference(options: Partial<GridOptions<TData>>, effects: OptionUpdateEffects): void {
    const resolved = this.core.gridOptions;
    if (hasOwnOption(options, "datasource") && options.datasource !== resolved.datasource) {
      resolved.datasource = options.datasource;
      resolved.paginationEnabled = options.datasource == null && resolved.paginationEnabled;
      effects.datasourceChanged = true;
      this.core.paginationBar.rebuild();
    }
    if (copyOptions(options, resolved, ["detailRowRenderer", "isRowExpandable"], true)) effects.needsCellRefresh = true;
  }

  private updatePinnedRows(options: Partial<GridOptions<TData>>): void {
    const resolved = this.core.gridOptions;
    if (options.pinnedTopRowData !== undefined) {
      resolved.pinnedTopRowData = options.pinnedTopRowData ?? [];
      this.core.pinnedRowsRenderer.setRows("top", resolved.pinnedTopRowData);
    }
    if (options.pinnedBottomRowData !== undefined) {
      resolved.pinnedBottomRowData = options.pinnedBottomRowData ?? [];
      this.core.pinnedRowsRenderer.setRows("bottom", resolved.pinnedBottomRowData);
    }
  }

  private applyOptionUpdateEffects(
    options: Partial<GridOptions<TData>>,
    effects: OptionUpdateEffects,
    previousColumnMenu: boolean
  ): void {
    const resolved = this.core.gridOptions;
    if (effects.needsColumnRebuild) {
      this.core.columnModel.setColumnDefs(resolved.columnDefs);
      this.core.onColumnsStructureChanged();
      effects.needsHeaderRebuild = false;
      effects.needsPoolRebuild = false;
    }
    if (effects.needsStateLoad) {
      this.core.loadPersistedGridState();
      this.core.onColumnsStructureChanged();
    }
    if (effects.needsFeatureReload) this.core.setFeatures(resolved.features);
    this.applyRowUpdateEffect(effects);
    if (effects.filterChanged) {
      this.emitFilterChanged();
      if (!effects.datasourceChanged && !effects.needsRowRebuild) {
        if (this.core.rowModel.isInfinite) void this.core.rowModel.onServerParamsChanged();
        else {
          this.core.rowModel.refreshPipeline();
          this.core.requestUpdate({ data: true });
        }
      }
    }
    if (effects.needsRelayout) {
      this.core.skeleton.updateHeights(resolved.rowHeight, resolved.headerHeight);
    }
    if (options.columnMenu != null && options.columnMenu !== previousColumnMenu) {
      effects.needsHeaderRebuild = true;
    }
    if (effects.stateToApply) this.applyState(effects.stateToApply);
    this.core.requestUpdate({
      layout: effects.needsRelayout,
      header: effects.needsHeaderRebuild,
      pool: effects.needsPoolRebuild,
      cells: effects.needsCellRefresh && !effects.needsPoolRebuild ? true : undefined,
      summary: effects.needsSummaryRefresh,
      overlays: true
    });
  }

  private applyRowUpdateEffect(effects: OptionUpdateEffects): void {
    if (effects.datasourceChanged) {
      void this.core.rowModel.onDatasourceChanged();
      return;
    }
    if (!effects.needsRowRebuild) return;
    if (this.core.rowModel.isInfinite) {
      void this.core.rowModel.onServerParamsChanged();
      return;
    }
    this.core.rowModel.setRowData(this.core.gridOptions.rowData);
    this.core.requestUpdate({ data: true });
  }

  getDataAsCsv(params: CsvExportParams = {}): string {
    const rows = this.getDataAsMatrix({ ...params, target: "csv", protectFormulas: false });
    return buildCsv(rows, params);
  }

  getDataAsMatrix(params: MatrixExportParams = {}): unknown[][] {
    const cols = this.core.columnModel.getOrderedVisible().filter(column => !column.hasCheckbox && !column.isDetailToggle);
    const header = params.includeHeader === false ? [] : [cols.map(column => column.colDef.headerName ?? column.colDef.field ?? column.id)];
    if (params.headersOnly) return header;
    const nodes = params.onlySelected ? this.core.selectionService.getSelectedNodes().slice().sort((left, right) => left.rowIndex - right.rowIndex)
      : params.onlyAllDisplayed ? this.core.rowModel.getDisplayedRows() : this.core.rowModel.getPipelineRows();
    return [...header, ...nodes.filter(node => !node.isDetail && !node.isGroup).map(node => cols.map(column => {
      const value = serializeColumnValue(this.core, node, column, params.target ?? "xlsx");
      return params.protectFormulas === false ? value : sanitizeFormulaCell(value);
    }))];
  }

  getState(): GridState {
    return {
      version: 2,
      columns: this.getColumnState(),
      sortModel: this.getSortModel(),
      filterModel: this.getFilterModel(),
      advancedFilterModel: this.getAdvancedFilterModel(),
      quickFilterText: this.getQuickFilter(),
      pagination: {
        enabled: this.paginationEnabled(),
        page: this.getPage(),
        pageSize: this.getPageSize()
      },
      selectedRowIds: this.getSelectedIds(),
      expandedRowIds: this.core.rowModel.getExpandedRowIds(),
      expandedGroupIds: this.core.rowModel.getExpandedGroupIds()
    };
  }

  applyState(input: GridStateInput, options: ApplyGridStateOptions = {}): void {
    if (this.core.isDisposed()) return;
    const state = normalizeGridState(input);
    if (!state) {
      this.core.reportError(new TypeError("[MachTable] GridState must use the current version 2 schema."), "gridState.apply");
      return;
    }
    const all: readonly GridStateSection[] = ["columns", "sort", "filter", "pagination", "selection", "expansion"];
    const sections = new Set(options.sections ?? all);
    this.core.editingService.stop(true);

    this.restoreStateSections(state, sections);
    this.refreshAfterStateRestore(state, sections);
    if (options.emitEvents !== false) this.emitStateEvents(sections);
  }

  private restoreStateSections(state: GridState, sections: ReadonlySet<GridStateSection>): void {
    if (sections.has("columns")) {
      this.core.columnModel.applyColumnState(state.columns ?? []);
    }
    if (sections.has("sort")) this.core.columnModel.applySortModel(state.sortModel ?? []);
    if (sections.has("filter")) {
      this.core.rowModel.setFilterModel(state.filterModel ?? {});
      this.core.rowModel.setAdvancedFilterModel(state.advancedFilterModel);
      this.core.rowModel.setQuickFilter(state.quickFilterText);
    }
    if (sections.has("expansion")) {
      this.core.rowModel.restoreExpansion(state.expandedRowIds ?? [], state.expandedGroupIds ?? []);
    }
    if (sections.has("pagination") && state.pagination) {
      this.core.gridOptions.paginationEnabled = state.pagination.enabled && !this.core.rowModel.isInfinite;
      this.core.rowModel.restorePagination(state.pagination.page, state.pagination.pageSize);
      this.core.paginationBar.rebuild();
    }
  }

  private refreshAfterStateRestore(state: GridState, sections: ReadonlySet<GridStateSection>): void {
    if (sections.has("columns")) this.core.onColumnsStructureChanged();
    if (this.core.rowModel.isInfinite) {
      void this.core.rowModel.onServerParamsChanged();
    } else {
      this.core.rowModel.refreshPipeline();
      this.core.requestUpdate({ data: true });
    }
    this.core.headerRenderer.refreshSortIndicators();
    this.core.headerRenderer.refreshFilterIcons();
    if (sections.has("selection")) this.core.selectionService.restoreSelection(state.selectedRowIds ?? []);
  }

  private emitStateEvents(sections: ReadonlySet<GridStateSection>): void {
    if (sections.has("sort")) this.core.emit("sortChanged", { sortModel: this.getSortModel() });
    if (sections.has("filter")) this.emitFilterChanged();
    if (sections.has("pagination")) {
      this.core.emit("paginationChanged", {
        page: this.getPage(),
        pageSize: this.getPageSize(),
        pageCount: this.getPageCount(),
        total: this.getTotalRowCount()
      });
    }
  }

  getDiagnostics(): import("../types/api").GridDiagnostics {
    return this.core.getDiagnostics();
  }

  getPerformanceSnapshot(): import("../types/api").GridPerformanceSnapshot {
    return this.core.performanceMonitor.snapshot();
  }

  resetPerformanceMetrics(): void {
    this.core.performanceMonitor.reset();
  }

  setOverlay(type: "loading" | "noRows" | "error" | null): void {
    if (type !== "loading" && type !== "noRows" && type !== "error") {
      this.core.skeleton.hideOverlay();
      return;
    }
    const options = this.core.gridOptions;
    const content = type === "loading" ? options.overlayLoadingTemplate || this.core.buildDefaultLoadingState()
      : type === "noRows" ? options.overlayNoRowsTemplate || this.core.buildDefaultEmptyState()
      : options.overlayErrorTemplate || this.core.buildDefaultErrorState();
    this.core.skeleton.showOverlay(type, content, options.allowUnsafeOverlayHtml);
  }

  on<K extends import("../types/events").GridEventType>(
    eventType: K,
    listener: (event: any) => void
  ): () => void {
    return this.core.eventBus.on(eventType, listener);
  }

  destroy(): void {
    if (this.asyncTransactionTimer != null) clearTimeout(this.asyncTransactionTimer);
    this.asyncTransactionTimer = null;
    const entries = this.asyncTransactions;
    this.asyncTransactions = [];
    for (const entry of entries) {
      if (entry.signal && entry.onAbort) entry.signal.removeEventListener("abort", entry.onAbort);
      if (!entry.aborted) entry.resolve();
    }
    this.core.destroy();
  }

}

type BaseCommandKey = "batch" | "whenReady" | "getOption" | "updateOptions" | "on" | "destroy" | "isDestroyed";
type DomainFactories = {
  [Key in Exclude<keyof GridApi, BaseCommandKey>]: (impl: GridApiImpl<any>) => GridApi[Key]
};
// Each public domain has one lazy, frozen instance and no independent state.
const DOMAIN_FACTORIES = {
  rows: createGridRowsApi,
  columns: createGridColumnsApi,
  selection: createGridSelectionApi,
  editing: createGridEditingApi,
  filtering: createGridFilteringApi,
  sorting: createGridSortingApi,
  pagination: createGridPaginationApi,
  hierarchy: createGridHierarchyApi,
  view: createGridViewApi,
  state: createGridStateApi,
  io: createGridIoApi,
  diagnostics: createGridDiagnosticsApi,
} satisfies DomainFactories;

/** Creates the deliberately small public facade; GridApiImpl never escapes Core. */
export function createGridApi<TData>(core: GridCore<TData>): GridApi<TData> {
  const impl = new GridApiImpl(core);
  const api = {} as GridApi<TData>;
  for (const [key, create] of Object.entries(DOMAIN_FACTORIES)) {
    let domain: object | undefined;
    Object.defineProperty(api, key, {
      enumerable: true,
      get: () => domain ??= Object.freeze(create(impl))
    });
  }
  Object.assign(api, {
    batch: (callback) => impl.batch(callback),
    whenReady: () => core.whenReady(),
    getOption: (key) => impl.getOption(key),
    updateOptions: (options) => impl.updateOptions(options),
    on: (eventType, listener) => impl.on(eventType, listener),
    destroy: () => impl.destroy(),
    isDestroyed: () => core.isDisposed()
  } satisfies Pick<GridApi<TData>, BaseCommandKey>);
  attachImportContext(api, core);
  attachAdapterLifecycle(api, {
    suspend: () => core.suspend(), resume: () => api.view.refreshLayout(),
    canReplaceData: () => !core.editingService.isEditing() && core.changeTracker.getDirtyRowIds().length === 0,
    readCell: (rowId, colId) => {
      const node = core.rowModel.getNodeById(rowId);
      const column = core.columnModel.getColumn(colId);
      return node && column ? clipboardText(serializeColumnValue(core, node, column, "clipboard")) : "";
    },
    writeInput: (cells) => core.applyInputChanges(cells.flatMap(({ rowId, colId, value }) => {
      const node = core.rowModel.getNodeById(rowId);
      const column = core.columnModel.getColumn(colId);
      return node && column ? [{ node, column, oldValue: core.readCellValue(node, column), newValue: value }] : [];
    }))
  });
  return Object.freeze(api);
}
