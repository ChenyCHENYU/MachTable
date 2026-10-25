import { normalizeAdvancedFilterModel, normalizeFilterModel } from "../lib/advancedFilter";
import type { ServerSideQuery, ServerSideResult } from "./types";

export function aborted(): Error {
  const error = new Error("[MachTable] Server-side operation cancelled or replaced.");
  error.name = "AbortError";
  return error;
}

export function boundedInteger(value: number | undefined, fallback: number, maximum: number, minimum = 1): number {
  return value != null && Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, Math.floor(value))) : fallback;
}

export function validateRoute(route: readonly string[]): string[] {
  if (!Array.isArray(route) || route.length > 16 || route.some(key => typeof key !== "string" || key.length > 512)) {
    throw new TypeError("[MachTable] Invalid server-side group route.");
  }
  return [...route];
}

export function normalizeQuery(input: Partial<ServerSideQuery>, previous?: ServerSideQuery): ServerSideQuery {
  const source = { ...previous, ...input };
  const groups = source.rowGroupCols ?? [];
  const values = source.valueCols ?? [];
  if (groups.length > 16 || values.length > 128) throw new RangeError("[MachTable] Server-side query exceeds group/aggregate column limits.");
  const columns = [...groups, ...values];
  if (columns.some(column => typeof column.colId !== "string" || !column.colId || column.colId.length > 512)) {
    throw new TypeError("[MachTable] Invalid server-side query column.");
  }
  return {
    rowGroupCols: groups.map(column => ({ colId: column.colId, ...(column.field ? { field: column.field } : {}) })),
    valueCols: values.map(column => ({ colId: column.colId, aggFunc: column.aggFunc, ...(column.field ? { field: column.field } : {}) })),
    sortModel: (source.sortModel ?? []).slice(0, 2_000).filter(item => item.direction === "asc" || item.direction === "desc").map(item => ({ ...item })),
    filterModel: normalizeFilterModel(source.filterModel),
    advancedFilterModel: normalizeAdvancedFilterModel(source.advancedFilterModel),
    quickFilterText: source.quickFilterText?.slice(0, 10_000) || null
  };
}

function validateEnvelope<T>(result: ServerSideResult<T>, start: number, blockSize: number): void {
  if (!result || !Array.isArray(result.rows) || result.rows.length > blockSize
    || !Number.isInteger(result.rowCount) || result.rowCount < 0
    || (result.rows.length > 0 && result.rowCount < start + result.rows.length)
    || typeof result.revision !== "string" || !result.revision || result.revision.length > 512) {
    throw new TypeError("[MachTable] Invalid server-side route response.");
  }
}

export function validOffset(start: number, rowCount: number, blockSize: number): number | null {
  return rowCount > 0 && start >= rowCount ? Math.floor((rowCount - 1) / blockSize) * blockSize : null;
}

export function validateResult<T>(result: ServerSideResult<T>, start: number, blockSize: number, group: boolean): ServerSideResult<T> {
  validateEnvelope(result, start, blockSize);
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const row of result.rows) {
    if (typeof row.id !== "string" || !row.id || row.id.length > 512 || ids.has(row.id)) throw new TypeError("[MachTable] Duplicate/invalid server-side row ID.");
    ids.add(row.id);
    if (group) {
      if (typeof row.groupKey !== "string" || row.groupKey.length > 512 || keys.has(row.groupKey)) throw new TypeError("[MachTable] Duplicate/invalid group key.");
      keys.add(row.groupKey);
    } else if (row.groupKey !== undefined) throw new TypeError("[MachTable] Leaf routes cannot return group rows.");
  }
  return { rows: result.rows.map(row => ({ ...row })), rowCount: result.rowCount, revision: result.revision };
}

export function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(aborted()); return; }
    const abort = () => { clearTimeout(timer); reject(aborted()); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** A transport may ignore cancellation; the store must still release its waiter. */
export function withAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(aborted());
    void work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) { reject(aborted()); return; }
    signal.addEventListener("abort", abort, { once: true });
  });
}
