import type {
  GridBatchSaveResult,
  GridChange,
  SaveChangeConflict,
  SaveChangeIssue,
  SaveChangesResult
} from "../types/api";
import type { GridApi } from "../types/api";
import { getByPath } from "./path";

function cloneSnapshotData<T>(data: T): T {
  try { if (typeof structuredClone === "function") return structuredClone(data); }
  catch { /* rows with platform values use a shallow snapshot */ }
  if (Array.isArray(data)) return [...data] as T;
  if (data != null && typeof data === "object") return { ...data };
  return data;
}

export function createSaveSnapshot<TData>(
  changes: readonly GridChange<TData>[],
  rowIds?: readonly string[]
): GridChange<TData>[] {
  const ids = rowIds ? new Set(rowIds.map(String)) : null;
  return changes.filter((change) => !ids || ids.has(change.rowId)).map((change) => ({
    ...change,
    data: cloneSnapshotData(change.data),
    cells: change.cells.map((cell) => ({ ...cell }))
  }));
}

function normalizeIssue<T extends SaveChangeIssue>(issue: T, submittedIds: ReadonlySet<string>): T | null {
  const rowId = typeof issue?.rowId === "string" ? issue.rowId : "";
  if (!submittedIds.has(rowId) || typeof issue.message !== "string" || !issue.message.trim()) return null;
  return {
    ...issue,
    rowId,
    message: issue.message.trim(),
    ...(typeof issue.code === "string" && issue.code.trim() ? { code: issue.code.trim() } : {}),
    ...(Array.isArray(issue.colIds)
      ? { colIds: [...new Set(issue.colIds.filter((id): id is string => typeof id === "string" && id.length > 0))] }
      : {})
  };
}

function uniqueIssues<T extends SaveChangeIssue>(
  input: readonly T[] | undefined,
  submittedIds: ReadonlySet<string>
): T[] {
  const byRow = new Map<string, T>();
  for (const issue of input ?? []) {
    const normalized = normalizeIssue(issue, submittedIds);
    if (normalized && !byRow.has(normalized.rowId)) byRow.set(normalized.rowId, normalized);
  }
  return [...byRow.values()];
}

export function normalizeBatchSaveResult<TData>(
  submitted: GridChange<TData>[],
  response: void | SaveChangesResult<TData>
): GridBatchSaveResult<TData> {
  const submittedIds = new Set(submitted.map((change) => change.rowId));
  const conflicts = uniqueIssues<SaveChangeConflict<TData>>(response?.conflicts, submittedIds);
  const conflictIds = new Set(conflicts.map((conflict) => conflict.rowId));
  const failures = uniqueIssues(response?.failures, submittedIds)
    .filter((failure) => !conflictIds.has(failure.rowId));
  const blocked = new Set([...failures, ...conflicts].map((issue) => issue.rowId));
  const explicitlySaved = response?.savedRowIds == null
    ? null
    : new Set(response.savedRowIds.map(String).filter((id) => submittedIds.has(id)));
  const saved = submitted.filter((change) =>
    !blocked.has(change.rowId) && (explicitlySaved == null || explicitlySaved.has(change.rowId))
  );
  return { submitted, saved, failures, conflicts };
}

function conflictUpdateData<TData>(
  api: GridApi<TData>,
  conflict: SaveChangeConflict<TData>
): { data: TData; mergeIntoCurrent: boolean } | null {
  if (conflict.serverData === undefined) return null;
  const node = api.rows.getById(conflict.rowId);
  if (!node || node.data == null) return null;
  const rowKey = api.getOption("rowKey");
  if (rowKey) {
    const id = typeof rowKey === "function" ? rowKey(conflict.serverData) : getByPath(conflict.serverData, rowKey);
    return String(id) === conflict.rowId ? { data: conflict.serverData, mergeIntoCurrent: false } : null;
  }
  const current = node.data;
  const mergeable = current != null && conflict.serverData != null &&
    typeof current === "object" && typeof conflict.serverData === "object";
  return mergeable ? { data: current, mergeIntoCurrent: true } : null;
}

export function resolveSaveConflict<TData>(
  api: GridApi<TData>,
  conflict: SaveChangeConflict<TData>,
  strategy: "acceptServer" | "keepLocal"
): boolean {
  if (api.isDestroyed()) return false;
  if (strategy === "keepLocal") return true;
  const update = conflictUpdateData(api, conflict);
  if (!update) return false;
  api.editing.rollback([conflict.rowId]);
  if (update.mergeIntoCurrent) Object.assign(update.data as object, conflict.serverData as object);
  api.rows.transact({ update: [update.data] });
  api.editing.markSaved([conflict.rowId]);
  return true;
}
