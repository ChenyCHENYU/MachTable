import { EventBus } from "./eventBus";
import { resolveOptions } from "./resolveOptions";
import { ColumnModel } from "../services/columnModel";
import { RowModel } from "../services/rowModel";
import { SelectionService } from "../services/selectionService";
import { ResizeService } from "../services/resizeService";
import { ColumnDragService } from "../services/columnDragService";
import { KeyboardService } from "../services/keyboardService";
import { EditingService } from "../services/editingService";
import { FilterPopupService } from "../services/filterPopup";
import { ColumnMenuService } from "../services/columnMenuService";
import { ContextMenuService } from "../services/contextMenuService";
import { TooltipService } from "../services/tooltipService";
import { WatermarkService } from "../services/watermarkService";
import { UndoRedoService } from "../services/undoRedoService";
import { ChangeTrackingService } from "../services/changeTrackingService";
import { GridApiImpl } from "../services/gridApi";
import { GridSkeleton } from "../render/skeleton";
import { HeaderRenderer } from "../render/headerRenderer";
import { BodyRenderer } from "../render/bodyRenderer";
import { SummaryRenderer } from "../render/summaryRenderer";
import { PaginationBar } from "../render/paginationBar";
import { PinnedRowsRenderer } from "../render/pinnedRowsRenderer";
import { StatusBarService } from "../render/statusBarService";
import { getByPath, setByPath } from "../lib/path";
import { loadColumnState, saveColumnState } from "../lib/columnStateStore";
import { registerBuiltinRenderers } from "../lib/presetRenderers";
import {
  ensureCellRenderer,
  getCellEditor,
  getCellRenderer
} from "../lib/componentRegistry";
import { validateColumnDefs } from "../lib/validateDefs";
import { toTsv, parseTsv, writeClipboard } from "../lib/clipboard";
import { formatCellValueWith } from "../render/cellContent";
import { DEFAULT_LOCALE, type RgLocale, type RgLocaleKey } from "../lib/locale";
import packageJson from "../../package.json";
import type { ResolvedGridOptions } from "../types/options";
import type { GridApi, GridDiagnosticError, GridDiagnostics } from "../types/api";
import type { GridFeature, GridFeatureContext, GridOptions } from "../types/options";
import type { Column } from "../services/column";
import type { RowNode } from "../types/row";
import type { GridErrorCode, GridEventMap, GridEventType } from "../types/events";
import type {
  CellEditorFactory,
  CellRendererFn,
  ColumnFilter,
  ColumnState,
  ColDef,
  ColDefGroup
} from "../types/colDef";

type ColumnStateLike = ColumnState;

let gridUid = 0;
function ensureBuiltinRenderers(): void {
  registerBuiltinRenderers(ensureCellRenderer);
}

export class GridCore<TData = any> {
  readonly gridId: number;
  readonly options: ResolvedGridOptions<TData>;
  readonly eventBus: EventBus<GridEventMap<TData>>;
  readonly skeleton: GridSkeleton;
  readonly columnModel: ColumnModel;
  readonly rowModel: RowModel<TData>;
  readonly selectionService: SelectionService;
  readonly headerRenderer: HeaderRenderer;
  readonly bodyRenderer: BodyRenderer;
  readonly resizeService: ResizeService;
  readonly columnDragService: ColumnDragService;
  readonly keyboardService: KeyboardService;
  readonly editingService: EditingService;
  readonly undoService: UndoRedoService;
  readonly changeTracker: ChangeTrackingService<TData>;
  readonly filterPopup: FilterPopupService;
  readonly columnMenu: ColumnMenuService;
  readonly contextMenuService: ContextMenuService;
  readonly tooltipService: TooltipService;
  readonly watermarkService: WatermarkService;
  readonly paginationBar: PaginationBar;
  readonly pinnedRowsRenderer: PinnedRowsRenderer;
  readonly summaryRenderer: SummaryRenderer;
  readonly statusBarService: StatusBarService;
  readonly api: GridApi<TData>;

