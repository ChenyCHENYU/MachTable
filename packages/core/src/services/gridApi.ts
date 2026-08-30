import type { GridCore } from "../core/gridCore";
import type { CsvExportParams, ImportCsvOptions, RowTransaction } from "../types/api";
import type { GridApi } from "../types/api";
import type { GridOptions } from "../types/options";
import type { ApplyGridStateOptions, GridState, GridStateInput, GridStateSection } from "../types/state";
import type { AdvancedFilterModel } from "../types/advancedFilter";
import type { Column } from "./column";
import { EVENT_TYPES } from "../types/events";
import type { ColDefOrGroup, ColumnState, FilterModel, SortModel } from "../types/colDef";
import { DEFAULT_COL_DEF, GRID_SIZE_PRESETS, rowIdFromKey } from "../core/resolveOptions";
import { buildCsv } from "../lib/csv";
import { parseCsv, toTsv } from "../lib/clipboard";
import { escapeHtml } from "../lib/download";
import { setByPath } from "../lib/path";
import { formatCellValue } from "../render/cellContent";
import { sanitizeGridOptionPatch } from "../core/gridOptionRuntime";
import { migrateGridState } from "../lib/gridState";
import { createSaveSnapshot, normalizeBatchSaveResult } from "../lib/batchSave";

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
  stateToApply?: GridStateInput;
}

interface CsvFieldBinding {
  field: string;
  index: number;
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
    needsSummaryRefresh: false
  };
}

function hasOwnOption<T extends object>(options: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(options, key);
}

function normalizeFinite(value: unknown, min: number, integer = false): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min) return undefined;
  return integer ? Math.floor(value) : value;
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

export class GridApiImpl<TData = any> implements GridApi<TData> {
  private measureCanvas: HTMLCanvasElement | null = null;
  private asyncTransactions: RowTransaction<TData>[] = [];
  private asyncTransactionTimer: ReturnType<typeof setTimeout> | null = null;
  private asyncTransactionResolvers: Array<() => void> = [];

  constructor(private core: GridCore<TData>) {}

  whenReady(): Promise<import("../types/api").GridApi<TData>> {
    return this.core.whenReady();
  }

  getRootElement(): HTMLElement | null {
    return this.core.isDestroyed() ? null : this.core.skeleton.root;
  }

  setRowData(rows: TData[] | null | undefined): void {
    if (this.core.isDestroyed()) return;
    this.core.options.rowData = rows ?? [];
    if (this.core.rowModel.isInfinite) return;
    this.core.rowModel.setRowData(rows);
    this.core.bodyRenderer.onDataChanged();
  }

  applyTransaction(transaction: RowTransaction<TData>): void {
    if (this.core.isDestroyed() || this.core.rowModel.isInfinite) return;
    this.core.rowModel.applyTransaction(transaction);
    this.core.bodyRenderer.onDataChanged();
  }

  applyTransactionAsync(transaction: RowTransaction<TData>): Promise<void> {
    if (this.core.isDestroyed() || this.core.rowModel.isInfinite) return Promise.resolve();
    this.asyncTransactions.push(transaction);
    if (this.asyncTransactionTimer == null) {
      this.asyncTransactionTimer = setTimeout(
        () => this.flushAsyncTransactions(),
        this.core.options.asyncTransactionWaitMillis
      );
    }
    return new Promise((resolve) => this.asyncTransactionResolvers.push(resolve));
  }

  flushAsyncTransactions(): void {
    if (this.asyncTransactionTimer != null) clearTimeout(this.asyncTransactionTimer);
    this.asyncTransactionTimer = null;
    const transactions = this.asyncTransactions;
    const resolvers = this.asyncTransactionResolvers;
    this.asyncTransactions = [];
    this.asyncTransactionResolvers = [];
    if (transactions.length > 0 && !this.core.isDestroyed() && !this.core.rowModel.isInfinite) {
      this.core.rowModel.applyTransactions(transactions);
      this.core.bodyRenderer.onDataChanged();
    }
    for (const resolve of resolvers) resolve();
  }

  getColumnDefs(): ColDefOrGroup<TData>[] | null {
    return this.core.columnModel.getColumnDefs() as ColDefOrGroup<TData>[];
  }

  setColumnDefs(colDefs: ColDefOrGroup<TData>[] | null | undefined): void {
    if (this.core.isDestroyed()) return;
    this.core.options.columnDefs = colDefs ?? [];
    this.core.columnModel.setColumnDefs(colDefs);
    this.core.loadPersistedColumnState();
    this.core.onColumnsStructureChanged();
    if (this.core.rowModel.isInfinite) void this.core.rowModel.onServerParamsChanged();
    else {
      this.core.rowModel.refreshPipeline();
      this.core.bodyRenderer.onDataChanged();
    }
  }

  getColumnState(): ColumnState[] {
    return this.core.columnModel.getColumnState();
  }

  setColumnState(state: ColumnState[]): void {
    if (this.core.isDestroyed()) return;
    this.core.columnModel.applyColumnState(state);
    this.core.onColumnsStructureChanged();
    this.core.applySortModel();
    this.core.persistColumnState();
  }

  resetColumnState(): void {
    if (this.core.isDestroyed()) return;
    this.core.columnModel.resetColumnState();
    this.core.onColumnsStructureChanged();
    this.core.applySortModel();
    this.core.persistColumnState();
  }

