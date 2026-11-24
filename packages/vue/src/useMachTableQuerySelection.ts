import { computed, ref, shallowRef, watch, type Ref } from "vue";
import type { GridApi, SelectionChangedEvent } from "@agile-team/mach-table";

export type MachTableRemoteSelectionState =
  | { mode: "explicit"; selectedKeys: string[] }
  | { mode: "allMatching"; excludedKeys: string[] };

/** Owns query-wide selection and projects it into the grid's current page. */
export function useMachTableQuerySelection<TData>(
  rows: Readonly<Ref<TData[]>>,
  rowId: (row: TData) => string,
  pageOnly: boolean,
  getApi: () => GridApi<TData> | null
) {
  const selectedKeys = ref<string[]>([]);
  const selectedRows = shallowRef<TData[]>([]);
  // Explicit mode stores selected IDs, and allMatching mode stores exclusions.
  let selectionIds = new Set<string>();
  const selectedById = new Map<string, TData>();
  let allMatching = false;
  let updatingSelectedRefs = false;
  let suppressSelectionEvents = false;

  const isSelectedId = (id: string): boolean => selectionIds.has(id) !== allMatching;

  const updateSelectedRefs = (): void => {
    const keys = allMatching ? [] : [...selectionIds];
    updatingSelectedRefs = true;
    selectedKeys.value = keys;
    updatingSelectedRefs = false;
    const snapshots = allMatching
      ? [...selectedById.values()]
      : keys.map((id) => selectedById.get(id));
    selectedRows.value = snapshots.filter((row) => row !== undefined);
  };

  const syncVisibleSelection = (): void => {
    const api = getApi();
    if (!api || api.isDestroyed()) return;
    const selected = rows.value.filter((row) => isSelectedId(rowId(row)));
    suppressSelectionEvents = true;
    try {
      api.selection.setRows(selected, true);
    } finally {
      suppressSelectionEvents = false;
    }
  };

  const cacheVisibleSelection = (): void => {
    for (const row of rows.value) {
      const id = rowId(row);
      if (isSelectedId(id)) selectedById.set(id, row);
    }
  };

  const replaceSelection = (matching: boolean, ids: readonly string[], retainSnapshots = false): void => {
    allMatching = matching;
    selectionIds = new Set(ids.map(String));
    if (retainSnapshots) {
      for (const id of selectedById.keys()) {
        if (!selectionIds.has(id)) selectedById.delete(id);
      }
    } else {
      selectedById.clear();
    }
    cacheVisibleSelection();
    updateSelectedRefs();
    syncVisibleSelection();
  };

  // selectedKeys is replaced whenever the mode or the exclusion set changes.
  const selectionState = computed<MachTableRemoteSelectionState>(() => {
    const keys = selectedKeys.value;
    return allMatching
      ? { mode: "allMatching", excludedKeys: [...selectionIds] }
      : { mode: "explicit", selectedKeys: [...keys] };
  });

  const acceptPage = (pageRows: ReadonlyMap<string, TData>): void => {
    // The query rule owns allMatching selection; only retain the accepted page's snapshots.
    if (allMatching) {
      selectedById.clear();
    } else if (pageOnly) {
      for (const id of selectionIds) {
        if (pageRows.has(id)) continue;
        selectionIds.delete(id);
        selectedById.delete(id);
      }
    }
    for (const [id, row] of pageRows) {
      if (isSelectedId(id)) selectedById.set(id, row);
      else selectedById.delete(id);
    }
    updateSelectedRefs();
  };

  const onSelectionChanged = (event: SelectionChangedEvent<TData>): void => {
    if (suppressSelectionEvents) return;
    const selected = event.selectedRows;
    if (allMatching) {
      selectedById.clear();
      const visibleIds = new Set(selected.map(rowId));
      for (const row of rows.value) {
        const id = rowId(row);
        if (visibleIds.has(id)) {
          selectionIds.delete(id);
          selectedById.set(id, row);
        } else {
          selectionIds.add(id);
        }
      }
    } else {
      if (pageOnly) {
        selectionIds.clear();
        selectedById.clear();
      } else {
        for (const row of rows.value) {
          const id = rowId(row);
          selectionIds.delete(id);
          selectedById.delete(id);
        }
      }
      for (const row of selected) {
        const id = rowId(row);
        selectionIds.add(id);
        selectedById.set(id, row);
      }
    }
    updateSelectedRefs();
  };

  watch(selectedKeys, (keys) => {
    if (updatingSelectedRefs) return;
    replaceSelection(false, keys, true);
  }, { deep: true, flush: "sync" });

  return {
    state: {
      selectedKeys,
      selectedRows,
      selectionState,
      clearSelection: () => replaceSelection(false, []),
      selectAllMatching: () => replaceSelection(true, []),
      applySelectionState: (state: MachTableRemoteSelectionState) => {
        if (state.mode === "allMatching") replaceSelection(true, state.excludedKeys);
        else replaceSelection(false, state.selectedKeys);
      }
    },
    acceptPage,
    syncVisibleSelection,
    onSelectionChanged
  };
}
