import type { GridUpdateRequest } from "./updateScheduler";
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
import { isValueColumn, type Column } from "./column";
import type { ColDefOrGroup, ColumnState, FilterModel, SortModel } from "../types/colDef";
import { DEFAULT_COL_DEF, GRID_SIZE_PRESETS, VALUE_DEFAULTS, resolveWatermark, rowIdFromKey, updateDatasourceTuning } from "../core/resolveOptions";
import { buildCsv, sanitizeFormulaCell } from "../lib/csv";
import { prepareMatrixImport } from "../lib/importData";
import { serializeColumnValue } from "../lib/columnValues";
import { clipboardText, parseCsv } from "../lib/clipboard";
import { escapeHtml } from "../lib/download";
import { formatCellValue } from "../render/cellContent";
import { EVENT_OPTION_KEYS, sanitizeGridOptionPatch } from "../core/gridOptionRuntime";
import { normalizeGridState } from "../lib/gridState";
import { copyOptions, hasOwnOption, normalizeFinite, normalizePersistence } from "../lib/optionValues";
import { fitColumnWidths } from "../lib/layout";
import { abortable, createAbortError } from "../lib/abortable";
import { validateTreeData } from "./rowModel";
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

interface OptionUpdateEffects extends Pick<GridUpdateRequest, "header" | "pool" | "layout" | "summary" | "overlays"> {
  cells?: true;
  columnDefsChanged?: boolean;
  datasourceChanged?: boolean;
  filterChanged?: boolean;
  needsColumnRebuild?: boolean;
  needsRowRebuild?: boolean;
  needsStateLoad?: boolean;
  needsFeatureReload?: boolean;
  stateToApply?: GridStateInput;
}

interface AsyncTransactionEntry<TData> {
  transaction: RowTransaction<TData>;
  revision: number;
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

function changedFinite(
  value: unknown,
  current: number,
  min: number,
  integer = false
): number | undefined {
  const normalized = normalizeFinite(value, min, integer);
  return normalized === undefined || normalized === current ? undefined : normalized;
}

function copyChangedOption<T extends object, K extends keyof T>(
  source: T, target: Pick<T, K>, key: K
): boolean {
  const value = source[key];
  if (value == null || value === target[key]) return false;
  target[key] = value;
  return true;
}

/** @internal Only the domain facade, never this implementation instance, crosses the package boundary. */
export class GridApiImpl<TData = any> {
  private asyncTransactions: AsyncTransactionEntry<TData>[] = [];
  private asyncTransactionTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private core: GridCore<TData>) {}

  batch<TResult>(callback: (api: GridApi<TData>) => TResult): TResult {
    return this.core.batchUpdates(() => callback(this.core.api));
  }

