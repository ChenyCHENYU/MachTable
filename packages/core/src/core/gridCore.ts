import { el } from "../lib/dom";
import { EventBus } from "./eventBus";
import { resolveOptions } from "./resolveOptions";
import { ColumnModel } from "../services/columnModel";
import { RowModel } from "../services/rowModel";
import { SelectionService } from "../services/selectionService";
import { ResizeService } from "../services/resizeService";
import { ColumnDragService } from "../services/columnDragService";
import { KeyboardService } from "../services/keyboardService";
import { EditingService } from "../services/editingService";
import { InputService, type InputChange } from "../services/inputService";
import { parseColumnValue, serializeColumnValue } from "../lib/columnValues";
import { coerceImportedValue } from "../lib/numericText";
import { FilterPopupService } from "../services/filterPopup";
import { ColumnMenuService } from "../services/columnMenuService";
import { ContextMenuService } from "../services/contextMenuService";
import { TooltipService } from "../services/tooltipService";
import { WatermarkService } from "../services/watermarkService";
import { UndoRedoService } from "../services/undoRedoService";
import { ChangeTrackingService } from "../services/changeTrackingService";
import { PerformanceMonitor } from "../services/performanceMonitor";
import { GridUpdateScheduler, type GridUpdateRequest } from "../services/updateScheduler";
import { createGridApi } from "../services/gridApi";
import { GridSkeleton } from "../render/skeleton";
import { HeaderRenderer } from "../render/headerRenderer";
import { BodyRenderer } from "../render/bodyRenderer";
import { SummaryRenderer } from "../render/summaryRenderer";
import { PaginationBar } from "../render/paginationBar";
import { PinnedRowsRenderer } from "../render/pinnedRowsRenderer";
import { StatusBarService } from "../render/statusBarService";
import { getByPath, setByPath } from "../lib/path";
import { loadGridState, saveGridState } from "../lib/gridStateStore";
import { selectGridStateSections } from "../lib/gridState";
import { BUILTIN_CELL_RENDERERS, closeGridActionSurface } from "../lib/presetRenderers";
import { closeGridSelect } from "../lib/selectControl";
import { ResourceScope } from "../lib/resourceScope";
import { validateColumnDefs } from "../lib/validateDefs";
import { validateGridOptions } from "../lib/validateOptions";
import { normalizeFeatureRequirements, resolveGridFeatures } from "../lib/featureManifest";
import { toTsv, parseTsv, writeClipboard } from "../lib/clipboard";
import { DEFAULT_LOCALE, type MachTableLocale, type MachTableLocaleKey } from "../lib/locale";
import { version as packageVersion } from "../../package.json";
import type { ResolvedGridOptions } from "../types/options";
import type { GridApi, GridDiagnosticError, GridDiagnostics } from "../types/api";
import type { GridFeature, GridFeatureContext, GridOptions, GridStateStore } from "../types/options";
import type { GridState } from "../types/state";
import type { Column } from "../services/column";
import type { RowNode } from "../types/row";
import type { GridErrorCode, GridEventMap, GridEventType } from "../types/events";
import type {
  CellEditorFactory,
  CellRendererFn,
  ColumnFilter,
  ColDef,
  ColDefGroup
} from "../types/colDef";

const DATA_SOURCE_ERROR_PREFIXES = ["datasource", "treeData"] as const;
const STATE_ERROR_PREFIXES = ["columnState.", "gridState."] as const;
const RENDERER_ERROR_SOURCES = new Set(["valueFormatter", "cellStyle", "cellClass"]);
const GRID_STATE_CHANGE_EVENTS = new Set<GridEventType>([
  "selectionChanged",
  "sortChanged",
  "filterChanged",
  "columnMoved",
  "columnVisibilityChanged",
  "displayedColumnsChanged",
  "paginationChanged",
  "detailToggled"
]);

let gridUid = 0;

/** @internal Per-grid services are exposed only through the frozen GridApi facade. */
export class GridCore<TData = any> {
  readonly gridId: number;
  readonly gridOptions: ResolvedGridOptions<TData>;
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
  readonly inputService: InputService;
  readonly undoService: UndoRedoService;
  readonly changeTracker: ChangeTrackingService<TData>;
  readonly performanceMonitor: PerformanceMonitor;
  readonly updateScheduler: GridUpdateScheduler;
  readonly filterPopup: FilterPopupService;
  readonly columnMenu: ColumnMenuService;
  readonly contextMenuService: ContextMenuService;
  readonly tooltipService: TooltipService;
  readonly watermarkService: WatermarkService;
  readonly paginationBar: PaginationBar;
  readonly pinnedRowsRenderer: PinnedRowsRenderer;
  readonly summaryRenderer: SummaryRenderer;
  readonly statusBarService: StatusBarService;
  // Construction failures can occur before the facade is connected; cleanup checks it explicitly.
  readonly api!: GridApi<TData>;

