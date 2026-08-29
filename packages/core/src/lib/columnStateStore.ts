import type { ColumnState } from "../types/colDef";
import type { ColumnStateStore } from "../types/options";

export interface ColumnStateStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StoredColumnState {
  version: number;
  savedAt: number;
  columns: ColumnState[];
}

export interface LocalColumnStateStoreOptions {
  /** Storage prefix. Separate applications or environments with different values. */
  namespace?: string;
  /** Schema version for migrations when column identifiers or meanings change. */
  version?: number;
  storage?: ColumnStateStorage;
  maxColumns?: number;
  migrate?(
    columns: readonly ColumnState[],
    fromVersion: number,
    toVersion: number
  ): ColumnState[] | null;
  onError?(error: unknown, operation: "load" | "save" | "clear", key: string): void;
}

export interface ManagedColumnStateStore extends ColumnStateStore {
  clear(key: string): void;
  storageKey(key: string): string;
}

export interface ColumnStateKeyParts {
  app?: string;
  tenant?: string | number;
  user?: string | number;
  route?: string;
  table: string;
  schema?: string | number;
}

function currentStorage(): ColumnStateStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function safeSegment(value: string | number): string {
  return encodeURIComponent(String(value).trim()).replace(/%/g, "~");
}

/** Builds a collision-resistant key for per-user/per-route table preferences. */
export function createColumnStateKey(parts: ColumnStateKeyParts): string {
  const segments: Array<[string, string | number | undefined]> = [
    ["app", parts.app],
    ["tenant", parts.tenant],
    ["user", parts.user],
    ["route", parts.route],
    ["table", parts.table],
    ["schema", parts.schema]
  ];
  return segments
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined && String(entry[1]).trim() !== "")
    .map(([name, value]) => `${name}=${safeSegment(value)}`)
    .join(";");
}

function sanitizeColumnState(value: unknown, maxColumns: number): ColumnState[] | null {
  if (!Array.isArray(value) || value.length > maxColumns) return null;
  const result: ColumnState[] = [];
  const ids = new Set<string>();
  for (const item of value) {
    if (item == null || typeof item !== "object") continue;
    const source = item as Record<string, unknown>;
    if (typeof source.colId !== "string" || source.colId.length === 0 || source.colId.length > 256 || ids.has(source.colId)) continue;
    ids.add(source.colId);
    const state: ColumnState = { colId: source.colId };
    if (typeof source.hide === "boolean") state.hide = source.hide;
    if (typeof source.width === "number" && Number.isFinite(source.width) && source.width > 0) state.width = source.width;
    if (source.pinned === "left" || source.pinned === "right" || source.pinned === null) state.pinned = source.pinned;
    if (source.sort === "asc" || source.sort === "desc" || source.sort === null) state.sort = source.sort;
    if (source.sortIndex === null) state.sortIndex = null;
    else if (typeof source.sortIndex === "number" && Number.isInteger(source.sortIndex) && source.sortIndex >= 0) {
      state.sortIndex = source.sortIndex;
    }
    result.push(state);
  }
  return result;
}

/**
 * Creates a versioned local state adapter. Legacy array payloads are read as
 * version 0, so existing users can migrate without losing preferences.
 */
export function createLocalColumnStateStore(options: LocalColumnStateStoreOptions = {}): ManagedColumnStateStore {
  const namespace = (options.namespace ?? "mach-table:col-state").replace(/:+$/, "");
  const version = Math.max(1, Math.floor(options.version ?? 1));
  const maxColumns = Math.max(1, Math.floor(options.maxColumns ?? 1_000));
  const storageKey = (key: string): string => `${namespace}:${key}`;
  const report = (error: unknown, operation: "load" | "save" | "clear", key: string): void => {
    try { options.onError?.(error, operation, key); } catch { /* error observers must not break the grid */ }
  };

  return {
    storageKey,
    load(key) {
      try {
        const raw = (options.storage ?? currentStorage())?.getItem(storageKey(key));
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const legacy = sanitizeColumnState(parsed, maxColumns);
          if (!legacy || !options.migrate) return legacy;
          return sanitizeColumnState(options.migrate(legacy, 0, version), maxColumns);
        }
        if (parsed == null || typeof parsed !== "object") return null;
        const envelope = parsed as Partial<StoredColumnState>;
        if (!Number.isInteger(envelope.version) || typeof envelope.version !== "number") return null;
        const columns = sanitizeColumnState(envelope.columns, maxColumns);
        if (!columns) return null;
        if (envelope.version === version) return columns;
        return options.migrate
          ? sanitizeColumnState(options.migrate(columns, envelope.version, version), maxColumns)
          : null;
      } catch (error) {
        report(error, "load", key);
        return null;
      }
    },
    save(key, state) {
      try {
        const columns = sanitizeColumnState(state, maxColumns);
        if (!columns) throw new TypeError(`[MachTable] Invalid column state for "${key}".`);
        const envelope: StoredColumnState = { version, savedAt: Date.now(), columns };
        (options.storage ?? currentStorage())?.setItem(storageKey(key), JSON.stringify(envelope));
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

const defaultStore = createLocalColumnStateStore();

export function saveColumnState(key: string, state: ColumnState[]): void {
  void defaultStore.save(key, state);
}

export function loadColumnState(key: string): ColumnState[] | null {
  return defaultStore.load(key) as ColumnState[] | null;
}

export function clearColumnState(key: string): void {
  void defaultStore.clear(key);
}
