import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  resolveSaveConflict as resolveCoreSaveConflict,
  type GridBatchSaveResult,
  type GridChange,
  type SaveChangeConflict,
  type SaveChangeIssue,
  type SaveChangesHandler
} from "@agile-team/mach-table";
import type { UseMachTableReturn } from "./useMachTable";

export interface UseMachTableEditingOptions<TData = any> {
  guardBeforeUnload?: boolean;
  beforeUnloadMessage?: string;
  onSaveSuccess?(saved: readonly GridChange<TData>[]): void;
  onSaveResult?(result: GridBatchSaveResult<TData>): void;
  onSaveError?(error: unknown): void;
}

export interface UseMachTableEditingReturn<TData = any> {
  changes: GridChange<TData>[];
  dirtyRowIds: string[];
  dirty: boolean;
  saving: boolean;
  saveError: unknown | null;
  lastSaveResult: GridBatchSaveResult<TData> | null;
  saveIssues: Array<SaveChangeIssue | SaveChangeConflict<TData>>;
  failedRowIds: string[];
  save(handler: SaveChangesHandler<TData>, rowIds?: readonly string[]): Promise<GridChange<TData>[]>;
  saveDetailed(handler: SaveChangesHandler<TData>, rowIds?: readonly string[]): Promise<GridBatchSaveResult<TData>>;
  clearSaveIssues(): void;
  resolveConflict(rowId: string, strategy: "acceptServer" | "keepLocal"): boolean;
  rollback(rowIds?: readonly string[]): boolean;
  markSaved(rowIds?: readonly string[]): void;
  reveal(rowId: string, colId?: string, edit?: boolean): boolean;
  refresh(): void;
}