  setColumnVisibility(colId: string, visible: boolean): void {
    if (this.core.isDestroyed()) return;
    this.core.columnModel.setColumnVisibility(colId, visible);
    this.core.onColumnsStructureChanged();
    this.core.emit("columnVisibilityChanged", { colId, visible });
    this.core.persistColumnState();
  }

  moveColumn(colId: string, toIndex: number): void {
    if (this.core.isDestroyed()) return;
    this.core.moveColumn(colId, toIndex);
  }

  setColumnPinned(colId: string, pinned: "left" | "right" | null): void {
    if (this.core.isDestroyed()) return;
    this.core.columnModel.setColumnPinned(colId, pinned);
    this.core.onColumnsStructureChanged();
    this.core.persistColumnState();
  }

  setColumnWidth(colId: string, width: number): boolean {
    if (this.core.isDestroyed()) return false;
    const column = this.core.columnModel.getColumn(colId);
    if (!column || !this.core.columnModel.setColumnWidth(column, width)) return false;
    this.core.relayoutColumns();
    this.core.commitColumnWidths([column]);
    return true;
  }

  sizeColumnsToFit(width?: number): void {
    if (this.core.isDestroyed()) return;
    const cols = this.core.columnModel.getOrderedVisible();
    if (cols.length === 0) return;
    const target = width ?? this.core.skeleton.measureViewportWidth();
    if (target <= 0) return;
    const total = cols.reduce((acc, c) => acc + c.currentWidth, 0);
    if (total <= 0) return;
    const changed = cols.filter((col) =>
      this.core.columnModel.setColumnWidth(col, Math.max(30, Math.floor((col.currentWidth * target) / total)))
    );
    this.core.relayoutColumns();
    this.core.commitColumnWidths(changed);
  }

  autoSizeColumn(colId: string, skipHeader = false): void {
    if (this.core.isDestroyed()) return;
    const column = this.core.columnModel.getColumn(colId);
    if (!column) return;

    if (this.autoSizeColumnInternal(column, skipHeader)) {
      this.core.relayoutColumns();
      this.core.commitColumnWidths([column]);
    }
  }

  private autoSizeColumnInternal(
    column: Column<TData>,
    skipHeader: boolean
  ): boolean {

    if (column.hasCheckbox || column.isDetailToggle) {
      return this.core.columnModel.setColumnWidth(column, column.isDetailToggle ? 38 : 46);
    }

    this.measureCanvas ??= document.createElement("canvas");
    const ctx = this.measureCanvas.getContext("2d");
    if (!ctx) return false;
    const style = window.getComputedStyle(this.core.skeleton.root);
    ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;

    let maxWidth = 0;
    const consider = (text: string) => {
      if (!text) return;
      const w = ctx.measureText(text).width;
      if (w > maxWidth) maxWidth = w;
    };

    if (!skipHeader) {
      consider(column.colDef.headerName ?? column.colDef.field ?? column.id);
    }
    const nodes = this.core.rowModel.getAllNodes();
    const cap = Math.min(nodes.length, 2000);
    for (let i = 0; i < cap; i++) {
      consider(formatCellValue(this.core, nodes[i], column));
    }

    const extra = (column.sortable ? 20 : 0) + (column.filterable ? 28 : 0) + (this.core.options.columnMenu ? 22 : 0) + 28;
    return this.core.columnModel.setColumnWidth(column, Math.ceil(maxWidth) + extra);
  }