  private disposedState = false;
  private autoIdCounter = 0;
  private readyRafId = 0;
  private readySettled = false;
  private readonly readyPromise: Promise<GridApi<TData>>;
  private readonly resolveReady: (api: GridApi<TData>) => void;
  private lastColumnLayoutSignature = "";
  private resources = new ResourceScope((error) => console.error("[mach-table] resource cleanup error", error));
  private activeFeatures = new Map<string, { feature: GridFeature<TData>; scope: ResourceScope }>();
  private processorSource: GridOptions<TData>["dataProcessor"];
  private releaseProcessor?: () => void;
  private processorGeneration = 0;
  private featureGeneration = 0;
  private recentErrors: GridDiagnosticError[] = [];
  private stateSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private gridStateLoadToken = 0;
  private gridStateMutationVersion = 0;
  private applyingPersistedGridState = false;
  private stateSaveInFlight = false;
  private pendingStateSave: { key: string; store?: GridStateStore; state: GridState } | null = null;

  constructor(container: HTMLElement, options: GridOptions<TData>) {
    let settleReady!: (api: GridApi<TData>) => void;
    this.readyPromise = new Promise((resolve) => {
      settleReady = resolve;
    });
    this.resolveReady = settleReady;
    this.gridId = ++gridUid;
    this.gridOptions = resolveOptions(options);
    this.eventBus = new EventBus<GridEventMap<TData>>((error, eventType) => {
      if (eventType === "gridError") console.error("[mach-table] error in gridError listener", error);
      else this.reportError(error, "eventBus.listener", { eventType });
    });

    try {
      this.setDataProcessor(options.dataProcessor);
      this.columnModel = new ColumnModel(this);
      this.rowModel = this.resources.own(new RowModel<TData>(this));
      this.selectionService = new SelectionService(this);
      this.skeleton = this.resources.own(new GridSkeleton(this));
      this.headerRenderer = this.resources.own(new HeaderRenderer(this));
      this.bodyRenderer = this.resources.own(new BodyRenderer(this));
      this.resizeService = this.resources.own(new ResizeService(this));
      this.columnDragService = this.resources.own(new ColumnDragService(this));
      this.keyboardService = this.resources.own(new KeyboardService(this));
      this.editingService = this.resources.own(new EditingService(this));
      this.inputService = new InputService(this);
      this.undoService = new UndoRedoService(this);
      this.performanceMonitor = this.resources.own(new PerformanceMonitor());
      this.updateScheduler = this.resources.own(new GridUpdateScheduler((request) => this.applyScheduledUpdate(request)));
      this.filterPopup = this.resources.own(new FilterPopupService(this));
      this.columnMenu = this.resources.own(new ColumnMenuService(this));
      this.contextMenuService = this.resources.own(new ContextMenuService(this));
      this.tooltipService = this.resources.own(new TooltipService(this));
      this.watermarkService = this.resources.own(new WatermarkService(this));
      this.paginationBar = this.resources.own(new PaginationBar(this));
      this.pinnedRowsRenderer = this.resources.own(new PinnedRowsRenderer(this));
      this.summaryRenderer = this.resources.own(new SummaryRenderer(this));
      this.statusBarService = this.resources.own(new StatusBarService(this));
      this.api = createGridApi(this);
      this.changeTracker = this.resources.own(new ChangeTrackingService<TData>(this));
      this.resources.add(() => this.destroyFeatures());

      this.changeTracker.init();
      this.skeleton.init(container, this.gridOptions);
      this.watermarkService.init();
      this.bodyRenderer.init();
      this.keyboardService.init();
      this.tooltipService.init();
      this.paginationBar.init();
      this.summaryRenderer.init();
      this.statusBarService.init();
      this.pinnedRowsRenderer.init();

      this.rowModel.restorePagination(this.gridOptions.paginationPage, this.gridOptions.paginationPageSize);
      this.columnModel.setColumnDefs(this.gridOptions.columnDefs);
      this.rowModel.setAdvancedFilterModel(this.gridOptions.advancedFilterModel);
      this.rowModel.setQuickFilter(this.gridOptions.quickFilterText);
      this.refreshAriaState();
      this.validateDefs(this.gridOptions.columnDefs);
      this.checkWarnings(options);
      this.headerRenderer.build();
      if (this.gridOptions.datasource) {
        void this.rowModel.startInfinite().catch(() => undefined);
      } else {
        this.rowModel.setRowData(this.gridOptions.rowData);
      }
      if (this.gridOptions.initialState) this.api.state.apply(this.gridOptions.initialState, { emitEvents: false });
      this.loadPersistedGridState();
      this.relayout();
      this.pinnedRowsRenderer.setData(this.gridOptions.pinnedTopRowData, this.gridOptions.pinnedBottomRowData);
      this.setFeatures(this.gridOptions.features);

      if (this.disposedState) return;

      this.readyRafId = requestAnimationFrame(() => {
        this.readyRafId = 0;
        if (!this.disposedState) this.emit("gridReady", {});
        this.settleReady();
      });
    } catch (error) {
      if (this.api) this.reportError(error, "grid.constructor");
      this.destroy();
      throw error;
    }
  }


