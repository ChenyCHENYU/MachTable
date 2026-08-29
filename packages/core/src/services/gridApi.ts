import type { GridCore } from "../core/gridCore";
import type { CsvExportParams, RowTransaction } from "../types/api";
import type { GridApi, } from "../types/api";
import type { GridOptions } from "../types/options";
import type { ApplyGridStateOptions, GridState, GridStateSection } from "../types/state";
import type { Column } from "./column";
import { EVENT_TYPES } from "../types/events";
import type { ColDefOrGroup, ColumnState, FilterModel, SortModel } from "../types/colDef";
import { DEFAULT_COL_DEF, GRID_SIZE_PRESETS } from "../core/resolveOptions";
import { buildCsv } from "../lib/csv";
import { parseCsv, toTsv } from "../lib/clipboard";
import { escapeHtml } from "../lib/download";
import { setByPath } from "../lib/path";
import { formatCellValue } from "../render/cellContent";

function cloneSnapshotData<T>(data: T): T {
  try {
    if (typeof structuredClone === "function") return structuredClone(data);
  } catch {
    // Rows containing functions or platform objects fall back to a shallow snapshot.
  }
  if (Array.isArray(data)) return [...data] as T;
  if (data != null && typeof data === "object") return { ...data } as T;
  return data;
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

  sizeColumnsToFit(width?: number): void {
    if (this.core.isDestroyed()) return;
    const cols = this.core.columnModel.getOrderedVisible();
    if (cols.length === 0) return;
    const target = width ?? this.core.skeleton.measureViewportWidth();
    if (target <= 0) return;
    const total = cols.reduce((acc, c) => acc + c.currentWidth, 0);
    if (total <= 0) return;
    for (const col of cols) {
      this.core.columnModel.setColumnWidth(col, Math.max(30, Math.floor((col.currentWidth * target) / total)));
    }
    this.core.relayoutColumns();
    this.core.persistColumnState();
  }

  autoSizeColumn(colId: string, skipHeader = false): void {
    if (this.core.isDestroyed()) return;
    const column = this.core.columnModel.getColumn(colId);
    if (!column) return;

    if (this.autoSizeColumnInternal(column, skipHeader)) {
      this.core.relayoutColumns();
      this.core.persistColumnState();
    }
  }

  private autoSizeColumnInternal(
    column: Column<TData>,
    skipHeader: boolean
  ): boolean {

    if (column.hasCheckbox || column.isDetailToggle) {
      this.core.columnModel.setColumnWidth(column, column.isDetailToggle ? 38 : 46);
      return true;
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
    this.core.columnModel.setColumnWidth(column, Math.ceil(maxWidth) + extra);
    return true;
  }

  autoSizeAllColumns(skipHeader?: boolean): void {
    if (this.core.isDestroyed()) return;
    let changed = false;
    for (const col of this.core.columnModel.getOrderedVisible()) {
      changed = this.autoSizeColumnInternal(col, skipHeader ?? false) || changed;
    }
    if (changed) {
      this.core.relayoutColumns();
      this.core.persistColumnState();
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
    this.core.emit("filterChanged", { filterModel: this.core.rowModel.getFilterModel() });
    if (this.core.rowModel.isInfinite) {
      void this.core.rowModel.onServerParamsChanged();
      return;
    }
    this.core.rowModel.refreshPipeline();
    this.core.bodyRenderer.onDataChanged();
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
    const ids = rowIds ? new Set(rowIds) : null;
    const snapshot = this.core.changeTracker.getChanges()
      .filter((change) => !ids || ids.has(change.rowId))
      .map((change) => ({
        ...change,
        data: cloneSnapshotData(change.data),
        cells: change.cells.map((cell) => ({ ...cell }))
      }));
    if (snapshot.length === 0) return [];
    const result = await handler(snapshot);
    const savedIds = result && typeof result === "object" && Array.isArray(result.savedRowIds)
      ? new Set(result.savedRowIds.map(String))
      : null;
    const saved = savedIds ? snapshot.filter((change) => savedIds.has(change.rowId)) : snapshot;
    if (!this.core.isDestroyed()) this.core.changeTracker.acknowledge(saved);
    return saved;
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
    if (this.core.isDestroyed()) return;
    this.core.columnMenu.openStandalone(anchor);
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

  importCsv(text: string, options: import("../types/api").ImportCsvOptions = {}): boolean {
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

    const cols = this.core.columnModel.getOrderedVisible().filter((c) => c.colDef.field);
    const byHeader = new Map<string, string>();
    for (const col of cols) {
      byHeader.set(String(col.colDef.headerName ?? col.colDef.field ?? col.id), col.colDef.field!);
      if (col.colDef.field) byHeader.set(col.colDef.field, col.colDef.field);
    }
    if (headerRow.length > 0) headerRow[0] = headerRow[0].replace(/^\uFEFF/, "");
    let fieldOrder = headerRow
      .map((header, index) => ({ field: byHeader.get(String(header).trim()) ?? null, index }))
      .filter((entry): entry is { field: string; index: number } => entry.field != null);

    if (fieldOrder.length === 0) {
      fieldOrder = cols.map((col, index) => ({ field: col.colDef.field!, index }));
    }

    const records = body.map((row, rowIndex) => {
      const record: Record<string, any> = {};
      fieldOrder.forEach(({ field, index }) => {
        const raw = row[index];
        if (raw === undefined) return;
        let value: any;
        if (options.parseValue) {
          try {
            value = options.parseValue({ value: raw, field, rowIndex, columnIndex: index });
          } catch (error) {
            this.core.reportError(error, "csv.parseValue", { field, rowIndex, columnIndex: index });
            value = raw;
          }
        } else if (raw === "") {
          value = null;
        } else if (
          options.coerceNumbers !== false &&
          /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw) &&
          !/^[+-]?0\d/.test(raw)
        ) {
          value = Number(raw);
        } else {
          value = raw;
        }
        if (!setByPath(record, field, value)) {
          this.core.reportError(new Error(`Unsafe CSV field: ${field}`), "csv.import", { field });
        }
      });
      return record;
    });

    if (mode === "append") {
      this.core.rowModel.applyTransaction({ add: records as unknown as TData[] });
    } else {
      this.core.rowModel.setRowData(records as unknown as TData[]);
    }
    this.core.bodyRenderer.onDataChanged();
    return true;
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
    this.updateOptions({ [key]: value } as Pick<GridOptions<TData>, K>);
  }

  updateOptions(options: Partial<GridOptions<TData>>): void {
    if (this.core.isDestroyed()) return;
    const resolved = this.core.options;
    let needsRelayout = false;
    let needsCellRefresh = false;
    let needsHeaderRebuild = false;
    let needsPoolRebuild = false;
    let needsSummaryRefresh = false;
    let needsColumnRebuild = false;
    let needsRowRebuild = false;
    let needsStateLoad = false;
    let datasourceChanged = false;
    let stateToApply: GridState | undefined;
    const prevColumnMenu = resolved.columnMenu;
    const prevUndoSize = resolved.undoStackSize;

    if (Object.prototype.hasOwnProperty.call(options, "columnDefs") && options.columnDefs !== resolved.columnDefs) {
      resolved.columnDefs = Array.isArray(options.columnDefs) ? options.columnDefs : [];
      needsColumnRebuild = true;
      needsRowRebuild = true;
    }
    if (Object.prototype.hasOwnProperty.call(options, "rowData")) {
      resolved.rowData = Array.isArray(options.rowData) ? options.rowData : [];
      needsRowRebuild = true;
    }
    if (Object.prototype.hasOwnProperty.call(options, "initialState") && options.initialState) {
      resolved.initialState = options.initialState;
      stateToApply = options.initialState;
    }

    for (const eventType of EVENT_TYPES) {
      const key = `on${eventType.charAt(0).toUpperCase()}${eventType.slice(1)}` as keyof GridOptions<TData>;
      if (Object.prototype.hasOwnProperty.call(options, key)) {
        Object.assign(resolved, { [key]: options[key] });
      }
    }

    if (options.rowHeight != null && Number.isFinite(options.rowHeight) && options.rowHeight > 0 && options.rowHeight !== resolved.rowHeight) {
      resolved.rowHeight = options.rowHeight;
      needsRelayout = true;
    }
    if (options.headerHeight != null && Number.isFinite(options.headerHeight) && options.headerHeight > 0 && options.headerHeight !== resolved.headerHeight) {
      resolved.headerHeight = options.headerHeight;
      needsRelayout = true;
      needsHeaderRebuild = true;
    }
    if (options.rowBuffer != null && Number.isFinite(options.rowBuffer) && options.rowBuffer >= 0 && options.rowBuffer !== resolved.rowBuffer) {
      resolved.rowBuffer = Math.floor(options.rowBuffer);
      needsRelayout = true;
    }
    if (options.columnLayout != null && options.columnLayout !== resolved.columnLayout) {
      resolved.columnLayout = options.columnLayout === "fit" ? "fit" : "normal";
      needsRelayout = true;
    }
    if (options.multiSort != null) resolved.multiSort = options.multiSort;
    if (options.detailRowHeight != null && Number.isFinite(options.detailRowHeight) && options.detailRowHeight > 0 && options.detailRowHeight !== resolved.detailRowHeight) {
      resolved.detailRowHeight = options.detailRowHeight;
      this.core.bodyRenderer.applyContainerSizes();
      this.core.bodyRenderer.updateRange(true);
    }
    if (options.editType != null && options.editType !== resolved.editType) {
      this.core.editingService.stop(true);
      resolved.editType = options.editType === "fullRow" ? "fullRow" : "cell";
      needsCellRefresh = true;
    }
    if (options.editableIndicator != null && options.editableIndicator !== resolved.editableIndicator) {
      resolved.editableIndicator =
        options.editableIndicator === "always" || options.editableIndicator === "none"
          ? options.editableIndicator
          : "hover";
      needsCellRefresh = true;
    }
    if (Object.prototype.hasOwnProperty.call(options, "rowEditValidator")) {
      resolved.rowEditValidator = options.rowEditValidator;
    }
    if (options.singleClickEdit != null) resolved.singleClickEdit = options.singleClickEdit;
    if (options.manualSorting != null) resolved.manualSorting = options.manualSorting;
    if (options.manualFiltering != null) resolved.manualFiltering = options.manualFiltering;
    if (options.locale != null && options.locale !== resolved.locale) {
      resolved.locale = options.locale;
      needsHeaderRebuild = true;
      needsCellRefresh = true;
      this.core.paginationBar.rebuild();
      this.core.statusBarService.rebuild();
    }
    if (options.indexOffset != null && options.indexOffset !== resolved.indexOffset) {
      resolved.indexOffset = options.indexOffset;
      needsCellRefresh = true;
    }
    if (options.showSummary != null && options.showSummary !== resolved.showSummary) {
      resolved.showSummary = options.showSummary;
      needsSummaryRefresh = true;
      needsRelayout = true;
    }
    if (options.undoStackSize != null && Number.isFinite(options.undoStackSize) && options.undoStackSize >= 0 && options.undoStackSize !== prevUndoSize) {
      resolved.undoStackSize = Math.floor(options.undoStackSize);
      this.core.undoService.trimToSize();
    }
    if (options.asyncTransactionWaitMillis != null && Number.isFinite(options.asyncTransactionWaitMillis) && options.asyncTransactionWaitMillis >= 0) {
      resolved.asyncTransactionWaitMillis = Math.floor(options.asyncTransactionWaitMillis);
    }
    if (Object.prototype.hasOwnProperty.call(options, "getRowHeight")) {
      const changed = resolved.getRowHeight !== options.getRowHeight;
      resolved.getRowHeight = options.getRowHeight;
      if (changed) this.core.bodyRenderer.invalidateAllRowHeights();
      needsRelayout = true;
    }
    if (options.enableRangeSelection != null) {
      resolved.enableRangeSelection = options.enableRangeSelection;
      if (!options.enableRangeSelection) this.clearRangeSelection();
    }
    if (Object.prototype.hasOwnProperty.call(options, "tooltipComponent")) resolved.tooltipComponent = options.tooltipComponent;
    if (options.tooltipShowDelay != null && Number.isFinite(options.tooltipShowDelay) && options.tooltipShowDelay >= 0) {
      resolved.tooltipShowDelay = options.tooltipShowDelay;
    }
    if (options.flashCells != null) resolved.flashCells = options.flashCells;
    if (Object.prototype.hasOwnProperty.call(options, "getContextMenuItems")) resolved.getContextMenuItems = options.getContextMenuItems;
    if (options.theme != null && options.theme !== resolved.theme) {
      resolved.theme = options.theme;
      this.core.skeleton.applyTheme(options.theme);
      this.core.watermarkService.refresh();
    }
    if (options.pagination !== undefined) {
      const cfg = options.pagination;
      const target = cfg !== false && resolved.datasource == null;
      if (target !== resolved.paginationEnabled) {
        this.core.rowModel.setPaginationEnabled(target);
      }
      if (typeof cfg === "object" && cfg) {
        resolved.paginationMode = cfg.mode === "server" ? "server" : "client";
        if (cfg.page != null && Number.isFinite(cfg.page)) {
          resolved.paginationPage = Math.max(1, Math.floor(cfg.page));
        }
        if (cfg.total != null && Number.isFinite(cfg.total)) {
          resolved.paginationTotal = Math.max(0, Math.floor(cfg.total));
        }
        if (cfg.pageSize != null) resolved.paginationPageSize = cfg.pageSize;
        if (cfg.pageSizeOptions != null) resolved.paginationPageSizeOptions = cfg.pageSizeOptions;
        if (cfg.showTotal != null) resolved.paginationShowTotal = cfg.showTotal;
        if (cfg.showPageSizeSelector != null) resolved.paginationShowSizeSelector = cfg.showPageSizeSelector;
      }
      if (resolved.paginationEnabled) {
        this.core.rowModel.onPaginationOptionsChanged();
      }
      this.core.paginationBar.rebuild();
    }
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
    if (Object.prototype.hasOwnProperty.call(options, "summaryMethod")) {
      resolved.summaryMethod = options.summaryMethod;
      needsSummaryRefresh = true;
    }
    if (options.size != null && Object.prototype.hasOwnProperty.call(GRID_SIZE_PRESETS, options.size) && options.size !== resolved.size) {
      const preset = GRID_SIZE_PRESETS[options.size];
      resolved.size = options.size;
      resolved.rowHeight = options.rowHeight ?? preset.rowHeight;
      resolved.headerHeight = options.headerHeight ?? preset.headerHeight;
      this.core.skeleton.applySize(options.size);
      needsRelayout = true;
      needsHeaderRebuild = true;
    }
    if (options.stripedRows != null && options.stripedRows !== resolved.stripedRows) {
      resolved.stripedRows = options.stripedRows;
      this.core.skeleton.setStriped(options.stripedRows);
    }
    if (options.showCellBorders != null && options.showCellBorders !== resolved.showCellBorders) {
      resolved.showCellBorders = options.showCellBorders;
      this.core.skeleton.setCellBorders(options.showCellBorders);
    }
    if (options.suppressCellFocus != null) resolved.suppressCellFocus = options.suppressCellFocus;
    if (options.suppressRowHoverHighlight != null) resolved.suppressRowHoverHighlight = options.suppressRowHoverHighlight;
    if (options.suppressNoRowsOverlay != null) resolved.suppressNoRowsOverlay = options.suppressNoRowsOverlay;
    if (options.suppressHeaderFocus != null && options.suppressHeaderFocus !== resolved.suppressHeaderFocus) {
      resolved.suppressHeaderFocus = options.suppressHeaderFocus;
      needsHeaderRebuild = true;
    }
    let ariaLabelsChanged = false;
    if (Object.prototype.hasOwnProperty.call(options, "ariaLabel")) {
      resolved.ariaLabel = options.ariaLabel ?? "MachTable data grid";
      ariaLabelsChanged = true;
    }
    if (Object.prototype.hasOwnProperty.call(options, "ariaLabelledBy")) {
      resolved.ariaLabelledBy = options.ariaLabelledBy ?? "";
      ariaLabelsChanged = true;
    }
    if (Object.prototype.hasOwnProperty.call(options, "ariaDescribedBy")) {
      resolved.ariaDescribedBy = options.ariaDescribedBy ?? "";
      ariaLabelsChanged = true;
    }
    if (ariaLabelsChanged) this.core.skeleton.applyAriaLabels(resolved);
    if (Object.prototype.hasOwnProperty.call(options, "overlayNoRowsTemplate")) {
      resolved.overlayNoRowsTemplate = options.overlayNoRowsTemplate ?? "";
    }
    if (Object.prototype.hasOwnProperty.call(options, "overlayLoadingTemplate")) {
      resolved.overlayLoadingTemplate = options.overlayLoadingTemplate ?? "";
    }
    if (options.allowUnsafeOverlayHtml != null) {
      resolved.allowUnsafeOverlayHtml = options.allowUnsafeOverlayHtml;
    }
    if (Object.prototype.hasOwnProperty.call(options, "className")) {
      resolved.className = options.className ?? "";
      this.core.skeleton.setCustomClass(resolved.className);
    }
    if (options.loading != null) resolved.loading = options.loading;
    if (options.rowSelection != null && options.rowSelection !== resolved.rowSelection) {
      resolved.rowSelection = options.rowSelection;
      if (options.rowSelection === "none") this.deselectAll();
      needsHeaderRebuild = true;
      needsPoolRebuild = true;
      this.core.refreshAriaState();
    }
    if (options.quickFilterText !== undefined) {
      this.setQuickFilter(options.quickFilterText);
    }
    if (options.defaultColDef !== undefined && options.defaultColDef !== resolved.defaultColDef) {
      resolved.defaultColDef = { ...DEFAULT_COL_DEF, ...options.defaultColDef };
      needsColumnRebuild = true;
    }
    if (Object.prototype.hasOwnProperty.call(options, "columnTypes") && options.columnTypes !== resolved.columnTypes) {
      resolved.columnTypes = options.columnTypes ?? {};
      needsColumnRebuild = true;
    }
    if (Object.prototype.hasOwnProperty.call(options, "getRowId") && options.getRowId !== resolved.getRowId) {
      resolved.getRowId = options.getRowId;
      needsRowRebuild = true;
    }
    if (options.masterDetail != null && options.masterDetail !== resolved.masterDetail) {
      resolved.masterDetail = options.masterDetail;
      needsColumnRebuild = true;
      needsRowRebuild = true;
    }
    if (options.detailToggleColumn != null && options.detailToggleColumn !== resolved.detailToggleColumn) {
      resolved.detailToggleColumn = options.detailToggleColumn;
      needsColumnRebuild = true;
    }
    if (options.treeData != null && options.treeData !== resolved.treeData) {
      resolved.treeData = options.treeData;
      needsRowRebuild = true;
      needsColumnRebuild = true;
      this.core.refreshAriaState();
    }
    if (options.childrenKey != null && options.childrenKey !== resolved.childrenKey) {
      resolved.childrenKey = options.childrenKey;
      needsRowRebuild = true;
    }
    if (options.autoCheckedChildren != null) resolved.autoCheckedChildren = options.autoCheckedChildren;
    if (options.defaultExpandAll != null && options.defaultExpandAll !== resolved.defaultExpandAll) {
      resolved.defaultExpandAll = options.defaultExpandAll;
      needsRowRebuild = true;
    }
    if (options.applyRowDrag != null) resolved.applyRowDrag = options.applyRowDrag;
    if (options.suppressWarnings != null) resolved.suppressWarnings = options.suppressWarnings;
    if (Object.prototype.hasOwnProperty.call(options, "aggFuncs")) {
      resolved.aggFuncs = options.aggFuncs;
      needsRowRebuild = true;
    }
    if (Object.prototype.hasOwnProperty.call(options, "components")) {
      resolved.components = options.components;
      needsCellRefresh = true;
    }
    if (Object.prototype.hasOwnProperty.call(options, "actionPolicy")) {
      resolved.actionPolicy = options.actionPolicy;
      needsCellRefresh = true;
    }
    if (Object.prototype.hasOwnProperty.call(options, "features")) {
      resolved.features = Array.isArray(options.features) ? options.features : [];
      this.core.setFeatures(resolved.features);
    }
    if (Object.prototype.hasOwnProperty.call(options, "columnStateStore")) {
      resolved.columnStateStore = options.columnStateStore;
      needsStateLoad = true;
    }
    if (Object.prototype.hasOwnProperty.call(options, "columnStateKey")) {
      resolved.columnStateKey = options.columnStateKey ?? null;
      needsStateLoad = true;
    }
    if (options.blockSize != null && Number.isFinite(options.blockSize) && options.blockSize > 0) {
      resolved.blockSize = Math.floor(options.blockSize);
    }
    if (options.infiniteBufferRows != null && Number.isFinite(options.infiniteBufferRows) && options.infiniteBufferRows >= 0) {
      resolved.infiniteBufferRows = Math.floor(options.infiniteBufferRows);
    }
    if (options.datasourceRetryCount != null && Number.isFinite(options.datasourceRetryCount) && options.datasourceRetryCount >= 0) {
      resolved.datasourceRetryCount = Math.floor(options.datasourceRetryCount);
    }
    if (options.datasourceRetryDelay != null && Number.isFinite(options.datasourceRetryDelay) && options.datasourceRetryDelay >= 0) {
      resolved.datasourceRetryDelay = Math.floor(options.datasourceRetryDelay);
    }
    if (Object.prototype.hasOwnProperty.call(options, "datasource") && options.datasource !== resolved.datasource) {
      resolved.datasource = options.datasource;
      resolved.paginationEnabled = options.datasource == null && resolved.paginationEnabled;
      datasourceChanged = true;
      this.core.paginationBar.rebuild();
    }
    if (Object.prototype.hasOwnProperty.call(options, "detailRowRenderer")) {
      resolved.detailRowRenderer = options.detailRowRenderer;
      needsCellRefresh = true;
    }
    if (Object.prototype.hasOwnProperty.call(options, "isRowExpandable")) {
      resolved.isRowExpandable = options.isRowExpandable;
      needsCellRefresh = true;
    }
    if (options.pinnedTopRowData !== undefined) {
      resolved.pinnedTopRowData = options.pinnedTopRowData ?? [];
      this.core.pinnedRowsRenderer.setTopData(resolved.pinnedTopRowData);
    }
    if (options.pinnedBottomRowData !== undefined) {
      resolved.pinnedBottomRowData = options.pinnedBottomRowData ?? [];
      this.core.pinnedRowsRenderer.setBottomData(resolved.pinnedBottomRowData);
    }

    if (needsColumnRebuild) {
      this.core.columnModel.setColumnDefs(resolved.columnDefs);
      this.core.onColumnsStructureChanged();
      needsHeaderRebuild = false;
      needsPoolRebuild = false;
    }
    if (needsStateLoad) {
      this.core.loadPersistedColumnState();
      this.core.onColumnsStructureChanged();
    }
    if (datasourceChanged) {
      void this.core.rowModel.onDatasourceChanged();
    } else if (needsRowRebuild) {
      if (this.core.rowModel.isInfinite) void this.core.rowModel.onServerParamsChanged();
      else {
        this.core.rowModel.setRowData(resolved.rowData);
        this.core.bodyRenderer.onDataChanged();
      }
    }

    if (needsRelayout) {
      this.core.skeleton.updateHeights(resolved.rowHeight, resolved.headerHeight);
      this.core.relayout();
      this.core.relayoutColumns(false);
    }
    if (options.columnMenu != null && options.columnMenu !== prevColumnMenu) {
      needsHeaderRebuild = true;
    }
    if (needsHeaderRebuild) this.core.headerRenderer.build();
    if (needsPoolRebuild) this.core.bodyRenderer.rebuildPool();
    else if (needsCellRefresh) this.refreshCells();
    if (needsSummaryRefresh) this.core.summaryRenderer.refresh();
    if (stateToApply) this.applyState(stateToApply);
    this.core.bodyRenderer.refreshOverlays();
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
      version: 1,
      columns: this.getColumnState(),
      sortModel: this.getSortModel(),
      filterModel: this.getFilterModel(),
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

  applyState(state: GridState, options: ApplyGridStateOptions = {}): void {
    if (this.core.isDestroyed() || !state || state.version !== 1) return;
    const all: readonly GridStateSection[] = ["columns", "sort", "filter", "pagination", "selection", "expansion"];
    const sections = new Set(options.sections ?? all);
    this.core.editingService.stop(true);

    if (sections.has("columns")) this.core.columnModel.applyColumnState(state.columns ?? []);
    if (sections.has("sort")) this.core.columnModel.applySortModel(state.sortModel ?? []);
    if (sections.has("filter")) {
      this.core.rowModel.setFilterModel(state.filterModel ?? {});
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

    if (options.emitEvents !== false) {
      if (sections.has("sort")) this.core.emit("sortChanged", { sortModel: this.getSortModel() });
      if (sections.has("filter")) this.core.emit("filterChanged", { filterModel: this.getFilterModel() });
      if (sections.has("pagination")) {
        this.core.emit("paginationChanged", {
          page: this.getPage(),
          pageSize: this.getPageSize(),
          pageCount: this.getPageCount(),
          total: this.getTotalRowCount()
        });
      }
    }
  }

  getDiagnostics(): import("../types/api").GridDiagnostics {
    return this.core.getDiagnostics();
  }

  setOverlay(type: "loading" | "noRows" | null): void {
    if (type === "loading") {
      this.core.skeleton.showOverlay(
        "loading",
        this.core.options.overlayLoadingTemplate,
        this.core.options.allowUnsafeOverlayHtml
      );
    } else if (type === "noRows") {
      const content = this.core.options.overlayNoRowsTemplate || this.core.buildDefaultEmptyState();
      this.core.skeleton.showOverlay("noRows", content, this.core.options.allowUnsafeOverlayHtml);
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
