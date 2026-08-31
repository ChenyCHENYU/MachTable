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
  GridBatchSaveResult,
  GridChange,
  SaveChangeConflict,
  SaveChangeIssue,
  SaveChangesHandler
} from "@agile-team/mach-table";
import { resolveSaveConflict } from "@agile-team/mach-table";
import type { UseMachTableReturn } from "./useMachTable";

export interface UseMachTableEditingOptions<TData = any> {
  /** Warn before closing/reloading a browser tab with unsaved changes. */
  guardBeforeUnload?: boolean;
  beforeUnloadMessage?: string;
  onSaveSuccess?(saved: readonly GridChange<TData>[]): void;
  onSaveResult?(result: GridBatchSaveResult<TData>): void;
  onSaveError?(error: unknown): void;
}

export interface UseMachTableEditingReturn<TData = any> {
  changes: ShallowRef<GridChange<TData>[]>;
  dirtyRowIds: Ref<string[]>;
  dirty: ComputedRef<boolean>;
  saving: Ref<boolean>;
  saveError: ShallowRef<unknown | null>;
  lastSaveResult: ShallowRef<GridBatchSaveResult<TData> | null>;
  saveIssues: ComputedRef<Array<SaveChangeIssue | SaveChangeConflict<TData>>>;
  failedRowIds: ComputedRef<string[]>;
  save(handler: SaveChangesHandler<TData>, rowIds?: readonly string[]): Promise<GridChange<TData>[]>;
  saveDetailed(handler: SaveChangesHandler<TData>, rowIds?: readonly string[]): Promise<GridBatchSaveResult<TData>>;
  clearSaveIssues(): void;
  resolveConflict(rowId: string, strategy: "acceptServer" | "keepLocal"): boolean;
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
  const lastSaveResult = shallowRef<GridBatchSaveResult<TData> | null>(null);
  const dirty = computed(() => dirtyRowIds.value.length > 0);
  const saveIssues = computed(() => [
    ...(lastSaveResult.value?.failures ?? []),
    ...(lastSaveResult.value?.conflicts ?? [])
  ]);
  const failedRowIds = computed(() => [...new Set(saveIssues.value.map((issue) => issue.rowId))]);
  let removeDirtyListener: (() => void) | null = null;

  const refresh = (): void => {
    const api = table.api.value;
    if (!api || api.isDestroyed()) {
      dirtyRowIds.value = [];
      changes.value = [];
      return;
    }
    dirtyRowIds.value = api.editing.getDirtyRowIds();
    changes.value = api.editing.getChanges();
  };

  watch(table.api, (api) => {
    removeDirtyListener?.();
    removeDirtyListener = null;
    refresh();
    if (!api || api.isDestroyed()) return;
    removeDirtyListener = api.on("dirtyStateChanged", refresh);
  }, { immediate: true });

  const saveDetailed = async (
    handler: SaveChangesHandler<TData>,
    rowIds?: readonly string[]
  ): Promise<GridBatchSaveResult<TData>> => {
    const api = table.api.value;
    if (!api || api.isDestroyed()) throw new Error("[MachTable] Cannot save before the grid is ready.");
    if (saving.value) throw new Error("[MachTable] A save operation is already in progress.");
    saving.value = true;
    saveError.value = null;
    lastSaveResult.value = null;
    try {
      const result = await api.editing.save(handler, rowIds);
      lastSaveResult.value = result;
      refresh();
      options.onSaveSuccess?.(result.saved);
      options.onSaveResult?.(result);
      return result;
    } catch (error) {
      saveError.value = error;
      options.onSaveError?.(error);
      throw error;
    } finally {
      saving.value = false;
    }
  };
  const save = async (
    handler: SaveChangesHandler<TData>,
    rowIds?: readonly string[]
  ): Promise<GridChange<TData>[]> => (await saveDetailed(handler, rowIds)).saved;

  const clearSaveIssues = (): void => { lastSaveResult.value = null; };
  const resolveConflict = (rowId: string, strategy: "acceptServer" | "keepLocal"): boolean => {
    const result = lastSaveResult.value;
    const conflict = result?.conflicts.find((entry) => entry.rowId === rowId);
    const api = table.api.value;
    if (!result || !conflict || !api || !resolveSaveConflict(api, conflict, strategy)) return false;
    lastSaveResult.value = {
      ...result,
      failures: result.failures,
      conflicts: result.conflicts.filter((entry) => entry.rowId !== rowId)
    };
    refresh();
    return true;
  };

  const rollback = (rowIds?: readonly string[]): boolean => {
    const changed = table.api.value?.editing.rollback(rowIds) ?? false;
    refresh();
    return changed;
  };
  const markSaved = (rowIds?: readonly string[]): void => {
    table.api.value?.editing.markSaved(rowIds);
    refresh();
  };
  const reveal = (rowId: string, colId?: string, edit = false): boolean => {
    const api = table.api.value;
    const node = api?.rows.getById(rowId);
    if (!api || !node || node.rowIndex < 0) return false;
    api.view.scrollToRow(node.rowIndex, "middle");
    return colId && edit ? api.editing.startCell({ rowIndex: node.rowIndex, colId }) : true;
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
    lastSaveResult,
    saveIssues,
    failedRowIds,
    save,
    saveDetailed,
    clearSaveIssues,
    resolveConflict,
    rollback,
    markSaved,
    reveal,
    refresh
  };
}