  /** Resolve factories once per owner; publish the new owner before releasing a reentrant old one. */
  setDataProcessor(source: GridOptions<TData>["dataProcessor"]): boolean {
    if (source === this.processorSource) return false;
    const generation = ++this.processorGeneration;
    const next = typeof source === "function" ? source() : source;
    if (this.disposedState || generation !== this.processorGeneration) {
      next?.destroy?.();
      return false;
    }
    const previous = this.releaseProcessor;
    this.processorSource = source;
    if (next === this.gridOptions.dataProcessor && previous) return false;
    this.gridOptions.dataProcessor = next;
    this.releaseProcessor = next ? this.resources.add(() => next.destroy?.()) : undefined;
    previous?.();
    return true;
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
    return this.gridOptions.components?.cellRenderers?.[name] ?? BUILTIN_CELL_RENDERERS[name];
  }

  resolveCellEditor(name: string): CellEditorFactory | undefined {
    return this.gridOptions.components?.cellEditors?.[name];
  }

  private inactiveFeatureDependency(feature: GridFeature<TData>): string | undefined {
    return normalizeFeatureRequirements(feature.requires)
      .map((dependency) => dependency.key)
      .find((dependency) => !this.activeFeatures.has(dependency));
  }

  setFeatures(features: readonly GridFeature<TData>[] | null | undefined): void {
    const generation = this.featureGeneration + 1;
    this.destroyFeatures();
    if (this.disposedState || this.featureGeneration !== generation) return;
    const resolved = resolveGridFeatures(features ?? []);
    for (const issue of resolved.issues) {
      this.reportError(new Error(issue.message), "feature.manifest", {
        code: issue.code,
        ...(issue.feature ? { key: issue.feature } : {}),
        ...(issue.dependency ? { dependency: issue.dependency } : {})
      });
    }

    for (const feature of resolved.features) {
      if (this.disposedState || this.featureGeneration !== generation) return;
      const key = feature.key.trim();
      const inactiveDependency = this.inactiveFeatureDependency(feature);
      if (inactiveDependency) {
        this.reportError(
          new Error(`GridFeature "${key}" dependency "${inactiveDependency}" did not initialise`),
          "feature.manifest",
          { code: "FEATURE_DEPENDENCY_SETUP_FAILED", key, dependency: inactiveDependency }
        );
        continue;
      }
      const scope = new ResourceScope((error) => this.reportError(error, "feature.cleanup", { key }));
      const manage = (cleanup: () => void): (() => void) => scope.add(cleanup);
      const context: GridFeatureContext<TData> = {
        api: this.api,
        root: this.skeleton.root,
        getOptions: () => this.gridOptions,
        addEventListener: (type, listener) => manage(this.eventBus.on(type, listener)),
        onCleanup: (cleanup) => { manage(cleanup); },
        addManagedDomListener: (target, type, listener, listenerOptions) => {
          target.addEventListener(type, listener, listenerOptions);
          return manage(() => target.removeEventListener(type, listener, listenerOptions));
        },
        setManagedTimeout: (handler, delayMs) => {
          const id = setTimeout(() => { release(); handler(); }, Math.max(0, delayMs));
          const release = manage(() => clearTimeout(id));
          return id;
        },
        createAbortController: () => {
          const controller = new AbortController();
          manage(() => controller.abort());
          return controller;
        },
        reportError: (error, source, details) => this.reportError(error, `feature.${source}`, details)
      };
      try {
        const cleanup = feature.setup(context);
        if (typeof cleanup === "function") manage(cleanup);
        if (this.disposedState || this.featureGeneration !== generation) {
          this.releaseFeature(key, { feature, scope });
          return;
        }
        this.activeFeatures.set(key, { feature, scope });
      } catch (error) {
        scope.dispose();
        this.reportError(error, "feature.setup", { key });
      }
    }
  }

