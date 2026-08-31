import { computed, onScopeDispose, ref, shallowRef, watch, type ComputedRef, type Ref, type ShallowRef } from "vue";
import { createMachTableCommands, type GridOptions, type MachTableCommands } from "@agile-team/mach-table";
import { useMachTable, type UseMachTableReturn } from "./useMachTable";
import { useMachTableEditing, type UseMachTableEditingOptions, type UseMachTableEditingReturn } from "./useMachTableEditing";
import { useMachTableQuery, type UseMachTableQueryOptions, type UseMachTableQueryReturn } from "./useMachTableQuery";

export interface UseMachTableControllerOptions<TData, TQuery = Record<string, unknown>> {
  /** Omit for local rowData; provide for a complete remote table workflow. */
  query?: UseMachTableQueryOptions<TData, TQuery>;
  editing?: UseMachTableEditingOptions<TData>;
  initialSearch?: string;
}

export interface UseMachTableControllerReturn<TData> {
  table: UseMachTableReturn<TData>;
  query: UseMachTableQueryReturn<TData> | null;
  editing: UseMachTableEditingReturn<TData>;
  bindings: ComputedRef<GridOptions<TData>>;
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
  const search = ref(options.initialSearch ?? "");
  const query = options.query
    ? useMachTableQuery({
        ...options.query,
        quickFilterText: options.query.quickFilterText ?? computed(() => search.value || null)
      })
    : null;
  const editing = useMachTableEditing(table, options.editing);
  const selectedRows = shallowRef<TData[]>([]);
  let removeSelectionListener: (() => void) | null = null;

  const syncSelection = (): void => {
    selectedRows.value = query?.selectedRows.value ?? table.api.value?.selection.getRows() ?? [];
  };
  watch(table.api, (api) => {
    removeSelectionListener?.();
    removeSelectionListener = null;
    if (api && !api.isDestroyed()) removeSelectionListener = api.on("selectionChanged", syncSelection);
    syncSelection();
  }, { immediate: true });
  if (query) watch(query.selectedRows, syncSelection, { deep: false });

  const reload = async (): Promise<void> => {
    if (query) await query.reload();
    else {
      const api = table.api.value;
      if (api?.rows.isRemote()) await api.rows.reload();
      else api?.view.refreshCells();
    }
  };
  const commands = createMachTableCommands<TData>({ getApi: () => table.api.value, reload });
  const bindings = computed<GridOptions<TData>>(() => query?.bindings.value ?? {});
  const selectedCount = computed(() => {
    if (!query) return selectedRows.value.length;
    const state = query.selectionState.value;
    return state.mode === "allMatching"
      ? Math.max(0, query.total.value - state.excludedKeys.length)
      : state.selectedKeys.length;
  });
  const busy = computed(() => query?.loading.value === true || editing.saving.value);
  const error = computed(() => query?.error.value ?? editing.saveError.value ?? null);

  watch(search, (value) => {
    if (!query) commands.search(value || null);
  });
  onScopeDispose(() => {
    removeSelectionListener?.();
    removeSelectionListener = null;
  });

  return { table, query, editing, bindings, search, selectedRows, selectedCount, busy, error, commands, reload };
}