  setRowData(rows: TData[] | null | undefined): void {
    if (this.core.isDisposed()) return;
    if (this.core.rowModel.isInfinite) {
      this.core.gridOptions.rowData = rows ?? [];
      return;
    }
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
        revision: this.core.rowModel.getDataRevision(),
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

  private takeAsyncTransactions(): AsyncTransactionEntry<TData>[] {
    if (this.asyncTransactionTimer != null) clearTimeout(this.asyncTransactionTimer);
    this.asyncTransactionTimer = null;
    const entries = this.asyncTransactions;
    this.asyncTransactions = [];
    return entries;
  }

  flushAsyncTransactions(): void {
    const entries = this.takeAsyncTransactions();
    const model = this.core.rowModel;
    const revision = model.getDataRevision();
    const transactions = entries.filter((entry) => !entry.aborted && entry.revision === revision)
      .map((entry) => entry.transaction);
    if (transactions.length > 0 && !this.core.isDisposed() && !model.isInfinite) {
      const impact = model.applyTransactions(transactions);
      if (model.getDataRevision() === revision) this.requestTransactionRefresh(impact);
    }
    const current = model.getDataRevision() === revision;
    for (const entry of entries) {
      if (entry.signal && entry.onAbort) entry.signal.removeEventListener("abort", entry.onAbort);
      if (entry.aborted) continue;
      if (current && entry.revision === revision) entry.resolve();
      else entry.reject(createAbortError(undefined, "The table data changed before the transaction could complete"));
    }
  }

  private requestTransactionRefresh(impact: import("./rowModel").RowTransactionImpact): void {
    if (!impact.pipelineChanged && impact.updatedRowIds.length === 0) return;
    if (impact.pipelineChanged || this.core.gridOptions.getRowHeight ||
      this.core.columnModel.getOrderedVisible().some(column => column.colDef.autoHeight === true)) {
      this.core.requestUpdate({ data: true });
      return;
    }
    this.core.requestUpdate({
      cells: { rowIds: impact.updatedRowIds },
      summary: true,
      overlays: true
    });
  }

  setColumnDefs(colDefs: ColDefOrGroup<TData>[] | null | undefined): void {
    this.updateOptions({ columnDefs: [...(colDefs ?? [])] });
  }

  setColumnState(state: ColumnState[]): void {
    if (this.core.isDisposed()) return;
    this.core.columnModel.applyColumnState(state);
    this.commitColumnState();
  }

  resetColumnState(): void {
    if (this.core.isDisposed()) return;
    this.core.columnModel.resetColumnState();
    this.commitColumnState();
  }

  setColumnVisibility(colId: string, visible: boolean): void {
    if (this.core.isDisposed()) return;
    this.core.columnModel.setColumnVisibility(colId, visible);
    this.core.onColumnsStructureChanged();
    this.core.emit("columnVisibilityChanged", { colId, visible });
  }

  setColumnPinned(colId: string, pinned: "left" | "right" | null): void {
    if (this.core.isDisposed()) return;
    this.core.columnModel.setColumnPinned(colId, pinned);
    this.commitColumnState();
  }

  private commitColumnState(): void {
    this.core.onColumnsStructureChanged();
    this.core.scheduleGridStateSave();
  }

  setColumnWidth(colId: string, width: number): boolean {
    if (this.core.isDisposed()) return false;
    const column = this.core.columnModel.getColumn(colId);
    if (!column || !this.core.columnModel.setColumnWidth(column, width)) return false;
    this.commitColumnWidths([column]);
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
    const responsive = this.core.gridOptions.columnLayout !== "normal" && width === undefined;
    const changed = cols.filter((col, index) => responsive
      ? this.core.columnModel.setContentWidth(col, fitted[index])
      : this.core.columnModel.setColumnWidth(col, fitted[index]));
    this.commitColumnWidths(changed);
  }

  autoSizeColumn(colId: string): void {
    if (this.core.isDisposed()) return;
    const column = this.core.columnModel.getColumn(colId);
    if (!column) return;

    if (this.autoSizeColumnInternal(column)) this.commitColumnWidths([column]);
  }

  private autoSizeColumnInternal(column: Column<TData>): boolean {
    // Display/utility columns keep their configured width in responsive mode.
    if (this.core.gridOptions.columnLayout !== "normal" && column.colDef.suppressSizeToFit) return false;
    if (column.hasCheckbox || column.isDetailToggle) {
      return this.core.columnModel.setColumnWidth(column, column.isDetailToggle ? 38 : 46);
    }

    return this.setAutoSizeWidth(column, this.core.columnSizing.measureColumnWidth(column));
  }

  private setAutoSizeWidth(column: Column<TData>, width: number): boolean {
    return this.core.gridOptions.columnLayout !== "normal"
      ? this.core.columnModel.setContentWidth(column, width)
      : this.core.columnModel.setColumnWidth(column, width);
  }

  autoSizeAllColumns(): void {
    if (this.core.isDisposed()) return;
    const changed: Column<TData>[] = [];
    for (const col of this.core.columnModel.getOrderedVisible()) {
      if (this.autoSizeColumnInternal(col)) changed.push(col);
    }
    if (changed.length > 0) this.commitColumnWidths(changed);
  }

  private commitColumnWidths(columns: Column<TData>[]): void {
    this.core.relayoutColumns();
    this.core.commitColumnWidths(columns);
  }

  setSortModel(sortModel: SortModel | null): void {
    if (this.core.isDisposed()) return;
    this.core.columnModel.applySortModel(sortModel);
    this.core.applySortModel();
  }

  setFilterModel(filterModel: FilterModel | null): void {
    if (this.core.isDisposed()) return;
    this.core.rowModel.setFilterModel(filterModel);
    this.core.applyFilterModel();
  }

  setAdvancedFilterModel(model: AdvancedFilterModel | null): void {
    if (this.core.isDisposed() || !this.core.rowModel.setAdvancedFilterModel(model)) return;
    this.core.applyFilterModel();
  }

  setQuickFilter(text: string | null | undefined): void {
    if (this.core.isDisposed()) return;
    const changed = this.core.rowModel.setQuickFilter(text);
    this.core.gridOptions.quickFilterText = this.core.rowModel.getQuickFilter();
    if (changed) this.core.applyFilterModel();
  }

  setRowSelection(mode: "none" | "single" | "multiple"): void {
    if (this.core.gridOptions.rowSelection === mode) return;
    this.updateOptions({ rowSelection: mode });
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
      this.core.selectionService.applySelection(changes, clearOthers);
    } else if (clearOthers) {
      this.core.selectionService.deselectAll();
    }
  }

