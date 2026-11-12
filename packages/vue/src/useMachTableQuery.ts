import {
  computed,
  nextTick,
  onScopeDispose,
  ref,
  shallowRef,
  watch,
  type ComputedRef,
  type Ref,
  type ShallowRef
} from "vue";
import {
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
import { abortable, finiteAtLeast, rowIdFromKey } from "@agile-team/mach-table/adapter";
import { resolveSource } from "./source";

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

function isAbortError(error: unknown): boolean {
  return error != null && typeof error === "object" && (error as { name?: unknown }).name === "AbortError";
}

/** Validate the transport envelope before deriving its last available page. */
function lastResultPage<T>(result: MachTablePageResult<T>, pageSize: number): number {
  if (!Array.isArray(result?.rows) || !Number.isFinite(result.total) || result.total < 0) {
    throw new TypeError("[MachTable] Expected rows[] and a finite total >= 0.");
  }
  return Math.ceil(Math.floor(result.total) / pageSize) || 1;
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
  const page = ref(finiteAtLeast(options.initialPage, 1, 1, true));
  const pageSize = ref(finiteAtLeast(options.pageSize, 20, 1, true));
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
  const pageSizes = [...new Set([...(options.pageSizeOptions ?? [10, 20, 50, 100]), pageSize.value]
    .map((value) => finiteAtLeast(value, 0, 1, true)).filter(Boolean))].sort((a, b) => a - b);

  let api: GridApi<TData> | null = null;
  let controller: AbortController | null = null;
  let generation = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let suppressGridEvents = false;
  let handledQuickFilterText = quickFilterText.value;
  let suppressSelectionEvents = false;
  let updatingSelectedRefs = false;

  const rowId = (row: TData): string => {
    // Query paths may come from runtime schemas; Core additionally types static field paths.
    const id = rowIdFromKey(options.rowKey as NonNullable<GridOptions<TData>["rowKey"]>, row);
    if (!id) {
      throw new Error(`[MachTable] Empty rowKey \"${String(options.rowKey)}\".`);
    }
    return id;
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
    acceptedPage: number
  ): Promise<void> => {
    const nextRows = [...result.rows];
    const pageRows = new Map(nextRows.map((row) => [rowId(row), row] as const));
    if (pageRows.size !== nextRows.length) throw new Error("[MachTable] Duplicate remote row keys.");
    if (selectionScope === "page") {
      for (const id of selectedIds) {
        if (!pageRows.has(id)) {
          selectedIds.delete(id);
          selectedById.delete(id);
        }
      }
    }
    page.value = acceptedPage;
    rows.value = nextRows;
    total.value = Math.floor(result.total);
    for (const [id, row] of pageRows) {
      if (isSelectedId(id)) selectedById.set(id, row);
      else selectedById.delete(id);
    }
    updateSelectedRefs();
    options.onSuccess?.(result);
    await nextTick(syncVisibleSelection);
  };

  const load = async (): Promise<void> => {
    abort();
    const activeController = new AbortController();
    controller = activeController;
    const requestGeneration = ++generation;
    loading.value = true;
    error.value = null;
    if (options.keepPreviousData === false) rows.value = [];

    try {
      let params: MachTablePageRequest<TQuery> = {
        page: page.value,
        pageSize: pageSize.value,
        query: resolveSource<TQuery>(options.query),
        sortModel: sortModel.value.map((item) => ({ ...item })),
        filterModel: { ...filterModel.value },
        advancedFilterModel: normalizeAdvancedFilterModel(advancedFilterModel.value),
        quickFilterText: quickFilterText.value,
        signal: activeController.signal
      };
      // A deletion can invalidate the current page. Recover once under the same
      // request identity; never publish an intermediate empty page or loop.
      for (let attempt = 0; ; attempt++) {
        const result = await abortable(options.request(params), activeController.signal);
        // Check after each await, before validation, recovery or publication.
        if (requestGeneration !== generation) return;
        const lastPage = lastResultPage(result, params.pageSize);
        if (params.page <= lastPage || result.total < 1) {
          await applyPageResult(result, Math.min(params.page, lastPage));
          break;
        }
        if (attempt) throw new RangeError("[MachTable] Page changed during recovery; retry.");
        params = { ...params, page: lastPage };
      }
    } catch (requestError) {
      if (requestGeneration === generation && !isAbortError(requestError)) {
        error.value = requestError ?? new Error();
        options.onError?.(error.value);
      }
    } finally {
      if (requestGeneration === generation) {
        loading.value = false;
        controller = null;
      }
    }
  };

  const scheduleLoad = (): void => {
    page.value = 1;
    abort();
    if (!automatic) return;
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
    else abort();
  };
  const onSortChanged = (event: SortChangedEvent<TData>): void => {
    if (suppressGridEvents) return;
    sortModel.value = event.sortModel.map((item) => ({ ...item }));
    scheduleLoad();
  };
  const onFilterChanged = (event: FilterChangedEvent<TData>): void => {
    if (suppressGridEvents) return;
    const advanced = normalizeAdvancedFilterModel(event.advancedFilterModel);
    const quickText = event.api.filtering.getQuickText();
    // Prop synchronization can echo criteria already submitted by reload().
    // Only a real change may cancel that request, including in manual mode.
    if (quickText === handledQuickFilterText &&
      JSON.stringify([event.filterModel, advanced]) === JSON.stringify([filterModel.value, advancedFilterModel.value])) return;
    filterModel.value = { ...event.filterModel };
    advancedFilterModel.value = advanced;
    handledQuickFilterText = quickText;
    if (quickFilterText.value !== handledQuickFilterText) quickFilterText.value = handledQuickFilterText;
    onCriteriaChanged();
  };
  const onSelectionChanged = (event: SelectionChangedEvent<TData>): void => {
    if (suppressSelectionEvents) return;
    if (allMatching.value) {
      const nextVisibleIds = new Set(event.selectedRows.map(rowId));
      for (const row of rows.value) {
        const id = rowId(row);
        if (nextVisibleIds.has(id)) excludedIds.delete(id);
        else {
          excludedIds.add(id);
          selectedById.delete(id);
        }
      }
    } else if (selectionScope === "page") {
      clearSelectionCache();
    } else {
      for (const row of rows.value) {
        const id = rowId(row);
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

  const reload = (reloadOptions: { resetPage?: boolean } = {}): Promise<void> => {
    if (reloadOptions.resetPage) page.value = 1;
    return load();
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
    applySelectionState({ mode: "allMatching", excludedKeys: [] });
  };
  const applySelectionState = (state: MachTableRemoteSelectionState): void => {
    clearSelectionCache();
    allMatching.value = state.mode === "allMatching";
    const ids = state.mode === "allMatching" ? state.excludedKeys : state.selectedKeys;
    const target = state.mode === "allMatching" ? excludedIds : selectedIds;
    for (const id of ids) target.add(String(id));
    for (const row of rows.value) {
      const id = rowId(row);
      if (isSelectedId(id)) selectedById.set(id, row);
    }
    updateSelectedRefs();
    syncVisibleSelection();
  };

  const selectionState = computed<MachTableRemoteSelectionState>(() => {
    const keys = selectedKeys.value;
    return allMatching.value
      ? { mode: "allMatching", excludedKeys: [...excludedIds] }
      : { mode: "explicit", selectedKeys: [...keys] };
  });

  const onCriteriaChanged = (): void => {
    if (options.clearSelectionOnQueryChange !== false) clearSelection();
    scheduleLoad();
  };

  watch(
    () => resolveSource<TQuery>(options.query),
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
    selectedIds.clear();
    for (const id of keys) selectedIds.add(String(id));
    for (const id of [...selectedById.keys()]) {
      if (!selectedIds.has(id)) selectedById.delete(id);
    }
    for (const row of rows.value) {
      const id = rowId(row);
      if (selectedIds.has(id)) selectedById.set(id, row);
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
