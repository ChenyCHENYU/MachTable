import type { GridApi } from "../types/api";
import type { ColumnStateStorage } from "./columnStateStore";
import type {
  GridViewManager,
  GridViewState,
  GridViewStore,
  SavedGridView
} from "../types/views";
import { migrateGridState } from "./gridState";

export interface LocalGridViewStoreOptions {
  namespace?: string;
  storage?: ColumnStateStorage;
  maxViews?: number;
  maxBytes?: number;
  onError?(error: unknown, operation: "list" | "save" | "remove", scope: string): void;
}

interface StoredViews {
  schemaVersion: 1;
  savedAt: number;
  views: SavedGridView[];
}

function currentStorage(): ColumnStateStorage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; }
  catch { return null; }
}

function storageBytes(value: string): number {
  return typeof TextEncoder === "undefined" ? value.length * 2 : new TextEncoder().encode(value).byteLength;
}

function safeId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return id && id.length <= 256 ? id : null;
}

export function normalizeGridViewState(input: unknown): GridViewState | null {
  if (input == null || typeof input !== "object") return null;
  const source = input as Partial<GridViewState>;
  if (source.version !== 1) return null;
  const state = migrateGridState({
    version: 2,
    columns: source.columns,
    sortModel: source.sortModel,
    filterModel: source.filterModel,
    advancedFilterModel: source.advancedFilterModel,
    quickFilterText: source.quickFilterText,
    pagination: { enabled: true, page: 1, pageSize: source.pageSize },
    selectedRowIds: [], expandedRowIds: [], expandedGroupIds: []
  });
  if (!state) return null;
  return {
    version: 1,
    columns: state.columns,
    sortModel: state.sortModel,
    filterModel: state.filterModel,
    advancedFilterModel: state.advancedFilterModel,
    quickFilterText: state.quickFilterText,
    pageSize: state.pagination.pageSize
  };
}

export function normalizeSavedGridView(input: unknown): SavedGridView | null {
  if (input == null || typeof input !== "object") return null;
  const source = input as Partial<SavedGridView>;
  const id = safeId(source.id);
  const name = typeof source.name === "string" ? source.name.trim().slice(0, 120) : "";
  const state = normalizeGridViewState(source.state);
  if (source.schemaVersion !== 1 || !id || !name || !state) return null;
  const createdAt = typeof source.createdAt === "number" && Number.isFinite(source.createdAt) ? source.createdAt : Date.now();
  const updatedAt = typeof source.updatedAt === "number" && Number.isFinite(source.updatedAt) ? source.updatedAt : createdAt;
  return { schemaVersion: 1, id, name, createdAt, updatedAt, state };
}

export function captureGridViewState<TData>(api: GridApi<TData>): GridViewState {
  const state = api.getState();
  return {
    version: 1,
    columns: state.columns,
    sortModel: state.sortModel,
    filterModel: state.filterModel,
    advancedFilterModel: state.advancedFilterModel,
    quickFilterText: state.quickFilterText,
    pageSize: state.pagination.pageSize
  };
}

export function applyGridViewState<TData>(
  api: GridApi<TData>,
  view: GridViewState,
  options: { emitEvents?: boolean } = {}
): boolean {
  const normalized = normalizeGridViewState(view);
  if (!normalized || api.isDestroyed()) return false;
  const current = api.getState();
  api.applyState({
    ...current,
    columns: normalized.columns,
    sortModel: normalized.sortModel,
    filterModel: normalized.filterModel,
    advancedFilterModel: normalized.advancedFilterModel,
    quickFilterText: normalized.quickFilterText,
    pagination: { ...current.pagination, page: 1, pageSize: normalized.pageSize }
  }, {
    sections: ["columns", "sort", "filter", "pagination"],
    emitEvents: options.emitEvents
  });
  return true;
}

