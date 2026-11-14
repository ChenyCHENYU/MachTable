import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  normalizeAdvancedFilterModel,
  type AdvancedFilterModel,
  type FilterModel,
  type FilterChangedEvent,
  type GridApi,
  type GridOptions,
  type OverlayContent,
  type OverlayTemplate,
  type PaginationChangedEvent,
  type SelectionChangedEvent,
  type SortModel
} from "@agile-team/mach-table";
import { abortable, finiteAtLeast, rowIdFromKey } from "@agile-team/mach-table/adapter";

export type MachTableQuerySource<TQuery> = TQuery | (() => TQuery);

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
  /** Memoize object queries in React; queryKey can explicitly control reload dependencies. */
  queryKey?: unknown;
  rowKey: string | ((row: TData) => string | number);
  initialPage?: number;
  pageSize?: number;
  pageSizeOptions?: readonly number[];
  immediate?: boolean;
  mode?: "auto" | "manual";
  debounceMs?: number;
  keepPreviousData?: boolean;
  /** `page` keeps explicit selections present in the accepted page; `preserve`/`query` retain cross-page selections. */
  selectionScope?: "page" | "preserve" | "query";
  clearSelectionOnQueryChange?: boolean;
  initialQuickFilterText?: string | null;
  errorOverlay?(context: { error: unknown; retry(): Promise<void> }): OverlayContent;
  emptyOverlay?: OverlayTemplate;
  onSuccess?(result: MachTablePageResult<TData>): void;
  onError?(error: unknown): void;
}

export interface UseMachTableQueryReturn<TData> {
  rows: TData[];
  loading: boolean;
  error: unknown | null;
  page: number;
  pageSize: number;
  total: number;
  sortModel: SortModel;
  filterModel: FilterModel;
  advancedFilterModel: AdvancedFilterModel | null;
  quickFilterText: string | null;
  setQuickFilterText: (value: string | null) => void;
  selectedKeys: string[];
  /** Explicit selections retain loaded snapshots; allMatching contains only selected rows from the last accepted page. */
  selectedRows: TData[];
  selectionState: MachTableRemoteSelectionState;
  bindings: GridOptions<TData>;
  reload(options?: { resetPage?: boolean }): Promise<void>;
  retry(): Promise<void>;
  reset(): Promise<void>;
  abort(): void;
  clearSelection(): void;
  selectAllMatching(): void;
  applySelectionState(state: MachTableRemoteSelectionState): void;
}

function isAbortError(error: unknown): boolean {
  return error != null && typeof error === "object" && (error as { name?: unknown }).name === "AbortError";
}

function readQuery<T>(source: MachTableQuerySource<T>): T {
  return typeof source === "function" ? (source as () => T)() : source;
}

/** Validate the transport envelope before deriving its last available page. */
function lastResultPage<T>(result: MachTablePageResult<T>, pageSize: number): number {
  if (!Array.isArray(result?.rows) || !Number.isFinite(result.total) || result.total < 0) {
    throw new TypeError("[MachTable] Expected rows[] and a finite total >= 0.");
  }
  return Math.ceil(Math.floor(result.total) / pageSize) || 1;
}

