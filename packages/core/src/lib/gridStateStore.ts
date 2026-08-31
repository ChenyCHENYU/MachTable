import type { GridState } from "../types/state";
import type { GridStateStore } from "../types/options";
import { normalizeGridState } from "./gridState";

export interface GridStateStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StoredGridState {
  schemaVersion: 2;
  savedAt: number;
  state: GridState;
}

export interface LocalGridStateStoreOptions {
  namespace?: string;
  storage?: GridStateStorage;
  /** Reject unexpectedly large or corrupted payloads. Defaults to 512 KiB. */
  maxBytes?: number;
  onError?(error: unknown, operation: "load" | "save" | "clear", key: string): void;
}

export interface ManagedGridStateStore extends GridStateStore {
  clear(key: string): void;
  storageKey(key: string): string;
}

function currentStorage(): GridStateStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function storageBytes(value: string): number {
  return typeof TextEncoder === "undefined" ? value.length * 2 : new TextEncoder().encode(value).byteLength;
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
        if (!raw) return null;
        if (storageBytes(raw) > maxBytes) {
          throw new RangeError(`[MachTable] Stored grid state for "${key}" exceeds ${maxBytes} bytes.`);
        }
        const parsed = JSON.parse(raw) as { schemaVersion?: unknown; state?: unknown };
        if (parsed?.schemaVersion !== 2) {
          throw new TypeError(`[MachTable] Stored grid state for "${key}" uses an unsupported schema.`);
        }
        const normalized = normalizeGridState(parsed.state);
        if (!normalized) throw new TypeError(`[MachTable] Stored grid state for "${key}" is invalid.`);
        return normalized;
      } catch (error) {
        report(error, "load", key);
        return null;
      }
    },
    save(key, state) {
      try {
        const normalized = normalizeGridState(state);
        if (!normalized) throw new TypeError(`[MachTable] Invalid grid state for "${key}".`);
        const payload = JSON.stringify({ schemaVersion: 2, savedAt: Date.now(), state: normalized } satisfies StoredGridState);
        if (storageBytes(payload) > maxBytes) throw new RangeError(`[MachTable] Grid state for "${key}" exceeds ${maxBytes} bytes.`);
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

export function saveGridState(key: string, state: import("../types/state").GridStateInput): void {
  void defaultStore.save(key, state);
}

export function loadGridState(key: string): GridState | null {
  return defaultStore.load(key) as GridState | null;
}

export function clearGridState(key: string): void {
  defaultStore.clear(key);
}