  private destroyed = false;
  private autoIdCounter = 0;
  private readyRafId = 0;
  private readySettled = false;
  private readonly readyPromise: Promise<GridApi<TData>>;
  private readonly resolveReady: (api: GridApi<TData>) => void;
  private lastColumnLayoutSignature = "";
  private activeFeatures = new Map<string, { feature: GridFeature<TData>; cleanup?: () => void }>();
  private recentErrors: GridDiagnosticError[] = [];

  constructor(container: HTMLElement, options: GridOptions<TData>) {
    let settleReady!: (api: GridApi<TData>) => void;
    this.readyPromise = new Promise((resolve) => {
      settleReady = resolve;
    });
    this.resolveReady = settleReady;
    this.gridId = ++gridUid;
    ensureBuiltinRenderers();
    this.options = resolveOptions(options);
    this.eventBus = new EventBus<GridEventMap<TData>>((error, eventType) => {
      if (eventType === "gridError") console.error("[mach-table] error in gridError listener", error);
      else this.reportError(error, "eventBus.listener", { eventType });
    });

    this.columnModel = new ColumnModel(this as GridCore<any>);
    this.rowModel = new RowModel<TData>(this as GridCore<any>);
    this.selectionService = new SelectionService(this as GridCore<any>);
    this.skeleton = new GridSkeleton(this as GridCore<any>);
    this.headerRenderer = new HeaderRenderer(this as GridCore<any>);
    this.bodyRenderer = new BodyRenderer(this as GridCore<any>);
    this.resizeService = new ResizeService(this as GridCore<any>);
    this.columnDragService = new ColumnDragService(this as GridCore<any>);
    this.keyboardService = new KeyboardService(this as GridCore<any>);
    this.editingService = new EditingService(this as GridCore<any>);
    this.undoService = new UndoRedoService(this as GridCore<any>);
    this.filterPopup = new FilterPopupService(this as GridCore<any>);
    this.columnMenu = new ColumnMenuService(this as GridCore<any>);
    this.contextMenuService = new ContextMenuService(this as GridCore<any>);
    this.tooltipService = new TooltipService(this as GridCore<any>);
    this.watermarkService = new WatermarkService(this as GridCore<any>);
    this.paginationBar = new PaginationBar(this as GridCore<any>);
    this.pinnedRowsRenderer = new PinnedRowsRenderer(this as GridCore<any>);
    this.summaryRenderer = new SummaryRenderer(this as GridCore<any>);
    this.statusBarService = new StatusBarService(this as GridCore<any>);
    this.api = new GridApiImpl<TData>(this as GridCore<TData>);
    this.changeTracker = new ChangeTrackingService<TData>(this as GridCore<TData>);

    try {
      this.changeTracker.init();
      this.skeleton.init(container, this.options);
      this.watermarkService.init();
      this.bodyRenderer.init();
      this.keyboardService.init();
      this.tooltipService.init();
      this.paginationBar.init();
      this.summaryRenderer.init();
      this.statusBarService.init();
      this.pinnedRowsRenderer.init();

      this.columnModel.setColumnDefs(this.options.columnDefs);
      this.refreshAriaState();
      this.validateDefs(this.options.columnDefs);
      this.checkWarnings();
      this.loadPersistedColumnState();
      this.headerRenderer.build();
      if (this.options.datasource) {
        void this.rowModel.startInfinite();
      } else {
        this.rowModel.setRowData(this.options.rowData);
      }
      if (this.options.initialState) this.api.applyState(this.options.initialState, { emitEvents: false });
      this.relayout();
      this.pinnedRowsRenderer.setData(this.options.pinnedTopRowData, this.options.pinnedBottomRowData);
      this.setFeatures(this.options.features);

      this.readyRafId = requestAnimationFrame(() => {
        this.readyRafId = 0;
        if (!this.destroyed) this.emit("gridReady", {});
        this.settleReady();
      });
    } catch (error) {
      this.reportError(error, "grid.constructor");
      this.destroy();
      throw error;
    }
  }

