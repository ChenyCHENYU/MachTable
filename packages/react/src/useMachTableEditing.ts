import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GridChange, SaveChangesHandler } from "@agile-team/mach-table";
import type { UseMachGridReturn } from "./useMachGrid";

export interface UseMachTableEditingOptions<TData = any> {
  guardBeforeUnload?: boolean;
  beforeUnloadMessage?: string;
  onSaveSuccess?(saved: readonly GridChange<TData>[]): void;
  onSaveError?(error: unknown): void;
}

export interface UseMachTableEditingReturn<TData = any> {
  changes: GridChange<TData>[];
  dirtyRowIds: string[];
  dirty: boolean;
  saving: boolean;
  saveError: unknown | null;
  save(handler: SaveChangesHandler<TData>, rowIds?: readonly string[]): Promise<GridChange<TData>[]>;
  rollback(rowIds?: readonly string[]): boolean;
  markSaved(rowIds?: readonly string[]): void;
  reveal(rowId: string, colId?: string, edit?: boolean): boolean;
  refresh(): void;
}

/** Reactive dirty/save workflow layered over useMachGrid(). */
export function useMachTableEditing<TData = any>(
  table: UseMachGridReturn<TData>,
  options: UseMachTableEditingOptions<TData> = {}
): UseMachTableEditingReturn<TData> {
  const [changes, setChanges] = useState<GridChange<TData>[]>([]);
  const [dirtyRowIds, setDirtyRowIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown | null>(null);
  const savingRef = useRef(false);

  const refresh = useCallback((): void => {
    const api = table.apiRef.current;
    if (!api || api.isDestroyed()) {
      setDirtyRowIds([]);
      setChanges([]);
      return;
    }
    setDirtyRowIds(api.getDirtyRowIds());
    setChanges(api.getChanges());
  }, [table.apiRef]);

  useEffect(() => {
    const api = table.api;
    refresh();
    return api && !api.isDestroyed() ? api.addEventListener("dirtyStateChanged", refresh) : undefined;
  }, [table.api, refresh]);

  const save = useCallback(async (
    handler: SaveChangesHandler<TData>,
    rowIds?: readonly string[]
  ): Promise<GridChange<TData>[]> => {
    const api = table.apiRef.current;
    if (!api || api.isDestroyed()) throw new Error("[MachTable] Cannot save before the grid is ready.");
    if (savingRef.current) throw new Error("[MachTable] A save operation is already in progress.");
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await api.saveChanges(handler, rowIds);
      refresh();
      options.onSaveSuccess?.(saved);
      return saved;
    } catch (error) {
      setSaveError(error);
      options.onSaveError?.(error);
      throw error;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [options, refresh, table.apiRef]);

  const rollback = useCallback((rowIds?: readonly string[]): boolean => {
    const changed = table.apiRef.current?.rollbackChanges(rowIds) ?? false;
    refresh();
    return changed;
  }, [refresh, table.apiRef]);
  const markSaved = useCallback((rowIds?: readonly string[]): void => {
    table.apiRef.current?.markChangesSaved(rowIds);
    refresh();
  }, [refresh, table.apiRef]);
  const reveal = useCallback((rowId: string, colId?: string, edit = false): boolean => {
    const api = table.apiRef.current;
    const node = api?.getNodeById(rowId);
    if (!api || !node || node.rowIndex < 0) return false;
    api.scrollToIndex(node.rowIndex, "middle");
    return colId && edit ? api.startEditingCell({ rowIndex: node.rowIndex, colId }) : true;
  }, [table.apiRef]);

  useEffect(() => {
    if (!options.guardBeforeUnload || typeof window === "undefined") return;
    const handler = (event: BeforeUnloadEvent): string | undefined => {
      if (dirtyRowIds.length === 0) return undefined;
      const message = options.beforeUnloadMessage ?? "存在未保存的表格修改。";
      event.preventDefault();
      event.returnValue = message;
      return message;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirtyRowIds.length, options.beforeUnloadMessage, options.guardBeforeUnload]);

  return useMemo(() => ({
    changes, dirtyRowIds, dirty: dirtyRowIds.length > 0, saving, saveError,
    save, rollback, markSaved, reveal, refresh
  }), [changes, dirtyRowIds, markSaved, refresh, reveal, rollback, save, saveError, saving]);
}
