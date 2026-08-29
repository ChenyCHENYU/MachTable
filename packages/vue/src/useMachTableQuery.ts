import {
  computed,
  isRef,
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
  getByPath,
  type FilterChangedEvent,
  type FilterModel,
  type GridApi,
  type GridOptions,
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
  debounceMs?: number;
  keepPreviousData?: boolean;
  /** `query` additionally enables compact select-all-matching rules. */
  selectionScope?: "page" | "preserve" | "query";
  /** Defaults true: a different business/filter query cannot inherit stale selections. */
  clearSelectionOnQueryChange?: boolean;
  quickFilterText?: Ref<string | null>;
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
  selectedKeys: Ref<string[]>;
  selectedRows: ShallowRef<TData[]>;
  selectionState: ComputedRef<MachTableRemoteSelectionState>;
  gridProps: ComputedRef<GridOptions<TData>>;
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
  if (typeof source === "function") return (source as () => T)();
  return isRef(source) ? source.value : source;
}

function normalizePositive(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : typeof error === "object" && error != null && "name" in error && (error as { name?: unknown }).name === "AbortError";
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
  const selectedKeys = ref<string[]>([]);
  const selectedRows = shallowRef<TData[]>([]);
  const selectedIds = new Set<string>();
  const excludedIds = new Set<string>();
  const selectedById = new Map<string, TData>();
  const quickFilterText = options.quickFilterText ?? ref<string | null>(null);
  const selectionScope = options.selectionScope ?? "preserve";
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
    const ids = allMatching.value ? [...selectedById.keys()] : [...selectedIds];
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
      api.setSelection(selected, true);
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
        quickFilterText: quickFilterText.value,
        signal: activeController.signal
      });
      if (activeController.signal.aborted || requestGeneration !== generation) return;
      if (!result || !Array.isArray(result.rows) || !Number.isFinite(result.total) || result.total < 0) {
        throw new TypeError("[MachTable] Remote request must resolve to { rows: TData[], total: non-negative number }.");
      }
      const nextRows = [...result.rows];
      for (const row of nextRows) rowId(row);
      rows.value = nextRows;
      total.value = Math.floor(result.total);
      for (const row of rows.value) {
        const id = rowId(row);
        if (isSelectedId(id)) selectedById.set(id, row);
        else selectedById.delete(id);
      }
      updateSelectedRefs();
      options.onSuccess?.(result);
      await nextTick();
      syncVisibleSelection();
    } catch (requestError) {
      if (activeController.signal.aborted || requestGeneration !== generation || isAbortError(requestError)) return;
      error.value = requestError;
      options.onError?.(requestError);
    } finally {
      if (requestGeneration === generation) {
        loading.value = false;
        if (controller === activeController) controller = null;
      }
    }
  };

  const scheduleLoad = (resetPage: boolean): void => {
    if (resetPage) page.value = 1;
    if (debounceTimer != null) clearTimeout(debounceTimer);
    if (controller) {
      generation++;
      controller.abort();
      controller = null;
      loading.value = false;
    }
    const delay = Math.max(0, options.debounceMs ?? 0);
    if (delay === 0) {
      void load();
      return;
    }
    debounceTimer = setTimeout(() => { void load(); }, delay);
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
    void load();
  };
  const onSortChanged = (event: SortChangedEvent<TData>): void => {
    if (suppressGridEvents) return;
    sortModel.value = event.sortModel.map((item) => ({ ...item }));
    scheduleLoad(true);
  };
  const onFilterChanged = (event: FilterChangedEvent<TData>): void => {
    if (suppressGridEvents) return;
    filterModel.value = { ...event.filterModel };
    if (options.clearSelectionOnQueryChange !== false) clearSelection();
    scheduleLoad(true);
  };
  const onSelectionChanged = (event: SelectionChangedEvent<TData>): void => {
    if (suppressSelectionEvents) return;
    const visibleIds = new Set(rows.value.map(rowId));
    const nextVisibleIds = new Set(event.selectedRows.map(rowId));
    if (allMatching.value) {
      for (const id of visibleIds) {
        if (nextVisibleIds.has(id)) excludedIds.delete(id);
        else {
          excludedIds.add(id);
          selectedById.delete(id);
        }
      }
      for (const row of event.selectedRows) selectedById.set(rowId(row), row);
      updateSelectedRefs();
      return;
    }
    if (selectionScope === "page") {
      selectedIds.clear();
      selectedById.clear();
    } else {
      for (const id of visibleIds) {
        selectedIds.delete(id);
        selectedById.delete(id);
      }
    }
    for (const row of event.selectedRows) {
      const id = rowId(row);
      selectedIds.add(id);
      selectedById.set(id, row);
    }
    updateSelectedRefs();
  };

  const gridProps = computed<GridOptions<TData>>(() => ({
    rowData: rows.value,
    loading: loading.value,
    getRowId: ({ data }) => rowId(data),
    manualSorting: true,
    manualFiltering: true,
    quickFilterText: quickFilterText.value,
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
    page.value = 1;
    sortModel.value = [];
    filterModel.value = {};
    clearSelection();
    suppressGridEvents = true;
    try {
      api?.setSortModel(null);
      api?.setFilterModel(null);
    } finally {
      suppressGridEvents = false;
    }
    await load();
  };
  const clearSelection = (): void => {
    allMatching.value = false;
    selectedIds.clear();
    excludedIds.clear();
    selectedById.clear();
    updateSelectedRefs();
    suppressSelectionEvents = true;
    try { api?.deselectAll(); } finally { suppressSelectionEvents = false; }
  };
  const selectAllMatching = (): void => {
    allMatching.value = true;
    selectedIds.clear();
    excludedIds.clear();
    selectedById.clear();
    for (const row of rows.value) selectedById.set(rowId(row), row);
    updateSelectedRefs();
    syncVisibleSelection();
  };
  const applySelectionState = (state: MachTableRemoteSelectionState): void => {
    selectedIds.clear();
    excludedIds.clear();
    selectedById.clear();
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

  watch(
    () => readSource(options.query),
    () => {
      if (options.clearSelectionOnQueryChange !== false) clearSelection();
      scheduleLoad(true);
    },
    { deep: true, immediate: options.immediate !== false }
  );
  watch(quickFilterText, () => {
    if (options.clearSelectionOnQueryChange !== false) clearSelection();
    scheduleLoad(true);
  });
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
    selectedKeys,
    selectedRows,
    selectionState,
    gridProps,
    bindings: gridProps,
    reload,
    retry: load,
    reset,
    abort,
    clearSelection,
    selectAllMatching,
    applySelectionState
  };
}