  autoSizeAllColumns(skipHeader?: boolean): void {
    if (this.core.isDestroyed()) return;
    const changed: Column<TData>[] = [];
    for (const col of this.core.columnModel.getOrderedVisible()) {
      if (this.autoSizeColumnInternal(col, skipHeader ?? false)) changed.push(col);
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
    if (this.core.isDestroyed()) return;
    this.core.columnModel.applySortModel(sortModel);
    this.core.applySortModel();
  }

  getFilterModel(): FilterModel {
    return this.core.rowModel.getFilterModel();
  }

  setFilterModel(filterModel: FilterModel | null): void {
    if (this.core.isDestroyed()) return;
    this.core.rowModel.setFilterModel(filterModel);
    this.core.headerRenderer.refreshFilterIcons();
    this.emitFilterChanged();
    if (this.core.rowModel.isInfinite) {
      void this.core.rowModel.onServerParamsChanged();
      return;
    }
    this.core.rowModel.refreshPipeline();
    this.core.bodyRenderer.onDataChanged();
  }

  getAdvancedFilterModel(): AdvancedFilterModel | null {
    return this.core.rowModel.getAdvancedFilterModel();
  }

  setAdvancedFilterModel(model: AdvancedFilterModel | null): void {
    if (this.core.isDestroyed() || !this.core.rowModel.setAdvancedFilterModel(model)) return;
    this.emitFilterChanged();
    if (this.core.rowModel.isInfinite) {
      void this.core.rowModel.onServerParamsChanged();
      return;
    }
    this.core.rowModel.refreshPipeline();
    this.core.bodyRenderer.onDataChanged();
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
    if (this.core.isDestroyed()) return;
    this.core.options.quickFilterText = text != null && text.trim() !== "" ? text : null;
    if (this.core.rowModel.setQuickFilter(text)) {
      this.core.applyQuickFilter();
    }
  }

  getQuickFilter(): string | null {
    return this.core.rowModel.getQuickFilter();
  }

  getRowSelection(): "none" | "single" | "multiple" {
    return this.core.options.rowSelection;
  }

  setRowSelection(mode: "none" | "single" | "multiple"): void {
    if (this.core.isDestroyed()) return;
    if (this.core.options.rowSelection === mode) return;
    this.core.options.rowSelection = mode;
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
    if (this.core.isDestroyed()) return false;
    return this.core.rowModel.expandRow(rowId);
  }

  collapseRow(rowId: string): boolean {
    if (this.core.isDestroyed()) return false;
    return this.core.rowModel.collapseRow(rowId);
  }

  toggleDetailRow(rowId: string): boolean {
    if (this.core.isDestroyed()) return false;
    return this.core.rowModel.toggleDetail(rowId);
  }

  isRowExpanded(rowId: string): boolean {
    return this.core.rowModel.isRowExpanded(rowId);
  }

  expandAllDetails(): void {
    if (this.core.isDestroyed()) return;
    this.core.rowModel.expandAllDetails();
  }

  collapseAllDetails(): void {
    if (this.core.isDestroyed()) return;
    this.core.rowModel.collapseAllDetails();
  }

  loadTreeChildren(rowId: string, options: { force?: boolean } = {}): Promise<readonly TData[]> {
    if (this.core.isDestroyed()) return Promise.resolve([]);
    return this.core.rowModel.loadTreeChildren(rowId, options.force === true);
  }

  retryTreeChildren(rowId: string): Promise<readonly TData[]> {
    return this.loadTreeChildren(rowId, { force: true });
  }

  isTreeRowLoading(rowId: string): boolean {
    return !this.core.isDestroyed() && this.core.rowModel.isTreeRowLoading(rowId);
  }

  toggleRowGroup(groupId: string): boolean {
    if (this.core.isDestroyed()) return false;
    return this.core.rowModel.toggleGroup(groupId);
  }

  reorderRows(fromIndex: number, toIndex: number): boolean {
    if (this.core.isDestroyed()) return false;
    return this.core.rowModel.reorderRowsByDisplayed(fromIndex, toIndex);
  }

  isGroupExpanded(groupId: string): boolean {
    return this.core.rowModel.isGroupExpanded(groupId);
  }

  expandAllGroups(): void {
    if (this.core.isDestroyed()) return;
    this.core.rowModel.expandAllGroups();
  }

  collapseAllGroups(): void {
    if (this.core.isDestroyed()) return;
    this.core.rowModel.collapseAllGroups();
  }

  setSelection(rows: TData[], clearOthers = true): void {
    if (this.core.isDestroyed()) return;
    const getRowId = this.core.options.getRowId;
    const changes: { node: any; selected: boolean }[] = [];
    for (const row of rows) {
      const node = getRowId
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
    if (this.core.isDestroyed()) return false;
    return this.core.undoService.undo();
  }

  redo(): boolean {
    if (this.core.isDestroyed()) return false;
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

  async saveChanges(
    handler: import("../types/api").SaveChangesHandler<TData>,
    rowIds?: readonly string[]
  ): Promise<import("../types/api").GridChange<TData>[]> {
    return (await this.saveChangesDetailed(handler, rowIds)).saved;
  }

  async saveChangesDetailed(
    handler: import("../types/api").SaveChangesHandler<TData>,
    rowIds?: readonly string[]
  ): Promise<import("../types/api").GridBatchSaveResult<TData>> {
    const snapshot = createSaveSnapshot(this.core.changeTracker.getChanges(), rowIds);
    if (snapshot.length === 0) return { submitted: [], saved: [], failures: [], conflicts: [] };
    const result = normalizeBatchSaveResult(snapshot, await handler(snapshot));
    if (!this.core.isDestroyed()) this.core.changeTracker.acknowledge(result.saved);
    return result;
  }

  rollbackChanges(rowIds?: readonly string[]): boolean {
    return this.core.changeTracker.rollback(rowIds);
  }

  setPinnedTopRowData(rows: TData[] | null): void {
    if (this.core.isDestroyed()) return;
    this.core.options.pinnedTopRowData = rows ?? [];
    this.core.pinnedRowsRenderer.setTopData(this.core.options.pinnedTopRowData);
  }

  getPinnedTopRowData(): TData[] {
    return this.core.pinnedRowsRenderer.getTopData();
  }

  setPinnedBottomRowData(rows: TData[] | null): void {
    if (this.core.isDestroyed()) return;
    this.core.options.pinnedBottomRowData = rows ?? [];
    this.core.pinnedRowsRenderer.setBottomData(this.core.options.pinnedBottomRowData);
  }

  getPinnedBottomRowData(): TData[] {
    return this.core.pinnedRowsRenderer.getBottomData();
  }

  getRangeSelection(): import("../types/events").GridCellRange | null {
    return this.core.bodyRenderer.getRangeSelection();
  }

  clearRangeSelection(): void {
    if (this.core.isDestroyed()) return;
    this.core.bodyRenderer.clearRangeSelection();
  }

  copyRangeToClipboard(): Promise<boolean> {
    if (this.core.isDestroyed()) return Promise.resolve(false);
    return this.core.copyActiveRange();
  }

  openColumnPanel(anchor?: HTMLElement): void {
    this.openColumnWorkbench(anchor);
  }

  openColumnWorkbench(anchor?: HTMLElement): void {
    if (this.core.isDestroyed()) return;
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
    if (this.core.isDestroyed()) return;
    this.core.relayout();
    this.core.bodyRenderer.syncScroll();
  }

  isInfinite(): boolean {
    return this.core.rowModel.isInfinite;
  }

  reload(): Promise<void> {
    if (this.core.isDestroyed()) return Promise.resolve();
    if (this.core.rowModel.isInfinite) {
      return this.core.rowModel.reloadInfinite();
    } else {
      this.core.rowModel.setRowData(this.core.options.rowData);
      this.core.bodyRenderer.onDataChanged();
      return Promise.resolve();
    }
  }

  paginationEnabled(): boolean {
    return this.core.rowModel.paginationActive;
  }

  setPaginationEnabled(enabled: boolean): void {
    if (this.core.isDestroyed()) return;
    this.core.rowModel.setPaginationEnabled(enabled);
  }

  getPage(): number {
    return this.core.rowModel.getCurrentPage();
  }

  setPage(page: number): void {
    if (this.core.isDestroyed()) return;
    this.core.rowModel.setPage(page);
  }

  getPageSize(): number {
    return this.core.options.paginationPageSize;
  }

  setPageSize(size: number): void {
    if (this.core.isDestroyed()) return;
    this.core.rowModel.setPageSize(size);
  }

  getPageCount(): number {
    return this.core.rowModel.getPageCount();
  }

  getTotalRowCount(): number {
    return this.core.rowModel.getTotalRowCount();
  }

  importCsv(text: string, options: ImportCsvOptions = {}): boolean {
    if (this.core.isDestroyed() || !text) return false;
    const grid = parseCsv(text, options.separator ?? ",");
    if (grid.length === 0) return false;
    const headerRow = grid[options.headerRowIndex ?? 0] ?? [];
    const body = grid.slice((options.headerRowIndex ?? 0) + 1).filter((r) => r.some((c) => c !== ""));
    const mode = options.mode ?? "replace";

    if (mode === "paste") {
      this.core.pasteText(toTsv(body, false), 0, 0);
      return true;
    }

    const columns = this.core.columnModel.getOrderedVisible().filter((column) => column.colDef.field);
    const fieldOrder = this.resolveCsvFieldOrder(headerRow, columns);
    const records = this.buildCsvRecords(body, fieldOrder, options);

    if (mode === "append") {
      this.core.rowModel.applyTransaction({ add: records as unknown as TData[] });
    } else {
      this.core.rowModel.setRowData(records as unknown as TData[]);
    }
    this.core.bodyRenderer.onDataChanged();
    return true;
  }

  private resolveCsvFieldOrder(headerRow: string[], columns: readonly Column[]): CsvFieldBinding[] {
    const byHeader = new Map<string, string>();
    for (const column of columns) {
      const field = column.colDef.field;
      if (!field) continue;
      byHeader.set(String(column.colDef.headerName ?? field), field);
      byHeader.set(field, field);
    }
    if (headerRow.length > 0) headerRow[0] = headerRow[0].replace(/^\uFEFF/, "");
    const matched = headerRow
      .map((header, index) => ({ field: byHeader.get(String(header).trim()) ?? null, index }))
      .filter((entry): entry is { field: string; index: number } => entry.field != null);
    if (matched.length > 0) return matched;
    return columns.map((column, index) => ({ field: column.colDef.field!, index }));
  }

  private buildCsvRecords(
    rows: string[][],
    fieldOrder: CsvFieldBinding[],
    options: ImportCsvOptions
  ): Array<Record<string, any>> {
    return rows.map((row, rowIndex) => {
      const record: Record<string, any> = {};
      fieldOrder.forEach(({ field, index }) => {
        const raw = row[index];
        if (raw === undefined) return;
        const value = this.parseCsvValue(raw, field, rowIndex, index, options);
        if (!setByPath(record, field, value)) {
          this.core.reportError(new Error(`Unsafe CSV field: ${field}`), "csv.import", { field });
        }
      });
      return record;
    });
  }

  private parseCsvValue(
    raw: string,
    field: string,
    rowIndex: number,
    columnIndex: number,
    options: ImportCsvOptions
  ): any {
    if (options.parseValue) {
      try {
        return options.parseValue({ value: raw, field, rowIndex, columnIndex });
      } catch (error) {
        this.core.reportError(error, "csv.parseValue", { field, rowIndex, columnIndex });
        return raw;
      }
    }
    if (raw === "") return null;
    const isNumeric = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw);
    const hasLeadingZero = /^[+-]?0\d/.test(raw);
    return options.coerceNumbers !== false && isNumeric && !hasLeadingZero ? Number(raw) : raw;
  }

  print(options: import("../types/api").PrintOptions = {}): boolean {
    if (this.core.isDestroyed()) return false;
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

  stopEditing(cancel?: boolean): void {
    this.core.editingService.stop(cancel ?? false);
  }

  stopEditingAsync(cancel?: boolean): Promise<boolean> {
    return this.core.editingService.stopAsync(cancel ?? false);
  }

  stopEditingRow(cancel?: boolean): Promise<boolean> {
    return this.core.editingService.stopRowAsync(cancel ?? false);
  }

  refreshCells(): void {
    this.core.bodyRenderer.refreshAllCells();
    this.core.pinnedRowsRenderer.refresh();
    this.core.summaryRenderer.refresh();
  }

  getGridOption<K extends keyof GridOptions<TData>>(key: K): GridOptions<TData>[K] {
    return (this.core.options as unknown as GridOptions<TData>)[key];
  }

  setGridOption<K extends keyof GridOptions<TData>>(key: K, value: GridOptions<TData>[K]): void {
    this.updateOptions({ [key]: value });
  }

  updateOptions(options: Partial<GridOptions<TData>>): void {
    if (this.core.isDestroyed()) return;
    this.core.checkWarnings(options);
    options = sanitizeGridOptionPatch(options);
    const effects = createOptionUpdateEffects();
    const previousColumnMenu = this.core.options.columnMenu;

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
  }

  private updateSourceOptions(options: Partial<GridOptions<TData>>, effects: OptionUpdateEffects): void {
    const resolved = this.core.options;
    if (hasOwnOption(options, "columnDefs") && options.columnDefs !== resolved.columnDefs) {
      resolved.columnDefs = Array.isArray(options.columnDefs) ? options.columnDefs : [];
      effects.needsColumnRebuild = true;
      effects.needsRowRebuild = true;
    }
    if (hasOwnOption(options, "rowData")) {
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
      if (hasOwnOption(options, key)) Object.assign(this.core.options, { [key]: options[key] });
    }
  }

  private updateDimensionOptions(options: Partial<GridOptions<TData>>, effects: OptionUpdateEffects): void {
    const resolved = this.core.options;
    const rowHeight = changedFinite(options.rowHeight, resolved.rowHeight, 1);
    const headerHeight = changedFinite(options.headerHeight, resolved.headerHeight, 1);
    const rowBuffer = changedFinite(options.rowBuffer, resolved.rowBuffer, 0, true);
    const detailHeight = changedFinite(options.detailRowHeight, resolved.detailRowHeight, 1);

    if (rowHeight !== undefined) {
      resolved.rowHeight = rowHeight;
      effects.needsRelayout = true;
    }
    if (headerHeight !== undefined) {
      resolved.headerHeight = headerHeight;
      effects.needsRelayout = true;
      effects.needsHeaderRebuild = true;
    }
    if (rowBuffer !== undefined) {
      resolved.rowBuffer = rowBuffer;
      effects.needsRelayout = true;
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
    if (options.multiSort != null) resolved.multiSort = options.multiSort;
    if (detailHeight !== undefined) {
      resolved.detailRowHeight = detailHeight;
      this.core.bodyRenderer.applyContainerSizes();
      this.core.bodyRenderer.updateRange(true);
    }
  }

  private updateEditingOptions(options: Partial<GridOptions<TData>>, effects: OptionUpdateEffects): void {
    const resolved = this.core.options;
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
    if (hasOwnOption(options, "rowEditValidator")) resolved.rowEditValidator = options.rowEditValidator;
    if (options.singleClickEdit != null) resolved.singleClickEdit = options.singleClickEdit;
    if (options.manualSorting != null) resolved.manualSorting = options.manualSorting;
    if (options.manualFiltering != null) resolved.manualFiltering = options.manualFiltering;
  }

  private updateInteractionOptions(options: Partial<GridOptions<TData>>, effects: OptionUpdateEffects): void {
    const resolved = this.core.options;
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
    const changed = this.core.options.getRowHeight !== options.getRowHeight;
    this.core.options.getRowHeight = options.getRowHeight;
    if (changed) this.core.bodyRenderer.invalidateAllRowHeights();
    effects.needsRelayout = true;
  }

  private updateRangeAndFeedbackOptions(options: Partial<GridOptions<TData>>): void {
    const resolved = this.core.options;
    if (options.enableRangeSelection != null) {
      resolved.enableRangeSelection = options.enableRangeSelection;
      if (!options.enableRangeSelection) this.clearRangeSelection();
    }
    if (hasOwnOption(options, "tooltipComponent")) resolved.tooltipComponent = options.tooltipComponent;
    const tooltipDelay = normalizeFinite(options.tooltipShowDelay, 0);
    if (tooltipDelay !== undefined) resolved.tooltipShowDelay = tooltipDelay;
    if (options.flashCells != null) resolved.flashCells = options.flashCells;
    if (hasOwnOption(options, "getContextMenuItems")) {
      resolved.getContextMenuItems = options.getContextMenuItems;
    }
    if (options.theme != null && options.theme !== resolved.theme) {
      resolved.theme = options.theme;
      this.core.skeleton.applyTheme(options.theme);
      this.core.watermarkService.refresh();
    }
  }

  private updatePaginationOptions(options: Partial<GridOptions<TData>>): void {
    if (options.pagination === undefined) return;
    const resolved = this.core.options;
    const config = options.pagination;
    const enabled = config !== false && resolved.datasource == null;
    if (enabled !== resolved.paginationEnabled) this.core.rowModel.setPaginationEnabled(enabled);
    if (typeof config === "object" && config) this.updatePaginationConfig(config);
    if (resolved.paginationEnabled) this.core.rowModel.onPaginationOptionsChanged();
    this.core.paginationBar.rebuild();
  }

  private updatePaginationConfig(config: Exclude<GridOptions<TData>["pagination"], boolean | undefined>): void {
    const resolved = this.core.options;
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
    this.updateWatermarkAndStatus(options, effects);
    this.updateSizePreset(options, effects);
    const resolved = this.core.options;
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
    const resolved = this.core.options;
    if (options.watermark !== undefined) {
      resolved.watermarkEnabled = options.watermark != null && options.watermark !== false;
      resolved.watermarkConfig =
        options.watermark == null || options.watermark === false
          ? null
          : options.watermark === true
            ? { text: "MachTable" }
            : options.watermark;
      this.core.watermarkService.refresh();
    }
    this.updateStatusOptions(options);
    if (hasOwnOption(options, "summaryMethod")) {
      resolved.summaryMethod = options.summaryMethod;
      effects.needsSummaryRefresh = true;
    }
  }

  private updateStatusOptions(options: Partial<GridOptions<TData>>): void {
    const resolved = this.core.options;
    if (options.suppressClipboard != null) resolved.suppressClipboard = options.suppressClipboard;
    if (options.contextMenu != null) resolved.contextMenu = options.contextMenu;
    if (options.columnMenu != null) resolved.columnMenu = options.columnMenu;
    if (options.fillHandle != null) resolved.fillHandle = options.fillHandle;
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
    if (size == null || !hasOwnOption(GRID_SIZE_PRESETS, size) || size === this.core.options.size) return;
    const preset = GRID_SIZE_PRESETS[size];
    this.core.options.size = size;
    this.core.options.rowHeight = options.rowHeight ?? preset.rowHeight;
    this.core.options.headerHeight = options.headerHeight ?? preset.headerHeight;
    this.core.skeleton.applySize(size);
    effects.needsRelayout = true;
    effects.needsHeaderRebuild = true;
  }

  private updateAccessibilityOptions(options: Partial<GridOptions<TData>>, effects: OptionUpdateEffects): void {
    const resolved = this.core.options;
    if (options.suppressCellFocus != null) resolved.suppressCellFocus = options.suppressCellFocus;
    if (options.suppressRowHoverHighlight != null) {
      resolved.suppressRowHoverHighlight = options.suppressRowHoverHighlight;
    }
    if (options.suppressNoRowsOverlay != null) resolved.suppressNoRowsOverlay = options.suppressNoRowsOverlay;
    if (options.suppressHeaderFocus != null && options.suppressHeaderFocus !== resolved.suppressHeaderFocus) {
      resolved.suppressHeaderFocus = options.suppressHeaderFocus;
      effects.needsHeaderRebuild = true;
    }
    this.updateAriaLabels(options);
    this.updateOverlayOptions(options);
  }

  private updateAriaLabels(options: Partial<GridOptions<TData>>): void {
    const resolved = this.core.options;
    let changed = false;
    if (hasOwnOption(options, "ariaLabel")) {
      resolved.ariaLabel = options.ariaLabel ?? "MachTable data grid";
      changed = true;
    }
    if (hasOwnOption(options, "ariaLabelledBy")) {
      resolved.ariaLabelledBy = options.ariaLabelledBy ?? "";
      changed = true;
    }
    if (hasOwnOption(options, "ariaDescribedBy")) {
      resolved.ariaDescribedBy = options.ariaDescribedBy ?? "";
      changed = true;
    }
    if (changed) this.core.skeleton.applyAriaLabels(resolved);
  }

  private updateOverlayOptions(options: Partial<GridOptions<TData>>): void {
    const resolved = this.core.options;
    if (hasOwnOption(options, "overlayNoRowsTemplate")) {
      resolved.overlayNoRowsTemplate = options.overlayNoRowsTemplate ?? "";
    }
    if (hasOwnOption(options, "overlayLoadingTemplate")) {
      resolved.overlayLoadingTemplate = options.overlayLoadingTemplate ?? "";
    }
    if (hasOwnOption(options, "overlayErrorTemplate")) {
      resolved.overlayErrorTemplate = options.overlayErrorTemplate ?? "";
    }
    if (options.allowUnsafeOverlayHtml != null) resolved.allowUnsafeOverlayHtml = options.allowUnsafeOverlayHtml;
    if (hasOwnOption(options, "className")) {
      resolved.className = options.className ?? "";
      this.core.skeleton.setCustomClass(resolved.className);
    }
    if (options.loading != null) resolved.loading = options.loading;
    if (hasOwnOption(options, "error")) resolved.error = options.error ?? null;
  }

  private updateRowModelOptions(options: Partial<GridOptions<TData>>, effects: OptionUpdateEffects): void {
    this.updateSelectionAndColumns(options, effects);
    this.updateHierarchyOptions(options, effects);
    const resolved = this.core.options;
    if (options.autoCheckedChildren != null) resolved.autoCheckedChildren = options.autoCheckedChildren;
    if (options.defaultExpandAll != null && options.defaultExpandAll !== resolved.defaultExpandAll) {
      resolved.defaultExpandAll = options.defaultExpandAll;
      effects.needsRowRebuild = true;
    }
    if (hasOwnOption(options, "advancedFilterModel")) {
      effects.filterChanged = this.core.rowModel.setAdvancedFilterModel(options.advancedFilterModel) || effects.filterChanged;
    }
    if (options.applyRowDrag != null) resolved.applyRowDrag = options.applyRowDrag;
    if (options.suppressWarnings != null) resolved.suppressWarnings = options.suppressWarnings;
  }

  private updateSelectionAndColumns(options: Partial<GridOptions<TData>>, effects: OptionUpdateEffects): void {
    const resolved = this.core.options;
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
    if (hasOwnOption(options, "getRowId") && options.getRowId !== resolved.getRowId) {
      resolved.getRowId = options.getRowId;
      effects.needsRowRebuild = true;
    }
    if (hasOwnOption(options, "rowKey")) {
      resolved.rowKey = options.rowKey;
      if (!hasOwnOption(options, "getRowId")) {
        const rowKey = options.rowKey;
        resolved.getRowId = rowKey
          ? ({ data }) => rowIdFromKey(rowKey, data)
          : undefined;
      }
      effects.needsRowRebuild = true;
    }
  }

  private updateHierarchyOptions(options: Partial<GridOptions<TData>>, effects: OptionUpdateEffects): void {
    const resolved = this.core.options;
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
    if (hasOwnOption(options, "isTreeRowExpandable")) {
      resolved.isTreeRowExpandable = options.isTreeRowExpandable;
      effects.needsCellRefresh = true;
    }
    if (hasOwnOption(options, "loadTreeChildren")) {
      resolved.loadTreeChildren = options.loadTreeChildren;
      effects.needsCellRefresh = true;
    }
  }

  private updateExtensionOptions(options: Partial<GridOptions<TData>>, effects: OptionUpdateEffects): void {
    const resolved = this.core.options;
    let reloadGridState = false;
    if (hasOwnOption(options, "aggFuncs")) {
      resolved.aggFuncs = options.aggFuncs;
      effects.needsRowRebuild = true;
    }
    if (hasOwnOption(options, "components")) {
      resolved.components = options.components;
      effects.needsCellRefresh = true;
    }
    if (hasOwnOption(options, "actionPolicy")) {
      resolved.actionPolicy = options.actionPolicy;
      effects.needsCellRefresh = true;
    }
    if (hasOwnOption(options, "features")) {
      resolved.features = Array.isArray(options.features) ? options.features : [];
      this.core.setFeatures(resolved.features);
    }
    if (hasOwnOption(options, "columnStateStore")) {
      resolved.columnStateStore = options.columnStateStore;
      effects.needsStateLoad = true;
    }
    if (hasOwnOption(options, "columnStateKey")) {
      resolved.columnStateKey = options.columnStateKey ?? null;
      effects.needsStateLoad = true;
    }
    if (hasOwnOption(options, "stateStore")) {
      resolved.stateStore = options.stateStore;
      reloadGridState = true;
    }
    if (hasOwnOption(options, "stateKey")) {
      resolved.stateKey = options.stateKey ?? null;
      reloadGridState = true;
    }
    const stateDebounce = normalizeFinite(options.stateSaveDebounceMs, 0, true);
    if (stateDebounce !== undefined) resolved.stateSaveDebounceMs = stateDebounce;
    if (reloadGridState) this.core.loadPersistedGridState();
  }

  private updateDatasourceOptions(options: Partial<GridOptions<TData>>, effects: OptionUpdateEffects): void {
    const resolved = this.core.options;
    const blockSize = normalizeFinite(options.blockSize, 1, true);
    const bufferRows = normalizeFinite(options.infiniteBufferRows, 0, true);
    const retryCount = normalizeFinite(options.datasourceRetryCount, 0, true);
    const retryDelay = normalizeFinite(options.datasourceRetryDelay, 0, true);
    if (blockSize !== undefined) resolved.blockSize = blockSize;
    if (bufferRows !== undefined) resolved.infiniteBufferRows = bufferRows;
    if (retryCount !== undefined) resolved.datasourceRetryCount = retryCount;
    if (retryDelay !== undefined) resolved.datasourceRetryDelay = retryDelay;
    this.updateDatasourceReference(options, effects);
    this.updatePinnedRows(options);
  }

  private updateDatasourceReference(options: Partial<GridOptions<TData>>, effects: OptionUpdateEffects): void {
    const resolved = this.core.options;
    if (hasOwnOption(options, "datasource") && options.datasource !== resolved.datasource) {
      resolved.datasource = options.datasource;
      resolved.paginationEnabled = options.datasource == null && resolved.paginationEnabled;
      effects.datasourceChanged = true;
      this.core.paginationBar.rebuild();
    }
    if (hasOwnOption(options, "detailRowRenderer")) {
      resolved.detailRowRenderer = options.detailRowRenderer;
      effects.needsCellRefresh = true;
    }
    if (hasOwnOption(options, "isRowExpandable")) {
      resolved.isRowExpandable = options.isRowExpandable;
      effects.needsCellRefresh = true;
    }
  }

  private updatePinnedRows(options: Partial<GridOptions<TData>>): void {
    const resolved = this.core.options;
    if (options.pinnedTopRowData !== undefined) {
      resolved.pinnedTopRowData = options.pinnedTopRowData ?? [];
      this.core.pinnedRowsRenderer.setTopData(resolved.pinnedTopRowData);
    }
    if (options.pinnedBottomRowData !== undefined) {
      resolved.pinnedBottomRowData = options.pinnedBottomRowData ?? [];
      this.core.pinnedRowsRenderer.setBottomData(resolved.pinnedBottomRowData);
    }
  }

  private applyOptionUpdateEffects(
    options: Partial<GridOptions<TData>>,
    effects: OptionUpdateEffects,
    previousColumnMenu: boolean
  ): void {
    const resolved = this.core.options;
    if (effects.needsColumnRebuild) {
      this.core.columnModel.setColumnDefs(resolved.columnDefs);
      this.core.onColumnsStructureChanged();
      effects.needsHeaderRebuild = false;
      effects.needsPoolRebuild = false;
    }
    if (effects.needsStateLoad) {
      this.core.loadPersistedColumnState();
      this.core.onColumnsStructureChanged();
    }
    this.applyRowUpdateEffect(effects);
    if (effects.filterChanged) {
      this.emitFilterChanged();
      if (!effects.datasourceChanged && !effects.needsRowRebuild) {
        if (this.core.rowModel.isInfinite) void this.core.rowModel.onServerParamsChanged();
        else {
          this.core.rowModel.refreshPipeline();
          this.core.bodyRenderer.onDataChanged();
        }
      }
    }
    if (effects.needsRelayout) {
      this.core.skeleton.updateHeights(resolved.rowHeight, resolved.headerHeight);
      this.core.relayout();
      this.core.relayoutColumns(false);
    }
    if (options.columnMenu != null && options.columnMenu !== previousColumnMenu) {
      effects.needsHeaderRebuild = true;
    }
    if (effects.needsHeaderRebuild) this.core.headerRenderer.build();
    if (effects.needsPoolRebuild) this.core.bodyRenderer.rebuildPool();
    else if (effects.needsCellRefresh) this.refreshCells();
    if (effects.needsSummaryRefresh) this.core.summaryRenderer.refresh();
    if (effects.stateToApply) this.applyState(effects.stateToApply);
    this.core.bodyRenderer.refreshOverlays();
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
    this.core.rowModel.setRowData(this.core.options.rowData);
    this.core.bodyRenderer.onDataChanged();
  }

  getDataAsCsv(params: CsvExportParams = {}): string {
    const cols = this.core.columnModel.getOrderedVisible().filter((c) => !c.hasCheckbox && !c.isDetailToggle);
    if (params.headersOnly) {
      return buildCsv(
        {
          getHeaderLabels: () => cols.map((c) => c.colDef.headerName ?? c.colDef.field ?? c.id),
          getRowValues: () => []
        },
        params
      );
    }
    const nodes = params.onlySelected
      ? this.core.selectionService.getSelectedNodes().slice().sort((a, b) => a.rowIndex - b.rowIndex)
      : params.onlyAllDisplayed
        ? this.core.rowModel.getDisplayedRows().filter((n) => !n.isDetail && !n.isGroup)
      : this.core.rowModel.getPipelineRows().filter((n) => !n.isDetail && !n.isGroup);

    return buildCsv({
      getHeaderLabels: () => cols.map((c) => c.colDef.headerName ?? c.colDef.field ?? c.id),
      getRowValues: () =>
        nodes.map((node) =>
          cols.map((c) => {
            const v = this.core.getCellValue(node, c);
            if (typeof v === "number") return v;
            return formatCellValue(this.core, node, c);
          })
        )
    }, params);
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
    if (this.core.isDestroyed()) return;
    const state = migrateGridState(input);
    if (!state) return;
    const all: readonly GridStateSection[] = ["columns", "sort", "filter", "pagination", "selection", "expansion"];
    const sections = new Set(options.sections ?? all);
    this.core.editingService.stop(true);

    this.restoreStateSections(state, sections);
    this.refreshAfterStateRestore(state, sections);
    if (options.emitEvents !== false) this.emitStateEvents(sections);
  }

  private restoreStateSections(state: GridState, sections: ReadonlySet<GridStateSection>): void {
    if (sections.has("columns")) this.core.columnModel.applyColumnState(state.columns ?? []);
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
      this.core.options.paginationEnabled = state.pagination.enabled && !this.core.rowModel.isInfinite;
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
      this.core.bodyRenderer.onDataChanged();
    }
    this.core.headerRenderer.refreshSortIndicators();
    this.core.headerRenderer.refreshFilterIcons();
    if (sections.has("selection")) this.core.selectionService.restoreSelection(state.selectedRowIds ?? []);
    this.core.persistColumnState();
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
    if (type === "loading") {
      this.core.skeleton.showOverlay(
        "loading",
        this.core.options.overlayLoadingTemplate,
        this.core.options.allowUnsafeOverlayHtml
      );
    } else if (type === "noRows") {
      const content = this.core.options.overlayNoRowsTemplate || this.core.buildDefaultEmptyState();
      this.core.skeleton.showOverlay("noRows", content, this.core.options.allowUnsafeOverlayHtml);
    } else if (type === "error") {
      const content = this.core.options.overlayErrorTemplate || this.core.buildDefaultErrorState();
      this.core.skeleton.showOverlay("error", content, this.core.options.allowUnsafeOverlayHtml);
    } else {
      this.core.skeleton.hideOverlay();
    }
  }

  hideOverlays(): void {
    this.core.skeleton.hideOverlay();
  }

  addEventListener<K extends import("../types/events").GridEventType>(
    eventType: K,
    listener: (event: any) => void
  ): () => void {
    return this.core.eventBus.on(eventType, listener);
  }

  removeEventListener<K extends import("../types/events").GridEventType>(
    eventType: K,
    listener: (event: any) => void
  ): void {
    this.core.eventBus.off(eventType, listener);
  }

  destroy(): void {
    if (this.asyncTransactionTimer != null) clearTimeout(this.asyncTransactionTimer);
    this.asyncTransactionTimer = null;
    this.asyncTransactions = [];
    const resolvers = this.asyncTransactionResolvers;
    this.asyncTransactionResolvers = [];
    for (const resolve of resolvers) resolve();
    this.core.destroy();
  }

  isDestroyed(): boolean {
    return this.core.isDestroyed();
  }
}