/** React remote-list controller with cancellation, stale guards and cross-page selection. */
export function useMachTableQuery<TData, TQuery = Record<string, unknown>>(
  options: UseMachTableQueryOptions<TData, TQuery>
): UseMachTableQueryReturn<TData> {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [rows, setRows] = useState<TData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  const [page, setPage] = useState(finiteAtLeast(options.initialPage, 1, 1, true));
  const [pageSize, setPageSize] = useState(finiteAtLeast(options.pageSize, 20, 1, true));
  const [total, setTotal] = useState(0);
  const [sortModel, setSortModel] = useState<SortModel>([]);
  const [filterModel, setFilterModel] = useState<FilterModel>({});
  const [advancedFilterModel, setAdvancedFilterModel] = useState<AdvancedFilterModel | null>(null);
  const [quickFilterText, setQuickFilterState] = useState<string | null>(options.initialQuickFilterText ?? null);
  const [, refreshSelection] = useReducer((value: number) => value + 1, 0);
  const stateRef = useRef({ page, pageSize, sortModel, filterModel, advancedFilterModel, quickFilterText, rows });
  stateRef.current = { page, pageSize, sortModel, filterModel, advancedFilterModel, quickFilterText, rows };
  const apiRef = useRef<GridApi<TData> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);
  const selectedIds = useRef(new Set<string>());
  const excludedIds = useRef(new Set<string>());
  const selectedById = useRef(new Map<string, TData>());
  const allMatching = useRef(false);
  const suppressGrid = useRef(false);
  const suppressSelection = useRef(false);

  const rowId = useCallback((row: TData): string => {
    const rowKey = optionsRef.current.rowKey;
    // Query paths may come from runtime schemas; Core additionally types static field paths.
    const id = rowIdFromKey(rowKey as NonNullable<GridOptions<TData>["rowKey"]>, row);
    if (!id) {
      throw new Error(`[MachTable] Empty rowKey "${String(rowKey)}".`);
    }
    return id;
  }, []);
  const selected = useCallback((id: string): boolean => allMatching.current ? !excludedIds.current.has(id) : selectedIds.current.has(id), []);
  const notifySelection = useCallback(() => refreshSelection(), []);
  const syncVisibleSelection = useCallback((): void => {
    const api = apiRef.current;
    if (!api || api.isDestroyed()) return;
    suppressSelection.current = true;
    try { api.selection.setRows(stateRef.current.rows.filter((row) => selected(rowId(row))), true); }
    finally { suppressSelection.current = false; }
  }, [rowId, selected]);

  const abort = useCallback((): void => {
    generationRef.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setLoading(false);
  }, []);

  const isStale = useCallback((controller: AbortController, generation: number): boolean =>
    controller.signal.aborted || generation !== generationRef.current, []);

  const applyPageResult = useCallback((
    result: MachTablePageResult<TData>,
    acceptedPage: number
  ): void => {
    const nextRows = [...result.rows];
    const pageRows = new Map(nextRows.map((row) => [rowId(row), row] as const));
    if (pageRows.size !== nextRows.length) throw new Error("[MachTable] Duplicate remote row keys.");
    // The query rule owns allMatching selection; retain only this page's row
    // snapshots so visiting more pages cannot grow the cache indefinitely.
    if (allMatching.current) selectedById.current.clear();
    if (optionsRef.current.selectionScope === "page") {
      for (const id of selectedIds.current) {
        if (!pageRows.has(id)) {
          selectedIds.current.delete(id);
          selectedById.current.delete(id);
        }
      }
    }
    for (const [id, row] of pageRows) {
      if (selected(id)) selectedById.current.set(id, row);
      else selectedById.current.delete(id);
    }
    stateRef.current.page = acceptedPage;
    stateRef.current.rows = nextRows;
    setPage(acceptedPage);
    setRows(nextRows);
    setTotal(Math.floor(result.total));
    notifySelection();
    optionsRef.current.onSuccess?.(result);
    queueMicrotask(syncVisibleSelection);
  }, [notifySelection, rowId, selected, syncVisibleSelection]);

  const load = useCallback(async (): Promise<void> => {
    abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const generation = ++generationRef.current;
    setLoading(true);
    setError(null);
    if (optionsRef.current.keepPreviousData === false) {
      stateRef.current.rows = [];
      setRows([]);
    }
    const current = stateRef.current;
    try {
      const activeOptions = optionsRef.current;
      let params: MachTablePageRequest<TQuery> = {
        page: current.page,
        pageSize: current.pageSize,
        query: readQuery(activeOptions.query),
        sortModel: current.sortModel.map((item) => ({ ...item })),
        filterModel: { ...current.filterModel },
        advancedFilterModel: normalizeAdvancedFilterModel(current.advancedFilterModel),
        quickFilterText: current.quickFilterText,
        signal: controller.signal
      };
      // Keep recovery within one cancellable request and only publish the final
      // valid page. A second shrink is a retryable error, never a request loop.
      for (let attempt = 0; ; attempt++) {
        const result = await abortable(activeOptions.request(params), controller.signal);
        if (isStale(controller, generation)) return;
        const lastPage = lastResultPage(result, params.pageSize);
        if (params.page <= lastPage || result.total < 1) {
          applyPageResult(result, Math.min(params.page, lastPage));
          break;
        }
        if (attempt) throw new RangeError("[MachTable] Page changed during recovery; retry.");
        params = { ...params, page: lastPage };
      }
    } catch (requestError) {
      if (!isStale(controller, generation) && !isAbortError(requestError)) {
        const normalized = requestError ?? new Error("Remote request failed");
        setError(normalized);
        optionsRef.current.onError?.(normalized);
      }
    } finally {
      if (generation === generationRef.current) {
        setLoading(false);
        abortRef.current = null;
      }
    }
  }, [abort, applyPageResult, isStale]);

  const scheduleLoad = useCallback((resetPage: boolean): void => {
    if (resetPage) {
      stateRef.current.page = 1;
      setPage(1);
    }
    abort();
    if (optionsRef.current.mode === "manual") return;
    const delay = Math.max(0, optionsRef.current.debounceMs ?? 0);
    if (delay === 0) void load();
    else timerRef.current = setTimeout(() => { void load(); }, delay);
  }, [abort, load]);

  const clearSelection = useCallback((): void => {
    const changed = allMatching.current || selectedIds.current.size > 0 ||
      excludedIds.current.size > 0 || selectedById.current.size > 0;
    allMatching.current = false;
    selectedIds.current.clear();
    excludedIds.current.clear();
    selectedById.current.clear();
    if (changed) notifySelection();
    suppressSelection.current = true;
    try { apiRef.current?.selection.clear(); } finally { suppressSelection.current = false; }
  }, [notifySelection]);

  const onPaginationChanged = useCallback((event: PaginationChangedEvent<TData>): void => {
    if (suppressGrid.current) return;
    const current = stateRef.current;
    if (event.page === current.page && event.pageSize === current.pageSize) return;
    current.page = event.page;
    current.pageSize = event.pageSize;
    setPage(event.page);
    setPageSize(event.pageSize);
    if (optionsRef.current.mode !== "manual") void load();
    else abort();
  }, [abort, load]);
  const onSortChanged = useCallback((event: { sortModel: SortModel }): void => {
    if (suppressGrid.current) return;
    const next = event.sortModel.map((item) => ({ ...item }));
    stateRef.current.sortModel = next;
    setSortModel(next);
    scheduleLoad(true);
  }, [scheduleLoad]);
  const onFilterChanged = useCallback((event: FilterChangedEvent<TData>): void => {
    if (suppressGrid.current) return;
    // Commands can change filters before the gridReady animation frame.
    apiRef.current = event.api;
    const advanced = normalizeAdvancedFilterModel(event.advancedFilterModel);
    const quickText = event.api.filtering.getQuickText();
    const current = stateRef.current;
    // Ignore the grid's echo of already submitted criteria, so it cannot
    // cancel a fresh manual reload or issue a duplicate automatic request.
    if (quickText === current.quickFilterText &&
      JSON.stringify([event.filterModel, advanced]) === JSON.stringify([current.filterModel, current.advancedFilterModel])) return;
    const next = { ...event.filterModel };
    stateRef.current.filterModel = next;
    stateRef.current.advancedFilterModel = advanced;
    stateRef.current.quickFilterText = quickText;
    setFilterModel(next);
    setAdvancedFilterModel(advanced);
    setQuickFilterState(stateRef.current.quickFilterText);
    if (optionsRef.current.clearSelectionOnQueryChange !== false) clearSelection();
    scheduleLoad(true);
  }, [clearSelection, scheduleLoad]);
  const onSelectionChanged = useCallback((event: SelectionChangedEvent<TData>): void => {
    if (suppressSelection.current) return;
    if (allMatching.current) {
      selectedById.current.clear();
      const nextVisible = new Set(event.selectedRows.map(rowId));
      for (const row of stateRef.current.rows) {
        const id = rowId(row);
        if (nextVisible.has(id)) {
          excludedIds.current.delete(id);
          selectedById.current.set(id, row);
        } else {
          excludedIds.current.add(id);
        }
      }
      notifySelection();
      return;
    }
    if ((optionsRef.current.selectionScope ?? "preserve") === "page") {
      selectedIds.current.clear(); selectedById.current.clear();
    } else {
      for (const row of stateRef.current.rows) {
        const id = rowId(row);
        selectedIds.current.delete(id); selectedById.current.delete(id);
      }
    }
    for (const row of event.selectedRows) {
      const id = rowId(row);
      selectedIds.current.add(id);
      selectedById.current.set(id, row);
    }
    notifySelection();
  }, [notifySelection, rowId]);

  const reload = useCallback((reloadOptions: { resetPage?: boolean } = {}): Promise<void> => {
    if (reloadOptions.resetPage) { stateRef.current.page = 1; setPage(1); }
    return load();
  }, [load]);
  const reset = useCallback(async (): Promise<void> => {
    stateRef.current.page = 1;
    stateRef.current.sortModel = [];
    stateRef.current.filterModel = {};
    stateRef.current.advancedFilterModel = null;
    stateRef.current.quickFilterText = null;
    setPage(1); setSortModel([]); setFilterModel({}); setAdvancedFilterModel(null); setQuickFilterState(null); clearSelection();
    suppressGrid.current = true;
    try {
      apiRef.current?.sorting.setModel(null);
      apiRef.current?.filtering.setModel(null);
      apiRef.current?.filtering.setAdvancedModel(null);
      apiRef.current?.filtering.setQuickText(null);
    }
    finally { suppressGrid.current = false; }
    await load();
  }, [clearSelection, load]);
  const setQuickFilterText = useCallback((value: string | null): void => {
    if (stateRef.current.quickFilterText === value) return;
    stateRef.current.quickFilterText = value;
    setQuickFilterState(value);
    suppressGrid.current = true;
    try { apiRef.current?.filtering.setQuickText(value); }
    finally { suppressGrid.current = false; }
    if (optionsRef.current.clearSelectionOnQueryChange !== false) clearSelection();
    scheduleLoad(true);
  }, [clearSelection, scheduleLoad]);
  const applySelectionState = useCallback((state: MachTableRemoteSelectionState): void => {
    selectedIds.current.clear(); excludedIds.current.clear(); selectedById.current.clear();
    allMatching.current = state.mode === "allMatching";
    for (const id of (state.mode === "allMatching" ? state.excludedKeys : state.selectedKeys).map(String)) {
      if (state.mode === "allMatching") excludedIds.current.add(id); else selectedIds.current.add(id);
    }
    for (const row of stateRef.current.rows) if (selected(rowId(row))) selectedById.current.set(rowId(row), row);
    notifySelection(); syncVisibleSelection();
  }, [notifySelection, rowId, selected, syncVisibleSelection]);
  const selectAllMatching = useCallback((): void => {
    applySelectionState({ mode: "allMatching", excludedKeys: [] });
  }, [applySelectionState]);

  const queryDependency = options.queryKey === undefined ? options.query : options.queryKey;
  const previousQueryDependency = useRef(queryDependency);
  useEffect(() => {
    // StrictMode replays effects without changing the query. Only a changed
    // dependency owns an automatic reload; initial loading stays below.
    if (Object.is(previousQueryDependency.current, queryDependency)) return;
    previousQueryDependency.current = queryDependency;
    if (optionsRef.current.clearSelectionOnQueryChange !== false) clearSelection();
    scheduleLoad(true);
  }, [queryDependency, clearSelection, scheduleLoad]);
  useEffect(() => {
    if (options.mode !== "manual" && options.immediate !== false) void load();
    return abort;
  }, []);

  const pageSizes = useMemo(() => {
    return [...new Set([...(options.pageSizeOptions ?? [10, 20, 50, 100]), pageSize]
      .map((value) => finiteAtLeast(value, 0, 1, true)).filter(Boolean))].sort((left, right) => left - right);
  }, [options.pageSizeOptions, pageSize]);
  const bindings = useMemo<GridOptions<TData>>(() => ({
    rowData: rows,
    loading,
    error,
    rowKey: rowId,
    manualSorting: true,
    manualFiltering: true,
    advancedFilterModel,
    quickFilterText,
    overlayErrorTemplate: error
      ? () => optionsRef.current.errorOverlay?.({ error, retry: load }) ?? "Remote request failed. Please retry."
      : undefined,
    overlayNoRowsTemplate: options.emptyOverlay,
    pagination: {
      mode: "server", page, pageSize, pageSizeOptions: pageSizes, total,
      showTotal: true, showPageSizeSelector: true
    },
    onGridReady: ({ api }) => { apiRef.current = api; queueMicrotask(syncVisibleSelection); },
    onPaginationChanged,
    onSortChanged,
    onFilterChanged,
    onSelectionChanged
  }), [advancedFilterModel, error, load, loading, onFilterChanged, onPaginationChanged, onSelectionChanged, onSortChanged, options.emptyOverlay, page, pageSize, pageSizes, quickFilterText, rowId, rows, syncVisibleSelection, total]);

  const selectedKeys = allMatching.current ? [] : [...selectedIds.current];
  const selectedRows = [...selectedById.current.entries()]
    .filter(([id]) => !excludedIds.current.has(id))
    .map(([, row]) => row);
  const selectionState: MachTableRemoteSelectionState = allMatching.current
    ? { mode: "allMatching", excludedKeys: [...excludedIds.current] }
    : { mode: "explicit", selectedKeys };

  return {
    rows, loading, error, page, pageSize, total, sortModel, filterModel, advancedFilterModel,
    quickFilterText, setQuickFilterText,
    selectedKeys, selectedRows, selectionState, bindings,
    reload, retry: load, reset, abort, clearSelection, selectAllMatching, applySelectionState
  };
}
