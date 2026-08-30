import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  getByPath,
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

export type MachTableQuerySource<TQuery> = TQuery | (() => TQuery);

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
  quickFilterText: string | null;
  setQuickFilterText(value: string | null): void;
  selectedKeys: string[];
  selectedRows: TData[];
  selectionState: MachTableRemoteSelectionState;
  gridProps: GridOptions<TData>;
  bindings: GridOptions<TData>;
  reload(options?: { resetPage?: boolean }): Promise<void>;
  retry(): Promise<void>;
  reset(): Promise<void>;
  abort(): void;
  clearSelection(): void;
  selectAllMatching(): void;
  applySelectionState(state: MachTableRemoteSelectionState): void;
}

function positive(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : typeof error === "object" && error != null && "name" in error && (error as { name?: unknown }).name === "AbortError";
}

function readQuery<T>(source: MachTableQuerySource<T>): T {
  return typeof source === "function" ? (source as () => T)() : source;
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
  const [page, setPage] = useState(positive(options.initialPage, 1));
  const [pageSize, setPageSize] = useState(positive(options.pageSize, 20));
  const [total, setTotal] = useState(0);
  const [sortModel, setSortModel] = useState<SortModel>([]);
  const [filterModel, setFilterModel] = useState<FilterModel>({});
  const [quickFilterText, setQuickFilterText] = useState<string | null>(options.initialQuickFilterText ?? null);
  const [, refreshSelection] = useReducer((value: number) => value + 1, 0);
  const stateRef = useRef({ page, pageSize, sortModel, filterModel, quickFilterText, rows });
  stateRef.current = { page, pageSize, sortModel, filterModel, quickFilterText, rows };
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
    const value = typeof rowKey === "function" ? rowKey(row) : getByPath(row, rowKey);
    if (value == null || String(value).length === 0) {
      throw new Error(`[MachTable] useMachTableQuery rowKey "${String(rowKey)}" returned an empty value.`);
    }
    return String(value);
  }, []);
  const selected = useCallback((id: string): boolean => allMatching.current ? !excludedIds.current.has(id) : selectedIds.current.has(id), []);
  const notifySelection = useCallback(() => refreshSelection(), []);
  const syncVisibleSelection = useCallback((): void => {
    const api = apiRef.current;
    if (!api || api.isDestroyed()) return;
    suppressSelection.current = true;
    try { api.setSelection(stateRef.current.rows.filter((row) => selected(rowId(row))), true); }
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
    controller: AbortController,
    generation: number
  ): void => {
    if (isStale(controller, generation)) return;
    if (!result || !Array.isArray(result.rows) || !Number.isFinite(result.total) || result.total < 0) {
      throw new TypeError("[MachTable] Remote request must resolve to { rows: TData[], total: non-negative number }.");
    }
    const nextRows = [...result.rows];
    for (const row of nextRows) {
      const id = rowId(row);
      if (selected(id)) selectedById.current.set(id, row);
      else selectedById.current.delete(id);
    }
    stateRef.current.rows = nextRows;
    setRows(nextRows);
    setTotal(Math.floor(result.total));
    notifySelection();
    optionsRef.current.onSuccess?.(result);
    queueMicrotask(syncVisibleSelection);
  }, [isStale, notifySelection, rowId, selected, syncVisibleSelection]);

  const handleRequestError = useCallback((
    requestError: unknown,
    controller: AbortController,
    generation: number
  ): void => {
    if (isStale(controller, generation) || isAbortError(requestError)) return;
    const normalized = requestError ?? new Error("Remote request failed");
    setError(normalized);
    optionsRef.current.onError?.(normalized);
  }, [isStale]);

  const finishRequest = useCallback((controller: AbortController, generation: number): void => {
    if (generation !== generationRef.current) return;
    setLoading(false);
    if (abortRef.current === controller) abortRef.current = null;
  }, []);

  const load = useCallback(async (): Promise<void> => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const generation = ++generationRef.current;
    setLoading(true);
    setError(null);
    if (optionsRef.current.keepPreviousData === false) setRows([]);
    const current = stateRef.current;
    try {
      const result = await optionsRef.current.request({
        page: current.page,
        pageSize: current.pageSize,
        query: readQuery(optionsRef.current.query),
        sortModel: current.sortModel.map((item) => ({ ...item })),
        filterModel: { ...current.filterModel },
        quickFilterText: current.quickFilterText,
        signal: controller.signal
      });
      applyPageResult(result, controller, generation);
    } catch (requestError) {
      handleRequestError(requestError, controller, generation);
    } finally {
      finishRequest(controller, generation);
    }
  }, [applyPageResult, finishRequest, handleRequestError]);

  const scheduleLoad = useCallback((resetPage: boolean): void => {
    if (resetPage) {
      stateRef.current.page = 1;
      setPage(1);
    }
    abortRef.current?.abort();
    abortRef.current = null;
    const delay = Math.max(0, optionsRef.current.debounceMs ?? 0);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (delay === 0) void load();
    else timerRef.current = setTimeout(() => { void load(); }, delay);
  }, [load]);

  const clearSelection = useCallback((): void => {
    const changed = allMatching.current || selectedIds.current.size > 0 ||
      excludedIds.current.size > 0 || selectedById.current.size > 0;
    allMatching.current = false;
    selectedIds.current.clear();
    excludedIds.current.clear();
    selectedById.current.clear();
    if (changed) notifySelection();
    suppressSelection.current = true;
    try { apiRef.current?.deselectAll(); } finally { suppressSelection.current = false; }
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
  }, [load]);
  const onSortChanged = useCallback((event: { sortModel: SortModel }): void => {
    if (suppressGrid.current) return;
    const next = event.sortModel.map((item) => ({ ...item }));
    stateRef.current.sortModel = next;
    setSortModel(next);
    if (optionsRef.current.mode !== "manual") scheduleLoad(true);
    else { stateRef.current.page = 1; setPage(1); }
  }, [scheduleLoad]);
  const onFilterChanged = useCallback((event: FilterChangedEvent<TData>): void => {
    if (suppressGrid.current) return;
    const next = { ...event.filterModel };
    stateRef.current.filterModel = next;
    stateRef.current.quickFilterText = event.api.getQuickFilter();
    setFilterModel(next);
    setQuickFilterText(stateRef.current.quickFilterText);
    if (optionsRef.current.clearSelectionOnQueryChange !== false) clearSelection();
    if (optionsRef.current.mode !== "manual") scheduleLoad(true);
    else { stateRef.current.page = 1; setPage(1); }
  }, [clearSelection, scheduleLoad]);
  const onSelectionChanged = useCallback((event: SelectionChangedEvent<TData>): void => {
    if (suppressSelection.current) return;
    const visibleIds = new Set(stateRef.current.rows.map(rowId));
    const nextVisible = new Set(event.selectedRows.map(rowId));
    if (allMatching.current) {
      for (const id of visibleIds) {
        if (nextVisible.has(id)) excludedIds.current.delete(id);
        else { excludedIds.current.add(id); selectedById.current.delete(id); }
      }
    } else {
      if ((optionsRef.current.selectionScope ?? "preserve") === "page") {
        selectedIds.current.clear(); selectedById.current.clear();
      } else {
        for (const id of visibleIds) { selectedIds.current.delete(id); selectedById.current.delete(id); }
      }
      for (const row of event.selectedRows) selectedIds.current.add(rowId(row));
    }
    for (const row of event.selectedRows) selectedById.current.set(rowId(row), row);
    notifySelection();
  }, [notifySelection, rowId]);

  const reload = useCallback(async (reloadOptions: { resetPage?: boolean } = {}): Promise<void> => {
    if (reloadOptions.resetPage) { stateRef.current.page = 1; setPage(1); }
    await load();
  }, [load]);
  const reset = useCallback(async (): Promise<void> => {
    stateRef.current.page = 1;
    stateRef.current.sortModel = [];
    stateRef.current.filterModel = {};
    setPage(1); setSortModel([]); setFilterModel({}); clearSelection();
    suppressGrid.current = true;
    try { apiRef.current?.setSortModel(null); apiRef.current?.setFilterModel(null); }
    finally { suppressGrid.current = false; }
    await load();
  }, [clearSelection, load]);
  const selectAllMatching = useCallback((): void => {
    allMatching.current = true; selectedIds.current.clear(); excludedIds.current.clear(); selectedById.current.clear();
    for (const row of stateRef.current.rows) selectedById.current.set(rowId(row), row);
    notifySelection(); syncVisibleSelection();
  }, [notifySelection, rowId, syncVisibleSelection]);
  const applySelectionState = useCallback((state: MachTableRemoteSelectionState): void => {
    selectedIds.current.clear(); excludedIds.current.clear(); selectedById.current.clear();
    allMatching.current = state.mode === "allMatching";
    for (const id of (state.mode === "allMatching" ? state.excludedKeys : state.selectedKeys).map(String)) {
      if (state.mode === "allMatching") excludedIds.current.add(id); else selectedIds.current.add(id);
    }
    for (const row of stateRef.current.rows) if (selected(rowId(row))) selectedById.current.set(rowId(row), row);
    notifySelection(); syncVisibleSelection();
  }, [notifySelection, rowId, selected, syncVisibleSelection]);

  const firstQueryEffect = useRef(true);
  const queryDependency = options.queryKey === undefined ? options.query : options.queryKey;
  useEffect(() => {
    if (firstQueryEffect.current) { firstQueryEffect.current = false; return; }
    if (optionsRef.current.clearSelectionOnQueryChange !== false) clearSelection();
    if (optionsRef.current.mode !== "manual") scheduleLoad(true);
    else { stateRef.current.page = 1; setPage(1); }
  }, [queryDependency, clearSelection, scheduleLoad]);
  useEffect(() => {
    if (options.mode !== "manual" && options.immediate !== false) void load();
    return abort;
  }, []);

  const pageSizes = useMemo(() => {
    const values = [...new Set((options.pageSizeOptions ?? [10, 20, 50, 100]).map((value) => positive(value, 0)).filter(Boolean))];
    if (!values.includes(pageSize)) values.push(pageSize);
    return values.sort((left, right) => left - right);
  }, [options.pageSizeOptions, pageSize]);
  const gridProps = useMemo<GridOptions<TData>>(() => ({
    rowData: rows,
    loading,
    error,
    rowKey: rowId,
    manualSorting: true,
    manualFiltering: true,
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
  }), [error, load, loading, onFilterChanged, onPaginationChanged, onSelectionChanged, onSortChanged, options.emptyOverlay, page, pageSize, pageSizes, quickFilterText, rowId, rows, syncVisibleSelection, total]);

  const selectedKeys = allMatching.current ? [] : [...selectedIds.current];
  const selectedRows = [...selectedById.current.entries()]
    .filter(([id]) => !excludedIds.current.has(id))
    .map(([, row]) => row);
  const selectionState: MachTableRemoteSelectionState = allMatching.current
    ? { mode: "allMatching", excludedKeys: [...excludedIds.current] }
    : { mode: "explicit", selectedKeys };

  return {
    rows, loading, error, page, pageSize, total, sortModel, filterModel,
    quickFilterText,
    setQuickFilterText(value) {
      stateRef.current.quickFilterText = value;
      setQuickFilterText(value);
      apiRef.current?.setQuickFilter(value);
    },
    selectedKeys, selectedRows, selectionState, gridProps, bindings: gridProps,
    reload, retry: load, reset, abort, clearSelection, selectAllMatching, applySelectionState
  };
}
