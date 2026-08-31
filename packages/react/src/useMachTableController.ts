import { useEffect, useMemo, useState } from "react";
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
  const [search, setSearch] = useState(options.initialSearch ?? "");
  const [localSelection, setLocalSelection] = useState<TData[]>([]);
  const query = options.query ?? null;

  useEffect(() => {
    const api = table.api;
    if (!api || api.isDestroyed() || query) return;
    const sync = () => setLocalSelection(api.selection.getRows());
    sync();
    return api.on("selectionChanged", sync);
  }, [query, table.api]);
  useEffect(() => {
    if (!query) table.apiRef.current?.filtering.setQuickText(search || null);
    else query.setQuickFilterText(search || null);
  }, [query, search, table.apiRef]);

  const reload = useMemo(() => async (): Promise<void> => {
    if (query) await query.reload();
    else if (table.apiRef.current?.rows.isRemote()) await table.apiRef.current.rows.reload();
    else table.apiRef.current?.view.refreshCells();
  }, [query, table.apiRef]);
  const commands = useMemo(() => createMachTableCommands<TData>({
    getApi: () => table.apiRef.current,
    reload
  }), [reload, table.apiRef]);
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