  getApi(): GridApi<TData> {
    return this.api;
  }

  whenReady(): Promise<GridApi<TData>> {
    return this.readyPromise;
  }

  private settleReady(): void {
    if (this.readySettled) return;
    this.readySettled = true;
    this.resolveReady(this.api);
  }

  resolveCellRenderer(name: string): CellRendererFn | undefined {
    const local = this.options.components?.cellRenderers?.[name];
    if (local) return local;
    let renderer = getCellRenderer(name);
    if (!renderer) {
      // `clearComponentRegistries` is public for test/HMR isolation; built-ins
      // must remain recoverable for already-created and future grids.
      ensureBuiltinRenderers();
      renderer = getCellRenderer(name);
    }
    return renderer;
  }

  resolveCellEditor(name: string): CellEditorFactory | undefined {
    return this.options.components?.cellEditors?.[name] ?? getCellEditor(name);
  }

  setFeatures(features: readonly GridFeature<TData>[] | null | undefined): void {
    this.destroyFeatures();
    if (this.destroyed) return;
    const context: GridFeatureContext<TData> = {
      api: this.api,
      root: this.skeleton.root,
      getOptions: () => this.options,
      addEventListener: (type, listener) => this.eventBus.on(type, listener),
      reportError: (error, source, details) => this.reportError(error, `feature.${source}`, details)
    };

    for (const feature of features ?? []) {
      const key = typeof feature?.key === "string" ? feature.key.trim() : "";
      if (!key) {
        this.reportError(new Error("GridFeature.key must be a non-empty string"), "feature.setup");
        continue;
      }
      if (this.activeFeatures.has(key)) {
        this.reportError(new Error(`Duplicate GridFeature key: ${key}`), "feature.setup", { key });
        continue;
      }
      try {
        const cleanup = feature.setup(context);
        this.activeFeatures.set(key, {
          feature,
          ...(typeof cleanup === "function" ? { cleanup } : {})
        });
      } catch (error) {
        this.reportError(error, "feature.setup", { key });
      }
    }
  }

