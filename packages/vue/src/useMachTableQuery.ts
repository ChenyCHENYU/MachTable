import {
  computed,
  nextTick,
  onScopeDispose,
  ref,
  shallowRef,
  watch,
  type ComputedRef,
  type Ref
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
  type SortChangedEvent,
  type SortModel
} from "@agile-team/mach-table";
import { abortable, finiteAtLeast, rowIdFromKey } from "@agile-team/mach-table/adapter";
import { resolveSource } from "./source";
import { useMachTableQuerySelection, type MachTableRemoteSelectionState } from "./useMachTableQuerySelection";

export type { MachTableRemoteSelectionState } from "./useMachTableQuerySelection";

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

export interface UseMachTableQueryOptions<
  TData,
  TQuery = Record<string, unknown>,
  TResult extends MachTablePageResult<TData> = MachTablePageResult<TData>
> {
  /** Keep the base signature last so inline promises still infer their contextual row type. */
  request: ((params: MachTablePageRequest<TQuery>) => Promise<TResult>) &
    ((params: MachTablePageRequest<TQuery>) => Promise<MachTablePageResult<TData>>);
  query: MachTableQuerySource<TQuery>;
  /** Stable row key used for updates and cross-page selection. */
  rowKey: string | ((row: TData) => string | number);
  initialPage?: number;
  pageSize?: number;
  pageSizeOptions?: readonly number[];
  showPageJump?: boolean;
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
  /** Receives the accepted response, including metadata returned by request. */
  onSuccess?(result: NoInfer<TResult>): void;
  onError?(error: unknown): void;
}

export interface UseMachTableQueryReturn<TData> {
  rows: Ref<TData[]>;
  loading: Ref<boolean>;
  error: Ref<unknown | null>;
  page: Ref<number>;
  pageSize: Ref<number>;
  total: Ref<number>;
  sortModel: Ref<SortModel>;
  filterModel: Ref<FilterModel>;
  advancedFilterModel: Ref<AdvancedFilterModel | null>;
  selectedKeys: Ref<string[]>;
  /** Explicit selections retain loaded snapshots; allMatching contains only selected rows from the last accepted page. */
  selectedRows: Ref<TData[]>;
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
export function useMachTableQuery<
  TData,
  TQuery = Record<string, unknown>,
  TResult extends MachTablePageResult<TData> = MachTablePageResult<TData>
>(
  options: UseMachTableQueryOptions<TData, TQuery, TResult>
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
  const quickFilterText = options.quickFilterText ?? ref<string | null>(null);
  const automatic = options.mode !== "manual";
  const pageSizes = [...new Set([...(options.pageSizeOptions ?? [10, 20, 50, 100]), pageSize.value]
    .map((value) => finiteAtLeast(value, 0, 1, true)).filter(Boolean))].sort((a, b) => a - b);

  let api: GridApi<TData> | null = null;
  let controller: AbortController | null = null;
  let generation = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let suppressGridEvents = false;
  let handledQuickFilterText = quickFilterText.value;
  let disposed = false;

  const rowId = (row: TData): string => {
    // Query paths may come from runtime schemas; Core additionally types static field paths.
    const id = rowIdFromKey(options.rowKey as NonNullable<GridOptions<TData>["rowKey"]>, row);
    if (!id) {
      throw new Error(`[MachTable] Empty rowKey \"${String(options.rowKey)}\".`);
    }
    return id;
  };

  const selection = useMachTableQuerySelection(rows, rowId, options.selectionScope === "page", () => api);

  const abort = (): void => {
    generation++;
    controller?.abort();
    controller = null;
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
    loading.value = false;
  };

  const applyPageResult = (
    result: TResult,
    acceptedPage: number
  ): Promise<void> => {
    const nextRows = [...result.rows];
    const pageRows = new Map(nextRows.map((row) => [rowId(row), row] as const));
    if (pageRows.size !== nextRows.length) throw new Error("[MachTable] Duplicate remote row keys.");
    page.value = acceptedPage;
    rows.value = nextRows;
    total.value = Math.floor(result.total);
    selection.acceptPage(pageRows);
    options.onSuccess?.(result);
    return nextTick(selection.syncVisibleSelection);
  };

  const load = async (): Promise<void> => {
    if (disposed) return;
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
    if (!automatic || disposed) return;
    const delay = options.debounceMs ?? 0;
    if (delay > 0) debounceTimer = setTimeout(load, delay);
    else void load();
  };

  const onGridReady = (event: { api: GridApi<TData> }): void => {
    if (disposed) return;
    api = event.api;
    void nextTick(selection.syncVisibleSelection);
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
      ? () => options.errorOverlay?.({ error: error.value, retry: load }) ?? "Request failed. Retry."
      : undefined,
    overlayNoRowsTemplate: options.emptyOverlay,
    pagination: {
      mode: "server",
      page: page.value,
      pageSize: pageSize.value,
      pageSizeOptions: pageSizes,
      total: total.value,
      showTotal: true,
      showPageSizeSelector: true,
      showPageJump: options.showPageJump
    },
    onGridReady,
    onPaginationChanged,
    onSortChanged,
    onFilterChanged,
    onSelectionChanged: selection.onSelectionChanged
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
      selection.state.clearSelection();
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
  const onCriteriaChanged = (): void => {
    if (options.clearSelectionOnQueryChange !== false) selection.state.clearSelection();
    scheduleLoad();
  };

  watch(quickFilterText, (value) => {
    // A mounted grid can report the changed prop before gridReady. Give its
    // event the first chance to load, while keeping headless query use working.
    if (suppressGridEvents || value === handledQuickFilterText) return;
    handledQuickFilterText = value;
    onCriteriaChanged();
  }, { flush: automatic ? "post" : "sync" });
  onScopeDispose(() => {
    disposed = true;
    abort();
    api = null;
  });

  // 先建立内部观察与清理归属；首次 request 可能同步销毁当前作用域。
  watch(
    () => resolveSource<TQuery>(options.query),
    onCriteriaChanged,
    { deep: true, immediate: automatic && options.immediate !== false }
  );

  return {
    ...selection.state,
    rows,
    loading,
    error,
    page,
    pageSize,
    total,
    sortModel,
    filterModel,
    advancedFilterModel,
    bindings,
    reload,
    retry: load,
    reset,
    abort
  };
}
