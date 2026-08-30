import type { GridState } from "../types/state";
import type { GridStateStore } from "../types/options";
import type { ColumnStateStorage } from "./columnStateStore";

export interface StoredGridState {
  schemaVersion: 1;
  savedAt: number;
  state: GridState;
}

export interface LocalGridStateStoreOptions {
  namespace?: string;
  storage?: ColumnStateStorage;
  /** Reject unexpectedly large or corrupted payloads. Defaults to 512 KiB. */
  maxBytes?: number;
  onError?(error: unknown, operation: "load" | "save" | "clear", key: string): void;
}

export interface ManagedGridStateStore extends GridStateStore {
  clear(key: string): void;
  storageKey(key: string): string;
}

function currentStorage(): ColumnStateStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isGridState(value: unknown): value is GridState {
  if (value == null || typeof value !== "object") return false;
  const state = value as Partial<GridState>;
  return state.version === 1 &&
    Array.isArray(state.columns) &&
    Array.isArray(state.sortModel) &&
    state.filterModel != null && typeof state.filterModel === "object" &&
    state.pagination != null && typeof state.pagination === "object" &&
    Array.isArray(state.selectedRowIds) &&
    Array.isArray(state.expandedRowIds) &&
    Array.isArray(state.expandedGroupIds);
}

/** Safe, versioned localStorage adapter for full grid state. */
export function createLocalGridStateStore(options: LocalGridStateStoreOptions = {}): ManagedGridStateStore {
  const namespace = (options.namespace ?? "mach-table:grid-state").replace(/:+$/, "");
  const maxBytes = Math.max(1_024, Math.floor(options.maxBytes ?? 512 * 1_024));
  const storageKey = (key: string): string => `${namespace}:${key}`;
  const report = (error: unknown, operation: "load" | "save" | "clear", key: string): void => {
    try { options.onError?.(error, operation, key); } catch { /* observers cannot break the grid */ }
  };

  return {
    storageKey,
    load(key) {
      try {
        const raw = (options.storage ?? currentStorage())?.getItem(storageKey(key));
        if (!raw || raw.length > maxBytes) return null;
        const parsed = JSON.parse(raw) as Partial<StoredGridState>;
        return parsed?.schemaVersion === 1 && isGridState(parsed.state) ? parsed.state : null;
      } catch (error) {
        report(error, "load", key);
        return null;
      }
    },
    save(key, state) {
      try {
        if (!isGridState(state)) throw new TypeError(`[MachTable] Invalid grid state for "${key}".`);
        const payload = JSON.stringify({ schemaVersion: 1, savedAt: Date.now(), state } satisfies StoredGridState);
        if (payload.length > maxBytes) throw new RangeError(`[MachTable] Grid state for "${key}" exceeds ${maxBytes} bytes.`);
        (options.storage ?? currentStorage())?.setItem(storageKey(key), payload);
      } catch (error) {
        report(error, "save", key);
      }
    },
    clear(key) {
      try {
        (options.storage ?? currentStorage())?.removeItem(storageKey(key));
      } catch (error) {
        report(error, "clear", key);
      }
    }
  };
}

const defaultStore = createLocalGridStateStore();

export function saveGridState(key: string, state: GridState): void {
  void defaultStore.save(key, state);
}

export function loadGridState(key: string): GridState | null {
  return defaultStore.load(key) as GridState | null;
}

export function clearGridState(key: string): void {
  defaultStore.clear(key);
}