/** Reactive dirty/save workflow layered over useMachTable(). */
export function useMachTableEditing<TData = any>(
  table: UseMachTableReturn<TData>,
  options: UseMachTableEditingOptions<TData> = {}
): UseMachTableEditingReturn<TData> {
  const [changes, setChanges] = useState<GridChange<TData>[]>([]);
  const [dirtyRowIds, setDirtyRowIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown | null>(null);
  const [lastSaveResult, setLastSaveResult] = useState<GridBatchSaveResult<TData> | null>(null);
  const savingRef = useRef(false);
  const generationRef = useRef(0);
  const resultCurrentRef = useRef<((rowId?: string) => boolean) | null>(null);

  const refresh = useCallback((): void => {
    const api = table.apiRef.current;
    if (!api || api.isDestroyed()) {
      setDirtyRowIds([]);
      setChanges([]);
      return;
    }
    setDirtyRowIds(api.editing.getDirtyRowIds());
    setChanges(api.editing.getChanges());
  }, [table.apiRef]);

  useEffect(() => {
    const api = table.api;
    generationRef.current++;
    savingRef.current = false;
    setSaving(false);
    setSaveError(null);
    setLastSaveResult(null);
    resultCurrentRef.current = null;
    refresh();
    const remove = api && !api.isDestroyed() ? api.on("dirtyStateChanged", refresh) : undefined;
    return () => {
      generationRef.current++;
      remove?.();
    };
  }, [table.api, refresh]);

  const saveDetailed = useCallback(async (
    handler: SaveChangesHandler<TData>,
    rowIds?: readonly string[]
  ): Promise<GridBatchSaveResult<TData>> => {
    const api = table.apiRef.current;
    if (!api || api.isDestroyed()) throw new Error("[MachTable] Cannot save before the grid is ready.");
    if (savingRef.current) throw new Error("[MachTable] A save operation is already in progress.");
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    setLastSaveResult(null);
    resultCurrentRef.current = null;
    const generation = generationRef.current;
    // Keep late responses tied to the API that submitted them. In particular,
    // an old finally must not unlock a replacement table's active save.
    const isCurrentSave = (): boolean =>
      generation === generationRef.current && table.apiRef.current === api && !api.isDestroyed();
    const targets = api.editing.getDirtyRowIds()
      .filter((rowId) => !rowIds || rowIds.includes(rowId))
      .map((rowId) => { const node = api.rows.getById(rowId); return { rowId, node, data: node?.data }; });
    // Reloads can replace rows without replacing the component or API.
    const isCurrentResult = (rowId?: string): boolean => {
      const selected = rowId === undefined ? targets : targets.filter((target) => target.rowId === rowId);
      return isCurrentSave() && selected.every(({ rowId: id, node, data }) =>
        api.rows.getById(id) === node && node?.data === data);
    };
    try {
      const result = await api.editing.save(handler, rowIds);
      if (!isCurrentResult()) return result;
      resultCurrentRef.current = isCurrentResult;
      setLastSaveResult(result);
      refresh();
      options.onSaveSuccess?.(result.saved);
      options.onSaveResult?.(result);
      return result;
    } catch (error) {
      if (isCurrentResult()) {
        setSaveError(error);
        options.onSaveError?.(error);
      }
      throw error;
    } finally {
      if (isCurrentSave()) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  }, [options, refresh, table.apiRef]);
  const save = useCallback(async (
    handler: SaveChangesHandler<TData>,
    rowIds?: readonly string[]
  ): Promise<GridChange<TData>[]> => (await saveDetailed(handler, rowIds)).saved, [saveDetailed]);

  const clearSaveIssues = useCallback((): void => {
    resultCurrentRef.current = null;
    setLastSaveResult(null);
  }, []);
  const resolveConflict = useCallback((rowId: string, strategy: "acceptServer" | "keepLocal"): boolean => {
    const conflict = lastSaveResult?.conflicts.find((entry) => entry.rowId === rowId);
    const api = table.apiRef.current;
    if (!lastSaveResult || !conflict || !api || !resultCurrentRef.current?.(rowId) ||
      !resolveCoreSaveConflict(api, conflict, strategy)) return false;
    setLastSaveResult((result) => result && {
      ...result,
      conflicts: result.conflicts.filter((entry) => entry.rowId !== rowId)
    });
    refresh();
    return true;
  }, [lastSaveResult, refresh, table.apiRef]);

  const rollback = useCallback((rowIds?: readonly string[]): boolean => {
    const changed = table.apiRef.current?.editing.rollback(rowIds) ?? false;
    refresh();
    return changed;
  }, [refresh, table.apiRef]);
  const markSaved = useCallback((rowIds?: readonly string[]): void => {
    table.apiRef.current?.editing.markSaved(rowIds);
    refresh();
  }, [refresh, table.apiRef]);
  const reveal = useCallback((rowId: string, colId?: string, edit = false): boolean => {
    const api = table.apiRef.current;
    const node = api?.rows.getById(rowId);
    if (!api || !node || node.rowIndex < 0) return false;
    api.view.scrollToRow(node.rowIndex, "middle");
    return colId && edit ? api.editing.startCell({ rowIndex: node.rowIndex, colId }) : true;
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

  const saveIssues = useMemo(() => [
    ...(lastSaveResult?.failures ?? []),
    ...(lastSaveResult?.conflicts ?? [])
  ], [lastSaveResult]);
  const failedRowIds = useMemo(() => [...new Set(saveIssues.map((issue) => issue.rowId))], [saveIssues]);

  return useMemo(() => ({
    changes, dirtyRowIds, dirty: dirtyRowIds.length > 0, saving, saveError,
    lastSaveResult, saveIssues, failedRowIds,
    save, saveDetailed, clearSaveIssues, resolveConflict, rollback, markSaved, reveal, refresh
  }), [changes, clearSaveIssues, dirtyRowIds, failedRowIds, lastSaveResult, markSaved, refresh, resolveConflict, reveal, rollback, save, saveDetailed, saveError, saveIssues, saving]);
}