  private destroyFeatures(): void {
    this.featureGeneration++;
    const entries = [...this.activeFeatures.entries()].reverse();
    this.activeFeatures.clear();
    for (const [key, active] of entries) this.releaseFeature(key, active);
  }

  private releaseFeature(key: string, active: { feature: GridFeature<TData>; scope: ResourceScope }): void {
    active.scope.dispose();
    try {
      active.feature.destroy?.();
    } catch (error) {
      this.reportError(error, "feature.destroy", { key });
    }
  }

  isDisposed(): boolean {
    return this.disposedState;
  }

  /** KeepAlive closes transient interaction owners while retaining the model. */
  suspend(): void {
    this.cancelPendingInput();
    void this.api.editing.stop({ cancel: true });
    this.filterPopup.close();
    this.columnMenu.close();
    this.contextMenuService.close();
    this.tooltipService.hide();
    this.resizeService.cancelResize();
    this.columnDragService.destroy();
    this.bodyRenderer.suspend();
    closeGridSelect(this.skeleton.root);
    closeGridActionSurface(this.skeleton.root);
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && this.skeleton.root.contains(focused)) focused.blur();
  }

  nextId(): number {
    return ++this.autoIdCounter;
  }

  readCellValue(node: RowNode<any>, column: Column): any {
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

  getLocaleText(key: MachTableLocaleKey): string {
    const locale: MachTableLocale = this.gridOptions.locale;
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

  /** Emits the shared value-change side effects after a caller has written data transactionally. */
  notifyCellValueChanged(node: RowNode<any>, column: Column, oldValue: any, newValue: any): void {
    this.bodyRenderer.invalidateRowHeight(node);
    this.bodyRenderer.queueFlash([node.rowIndex], [column.id]);
    this.undoService.record({ nodeId: node.id, columnId: column.id, oldValue, newValue });
    this.emit("cellValueChanged", {
      oldValue,
      newValue,
      rowNode: node,
      rowIndex: node.rowIndex,
      column,
      colDef: column.colDef,
      data: node.data!
    });
  }

  buildRangeTsv(range: { r1: number; c1: number; r2: number; c2: number }): string {
    const flat = this.columnModel.getOrderedVisible();
    const cols = flat.slice(range.c1, range.c2 + 1);
    const rows: unknown[][] = [];
    for (let r = range.r1; r <= range.r2; r++) {
      const node = this.rowModel.getDisplayedRow(r);
      rows.push(
        cols.map((col) => {
          if (!node || node.isDetail || node.isGroup) return "";
          return serializeColumnValue(this, node, col, "clipboard");
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
    if (this.disposedState) return;
    const flat = this.columnModel.getOrderedVisible();
    const changes: InputChange[] = [];
    for (let r = range.r1; r <= range.r2; r++) {
      const node = this.rowModel.getDisplayedRow(r);
      if (!node || node.isDetail || node.isGroup) continue;
      for (let c = range.c1; c <= range.c2; c++) {
        const column = flat[c];
        if (!column || column.hasCheckbox || column.isDetailToggle || column.colDef.rowDrag) continue;
        changes.push({ node, column, oldValue: this.readCellValue(node, column), newValue: null });
      }
    }
    this.applyInputChanges(changes);
  }

  /** User input is validated here; trusted data transactions and undo replay stay separate. */
  applyInputChanges(changes: readonly InputChange[]): void {
    this.inputService.applyChanges(changes);
  }

  cancelPendingInput(): void {
    this.inputService?.cancelPending();
  }

  pasteText(text: string, startRow: number, startColIdx: number): void {
    if (this.disposedState) return;
    const grid = parseTsv(text);
    if (grid.length === 0) return;
    const flat = this.columnModel.getOrderedVisible();
    const rowCount = this.rowModel.getDisplayedRowCount();
    const changes: InputChange[] = [];
    let r = startRow;
    for (const line of grid) {
      const row = this.nextPasteRow(r, rowCount);
      if (!row) break;
      this.pasteLine(row.node, line, flat, startColIdx, changes);
      r = row.index + 1;
    }
    this.applyInputChanges(changes);
  }

  private nextPasteRow(start: number, rowCount: number): { index: number; node: RowNode<TData> } | null {
    for (let index = start; index < rowCount; index++) {
      const node = this.rowModel.getDisplayedRow(index);
      if (node && !node.isDetail && !node.isGroup) return { index, node };
    }
    return null;
  }

  private nextPasteColumn(columns: Column[], start: number): number {
    let index = start;
    while (index < columns.length) {
      const column = columns[index];
      if (!column.hasCheckbox && !column.isDetailToggle && !column.colDef.rowDrag) break;
      index++;
    }
    return index;
  }

  private pasteLine(
    node: RowNode<TData>,
    line: readonly string[],
    columns: Column[],
    startColIdx: number,
    changes: InputChange[]
  ): void {
    let columnIndex = startColIdx;
    const rowStart = changes.length;
    for (const token of line) {
      columnIndex = this.nextPasteColumn(columns, columnIndex);
      if (columnIndex >= columns.length) return;
      const column = columns[columnIndex];
      if (!this.editingService.isEditable(node, column)) { columnIndex++; continue; }
      const oldValue = this.readCellValue(node, column);
      try {
        const newValue = column.colDef.valueParser ? parseColumnValue(this, node, column, token, "clipboard", oldValue)
          : coerceImportedValue(token, typeof oldValue === "number" || column.colDef.cellEditor === "number");
        changes.push({ node, column, oldValue, newValue });
      } catch (error) {
        // One parse failure rejects the entire candidate row, before any setter runs.
        changes.splice(rowStart);
        this.reportError(error, "validate", { rowId: node.id, colId: column.id });
        return;
      }
      columnIndex++;
    }
  }

  pasteFromSystemClipboard(): Promise<void> {
    const start = this.bodyRenderer.getPasteStart();
    if (!start) return Promise.resolve();
    const current = this.inputService.beginIntent();
    const node = this.rowModel.getDisplayedRow(start.row);
    const column = this.columnModel.getOrderedVisible()[start.colIdx];
    if (!node || !column) return Promise.resolve();
    const oldValue = this.readCellValue(node, column);
    const scope = this.inputService.captureScope([{ node, column, oldValue, newValue: oldValue }]);
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
        return navigator.clipboard
          .readText()
          .then((text) => {
            const anchor = this.bodyRenderer.getPasteStart();
            if (text && current() && scope() && anchor?.row === start.row && anchor.colIdx === start.colIdx
              && this.rowModel.getDisplayedRow(start.row) === node
              && this.columnModel.getOrderedVisible()[start.colIdx] === column) {
              this.pasteText(text, start.row, start.colIdx);
            }
          })
          .catch(() => undefined);
      }
    } catch {
      void 0;
    }
    return Promise.resolve();
  }

  emit<K extends GridEventType>(type: K, extra?: Partial<GridEventMap<TData>[K]>): GridEventMap<TData>[K] {
    const event = { type, api: this.api, ...extra } as GridEventMap<TData>[K];
    this.eventBus.emit(type, event);
    const handlerKey = ("on" + type.charAt(0).toUpperCase() + type.slice(1)) as keyof ResolvedGridOptions<TData>;
    const handler = this.gridOptions[handlerKey] as
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
    const finishedResize = type === "columnResized" && Boolean((event as { finished?: boolean }).finished);
    if (finishedResize || GRID_STATE_CHANGE_EVENTS.has(type)) this.scheduleGridStateSave();
    return event;
  }

  reportError(error: unknown, source: string, context?: Record<string, unknown>): void {
    const code = this.errorCodeFor(source, error);
    const message = error instanceof Error ? error.message : String(error);
    this.recentErrors.push({ code, source, message, timestamp: Date.now(), ...(context ? { context } : {}) });
    if (this.recentErrors.length > 50) this.recentErrors.splice(0, this.recentErrors.length - 50);
    console.error(`[mach-table] ${code} (${source})`, error);
    if (this.disposedState) return;
    this.emit("gridError", { code, error, source, context });
  }

  private errorCodeFor(source: string, error: unknown): GridErrorCode {
    if (DATA_SOURCE_ERROR_PREFIXES.some((prefix) => source.startsWith(prefix))) return "DATA_SOURCE_ERROR";
    const message = error instanceof Error ? error.message : String(error);
    if (source === "rowKey" || message.includes("Duplicate row id")) return "DATA_INTEGRITY_ERROR";
    if (source === "validate") return "VALIDATION_ERROR";
    if (source.toLowerCase().includes("renderer") || RENDERER_ERROR_SOURCES.has(source)) return "RENDERER_ERROR";
    if (source.toLowerCase().includes("editor") || source === "editable") return "EDITOR_ERROR";
    if (source.startsWith("feature.")) return "FEATURE_ERROR";
    if (STATE_ERROR_PREFIXES.some((prefix) => source.startsWith(prefix))) return "STATE_ERROR";
    if (source.startsWith("eventBus.") || source.startsWith("eventHandler.")) return "EVENT_HANDLER_ERROR";
    return "GRID_ERROR";
  }

  getDiagnostics(): GridDiagnostics {
    return {
      gridId: this.gridId,
      version: packageVersion,
      destroyed: this.disposedState,
      infinite: this.rowModel.isInfinite,
      loading: this.rowModel.isLoadingInfinite() || this.gridOptions.loading,
      rowCount: this.rowModel.getDisplayTotalCount(),
      renderedRowCount: this.skeleton.bodyEl.querySelectorAll(".mach-row[data-index]").length,
      columnCount: this.columnModel.getColumns().length,
      selectedRowCount: this.selectionService.getSelectedNodes().length,
      dirtyRowCount: this.changeTracker.getDirtyRowIds().length,
      activeFeatures: [...this.activeFeatures].map(([key, active]) => ({
        key,
        ...(active.feature.version ? { version: active.feature.version } : {})
      })),
      performance: this.performanceMonitor.snapshot(),
      updates: this.updateScheduler.snapshot(),
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
    if (this.rowModel.isInfinite) {
      void this.rowModel.onServerParamsChanged();
      return;
    }
    this.rowModel.refreshPipeline();
    this.requestUpdate({ data: true });
  }

  applyColumnFilter(column: Column, filter: ColumnFilter | null): void {
    const model = this.rowModel.getFilterModel();
    if (filter) model[column.id] = filter;
    else delete model[column.id];
    this.rowModel.setFilterModel(model);
    this.headerRenderer.refreshFilterIcons();
    this.emit("filterChanged", {
      filterModel: this.rowModel.getFilterModel(),
      advancedFilterModel: this.rowModel.getAdvancedFilterModel()
    });
    if (this.rowModel.isInfinite) {
      void this.rowModel.onServerParamsChanged();
      return;
    }
    this.rowModel.refreshPipeline();
    this.requestUpdate({ data: true });
  }

  applyQuickFilter(): void {
    this.emit("filterChanged", {
      filterModel: this.rowModel.getFilterModel(),
      advancedFilterModel: this.rowModel.getAdvancedFilterModel()
    });
    if (this.rowModel.isInfinite) {
      void this.rowModel.onServerParamsChanged();
      return;
    }
    this.rowModel.refreshPipeline();
    this.requestUpdate({ data: true });
  }

  moveColumn(colId: string, toIndex: number): void {
    if (!this.columnModel.moveColumn(colId, toIndex)) return;
    this.onColumnsStructureChanged();
    this.emit("columnMoved", { colId, toIndex });
  }

  toggleDetail(rowId: string): boolean {
    return this.rowModel.toggleDetail(rowId);
  }

  emitColumnResize(column: Column, finished: boolean): void {
    this.emit("columnResized", {
      colId: column.id,
      width: column.currentWidth,
      finished
    });
  }

  /** Finalizes one logical resize operation and persists its state once. */
  commitColumnWidths(columns: readonly Column[]): void {
    if (this.disposedState || columns.length === 0) return;
    for (const column of columns) {
      if (this.disposedState) break;
      this.emitColumnResize(column, true);
    }
  }

  loadPersistedGridState(): void {
    const token = ++this.gridStateLoadToken;
    const mutationVersion = this.gridStateMutationVersion;
    const persistence = this.gridOptions.persistence;
    if (!persistence) return;
    const { key, store, sections } = persistence;
    let saved: import("../types/state").GridStateInput | null | Promise<import("../types/state").GridStateInput | null>;
    try {
      saved = store ? store.load(key) : loadGridState(key);
    } catch (error) {
      this.reportError(error, "gridState.load");
      return;
    }
    const apply = (state: import("../types/state").GridStateInput | null): void => {
      if (
        this.disposedState || token !== this.gridStateLoadToken ||
        mutationVersion !== this.gridStateMutationVersion || !state
      ) return;
      this.applyingPersistedGridState = true;
      try {
        this.api.state.apply(state, { emitEvents: false, ...(sections ? { sections } : {}) });
      } finally {
        this.applyingPersistedGridState = false;
      }
    };
    if (saved && typeof (saved as Promise<unknown>).then === "function") {
      void Promise.resolve(saved).then(apply).catch((error) => this.reportError(error, "gridState.load"));
    } else {
      apply(saved as import("../types/state").GridStateInput | null);
    }
  }

  scheduleGridStateSave(): void {
    const persistence = this.gridOptions.persistence;
    if (!persistence || this.disposedState || this.applyingPersistedGridState) return;
    this.gridStateMutationVersion++;
    if (this.stateSaveTimer) clearTimeout(this.stateSaveTimer);
    if (persistence.debounceMs === 0) {
      this.stateSaveTimer = null;
      this.persistGridState();
      return;
    }
    this.stateSaveTimer = setTimeout(() => {
      this.stateSaveTimer = null;
      this.persistGridState();
    }, persistence.debounceMs);
  }

  persistGridState(): void {
    const persistence = this.gridOptions.persistence;
    if (!persistence || this.disposedState) return;
    const { key, store, sections } = persistence;
    const currentState = this.api.state.get();
    const state = sections ? selectGridStateSections(currentState, sections) : currentState;
    const request = { key, ...(store ? { store } : {}), state };
    if (this.stateSaveInFlight) {
      this.pendingStateSave = request;
      return;
    }
    this.writeGridState(request);
  }

  private writeGridState(request: { key: string; store?: GridStateStore; state: GridState }): void {
    try {
      const result = request.store
        ? request.store.save(request.key, request.state)
        : saveGridState(request.key, request.state);
      if (!result || typeof result.then !== "function") return;
      this.stateSaveInFlight = true;
      void Promise.resolve(result)
        .catch((error) => this.reportError(error, "gridState.save"))
        .finally(() => {
          this.stateSaveInFlight = false;
          const pending = this.pendingStateSave;
          this.pendingStateSave = null;
          if (pending) this.writeGridState(pending);
        });
    } catch (error) {
      this.reportError(error, "gridState.save");
    }
  }

  buildDefaultErrorState(): HTMLElement {
    const error = el("div", "mach-empty mach-empty--error");
    const title = el("div", "mach-empty__title");
    title.textContent = this.getLocaleText("requestFailed");
    const hint = el("div", "mach-empty__hint");
    hint.textContent = this.getLocaleText("requestFailedHint");
    error.append(title, hint);
    return error;
  }

  buildDefaultLoadingState(): HTMLElement {
    const loading = el("div", "mach-loading");

    const visual = el("div", "mach-loading__visual");
    visual.setAttribute("aria-hidden", "true");
    for (let index = 0; index < 4; index += 1) {
      const row = el("span", "mach-loading__row");
      visual.appendChild(row);
    }

    const status = el("div", "mach-loading__status");
    const spinner = el("span", "mach-spinner mach-loading__spinner");
    spinner.setAttribute("aria-hidden", "true");
    const label = el("span", "mach-loading__label");
    label.textContent = this.getLocaleText("loading");
    status.append(spinner, label);

    loading.append(visual, status);
    return loading;
  }

  buildDefaultEmptyState(): HTMLElement {
    const empty = el("div", "mach-empty");

    // Static library-owned SVG only; locale strings stay on textContent below.
    empty.innerHTML = '<svg class="mach-empty__icon" viewBox="0 0 96 84" aria-hidden="true"><rect stroke-opacity=".3" x="8" y="6" width="76" height="66" rx="9"/><path fill="#8b98ff" opacity=".12" stroke="none" d="M17 6H75Q84 6 84 15V26H8V15Q8 6 17 6Z"/><path stroke="var(--mach-body-fg)" opacity=".06" d="M8 26h76M38 26v46M61 26v46M8 42h76M8 57h76"/><path stroke-width="5" opacity=".5" d="M19 15h12m17 0h7m15 0h7"/><path stroke="var(--mach-body-fg)" opacity=".06" stroke-width="4" d="M19 34h12m14 0h8m15 0h8M19 49h12m14 0h8m15 0h8M19 64h12m14 0h8"/><circle stroke-opacity=".3" cx="72" cy="55" r="19"/><circle cx="70" cy="53" r="9"/><path d="m77 60 6 6m-16-16 6 6m0-6-6 6"/></svg>';

    const titleEl = el("div", "mach-empty__title");
    titleEl.textContent = this.getLocaleText("emptyRows");
    const hintEl = el("div", "mach-empty__hint");
    hintEl.textContent = this.getLocaleText("emptyRowsHint");
    empty.append(titleEl, hintEl);
    return empty;
  }

  private lastValidatedDefs: unknown = null;
  private issuedWarningSignatures = new Set<string>();

  checkWarnings(inputOptions?: Partial<GridOptions<any>> | Record<string, unknown>): void {
    if (this.gridOptions.suppressWarnings || this.disposedState) return;
    if (inputOptions) {
      for (const issue of validateGridOptions(inputOptions)) {
        const signature = `${issue.code}:${issue.option ?? ""}:${issue.message}`;
        if (this.issuedWarningSignatures.has(signature)) continue;
        this.issuedWarningSignatures.add(signature);
        console.warn(`[mach-table:${issue.code}] ${issue.message}`);
      }
    }
    if (this.gridOptions.treeData) {
      if (this.columnModel.getRowGroupColumns().length > 0) {
        console.warn("[mach-table] treeData 与 rowGroup 不支持同时启用，行分组已被忽略");
      }
    }
  }

  validateDefs(defs: (ColDef<any> | ColDefGroup<any>)[] | null | undefined): void {
    if (this.gridOptions.suppressWarnings || this.disposedState) return;
    if (this.lastValidatedDefs === defs) return;
    this.lastValidatedDefs = defs;
    for (const issue of validateColumnDefs(defs)) {
      if (this.issuedWarningSignatures.has(issue)) continue;
      this.issuedWarningSignatures.add(issue);
      console.warn(`[mach-table] ${issue}`);
    }
  }

  onColumnsStructureChanged(): void {
    this.updateScheduler.schedule({ columns: true });
  }

  requestUpdate(request: GridUpdateRequest): void {
    this.updateScheduler.schedule(request);
  }

  batchUpdates<TResult>(callback: () => TResult): TResult {
    return this.updateScheduler.batch(callback);
  }

  private applyScheduledUpdate(request: GridUpdateRequest): void {
    if (this.disposedState) return;
    if (request.columns) this.applyColumnsStructureChanged();
    else {
      if (request.header) this.headerRenderer.build();
      if (request.pool) this.bodyRenderer.rebuildPool();
      else if (request.layout) this.relayout();
    }
    if (request.data && !request.pool && !request.columns) this.bodyRenderer.onDataChanged();
    else if (request.cells) {
      this.bodyRenderer.refreshCells(request.cells === true ? undefined : request.cells);
    }
    if (request.pinned) this.pinnedRowsRenderer.refresh();
    if (request.summary) this.summaryRenderer.refresh();
    if (request.overlays) this.bodyRenderer.refreshOverlays();
  }

  private applyColumnsStructureChanged(): void {
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
    if (this.disposedState) return;
    const startedAt = this.performanceMonitor.start();
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
    this.performanceMonitor.recordLayout(startedAt);
  }

  refreshAriaState(): void {
    if (!this.skeleton.root) return;
    const treeGrid = this.gridOptions.treeData || this.columnModel.getRowGroupColumns().length > 0;
    this.skeleton.root.setAttribute("role", treeGrid ? "treegrid" : "grid");
    if (this.gridOptions.rowSelection === "multiple") {
      this.skeleton.root.setAttribute("aria-multiselectable", "true");
    } else {
      this.skeleton.root.removeAttribute("aria-multiselectable");
    }
    const editable = this.columnModel.getOrderedVisible().some((column) => Boolean(column.colDef.editable));
    if (editable) this.skeleton.root.removeAttribute("aria-readonly");
    else this.skeleton.root.setAttribute("aria-readonly", "true");
  }

  relayoutColumns(invalidateRowHeights = true): void {
    if (this.disposedState) return;
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
    if (this.disposedState) return;
    if (this.stateSaveTimer) {
      clearTimeout(this.stateSaveTimer);
      this.stateSaveTimer = null;
      this.persistGridState();
    }
    this.disposedState = true;
    this.cancelPendingInput();
    if (this.readyRafId) cancelAnimationFrame(this.readyRafId);
    this.readyRafId = 0;
    if (this.api) {
      this.settleReady();
      try { this.emit("gridDestroyed", {}); } catch (error) { console.error("[mach-table] grid destroy event", error); }
    }
    this.resources.dispose();
    this.eventBus.clear();
  }
}