  getVisibleSelection(): TData[] {
    const selection = this.core.selectionService;
    return this.core.rowModel
      .getDisplayedRows()
      .filter((n) => !n.isDetail && !n.isGroup && selection.isSelected(n.id))
      .map((n) => n.data!)
      .filter(Boolean);
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

  setPinnedRows(position: "top" | "bottom", rows: TData[] | null): void {
    if (this.core.isDisposed()) return;
    const key = position === "top" ? "pinnedTopRowData" : "pinnedBottomRowData";
    this.core.gridOptions[key] = rows ?? [];
    this.core.pinnedRowsRenderer.setRows(position, this.core.gridOptions[key]);
  }

  clearRangeSelection(): void {
    if (this.core.isDisposed()) return;
    this.core.bodyRenderer.clearRangeSelection();
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

  reload(options: GridAsyncOptions = {}): Promise<void> {
    if (this.core.isDisposed()) return Promise.resolve();
    if (options.signal?.aborted) return Promise.reject(abortError(options.signal));
    if (this.core.rowModel.isInfinite) {
      return withAbort(this.core.rowModel.startInfinite(options.signal), options.signal);
    } else {
      this.setRowData(this.core.gridOptions.rowData);
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
        .filter(column => isValueColumn(column) && !column.colDef.rowDrag);
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
    const resolved = this.core.gridOptions;
    // Reject the complete tree candidate before any option or scheduled effect is changed.
    if ((options.treeData ?? resolved.treeData) &&
      (options.rowData !== undefined || options.treeData != null || options.childrenKey != null)) {
      const rows = hasOwnOption(options, "rowData") ? options.rowData : resolved.rowData;
      validateTreeData(Array.isArray(rows) ? rows : [], options.childrenKey ?? resolved.childrenKey);
    }
    this.core.batchUpdates(() => {
      const effects: OptionUpdateEffects = {};
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
      effects.columnDefsChanged = true;
    }
    if (copyOptions(options, resolved, ["rowNumber"])) effects.needsColumnRebuild = true;
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
    for (const eventKey of EVENT_OPTION_KEYS) {
      const key = eventKey as keyof GridOptions<TData>;
      if (hasOwnOption(options, key)) Reflect.set(this.core.gridOptions, key, options[key]);
    }
  }

  private updateDimensionOptions(options: Partial<GridOptions<TData>>, effects: OptionUpdateEffects): void {
    const resolved = this.core.gridOptions;
    for (const key of ["rowHeight", "headerHeight", "rowBuffer"] as const) {
      const next = changedFinite(options[key], resolved[key], key === "rowBuffer" ? 0 : 1, key === "rowBuffer");
      if (next === undefined) continue;
      resolved[key] = next;
      effects.layout = true;
      if (key === "headerHeight") effects.header = true;
    }
    if (options.columnLayout != null && options.columnLayout !== resolved.columnLayout) {
      resolved.columnLayout = options.columnLayout === "fit" || options.columnLayout === "normal" ? options.columnLayout : "auto";
      this.core.columnModel.preserveWidths = false;
      effects.layout = true;
    }
    if (options.domLayout != null && options.domLayout !== resolved.domLayout) {
      resolved.domLayout = options.domLayout === "autoHeight" ? "autoHeight" : "normal";
      this.core.skeleton.applyDomLayout(resolved.domLayout);
      effects.pool = true;
    }
    if (hasOwnOption(options, "maxBodyHeight")) {
      resolved.maxBodyHeight = normalizeFinite(options.maxBodyHeight, 1);
      effects.layout = true;
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
      effects.cells = true;
    }
    if (options.editableIndicator != null && options.editableIndicator !== resolved.editableIndicator) {
      resolved.editableIndicator =
        options.editableIndicator === "always" || options.editableIndicator === "none"
          ? options.editableIndicator
          : "hover";
      effects.cells = true;
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
      effects.header = true;
    }
    if (copyChangedOption(options, resolved, "locale")) {
      effects.header = true;
      effects.cells = true;
      this.core.paginationBar.rebuild();
      this.core.statusBarService.rebuild();
    }
    if (copyChangedOption(options, resolved, "indexOffset")) {
      effects.cells = true;
    }
    if (copyChangedOption(options, resolved, "showSummary")) {
      effects.summary = true;
      effects.layout = true;
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
    this.core.gridOptions.getRowHeight = options.getRowHeight;
    this.core.bodyRenderer.invalidateAllRowHeights();
    effects.layout = true;
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
    if (copyChangedOption(options, resolved, "theme")) {
      this.core.skeleton.applyTheme(resolved.theme);
      this.core.watermarkService.refresh();
    }
  }

  private updatePaginationOptions(options: Partial<GridOptions<TData>>): void {
    if (!hasOwnOption(options, "pagination")) return;
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
      effects.cells = true;
      this.core.requestUpdate({ pinned: true });
    }
    this.updateWatermarkAndStatus(options, effects);
    this.updateSizePreset(options, effects);
    const resolved = this.core.gridOptions;
    if (copyChangedOption(options, resolved, "stripedRows")) {
      this.core.skeleton.setStriped(resolved.stripedRows);
    }
    if (copyChangedOption(options, resolved, "showCellBorders")) {
      this.core.skeleton.setCellBorders(resolved.showCellBorders);
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
      effects.summary = true;
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
    effects.layout = true;
    effects.header = true;
  }

  private updateAccessibilityOptions(options: Partial<GridOptions<TData>>, effects: OptionUpdateEffects): void {
    const resolved = this.core.gridOptions;
    copyOptions(options, resolved, ["suppressCellFocus", "suppressRowHoverHighlight", "suppressNoRowsOverlay"]);
    if (copyChangedOption(options, resolved, "suppressHeaderFocus")) {
      effects.header = true;
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
    if (copyChangedOption(options, resolved, "defaultExpandAll")) {
      effects.needsRowRebuild = true;
    }
    if (options.applyRowDrag != null) {
      resolved.applyRowDrag = options.applyRowDrag;
      effects.cells = true;
    }
    if (hasOwnOption(options, "rowDragPolicy")) {
      resolved.rowDragPolicy = options.rowDragPolicy;
      effects.cells = true;
    }
    copyOptions(options, resolved, ["suppressWarnings"]);
  }

  private updateSelectionAndColumns(options: Partial<GridOptions<TData>>, effects: OptionUpdateEffects): void {
    const resolved = this.core.gridOptions;
    if (copyChangedOption(options, resolved, "rowSelection")) {
      this.core.selectionService.onModeChanged();
      effects.header = true;
      effects.pool = true;
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
    if (copyChangedOption(options, resolved, "masterDetail")) {
      effects.needsColumnRebuild = true;
      effects.needsRowRebuild = true;
    }
    if (copyChangedOption(options, resolved, "detailToggleColumn")) {
      effects.needsColumnRebuild = true;
    }
    if (copyChangedOption(options, resolved, "treeData")) {
      effects.needsRowRebuild = true;
      effects.needsColumnRebuild = true;
      this.core.refreshAriaState();
    }
    if (copyChangedOption(options, resolved, "childrenKey")) {
      effects.needsRowRebuild = true;
    }
    if (copyOptions(options, resolved, ["isTreeRowExpandable", "loadTreeChildren"], true)) effects.cells = true;
  }

  private updateExtensionOptions(options: Partial<GridOptions<TData>>, effects: OptionUpdateEffects): void {
    const resolved = this.core.gridOptions;
    if (copyOptions(options, resolved, ["aggFuncs"], true)) effects.needsRowRebuild = true;
    if (copyOptions(options, resolved, ["components", "actionPolicy"], true)) effects.cells = true;
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
    const resolved = this.core.gridOptions;
    if (updateDatasourceTuning(options, resolved) && resolved.datasourceMode === "block") effects.datasourceChanged = true;
    this.updateDatasourceMode(options, effects);
    this.updateDatasourceReference(options, effects);
    this.updatePinnedRows(options);
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
    if (copyOptions(options, resolved, ["detailRowRenderer", "isRowExpandable"], true)) effects.cells = true;
  }

  private updatePinnedRows(options: Partial<GridOptions<TData>>): void {
    if (options.pinnedTopRowData !== undefined) this.setPinnedRows("top", options.pinnedTopRowData);
    if (options.pinnedBottomRowData !== undefined) this.setPinnedRows("bottom", options.pinnedBottomRowData);
  }

  private applyOptionUpdateEffects(
    options: Partial<GridOptions<TData>>,
    effects: OptionUpdateEffects,
    previousColumnMenu: boolean
  ): void {
    const resolved = this.core.gridOptions;
    if (effects.needsColumnRebuild) {
      this.rebuildColumns(options, effects);
    } else if (hasOwnOption(options, "advancedFilterModel")) {
      effects.filterChanged = this.core.rowModel.setAdvancedFilterModel(options.advancedFilterModel);
    }
    if (effects.needsFeatureReload) this.core.setFeatures(resolved.features);
    this.applyRowsAndState(effects);
    if (effects.filterChanged) this.core.emitFilterChanged(!effects.needsColumnRebuild);
    if (effects.layout) {
      this.core.skeleton.updateHeights(resolved.rowHeight, resolved.headerHeight);
    }
    if (options.columnMenu != null && options.columnMenu !== previousColumnMenu) {
      effects.header = true;
    }
    if (effects.stateToApply) this.applyState(effects.stateToApply);
    if (effects.pool) effects.cells = undefined;
    effects.overlays = true;
    this.core.requestUpdate(effects);
  }

  private rebuildColumns(options: Partial<GridOptions<TData>>, effects: OptionUpdateEffects): void {
    if (effects.columnDefsChanged && !effects.needsRowRebuild) {
      this.core.cancelPendingInput();
      this.core.editingService.stop(true);
    }
    const sortChanged = this.core.columnModel.setColumnDefs(this.core.gridOptions.columnDefs);
    effects.filterChanged = this.core.rowModel.reconcileColumnFilters(
      hasOwnOption(options, "advancedFilterModel") ? options.advancedFilterModel ?? null : undefined
    );
    if (sortChanged) this.core.emit("sortChanged", { sortModel: this.core.columnModel.getSortModel() }, false);
    this.core.onColumnsStructureChanged();
    effects.header = false;
    effects.pool = false;
  }

  private applyRowsAndState(effects: OptionUpdateEffects): void {
    const restore = effects.needsStateLoad || effects.needsColumnRebuild;
    const refreshRows = effects.datasourceChanged || effects.needsRowRebuild || effects.columnDefsChanged || effects.filterChanged;
    const sections = this.core.gridOptions.persistence?.sections;
    // Local layout can be restored before the row update. Other saved sections
    // may depend on the new rows, for example selection and expansion.
    const restoreBeforeRows = refreshRows &&
      (this.core.rowModel.isInfinite || (sections?.length === 1 && sections[0] === "columns"));
    if (restore && restoreBeforeRows) this.core.loadPersistedGridState(!effects.needsStateLoad, true);
    this.applyRowUpdateEffect(effects, refreshRows);
    if (restore && !restoreBeforeRows) this.core.loadPersistedGridState(!effects.needsStateLoad);
  }

  private applyRowUpdateEffect(effects: OptionUpdateEffects, refreshRows?: boolean): void {
    if (effects.datasourceChanged) {
      void this.core.rowModel.onDatasourceChanged();
      return;
    }
    if (!refreshRows) return;
    if (!this.core.rowModel.isInfinite && effects.needsRowRebuild) {
      this.setRowData(this.core.gridOptions.rowData);
    } else {
      this.core.rowModel.refreshQueryRows();
    }
  }

  getDataAsCsv(params: CsvExportParams = {}): string {
    const rows = this.getDataAsMatrix({ ...params, target: "csv", protectFormulas: false });
    return buildCsv(rows, params);
  }

  getDataAsMatrix(params: MatrixExportParams = {}): unknown[][] {
    const cols = this.core.columnModel.getOrderedVisible().filter(isValueColumn);
    const header = params.includeHeader === false ? [] : [cols.map(column => column.colDef.headerName ?? column.colDef.field ?? column.id)];
    if (params.headersOnly) return header;
    const nodes = params.onlySelected ? this.core.selectionService.getSelectedNodes().sort((left, right) => left.rowIndex - right.rowIndex)
      : params.onlyAllDisplayed ? this.core.rowModel.getDisplayedRows() : this.core.rowModel.getPipelineRows();
    return [...header, ...nodes.filter(node => !node.isDetail && !node.isGroup).map(node => cols.map(column => {
      const value = serializeColumnValue(this.core, node, column, params.target ?? "xlsx");
      return params.protectFormulas === false ? value : sanitizeFormulaCell(value);
    }))];
  }

  getState(): GridState {
    return {
      version: 2,
      columns: this.core.columnModel.getColumnState(false),
      sortModel: this.core.columnModel.getSortModel(),
      filterModel: this.core.rowModel.getFilterModel(),
      advancedFilterModel: this.core.rowModel.getAdvancedFilterModel(),
      quickFilterText: this.core.rowModel.getQuickFilter(),
      pagination: {
        enabled: this.core.rowModel.paginationActive,
        page: this.core.rowModel.getCurrentPage(),
        pageSize: this.core.gridOptions.paginationPageSize
      },
      selectedRowIds: this.core.selectionService.getSelectedIds(),
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
    if (sections.has("columns")) this.core.scheduleGridStateSave();
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
    if (!this.core.isRestoringBeforeRows()) {
      if (!this.core.rowModel.isInfinite) {
        this.core.rowModel.refreshRows();
      } else if (sections.has("sort") || sections.has("filter")) {
        void this.core.rowModel.onServerParamsChanged();
      }
    }
    this.core.headerRenderer.refreshSortIndicators();
    this.core.headerRenderer.refreshFilterIcons();
    if (sections.has("selection")) this.core.selectionService.restoreSelection(state.selectedRowIds ?? []);
  }

  private emitStateEvents(sections: ReadonlySet<GridStateSection>): void {
    if (sections.has("sort")) this.core.emit("sortChanged", { sortModel: this.core.columnModel.getSortModel() });
    if (sections.has("filter")) this.core.emitFilterChanged();
    if (sections.has("pagination")) {
      this.core.rowModel.emitPaginationChanged(this.core.gridOptions.paginationPageSize);
    }
  }

  destroy(): void {
    const entries = this.takeAsyncTransactions();
    for (const entry of entries) {
      if (entry.signal && entry.onAbort) entry.signal.removeEventListener("abort", entry.onAbort);
      if (!entry.aborted) entry.resolve();
    }
    this.core.destroy();
  }

}

type BaseCommandKey = "batch" | "whenReady" | "getOption" | "updateOptions" | "on" | "destroy" | "isDestroyed";
type DomainFactories = {
  [Key in Exclude<keyof GridApi, BaseCommandKey>]: (impl: GridApiImpl<any>, core: GridCore<any>) => GridApi[Key]
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
      get: () => domain ??= Object.freeze(create(impl, core))
    });
  }
  Object.assign(api, {
    batch: (callback) => impl.batch(callback),
    whenReady: () => core.whenReady(),
    getOption: (key) => impl.getOption(key),
    updateOptions: (options) => impl.updateOptions(options),
    on: (eventType, listener) => core.eventBus.on(eventType, listener),
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