export function createLocalGridViewStore(options: LocalGridViewStoreOptions = {}): GridViewStore {
  const namespace = (options.namespace ?? "mach-table:views").replace(/:+$/, "");
  const maxViews = Math.max(1, Math.floor(options.maxViews ?? 50));
  const maxBytes = Math.max(4_096, Math.floor(options.maxBytes ?? 512 * 1_024));
  const keyOf = (scope: string): string => `${namespace}:${encodeURIComponent(scope)}`;
  const report = (error: unknown, operation: "list" | "save" | "remove", scope: string): void => {
    try { options.onError?.(error, operation, scope); } catch { /* observers cannot break preferences */ }
  };
  const read = (scope: string): SavedGridView[] => {
    const raw = (options.storage ?? currentStorage())?.getItem(keyOf(scope));
    if (!raw || storageBytes(raw) > maxBytes) return [];
    const parsed = JSON.parse(raw) as Partial<StoredViews>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.views)) return [];
    return parsed.views.flatMap((view) => {
      const normalized = normalizeSavedGridView(view);
      return normalized ? [normalized] : [];
    }).slice(0, maxViews);
  };
  const write = (scope: string, views: SavedGridView[]): void => {
    const payload = JSON.stringify({ schemaVersion: 1, savedAt: Date.now(), views } satisfies StoredViews);
    if (storageBytes(payload) > maxBytes) throw new RangeError(`[MachTable] Saved views for "${scope}" exceed ${maxBytes} bytes.`);
    const storage = options.storage ?? currentStorage();
    if (!storage) throw new Error("[MachTable] Saved view storage is unavailable.");
    storage.setItem(keyOf(scope), payload);
  };
  return {
    list(scope) {
      try { return read(scope); }
      catch (error) { report(error, "list", scope); return []; }
    },
    save(scope, view) {
      try {
        const normalized = normalizeSavedGridView(view);
        if (!normalized) throw new TypeError(`[MachTable] Invalid saved view for "${scope}".`);
        const views = read(scope).filter((entry) => entry.id !== normalized.id);
        views.unshift(normalized);
        write(scope, views.slice(0, maxViews));
      } catch (error) { report(error, "save", scope); throw error; }
    },
    remove(scope, id) {
      try { write(scope, read(scope).filter((entry) => entry.id !== id)); }
      catch (error) { report(error, "remove", scope); throw error; }
    }
  };
}

function createViewId(): string {
  try { if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID(); }
  catch { /* use deterministic-compatible fallback */ }
  return `view-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createGridViewManager<TData>(
  api: GridApi<TData>,
  options: { scope: string; store?: GridViewStore }
): GridViewManager {
  const scope = options.scope.trim();
  if (!scope || scope.length > 512) {
    throw new TypeError("[MachTable] Grid view scope must contain between 1 and 512 characters.");
  }
  const store = options.store ?? createLocalGridViewStore();
  const list = async (): Promise<SavedGridView[]> => {
    const views = await store.list(scope);
    return views.flatMap((view) => {
      const normalized = normalizeSavedGridView(view);
      return normalized ? [normalized] : [];
    }).sort((left, right) => right.updatedAt - left.updatedAt);
  };
  return {
    list,
    async save(name, requestedId) {
      const cleanName = name.trim().slice(0, 120);
      if (!cleanName) throw new TypeError("[MachTable] Grid view name must be a non-empty string.");
      const id = safeId(requestedId) ?? createViewId();
      const existing = (await list()).find((view) => view.id === id);
      const now = Date.now();
      const view: SavedGridView = {
        schemaVersion: 1,
        id,
        name: cleanName,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        state: captureGridViewState(api)
      };
      await store.save(scope, view);
      return view;
    },
    async apply(viewOrId, applyOptions) {
      const view = typeof viewOrId === "string"
        ? (await list()).find((entry) => entry.id === viewOrId)
        : normalizeSavedGridView(viewOrId);
      const requested = typeof viewOrId === "string" ? viewOrId : "provided view";
      if (!view) throw new Error(`[MachTable] Grid view "${requested}" was not found.`);
      if (!applyGridViewState(api, view.state, applyOptions)) {
        throw new Error(`[MachTable] Grid view "${view.id}" could not be applied.`);
      }
      return view;
    },
    async remove(id) { await store.remove(scope, id); }
  };
}