  private destroyFeatures(): void {
    const entries = [...this.activeFeatures.entries()].reverse();
    this.activeFeatures.clear();
    for (const [key, active] of entries) {
      try {
        active.cleanup?.();
      } catch (error) {
        this.reportError(error, "feature.cleanup", { key });
      }
      try {
        active.feature.destroy?.();
      } catch (error) {
        this.reportError(error, "feature.destroy", { key });
      }
    }
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  nextId(): number {
    return ++this.autoIdCounter;
  }

  getCellValue(node: RowNode<any>, column: Column): any {
    const def = column.colDef;
    if (def.valueGetter) {
      try {
        return def.valueGetter({
          api: this.api,
          colDef: def,
          column,
          node,
          data: node.data
        });
      } catch (error) {
        this.reportError(error, "valueGetter", { colId: column.id, rowId: node.id });
        return undefined;
      }
    }
    if (def.field) return getByPath(node.data, def.field);
    return undefined;
  }

  getLocaleText(key: RgLocaleKey): string {
    const locale: RgLocale = this.options.locale;
    return locale[key] ?? DEFAULT_LOCALE[key];
  }

  writeValue(node: RowNode<any>, column: Column, newValue: any, oldValue?: any): boolean {
    const colDef = column.colDef;
    if (colDef.valueSetter) {
      try {
        return colDef.valueSetter({
          oldValue,
          newValue,
          data: node.data!,
          node,
          colDef,
          column,
          api: this.api
        });
      } catch (error) {
        this.reportError(error, "valueSetter", { colId: column.id, rowId: node.id });
        return false;
      }
    }
    if (colDef.field) return setByPath(node.data, colDef.field, newValue);
    return false;
  }

  setCellValue(node: RowNode<any>, column: Column, newValue: any, oldValue: any): boolean {
    if (newValue === undefined || newValue === oldValue) return false;
    const colDef = column.colDef;

    let changed: boolean;
    if (colDef.valueSetter) {
      try {
        changed = colDef.valueSetter({
          oldValue,
          newValue,
          data: node.data!,
          node,
          colDef,
          column,
          api: this.api
        });
      } catch (error) {
        this.reportError(error, "valueSetter", { colId: column.id, rowId: node.id });
        return false;
      }
    } else if (colDef.field) {
      changed = setByPath(node.data, colDef.field, newValue);
    } else {
      return false;
    }

    if (changed) this.notifyCellValueChanged(node, column, oldValue, newValue);
    return changed;
  }

  /** Emits the shared value-change side effects after a caller has written data transactionally. */
  notifyCellValueChanged(node: RowNode<any>, column: Column, oldValue: any, newValue: any): void {
    this.bodyRenderer.invalidateRowHeight(node);
    this.bodyRenderer.queueFlash([node.rowIndex], [column.id]);
    this.emit("cellValueChanged", {
      oldValue,
      newValue,
      rowNode: node,
      rowIndex: node.rowIndex,
      column,
      colDef: column.colDef,
      data: node.data!
    });
    this.undoService.record({ nodeId: node.id, columnId: column.id, oldValue, newValue });
  }

  buildRangeTsv(range: { r1: number; c1: number; r2: number; c2: number }): string {
    const flat = this.columnModel.getOrderedVisible();
    const cols = flat.slice(range.c1, range.c2 + 1);
    const rows: string[][] = [];
    for (let r = range.r1; r <= range.r2; r++) {
      const node = this.rowModel.getDisplayedRow(r);
      rows.push(
        cols.map((col) => {
          if (!node || node.isDetail || node.isGroup) return "";
          return formatCellValueWith(this, node, col, this.getCellValue(node, col));
        })
      );
    }
    return toTsv(rows);
  }

  copyActiveRange(): Promise<boolean> {
    const range = this.bodyRenderer.getNormalizedRangeOrFocus();
    if (!range) return Promise.resolve(false);
    return writeClipboard(this.buildRangeTsv(range));
  }

  clearRangeValues(range: { r1: number; c1: number; r2: number; c2: number }): void {
    if (this.destroyed) return;
    const flat = this.columnModel.getOrderedVisible();
    const changedRows = new Set<number>();
    this.undoService.beginBatch();
    try {
      for (let r = range.r1; r <= range.r2; r++) {
        const node = this.rowModel.getDisplayedRow(r);
        if (!node || node.isDetail || node.isGroup) continue;
        for (let c = range.c1; c <= range.c2; c++) {
          const col = flat[c];
          if (!col || col.hasCheckbox || col.isDetailToggle || col.colDef.rowDrag) continue;
          if (!this.editingService.isEditable(node, col)) continue;
          const old = this.getCellValue(node, col);
          if (this.setCellValue(node, col, null, old)) changedRows.add(r);
        }
      }
    } finally {
      this.undoService.endBatch();
    }
    if (changedRows.size > 0) {
      this.bodyRenderer.refreshRows([...changedRows]);
      this.summaryRenderer.refresh();
    }
  }

  pasteText(text: string, startRow: number, startColIdx: number): void {
    if (this.destroyed) return;
    const grid = parseTsv(text);
    if (grid.length === 0) return;
    const flat = this.columnModel.getOrderedVisible();
    const rowCount = this.rowModel.getDisplayedRowCount();
    const changedRows = new Set<number>();
    let r = startRow;

    this.undoService.beginBatch();
    try {
      for (const line of grid) {
        while (r < rowCount) {
          const node = this.rowModel.getDisplayedRow(r);
          if (node && !node.isDetail && !node.isGroup) break;
          r++;
        }
        if (r >= rowCount) break;
        const node = this.rowModel.getDisplayedRow(r)!;
        let c = startColIdx;
        for (const token of line) {
          while (c < flat.length) {
            const skip = flat[c] && (flat[c].hasCheckbox || flat[c].isDetailToggle || flat[c].colDef.rowDrag);
            if (!skip) break;
            c++;
          }
          if (c >= flat.length) break;
          const col = flat[c];
          if (this.editingService.isEditable(node, col)) {
            const old = this.getCellValue(node, col);
            let value: any = token;
            if (token === "") {
              value = null;
            } else if (typeof old === "number" && !isNaN(Number(token))) {
              value = Number(token);
            }
            if (this.setCellValue(node, col, value, old)) changedRows.add(r);
          }
          c++;
        }
        r++;
      }
    } finally {
      this.undoService.endBatch();
    }

    if (changedRows.size > 0) {
      this.bodyRenderer.refreshRows([...changedRows]);
      this.summaryRenderer.refresh();
    }
  }

  pasteFromSystemClipboard(): Promise<void> {
    const start = this.bodyRenderer.getPasteStart();
    if (!start) return Promise.resolve();
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
        return navigator.clipboard
          .readText()
          .then((text) => {
            if (text) this.pasteText(text, start.row, start.colIdx);
          })
          .catch(() => undefined);
      }
    } catch {
      void 0;
    }
    return Promise.resolve();
  }

  refreshSummary(): void {
    this.summaryRenderer.refresh();
  }

  emit<K extends GridEventType>(type: K, extra?: Partial<GridEventMap<TData>[K]>): GridEventMap<TData>[K] {
    const event = { type, api: this.api, ...extra } as GridEventMap<TData>[K];
    this.eventBus.emit(type, event);
    const handlerKey = ("on" + type.charAt(0).toUpperCase() + type.slice(1)) as keyof ResolvedGridOptions<TData>;
    const handler = this.options[handlerKey] as unknown as
      | ((event: GridEventMap<TData>[K]) => void)
      | undefined;
    if (typeof handler === "function") {
      try {
        handler(event);
      } catch (error) {
        if (type === "gridError") console.error("[mach-table] error in onGridError", error);
        else this.reportError(error, `eventHandler.${String(handlerKey)}`, { eventType: type });
      }
    }
    return event;
  }

  reportError(error: unknown, source: string, context?: Record<string, unknown>): void {
    const code = this.errorCodeFor(source, error);
    const message = error instanceof Error ? error.message : String(error);
    this.recentErrors.push({ code, source, message, timestamp: Date.now(), ...(context ? { context } : {}) });
    if (this.recentErrors.length > 50) this.recentErrors.splice(0, this.recentErrors.length - 50);
    console.error(`[mach-table] ${code} (${source})`, error);
    if (this.destroyed) return;
    this.emit("gridError", { code, error, source, context });
  }

  private errorCodeFor(source: string, error: unknown): GridErrorCode {
    if (source.startsWith("datasource")) return "DATA_SOURCE_ERROR";
    const message = error instanceof Error ? error.message : String(error);
    if (source === "getRowId" || message.includes("Duplicate row id")) return "DATA_INTEGRITY_ERROR";
    if (source === "validate") return "VALIDATION_ERROR";
    if (
      source.toLowerCase().includes("renderer") ||
      source === "valueFormatter" ||
      source === "cellStyle" ||
      source === "cellClass"
    ) return "RENDERER_ERROR";
    if (source.toLowerCase().includes("editor") || source === "editable") return "EDITOR_ERROR";
    if (source.startsWith("feature.")) return "FEATURE_ERROR";
    if (source.startsWith("columnState.")) return "STATE_ERROR";
    if (source.startsWith("eventBus.") || source.startsWith("eventHandler.")) return "EVENT_HANDLER_ERROR";
    return "GRID_ERROR";
  }

  getDiagnostics(): GridDiagnostics {
    return {
      gridId: this.gridId,
      version: packageJson.version,
      destroyed: this.destroyed,
      infinite: this.rowModel.isInfinite,
      loading: this.rowModel.isLoadingInfinite() || this.options.loading,
      rowCount: this.rowModel.getDisplayTotalCount(),
      renderedRowCount: this.skeleton.bodyEl.querySelectorAll(".mach-row[data-index]").length,
      columnCount: this.columnModel.getColumns().length,
      selectedRowCount: this.selectionService.getSelectedNodes().length,
      dirtyRowCount: this.changeTracker.getDirtyRowIds().length,
      recentErrors: this.recentErrors.map((entry) => ({
        ...entry,
        ...(entry.context ? { context: { ...entry.context } } : {})
      }))
    };
  }

  cycleSort(column: Column, additive: boolean): void {
    this.columnModel.cycleSort(column, additive);
    this.applySortModel();
  }

  applySortModel(): void {
    this.headerRenderer.refreshSortIndicators();
    this.emit("sortChanged", { sortModel: this.columnModel.getSortModel() });
    this.persistColumnState();
    if (this.rowModel.isInfinite) {
      this.rowModel.onServerParamsChanged();
      return;
    }
    this.rowModel.refreshPipeline();
    this.bodyRenderer.onDataChanged();
  }

  applyColumnFilter(column: Column, filter: ColumnFilter | null): void {
    const model = this.rowModel.getFilterModel();
    if (filter) model[column.id] = filter;
    else delete model[column.id];
    this.rowModel.setFilterModel(model);
    this.headerRenderer.refreshFilterIcons();
    this.emit("filterChanged", { filterModel: this.rowModel.getFilterModel() });
    if (this.rowModel.isInfinite) {
      this.rowModel.onServerParamsChanged();
      return;
    }
    this.rowModel.refreshPipeline();
    this.bodyRenderer.onDataChanged();
  }

  applyQuickFilter(): void {
    this.emit("filterChanged", { filterModel: this.rowModel.getFilterModel() });
    if (this.rowModel.isInfinite) {
      this.rowModel.onServerParamsChanged();
      return;
    }
    this.rowModel.refreshPipeline();
    this.bodyRenderer.onDataChanged();
  }

  moveColumn(colId: string, toIndex: number): void {
    if (!this.columnModel.moveColumn(colId, toIndex)) return;
    this.onColumnsStructureChanged();
    this.emit("columnMoved", { colId, toIndex });
    this.persistColumnState();
  }

  toggleDetail(rowId: string): boolean {
    return this.rowModel.toggleDetail(rowId);
  }

  private stateLoadToken = 0;

  loadPersistedColumnState(): void {
    const token = ++this.stateLoadToken;
    if (!this.options.columnStateKey) return;
    let saved: ColumnStateLike[] | null | Promise<ColumnStateLike[] | null>;
    try {
      saved = this.options.columnStateStore
        ? this.options.columnStateStore.load(this.options.columnStateKey)
        : loadColumnState(this.options.columnStateKey);
    } catch (error) {
      this.reportError(error, "columnState.load");
      return;
    }
    if (saved == null) return;
    if (!Array.isArray(saved)) {
      Promise.resolve(saved)
        .then((states) => {
          if (this.destroyed || token !== this.stateLoadToken || !states || states.length === 0) return;
          this.columnModel.applyColumnState(states);
          if (this.rowModel.isInfinite) void this.rowModel.onServerParamsChanged();
          else this.rowModel.refreshPipeline();
          this.onColumnsStructureChanged();
        })
        .catch((error) => this.reportError(error, "columnState.load"));
      return;
    }
    if (saved.length > 0) {
      this.columnModel.applyColumnState(saved);
    }
  }

  persistColumnState(): void {
    if (!this.options.columnStateKey || this.destroyed) return;
    const state = this.columnModel.getColumnState();
    try {
      const result = this.options.columnStateStore
        ? this.options.columnStateStore.save(this.options.columnStateKey, state)
        : saveColumnState(this.options.columnStateKey, state);
      if (result && typeof (result as Promise<void>).catch === "function") {
        void (result as Promise<void>).catch((error) => this.reportError(error, "columnState.save"));
      }
    } catch (error) {
      this.reportError(error, "columnState.save");
    }
  }

  buildDefaultEmptyState(): HTMLElement {
    const locale = this.options.locale ?? {};
    const title = locale.emptyRows ?? DEFAULT_LOCALE.emptyRows;
    const hint = locale.emptyRowsHint ?? DEFAULT_LOCALE.emptyRowsHint;
    const empty = document.createElement("div");
    empty.className = "mach-empty";

    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("class", "mach-empty__icon");
    icon.setAttribute("viewBox", "0 0 96 84");
    icon.setAttribute("width", "96");
    icon.setAttribute("height", "84");
    icon.setAttribute("fill", "none");
    icon.setAttribute("aria-hidden", "true");
    // Static library-owned SVG only; user-controlled text is assigned via textContent below.
    icon.innerHTML =
      '<rect x="8" y="10" width="68" height="56" rx="6" fill="#eaf3fe"/>' +
      '<rect x="8" y="10" width="68" height="12" rx="6" fill="#d5e8fd"/>' +
      '<rect x="8" y="19" width="68" height="3" fill="#d5e8fd"/>' +
      '<g stroke="#bcd7f8" stroke-width="2.4" stroke-linecap="round">' +
      '<line x1="16" y1="32" x2="68" y2="32"/><line x1="16" y1="42" x2="60" y2="42"/>' +
      '<line x1="16" y1="52" x2="64" y2="52"/></g>' +
      '<circle cx="66" cy="52" r="15" fill="#ffffff" stroke="#8fbdf5" stroke-width="3"/>' +
      '<line x1="77" y1="63" x2="86" y2="72" stroke="#8fbdf5" stroke-width="4" stroke-linecap="round"/>' +
      '<line x1="60" y1="52" x2="72" y2="52" stroke="#bcd7f8" stroke-width="2.6" stroke-linecap="round"/>';

    const titleEl = document.createElement("div");
    titleEl.className = "mach-empty__title";
    titleEl.textContent = title;
    const hintEl = document.createElement("div");
    hintEl.className = "mach-empty__hint";
    hintEl.textContent = hint;
    empty.append(icon, titleEl, hintEl);
    return empty;
  }

  private lastValidatedDefs: unknown = null;
  private issuedWarningSignatures = new Set<string>();

  checkWarnings(): void {
    if (this.options.suppressWarnings || this.destroyed) return;
    if (this.options.treeData) {
      if (this.columnModel.getRowGroupColumns().length > 0) {
        console.warn("[mach-table] treeData 与 rowGroup 不支持同时启用，行分组已被忽略");
      }
      if (this.options.masterDetail) {
        console.warn("[mach-table] treeData 与 masterDetail 不支持同时启用，主从明细已被忽略");
      }
    }
  }

  validateDefs(defs: (ColDef<any> | ColDefGroup<any>)[] | null | undefined): void {
    if (this.options.suppressWarnings || this.destroyed) return;
    if (this.lastValidatedDefs === defs) return;
    this.lastValidatedDefs = defs;
    for (const issue of validateColumnDefs(defs)) {
      if (this.issuedWarningSignatures.has(issue)) continue;
      this.issuedWarningSignatures.add(issue);
      console.warn(`[mach-table] ${issue}`);
    }
  }

  onColumnsStructureChanged(): void {
    this.checkWarnings();
    this.validateDefs(this.columnModel.getColumnDefs());
    this.bodyRenderer.invalidateAllRowHeights();
    this.headerRenderer.build();
    this.bodyRenderer.rebuildPool();
    this.relayout();
    this.pinnedRowsRenderer.rebuild();
    this.summaryRenderer.refresh();
    this.emit("displayedColumnsChanged", {});
  }

  relayout(): void {
    if (this.destroyed) return;
    this.refreshAriaState();
    this.columnModel.computeLayout(this.skeleton.measureViewportWidth());
    const widthSignature = this.columnModel.getOrderedVisible()
      .map((column) => `${column.id}:${column.currentWidth}`)
      .join("|");
    if (this.lastColumnLayoutSignature && widthSignature !== this.lastColumnLayoutSignature) {
      this.bodyRenderer.invalidateAllRowHeights();
    }
    this.lastColumnLayoutSignature = widthSignature;
    this.skeleton.root.setAttribute("aria-colcount", String(this.columnModel.getOrderedVisible().length));
    this.headerRenderer.applyLayout();
    this.bodyRenderer.relayout();
    this.pinnedRowsRenderer.applyLayout();
    this.summaryRenderer.refresh();
  }

  refreshAriaState(): void {
    if (!this.skeleton.root) return;
    const treeGrid = this.options.treeData || this.columnModel.getRowGroupColumns().length > 0;
    this.skeleton.root.setAttribute("role", treeGrid ? "treegrid" : "grid");
    if (this.options.rowSelection === "multiple") {
      this.skeleton.root.setAttribute("aria-multiselectable", "true");
    } else {
      this.skeleton.root.removeAttribute("aria-multiselectable");
    }
    const editable = this.columnModel.getOrderedVisible().some((column) => Boolean(column.colDef.editable));
    if (editable) this.skeleton.root.removeAttribute("aria-readonly");
    else this.skeleton.root.setAttribute("aria-readonly", "true");
  }

  relayoutColumns(invalidateRowHeights = true): void {
    if (this.destroyed) return;
    this.columnModel.computeLayout(this.skeleton.measureViewportWidth());
    if (invalidateRowHeights) this.bodyRenderer.invalidateAllRowHeights();
    this.headerRenderer.applyLayout();
    this.bodyRenderer.applyContainerSizes();
    this.bodyRenderer.applyCellLayout();
    this.bodyRenderer.updateRange(true);
    this.pinnedRowsRenderer.applyLayout();
    this.summaryRenderer.refresh();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.readyRafId) cancelAnimationFrame(this.readyRafId);
    this.readyRafId = 0;
    this.settleReady();
    const safely = (source: string, fn: () => void): void => {
      try {
        fn();
      } catch (error) {
        console.error(`[mach-table] ${source} destroy error`, error);
      }
    };
    safely("grid event", () => this.emit("gridDestroyed", {}));
    safely("features", () => this.destroyFeatures());
    safely("changeTracker", () => this.changeTracker.destroy());
    safely("rowModel", () => this.rowModel.destroy());
    safely("editingService", () => this.editingService.destroy());
    safely("keyboardService", () => this.keyboardService.destroy());
    safely("filterPopup", () => this.filterPopup.destroy());
    safely("columnMenu", () => this.columnMenu.destroy());
    safely("contextMenu", () => this.contextMenuService.destroy());
    safely("tooltip", () => this.tooltipService.destroy());
    safely("watermark", () => this.watermarkService.destroy());
    safely("pagination", () => this.paginationBar.destroy());
    safely("columnDrag", () => this.columnDragService.destroy());
    safely("resize", () => this.resizeService.destroy());
    safely("bodyRenderer", () => this.bodyRenderer.destroy());
    safely("headerRenderer", () => this.headerRenderer.destroy());
    safely("pinnedRowsRenderer", () => this.pinnedRowsRenderer.destroy());
    safely("summaryRenderer", () => this.summaryRenderer.destroy());
    safely("statusBar", () => this.statusBarService.destroy());
    safely("skeleton", () => this.skeleton.destroy());
    this.eventBus.clear();
  }
}
