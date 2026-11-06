import { useEffect, useMemo, useRef, useState } from "react";
import { createMachTableCommands, type GridOptions, type MachTableCommands } from "@agile-team/mach-table";
import { useMachTable, type UseMachTableReturn } from "./useMachTable";
import { useMachTableEditing, type UseMachTableEditingOptions, type UseMachTableEditingReturn } from "./useMachTableEditing";
import type { UseMachTableQueryReturn } from "./useMachTableQuery";

export interface UseMachTableControllerOptions<TData> {
  /** Pass the result of useMachTableQuery for remote workflows. */
  query?: UseMachTableQueryReturn<TData>;
  editing?: UseMachTableEditingOptions<TData>;
  initialSearch?: string;
}

export interface UseMachTableControllerReturn<TData> {
  table: UseMachTableReturn<TData>;
  query: UseMachTableQueryReturn<TData> | null;
  editing: UseMachTableEditingReturn<TData>;
  bindings: GridOptions<TData>;
  search: string;
  setSearch(value: string): void;
  selectedRows: TData[];
  selectedCount: number;
  busy: boolean;
  error: unknown | null;
  commands: MachTableCommands;
  reload(): Promise<void>;
}

/** Cohesive React controller for API readiness, selection, editing and toolbar commands. */
export function useMachTableController<TData>(
  options: UseMachTableControllerOptions<TData> = {}
): UseMachTableControllerReturn<TData> {
  const table = useMachTable<TData>();
  const editing = useMachTableEditing(table, options.editing);
  const [localSelection, setLocalSelection] = useState<TData[]>([]);
  const query = options.query ?? null;
  const { search, setSearch, remoteSearch } = useControllerSearch(table, query, options.initialSearch);

  useEffect(() => {
    const api = table.api;
    if (query) return;
    if (!api || api.isDestroyed()) {
      setLocalSelection((rows) => rows.length ? [] : rows);
      return;
    }
    const sync = () => setLocalSelection(api.selection.getRows());
    sync();
    return api.on("selectionChanged", sync);
  }, [query, table.api]);
  const reload = useMemo(() => async (): Promise<void> => {
    if (query) await query.reload();
    else if (table.apiRef.current?.rows.isRemote()) await table.apiRef.current.rows.reload();
    else table.apiRef.current?.view.refreshCells();
  }, [query, table.apiRef]);
  const commands = useMemo(() => {
    const commands = createMachTableCommands<TData>({ getApi: () => table.apiRef.current, reload });
    if (remoteSearch) commands.search = remoteSearch;
    return commands;
  }, [reload, table.apiRef, remoteSearch]);
  const selectedRows = query?.selectedRows ?? localSelection;
  const selectedCount = query
    ? query.selectionState.mode === "allMatching"
      ? Math.max(0, query.total - query.selectionState.excludedKeys.length)
      : query.selectionState.selectedKeys.length
    : selectedRows.length;

  return {
    table,
    query,
    editing,
    bindings: query?.bindings ?? {},
    search,
    setSearch,
    selectedRows,
    selectedCount,
    busy: query?.loading === true || editing.saving,
    error: query?.error ?? editing.saveError ?? null,
    commands,
    reload
  };
}

function useControllerSearch<TData>(
  { api, apiRef }: UseMachTableReturn<TData>, query: UseMachTableQueryReturn<TData> | null, initialSearch: string | undefined
) {
  const [localSearch, setLocalSearch] = useState(initialSearch ?? "");
  const initialRemoteSearch = useRef(initialSearch);
  const setRemoteSearch = query?.setQuickFilterText;
  const remoteSearch = useMemo(() => {
    if (!setRemoteSearch) return undefined;
    return (text: string | null | undefined) => {
      const grid = apiRef.current;
      if (grid && !grid.isDestroyed()) grid.filtering.setQuickText(text);
      else setRemoteSearch(text?.trim() ? text : null);
    };
  }, [apiRef, setRemoteSearch]);

  useEffect(() => {
    if (!remoteSearch) api?.filtering.setQuickText(localSearch || null);
  }, [remoteSearch, localSearch, api]);
  useEffect(() => {
    // An explicit controller seed is applied once. Every subsequent search
    // reads from the query, including reset and direct API calls.
    const initial = initialRemoteSearch.current;
    if (!remoteSearch || initial === undefined) return;
    initialRemoteSearch.current = undefined;
    remoteSearch(initial);
  }, [remoteSearch]);

  return { search: query ? query.quickFilterText ?? "" : localSearch, setSearch: remoteSearch ?? setLocalSearch, remoteSearch };
}
