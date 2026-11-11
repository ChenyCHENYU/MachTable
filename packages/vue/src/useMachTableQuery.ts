import {
  computed,
  nextTick,
  onScopeDispose,
  ref,
  shallowRef,
  unref,
  watch,
  type ComputedRef,
  type Ref,
  type ShallowRef
} from "vue";
import {
  getByPath,
  normalizeAdvancedFilterModel,
  type AdvancedFilterModel,
  type FilterChangedEvent,
  type FilterModel,
  type GridApi,
  type GridOptions,
  type OverlayContent,
  type OverlayTemplate,
  type PaginationChangedEvent,
  type SelectionChangedEvent,
  type SortChangedEvent,
  type SortModel
} from "@agile-team/mach-table";

export type MachTableQuerySource<TQuery> =
  | TQuery
  | Readonly<Ref<TQuery>>
  | (() => TQuery);

export interface MachTablePageRequest<TQuery> {
  page: number;
  pageSize: number;
  query: TQuery;
  sortModel: SortModel;
  filterModel: FilterModel;
  advancedFilterModel: AdvancedFilterModel | null;
  quickFilterText: string | null;
  signal: AbortSignal;
}

export interface MachTablePageResult<TData> {
  rows: readonly TData[];
  total: number;
}

export type MachTableRemoteSelectionState =
  | { mode: "explicit"; selectedKeys: string[] }
  | { mode: "allMatching"; excludedKeys: string[] };

export interface UseMachTableQueryOptions<TData, TQuery = Record<string, unknown>> {
  request(params: MachTablePageRequest<TQuery>): Promise<MachTablePageResult<TData>>;
  query: MachTableQuerySource<TQuery>;
  /** Stable row key used for updates and cross-page selection. */
  rowKey: string | ((row: TData) => string | number);
  initialPage?: number;
  pageSize?: number;
  pageSizeOptions?: readonly number[];
  immediate?: boolean;
  /** auto reloads when query/grid criteria change; manual waits for reload/reset. */
  mode?: "auto" | "manual";
  debounceMs?: number;
  keepPreviousData?: boolean;
  /** `page` keeps explicit selections present in the accepted page; `preserve`/`query` retain cross-page selections. */
  selectionScope?: "page" | "preserve" | "query";
  /** Defaults true: a different business/filter query cannot inherit stale selections. */
  clearSelectionOnQueryChange?: boolean;
  /** Writable quick-filter state shared with inputs and GridApi. */
  quickFilterText?: Ref<string | null>;
  /** Renders inside the first-class error overlay for the latest failed request. */
  errorOverlay?(context: { error: unknown; retry(): Promise<void> }): OverlayContent;
  emptyOverlay?: OverlayTemplate;
  onSuccess?(result: MachTablePageResult<TData>): void;
  onError?(error: unknown): void;
}

export interface UseMachTableQueryReturn<TData> {
  rows: ShallowRef<TData[]>;
  loading: Ref<boolean>;
  error: ShallowRef<unknown | null>;
  page: Ref<number>;
  pageSize: Ref<number>;
  total: Ref<number>;
  sortModel: ShallowRef<SortModel>;
  filterModel: ShallowRef<FilterModel>;
  advancedFilterModel: ShallowRef<AdvancedFilterModel | null>;
  selectedKeys: Ref<string[]>;
  selectedRows: ShallowRef<TData[]>;
  selectionState: ComputedRef<MachTableRemoteSelectionState>;
  bindings: ComputedRef<GridOptions<TData>>;
  reload(options?: { resetPage?: boolean }): Promise<void>;
  retry(): Promise<void>;
  reset(): Promise<void>;
  abort(): void;
  clearSelection(): void;
  /** Selects the complete server query without downloading every row ID. */
  selectAllMatching(): void;
  applySelectionState(state: MachTableRemoteSelectionState): void;
}

function readSource<T>(source: MachTableQuerySource<T>): T {
  return typeof source === "function" ? (source as () => T)() : unref(source);
}

