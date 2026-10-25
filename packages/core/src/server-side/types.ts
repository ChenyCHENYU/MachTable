import type { AdvancedFilterModel } from "../types/advancedFilter";
import type { FilterModel, SortModel } from "../types/colDef";

export interface ServerSideGroupColumn { colId: string; field?: string }
export interface ServerSideValueColumn extends ServerSideGroupColumn { aggFunc: string }
export interface ServerSideQuery {
  rowGroupCols: readonly ServerSideGroupColumn[];
  valueCols: readonly ServerSideValueColumn[];
  sortModel: SortModel;
  filterModel: FilterModel;
  advancedFilterModel: AdvancedFilterModel | null;
  quickFilterText: string | null;
}

export interface ServerSideRequest extends ServerSideQuery {
  /** Group keys from root to parent; [] identifies the root sibling store. */
  route: readonly string[];
  startRow: number;
  endRow: number;
  revision: string | null;
  signal: AbortSignal;
}

export interface ServerSideRow<TData> {
  /** Unique among siblings, independent from the row's current offset. */
  id: string;
  data: TData;
  /** Present only for groups; appended to the parent route on expansion. */
  groupKey?: string;
  childCount?: number;
  aggValues?: Readonly<Record<string, unknown>>;
}

export interface ServerSideResult<TData> {
  rows: readonly ServerSideRow<TData>[];
  /** Total sibling count for this route, never the flattened tree total. */
  rowCount: number;
  revision: string;
}

export interface ServerSideTransaction<TData> {
  route: readonly string[];
  expectedRevision: string;
  add?: readonly ServerSideRow<TData>[];
  update?: readonly ServerSideRow<TData>[];
  remove?: readonly string[];
}

export interface ServerSideProjection<TData> extends ServerSideRow<TData> {
  key: string;
  route: readonly string[];
  depth: number;
  expanded: boolean;
}

export interface ServerSideRouteSnapshot {
  route: readonly string[];
  startRow: number;
  endRow: number;
  rowCount: number | null;
  revision: string | null;
  loading: boolean;
  error: unknown | null;
}

export interface ServerSideSelection {
  selectedKeys: readonly string[];
  /** Descendant intent includes unloaded rows in these group routes. */
  selectedRoutes: readonly (readonly string[])[];
  excludedRoutes: readonly (readonly string[])[];
  excludedKeys: readonly string[];
}

export interface ServerSideSnapshot<TData> {
  /** Only visible active pages; this is not a full server-side export. */
  rows: readonly ServerSideProjection<TData>[];
  routes: readonly ServerSideRouteSnapshot[];
  selection: ServerSideSelection;
  query: ServerSideQuery;
  revision: number;
  cachedBlockCount: number;
}

export interface ServerSideStoreOptions<TData> {
  getRows(request: ServerSideRequest): Promise<ServerSideResult<TData>>;
  /** Must atomically compare expectedRevision and return the committed revision. */
  transact?(transaction: ServerSideTransaction<TData> & { query: ServerSideQuery; signal: AbortSignal }): Promise<{ revision: string }>;
  query?: Partial<ServerSideQuery>;
  blockSize?: number;
  maxBlocks?: number;
  maxConcurrentRequests?: number;
  retryCount?: number;
  retryDelay?: number;
  onError?(error: unknown, route: readonly string[]): void;
}

export interface ServerSideStore<TData> {
  load(route?: readonly string[], startRow?: number, signal?: AbortSignal): Promise<void>;
  expand(route: readonly string[]): Promise<void>;
  collapse(route: readonly string[]): void;
  refresh(route?: readonly string[]): Promise<void>;
  setQuery(query: Partial<ServerSideQuery>): Promise<void>;
  transact(transaction: ServerSideTransaction<TData>): Promise<void>;
  select(row: ServerSideProjection<TData>, selected: boolean, mode?: "self" | "descendants"): void;
  getSelection(row: ServerSideProjection<TData>): "selected" | "partial" | "none";
  clearSelection(): void;
  getSnapshot(): ServerSideSnapshot<TData>;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

export class ServerSideVersionConflictError extends Error {
  constructor(readonly expectedRevision: string, readonly actualRevision: string | null) {
    super("[MachTable] Server-side route revision changed; refresh before retrying the transaction.");
    this.name = "ServerSideVersionConflictError";
  }
}
