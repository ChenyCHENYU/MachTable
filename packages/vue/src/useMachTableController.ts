import { computed, ref, shallowRef, watch, type ComputedRef, type Ref, type ShallowRef } from "vue";
import { resolveSource } from "./source";
import { createMachTableCommands, type GridOptions, type MachTableCommands } from "@agile-team/mach-table";
import type { MachTableVueProps } from "./MachTable";
import { useMachTable, type UseMachTableReturn } from "./useMachTable";
import { useMachTableEditing, type UseMachTableEditingOptions, type UseMachTableEditingReturn } from "./useMachTableEditing";
import { useMachTableQuery, type UseMachTableQueryOptions, type UseMachTableQueryReturn } from "./useMachTableQuery";

export type MachTableBindingSource<T> = T | Readonly<{ value: T }> | (() => T);
export type MachTableEditMode = "none" | "cell" | "row";

export interface UseMachTableControllerOptions<TData, TQuery = Record<string, unknown>> {
  /** Stable table props. Dynamic state below is bridged into `bindings` automatically. */
  config?: MachTableVueProps<TData>;
  /** Omit for local rowData; provide for a complete remote table workflow. */
  query?: UseMachTableQueryOptions<TData, TQuery>;
  editing?: UseMachTableEditingOptions<TData>;
  initialSearch?: string;
  loading?: MachTableBindingSource<boolean>;
  theme?: MachTableBindingSource<NonNullable<GridOptions<TData>["theme"]>>;
  editMode?: MachTableBindingSource<MachTableEditMode>;
  onCellValueChanged?: GridOptions<TData>["onCellValueChanged"];
  onRowEditingStopped?: GridOptions<TData>["onRowEditingStopped"];
  onGridError?: GridOptions<TData>["onGridError"];
}

export interface UseMachTableControllerReturn<TData> {
  table: UseMachTableReturn<TData>;
  query: UseMachTableQueryReturn<TData> | null;
  editing: UseMachTableEditingReturn<TData>;
  bindings: ComputedRef<MachTableVueProps<TData>>;
  search: Ref<string>;
  selectedRows: ShallowRef<TData[]>;
  selectedCount: ComputedRef<number>;
  busy: ComputedRef<boolean>;
  error: ComputedRef<unknown | null>;
  commands: MachTableCommands;
  reload(): Promise<void>;
}

/** One cohesive controller for API readiness, query, selection, editing and toolbar commands. */
export function useMachTableController<TData, TQuery = Record<string, unknown>>(
  options: UseMachTableControllerOptions<TData, TQuery> = {}
): UseMachTableControllerReturn<TData> {
  const table = useMachTable<TData>();
  const initialSearch = options.initialSearch ?? options.config?.quickFilterText ?? "";
  const quickFilterText = options.query?.quickFilterText ?? ref(initialSearch.trim() ? initialSearch : null);
  const search = computed({
    get: () => quickFilterText.value ?? "",
    set: (value: string) => { quickFilterText.value = value.trim() ? value : null; }
  });
  const query = options.query
    ? useMachTableQuery({
        ...options.query,
        quickFilterText
      })
    : null;
  const editing = useMachTableEditing(table, options.editing);
  const selectedRows = shallowRef<TData[]>([]);

  const syncSelection = (): void => {
    selectedRows.value = query?.selectedRows.value ?? table.api.value?.selection.getRows() ?? [];
  };
  watch(table.api, (api, _previous, onCleanup) => {
    if (api && !api.isDestroyed()) onCleanup(api.on("selectionChanged", syncSelection));
    syncSelection();
  }, { immediate: true });
  if (query) watch(query.selectedRows, syncSelection);

  const reload = async (): Promise<void> => {
    if (query) await query.reload();
    else {
      const api = table.api.value;
      if (api?.rows.isRemote()) await api.rows.reload();
      else api?.view.refreshCells();
    }
  };
  const commands = createMachTableCommands<TData>({ getApi: () => table.api.value, reload });
  if (query) commands.search = (text) => { search.value = text ?? ""; };
  const bindings = computed<MachTableVueProps<TData>>(() => {
    const value: MachTableVueProps<TData> = {
      ...options.config,
      ...(query?.bindings.value ?? { quickFilterText: quickFilterText.value })
    };
    const loading = resolveSource(options.loading);
    const theme = resolveSource(options.theme);
    const editMode = resolveSource(options.editMode);
    if (loading !== undefined) value.loading = loading;
    if (theme !== undefined) value.theme = theme;
    if (editMode !== undefined) {
      value.editType = editMode === "row" ? "fullRow" : "cell";
      value.editableIndicator = editMode === "cell" ? "hover" : "none";
    }
    if (options.onCellValueChanged) value.onCellValueChanged = options.onCellValueChanged;
    if (options.onRowEditingStopped) value.onRowEditingStopped = options.onRowEditingStopped;
    if (options.onGridError) value.onGridError = options.onGridError;
    return value;
  });
  const selectedCount = computed(() => {
    if (!query) return selectedRows.value.length;
    const state = query.selectionState.value;
    return state.mode === "allMatching"
      ? Math.max(0, query.total.value - state.excludedKeys.length)
      : state.selectedKeys.length;
  });
  const busy = computed(() => resolveSource(options.loading) === true || query?.loading.value === true || editing.saving.value);
  const error = computed(() => query?.error.value ?? editing.saveError.value ?? null);

  if (!query) watch(quickFilterText, (value) => commands.search(value));
  return { table, query, editing, bindings, search, selectedRows, selectedCount, busy, error, commands, reload };
}