function normalizePositive(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function isAbortError(error: unknown): boolean {
  return error != null && typeof error === "object" && (error as { name?: unknown }).name === "AbortError";
}

/**
 * B-side remote-list controller: paging, sorting, filtering, cancellation,
 * stale-response protection and cross-page selection in one typed binding.
 */
export function useMachTableQuery<TData, TQuery = Record<string, unknown>>(
  options: UseMachTableQueryOptions<TData, TQuery>
): UseMachTableQueryReturn<TData> {
  const rows = shallowRef<TData[]>([]);
  const loading = ref(false);
  const error = shallowRef<unknown | null>(null);
  const page = ref(normalizePositive(options.initialPage, 1));
  const pageSize = ref(normalizePositive(options.pageSize, 20));
  const total = ref(0);
  const sortModel = shallowRef<SortModel>([]);
  const filterModel = shallowRef<FilterModel>({});
  const advancedFilterModel = shallowRef<AdvancedFilterModel | null>(null);
  const selectedKeys = ref<string[]>([]);
  const selectedRows = shallowRef<TData[]>([]);
  const selectedIds = new Set<string>();
  const excludedIds = new Set<string>();
  const selectedById = new Map<string, TData>();
  const quickFilterText = options.quickFilterText ?? ref<string | null>(null);
  const selectionScope = options.selectionScope ?? "preserve";
  const automatic = options.mode !== "manual";
  const allMatching = ref(false);
  const selectionRevision = ref(0);
  const pageSizes = [...new Set((options.pageSizeOptions ?? [10, 20, 50, 100]).map((value) => normalizePositive(value, 0)).filter(Boolean))];
  if (!pageSizes.includes(pageSize.value)) pageSizes.push(pageSize.value);
  pageSizes.sort((a, b) => a - b);

  let api: GridApi<TData> | null = null;
  let controller: AbortController | null = null;
  let generation = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let suppressGridEvents = false;
  let handledQuickFilterText = quickFilterText.value;
  let suppressSelectionEvents = false;
  let updatingSelectedRefs = false;

  const rowId = (row: TData): string => {
    const value = typeof options.rowKey === "function"
      ? options.rowKey(row)
      : getByPath(row, options.rowKey);
    if (value == null || String(value).length === 0) {
      throw new Error(`[MachTable] useMachTableQuery rowKey \"${String(options.rowKey)}\" returned an empty value.`);
    }
    return String(value);
  };

  const updateSelectedRefs = (): void => {
    updatingSelectedRefs = true;
    selectedKeys.value = allMatching.value ? [] : [...selectedIds];
    updatingSelectedRefs = false;
    const ids = allMatching.value ? [...selectedById.keys()] : selectedKeys.value;
    selectedRows.value = ids.flatMap((id) => {
      const row = selectedById.get(id);
      return row === undefined || excludedIds.has(id) ? [] : [row];
    });
    selectionRevision.value++;
  };

  const isSelectedId = (id: string): boolean => allMatching.value
    ? !excludedIds.has(id)
    : selectedIds.has(id);

  const syncVisibleSelection = (): void => {
    if (!api || api.isDestroyed()) return;
    const selected = rows.value.filter((row) => isSelectedId(rowId(row)));
    suppressSelectionEvents = true;
    try {
      api.selection.setRows(selected, true);
    } finally {
      suppressSelectionEvents = false;
    }
  };

  const abort = (): void => {
    generation++;
    controller?.abort();
    controller = null;
    if (debounceTimer != null) clearTimeout(debounceTimer);
    debounceTimer = null;
    loading.value = false;
  };

  const applyPageResult = async (
    result: MachTablePageResult<TData>,
    requestGeneration: number
  ): Promise<void> => {
    // Abort and replacement both advance the generation before any response can resume.
    if (requestGeneration !== generation) return;
    if (!result || !Array.isArray(result.rows) || !Number.isFinite(result.total) || result.total < 0) {
      throw new TypeError("[MachTable] Remote request must resolve to { rows: TData[], total: non-negative number }.");
    }
    const nextRows = [...result.rows];
    const pageRows = new Map(nextRows.map((row) => [rowId(row), row] as const));
    if (selectionScope === "page") {
      for (const id of selectedIds) {
        if (!pageRows.has(id)) {
          selectedIds.delete(id);
          selectedById.delete(id);
        }
      }
    }
    rows.value = nextRows;
    total.value = Math.floor(result.total);
    for (const [id, row] of pageRows) {
      if (isSelectedId(id)) selectedById.set(id, row);
      else selectedById.delete(id);
    }
    updateSelectedRefs();
    options.onSuccess?.(result);
    await nextTick();
    syncVisibleSelection();
  };

  const handleRequestError = (
    requestError: unknown,
    requestGeneration: number
  ): void => {
    if (requestGeneration !== generation || isAbortError(requestError)) return;
    error.value = requestError ?? new Error();
    options.onError?.(error.value);
  };

  const load = async (): Promise<void> => {
    if (debounceTimer != null) clearTimeout(debounceTimer);
    debounceTimer = null;
    controller?.abort();
    const activeController = new AbortController();
    controller = activeController;
    const requestGeneration = ++generation;
    loading.value = true;
    error.value = null;
    if (options.keepPreviousData === false) rows.value = [];

    try {
      const result = await options.request({
        page: page.value,
        pageSize: pageSize.value,
        query: readSource(options.query),
        sortModel: sortModel.value.map((item) => ({ ...item })),
        filterModel: { ...filterModel.value },
        advancedFilterModel: normalizeAdvancedFilterModel(advancedFilterModel.value),
        quickFilterText: quickFilterText.value,
        signal: activeController.signal
      });
      await applyPageResult(result, requestGeneration);
    } catch (requestError) {
      handleRequestError(requestError, requestGeneration);
    } finally {
      if (requestGeneration === generation) {
        loading.value = false;
        if (controller === activeController) controller = null;
      }
    }
  };

  const scheduleLoad = (): void => {
    page.value = 1;
    if (!automatic) return;
    abort();
    const delay = options.debounceMs ?? 0;
    if (delay > 0) debounceTimer = setTimeout(load, delay);
    else void load();
  };

  const onGridReady = (event: { api: GridApi<TData> }): void => {
    api = event.api;
    void nextTick(syncVisibleSelection);
  };
  const onPaginationChanged = (event: PaginationChangedEvent<TData>): void => {
    if (suppressGridEvents) return;
    if (event.page === page.value && event.pageSize === pageSize.value) return;
    page.value = event.page;
    pageSize.value = event.pageSize;
    if (automatic) void load();
  };
  const onSortChanged = (event: SortChangedEvent<TData>): void => {
    if (suppressGridEvents) return;
    sortModel.value = event.sortModel.map((item) => ({ ...item }));
    scheduleLoad();
  };
  const onFilterChanged = (event: FilterChangedEvent<TData>): void => {
    if (suppressGridEvents) return;
    filterModel.value = { ...event.filterModel };
    advancedFilterModel.value = normalizeAdvancedFilterModel(event.advancedFilterModel);
    handledQuickFilterText = event.api.filtering.getQuickText();
    if (quickFilterText.value !== handledQuickFilterText) quickFilterText.value = handledQuickFilterText;
    onCriteriaChanged();
  };
  const onSelectionChanged = (event: SelectionChangedEvent<TData>): void => {
    if (suppressSelectionEvents) return;
    const visibleIds = rows.value.map(rowId);
    const nextVisibleIds = new Set(event.selectedRows.map(rowId));
    if (allMatching.value) {
      for (const id of visibleIds) {
        if (nextVisibleIds.has(id)) excludedIds.delete(id);
        else {
          excludedIds.add(id);
          selectedById.delete(id);
        }
      }
    } else if (selectionScope === "page") {
      clearSelectionCache();
    } else {
      for (const id of visibleIds) {
        selectedIds.delete(id);
        selectedById.delete(id);
      }
    }
    for (const row of event.selectedRows) {
      const id = rowId(row);
      if (!allMatching.value) selectedIds.add(id);
      selectedById.set(id, row);
    }
    updateSelectedRefs();
  };

  const bindings = computed<GridOptions<TData>>(() => ({
    rowData: rows.value,
    loading: loading.value,
    rowKey: rowId,
    manualSorting: true,
    manualFiltering: true,
    advancedFilterModel: advancedFilterModel.value,
    quickFilterText: quickFilterText.value,
    error: error.value,
    overlayErrorTemplate: error.value
      ? () => options.errorOverlay?.({ error: error.value, retry: load }) ?? "Remote request failed. Please retry."
      : undefined,
    overlayNoRowsTemplate: options.emptyOverlay,
    pagination: {
      mode: "server",
      page: page.value,
      pageSize: pageSize.value,
      pageSizeOptions: pageSizes,
      total: total.value,
      showTotal: true,
      showPageSizeSelector: true
    },
    onGridReady,
    onPaginationChanged,
    onSortChanged,
    onFilterChanged,
    onSelectionChanged
  }));

  const reload = async (reloadOptions: { resetPage?: boolean } = {}): Promise<void> => {
    if (reloadOptions.resetPage) page.value = 1;
    await load();
  };
  const reset = async (): Promise<void> => {
    suppressGridEvents = true;
    try {
      page.value = 1;
      sortModel.value = [];
      filterModel.value = {};
      advancedFilterModel.value = null;
      handledQuickFilterText = null;
      quickFilterText.value = null;
      clearSelection();
      api?.sorting.setModel(null);
      api?.filtering.setModel(null);
      api?.filtering.setAdvancedModel(null);
      api?.filtering.setQuickText(null);
      // Vue's criteria watchers flush asynchronously. Keep them suppressed so
      // reset owns the single deterministic request below.
      await nextTick();
    } finally {
      suppressGridEvents = false;
    }
    await load();
  };
  const clearSelectionCache = (): void => {
    selectedIds.clear();
    excludedIds.clear();
    selectedById.clear();
  };
  const clearSelection = (): void => {
    allMatching.value = false;
    clearSelectionCache();
    updateSelectedRefs();
    suppressSelectionEvents = true;
    try { api?.selection.clear(); } finally { suppressSelectionEvents = false; }
  };
  const selectAllMatching = (): void => {
    allMatching.value = true;
    clearSelectionCache();
    for (const row of rows.value) selectedById.set(rowId(row), row);
    updateSelectedRefs();
    syncVisibleSelection();
  };
  const applySelectionState = (state: MachTableRemoteSelectionState): void => {
    clearSelectionCache();
    allMatching.value = state.mode === "allMatching";
    const ids = state.mode === "allMatching" ? state.excludedKeys : state.selectedKeys;
    for (const id of ids.map(String)) {
      if (state.mode === "allMatching") excludedIds.add(id);
      else selectedIds.add(id);
    }
    for (const row of rows.value) {
      const id = rowId(row);
      if (isSelectedId(id)) selectedById.set(id, row);
    }
    updateSelectedRefs();
    syncVisibleSelection();
  };

  const selectionState = computed<MachTableRemoteSelectionState>(() => {
    void selectionRevision.value;
    return allMatching.value
      ? { mode: "allMatching", excludedKeys: [...excludedIds] }
      : { mode: "explicit", selectedKeys: [...selectedIds] };
  });

  const onCriteriaChanged = (): void => {
    if (options.clearSelectionOnQueryChange !== false) clearSelection();
    scheduleLoad();
  };

  watch(
    () => readSource(options.query),
    onCriteriaChanged,
    { deep: true, immediate: automatic && options.immediate !== false }
  );
  watch(quickFilterText, (value) => {
    // A mounted grid can report the changed prop before gridReady. Give its
    // event the first chance to load, while keeping headless query use working.
    if (suppressGridEvents || value === handledQuickFilterText) return;
    handledQuickFilterText = value;
    onCriteriaChanged();
  }, { flush: automatic ? "post" : "sync" });
  watch(selectedKeys, (keys) => {
    if (updatingSelectedRefs) return;
    allMatching.value = false;
    excludedIds.clear();
    const wanted = new Set(keys.map(String));
    selectedIds.clear();
    for (const id of wanted) selectedIds.add(id);
    for (const id of [...selectedById.keys()]) {
      if (!wanted.has(id)) selectedById.delete(id);
    }
    for (const row of rows.value) {
      const id = rowId(row);
      if (wanted.has(id)) selectedById.set(id, row);
    }
    syncVisibleSelection();
    updateSelectedRefs();
  }, { deep: true, flush: "sync" });

  onScopeDispose(() => {
    abort();
    api = null;
  });

  return {
    rows,
    loading,
    error,
    page,
    pageSize,
    total,
    sortModel,
    filterModel,
    advancedFilterModel,
    selectedKeys,
    selectedRows,
    selectionState,
    bindings,
    reload,
    retry: load,
    reset,
    abort,
    clearSelection,
    selectAllMatching,
    applySelectionState
  };
}
