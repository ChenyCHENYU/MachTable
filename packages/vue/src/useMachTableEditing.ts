import {
  computed,
  onScopeDispose,
  ref,
  shallowRef,
  watch,
  type ComputedRef,
  type Ref,
  type ShallowRef
} from "vue";
import type {
  GridChange,
  SaveChangesHandler
} from "@agile-team/mach-table";
import type { UseMachTableReturn } from "./useMachTable";

export interface UseMachTableEditingOptions<TData = any> {
  /** Warn before closing/reloading a browser tab with unsaved changes. */
  guardBeforeUnload?: boolean;
  beforeUnloadMessage?: string;
  onSaveSuccess?(saved: readonly GridChange<TData>[]): void;
  onSaveError?(error: unknown): void;
}

export interface UseMachTableEditingReturn<TData = any> {
  changes: ShallowRef<GridChange<TData>[]>;
  dirtyRowIds: Ref<string[]>;
  dirty: ComputedRef<boolean>;
  saving: Ref<boolean>;
  saveError: ShallowRef<unknown | null>;
  save(handler: SaveChangesHandler<TData>, rowIds?: readonly string[]): Promise<GridChange<TData>[]>;
  rollback(rowIds?: readonly string[]): boolean;
  markSaved(rowIds?: readonly string[]): void;
  /** Scrolls to a loaded changed row and optionally opens the failed cell editor. */
  reveal(rowId: string, colId?: string, edit?: boolean): boolean;
  refresh(): void;
}

/** Reactive dirty/save workflow layered over useMachTable(). */
export function useMachTableEditing<TData = any>(
  table: UseMachTableReturn<TData>,
  options: UseMachTableEditingOptions<TData> = {}
): UseMachTableEditingReturn<TData> {
  const changes = shallowRef<GridChange<TData>[]>([]);
  const dirtyRowIds = ref<string[]>([]);
  const saving = ref(false);
  const saveError = shallowRef<unknown | null>(null);
  const dirty = computed(() => dirtyRowIds.value.length > 0);
  let removeDirtyListener: (() => void) | null = null;

  const refresh = (): void => {
    const api = table.api.value;
    if (!api || api.isDestroyed()) {
      dirtyRowIds.value = [];
      changes.value = [];
      return;
    }
    dirtyRowIds.value = api.getDirtyRowIds();
    changes.value = api.getChanges();
  };

  watch(table.api, (api) => {
    removeDirtyListener?.();
    removeDirtyListener = null;
    refresh();
    if (!api || api.isDestroyed()) return;
    removeDirtyListener = api.addEventListener("dirtyStateChanged", refresh);
  }, { immediate: true });

  const save = async (
    handler: SaveChangesHandler<TData>,
    rowIds?: readonly string[]
  ): Promise<GridChange<TData>[]> => {
    const api = table.api.value;
    if (!api || api.isDestroyed()) throw new Error("[MachTable] Cannot save before the grid is ready.");
    if (saving.value) throw new Error("[MachTable] A save operation is already in progress.");
    saving.value = true;
    saveError.value = null;
    try {
      const saved = await api.saveChanges(handler, rowIds);
      refresh();
      options.onSaveSuccess?.(saved);
      return saved;
    } catch (error) {
      saveError.value = error;
      options.onSaveError?.(error);
      throw error;
    } finally {
      saving.value = false;
    }
  };

  const rollback = (rowIds?: readonly string[]): boolean => {
    const changed = table.api.value?.rollbackChanges(rowIds) ?? false;
    refresh();
    return changed;
  };
  const markSaved = (rowIds?: readonly string[]): void => {
    table.api.value?.markChangesSaved(rowIds);
    refresh();
  };
  const reveal = (rowId: string, colId?: string, edit = false): boolean => {
    const api = table.api.value;
    const node = api?.getNodeById(rowId);
    if (!api || !node || node.rowIndex < 0) return false;
    api.scrollToIndex(node.rowIndex, "middle");
    return colId && edit ? api.startEditingCell({ rowIndex: node.rowIndex, colId }) : true;
  };

  const onBeforeUnload = (event: BeforeUnloadEvent): string | undefined => {
    if (!dirty.value) return undefined;
    const message = options.beforeUnloadMessage ?? "存在未保存的表格修改。";
    event.preventDefault();
    event.returnValue = message;
    return message;
  };
  if (options.guardBeforeUnload && typeof window !== "undefined") {
    window.addEventListener("beforeunload", onBeforeUnload);
  }

  onScopeDispose(() => {
    removeDirtyListener?.();
    removeDirtyListener = null;
    if (options.guardBeforeUnload && typeof window !== "undefined") {
      window.removeEventListener("beforeunload", onBeforeUnload);
    }
  });

  return {
    changes,
    dirtyRowIds,
    dirty,
    saving,
    saveError,
    save,
    rollback,
    markSaved,
    reveal,
    refresh
  };
}
