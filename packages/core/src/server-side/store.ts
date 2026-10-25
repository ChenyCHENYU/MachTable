import { RemoteBlockCache } from "../services/remoteBlockCache";
import { aborted, boundedInteger, normalizeQuery, pause, validOffset, validateResult, validateRoute, withAbort } from "./protocol";
import { routeKey, rowKey, ServerSideSelectionModel, within } from "./selection";
import { ServerSideVersionConflictError } from "./types";
import type {
  ServerSideProjection, ServerSideQuery, ServerSideResult, ServerSideRouteSnapshot,
  ServerSideSnapshot, ServerSideStore, ServerSideStoreOptions, ServerSideTransaction
} from "./types";

interface RouteState extends ServerSideRouteSnapshot {
  generation: number;
  active: number | null;
  pending: number;
  requestVersion: number;
}
interface BlockRef { index: number; key: string; route: string; start: number }

class RouteStore<T> implements ServerSideStore<T> {
  private query: ServerSideQuery;
  private cache: RemoteBlockCache<ServerSideResult<T>>;
  private routes = new Map<string, RouteState>();
  private blocks = new Map<string, BlockRef>();
  private indices = new Map<number, BlockRef>();
  private expanded = new Set<string>();
  private selection = new ServerSideSelectionModel();
  private listeners = new Set<() => void>();
  private transactions = new Set<AbortController>();
  private blockSize: number;
  private nextIndex = 0;
  private generation = 0;
  private revision = 0;
  private disposed = false;
  private pendingLoads = 0;
  private snapshot: ServerSideSnapshot<T> | null = null;

  constructor(private options: ServerSideStoreOptions<T>) {
    this.query = normalizeQuery(options.query ?? {});
    this.blockSize = boundedInteger(options.blockSize, 100, 1_000);
    this.cache = new RemoteBlockCache(boundedInteger(options.maxBlocks, 12, 256), index => this.onEvict(index),
      boundedInteger(options.maxConcurrentRequests, 4, 16));
  }

  private assertLive(): void { if (this.disposed) throw aborted(); }

  private assertLoadCapacity(): void {
    if (this.pendingLoads >= 256) throw new RangeError("[MachTable] Server-side load queue limit reached (256).");
  }

  private emit(changed = false): void {
    if (this.disposed) return;
    this.snapshot = null;
    if (changed) this.revision++;
    for (const listener of this.listeners) {
      try { listener(); } catch (error) { this.report(error, []); }
    }
  }

  private report(error: unknown, route: readonly string[]): void {
    if ((error as Error)?.name === "AbortError") return;
    try { this.options.onError?.(error, route); } catch { /* observers do not own store lifetime */ }
  }

  private state(route: readonly string[]): RouteState {
    const path = validateRoute(route);
    if (path.length > this.query.rowGroupCols.length) throw new RangeError("[MachTable] Route exceeds configured grouping depth.");
    const key = routeKey(path);
    const existing = this.routes.get(key);
    if (existing) { this.routes.delete(key); this.routes.set(key, existing); return existing; }
    if (this.routes.size >= 256) {
      const idle = [...this.routes].find(([id, value]) => id !== "[]" && value.pending === 0 && !this.expanded.has(id));
      if (!idle) throw new RangeError("[MachTable] Server-side route metadata limit reached (256).");
      this.invalidateBlocks(idle[0]); this.routes.delete(idle[0]);
    }
    const state: RouteState = { route: path, startRow: 0, endRow: 0, rowCount: null,
      revision: null, loading: false, error: null, generation: 0, active: null, pending: 0, requestVersion: 0 };
    this.routes.set(key, state);
    return state;
  }

  private onEvict(index: number): void {
    this.snapshot = null;
    const ref = this.indices.get(index);
    if (!ref) return;
    this.indices.delete(index);
    if (this.blocks.get(ref.key) === ref) this.blocks.delete(ref.key);
    const state = this.routes.get(ref.route);
    if (state?.active === index) state.active = null;
  }

  private invalidateBlocks(route: string, except?: number): void {
    for (const ref of [...this.indices.values()]) {
      if (ref.route !== route || ref.index === except) continue;
      this.cache.invalidate(ref.index);
      this.onEvict(ref.index);
    }
  }

  private retainActive(): void {
    const retained = new Set<number>();
    for (const [key, state] of this.routes) {
      if (state.active != null && (key === "[]" || this.expanded.has(key))) retained.add(state.active);
    }
    this.cache.retain(retained);
  }

  private block(route: string, start: number): BlockRef {
    const key = JSON.stringify([route, start]);
    const existing = this.blocks.get(key);
    if (existing) return existing;
    const ref = { index: ++this.nextIndex, key, route, start };
    this.blocks.set(key, ref); this.indices.set(ref.index, ref);
    return ref;
  }

  private async fetch(state: RouteState, start: number, signal: AbortSignal): Promise<ServerSideResult<T>> {
    const retries = boundedInteger(this.options.retryCount, 1, 5, 0);
    const query = this.query;
    for (let attempt = 0; ; attempt++) {
      if (signal.aborted) throw aborted();
      try {
        const result = await this.options.getRows({ ...query, route: [...state.route], startRow: start,
          endRow: start + this.blockSize, revision: state.revision, signal });
        if (signal.aborted) throw aborted();
        return validateResult(result, start, this.blockSize, state.route.length < query.rowGroupCols.length);
      } catch (error) {
        if (signal.aborted || attempt >= retries) throw error;
        await pause(Math.min(30_000, boundedInteger(this.options.retryDelay, 200, 10_000, 0) * 2 ** attempt), signal);
      }
    }
  }

  private current(state: RouteState, ref: BlockRef, generation: number, routeGeneration: number): boolean {
    return !this.disposed && generation === this.generation && state.generation === routeGeneration && this.cache.has(ref.index);
  }

  async load(route: readonly string[] = [], startRow = 0, signal?: AbortSignal): Promise<void> {
    this.assertLive();
    this.assertLoadCapacity();
    const state = this.state(route);
    const start = Math.floor(boundedInteger(startRow, 0, Number.MAX_SAFE_INTEGER, 0) / this.blockSize) * this.blockSize;
    const ref = this.block(routeKey(state.route), start);
    const generation = this.generation;
    const routeGeneration = state.generation;
    const ticket = ++state.requestVersion;
    this.pendingLoads++;
    state.pending++; state.loading = true; state.error = null;
    this.retainActive(); this.emit();
    try {
      const response = await this.cache.load(ref.index, async innerSignal => ({ rows: [await this.fetch(state, start, innerSignal)] }), signal, 100);
      if (!this.current(state, ref, generation, routeGeneration)) throw aborted();
      if (ticket !== state.requestVersion) return;
      const result = response.rows[0];
      if (state.revision != null && state.revision !== result.revision) {
        state.generation++;
        this.invalidateBlocks(ref.route, ref.index);
      }
      state.revision = result.revision;
      const fallback = validOffset(start, result.rowCount, this.blockSize);
      if (fallback != null) { await this.load(state.route, fallback, signal); return; }
      state.active = ref.index; state.startRow = start; state.endRow = start + result.rows.length;
      state.rowCount = result.rowCount; state.revision = result.revision;
      this.retainActive(); this.emit(true);
      await this.restoreExpanded(state.route);
    } catch (error) {
      if (this.currentRequest(state, generation, routeGeneration, ticket)) {
        state.error = (error as Error)?.name === "AbortError" ? null : error;
        this.report(error, state.route);
      }
      throw error;
    } finally {
      state.pending = Math.max(0, state.pending - 1);
      this.pendingLoads--;
      if (ticket === state.requestVersion) state.loading = false;
      if (!this.cache.has(ref.index)) this.onEvict(ref.index);
      if (generation === this.generation) this.emit();
    }
  }

  private currentRequest(state: RouteState, generation: number, routeGeneration: number, ticket: number): boolean {
    return !this.disposed && generation === this.generation && state.generation === routeGeneration && ticket === state.requestVersion;
  }

  async expand(route: readonly string[]): Promise<void> {
    this.assertLive();
    const path = validateRoute(route);
    const state = this.state(path);
    const key = routeKey(path);
    if (!this.expanded.has(key) && this.expanded.size >= 128) throw new RangeError("[MachTable] Expanded group limit reached (128).");
    this.expanded.add(key);
    this.emit(true);
    if (state.active == null) await this.load(path, state.startRow);
    else await this.restoreExpanded(path);
  }

  collapse(route: readonly string[]): void {
    const path = validateRoute(route);
    for (const key of this.expanded) if (within(JSON.parse(key) as string[], path)) this.expanded.delete(key);
    this.retainActive(); this.emit(true);
  }

  private invalidateRoute(route: readonly string[]): void {
    for (const [key, state] of this.routes) {
      if (!within(state.route, route)) continue;
      state.generation++; state.active = null; state.revision = null; state.error = null;
      this.invalidateBlocks(key);
    }
  }

  private async restoreExpanded(route: readonly string[]): Promise<void> {
    const state = this.routes.get(routeKey(route));
    const page = state?.active == null ? undefined : this.cache.peek(state.active)?.rows[0];
    if (!page) return;
    const children = page.rows.flatMap(row => row.groupKey !== undefined
      && this.expanded.has(routeKey([...route, row.groupKey])) ? [[...route, row.groupKey]] : []);
    await Promise.all(children.map(path => this.expand(path)));
  }

  async refresh(route: readonly string[] = []): Promise<void> {
    this.assertLive();
    const state = this.state(route);
    this.invalidateRoute(state.route);
    this.emit(true);
    await this.load(state.route, state.startRow);
  }

  async setQuery(query: Partial<ServerSideQuery>): Promise<void> {
    this.assertLive();
    const next = normalizeQuery(query, this.query);
    if (JSON.stringify(next) === JSON.stringify(this.query)) return;
    this.generation++;
    this.cache.purge(); this.blocks.clear(); this.indices.clear(); this.routes.clear(); this.expanded.clear();
    for (const controller of this.transactions) controller.abort();
    this.selection.clear(); this.query = next; this.emit(true);
    await this.load();
  }

  async transact(transaction: ServerSideTransaction<T>): Promise<void> {
    this.assertLive();
    const state = this.state(transaction.route);
    if (state.revision !== transaction.expectedRevision) throw new ServerSideVersionConflictError(transaction.expectedRevision, state.revision);
    if (!this.options.transact) throw new Error("[MachTable] A server-side transaction transport is required.");
    if (this.transactions.size >= boundedInteger(this.options.maxConcurrentRequests, 4, 16)) {
      throw new RangeError("[MachTable] Too many active server-side transactions.");
    }
    const controller = new AbortController();
    this.transactions.add(controller);
    const generation = this.generation;
    const routeGeneration = state.generation;
    try {
      const result = await withAbort(Promise.resolve().then(() => {
        if (controller.signal.aborted) throw aborted();
        return this.options.transact!({ ...transaction, route: [...state.route], query: this.query, signal: controller.signal });
      }), controller.signal);
      if (controller.signal.aborted || generation !== this.generation || routeGeneration !== state.generation) throw aborted();
      if (typeof result?.revision !== "string" || !result.revision || result.revision.length > 512) {
        throw new TypeError("[MachTable] Transaction transport must return the committed revision.");
      }
      // Parent aggregates depend on descendants; refresh every ancestor, then
      // reopen only the previously expanded paths through bounded request queues.
      await this.refresh([]);
    } finally { this.transactions.delete(controller); }
  }

  select(row: ServerSideProjection<T>, selected: boolean, mode: "self" | "descendants" = "descendants"): void {
    this.assertLive(); this.selection.select(row, selected, mode); this.emit();
  }
  getSelection(row: ServerSideProjection<T>): "selected" | "partial" | "none" { return this.selection.get(row); }
  clearSelection(): void { this.selection.clear(); this.emit(); }

  getSnapshot(): ServerSideSnapshot<T> {
    if (this.snapshot) return this.snapshot;
    const rows: ServerSideProjection<T>[] = [];
    const walk = (route: readonly string[]): void => {
      const state = this.routes.get(routeKey(route));
      const page = state?.active == null ? undefined : this.cache.peek(state.active)?.rows[0];
      if (!page) return;
      for (const row of page.rows) {
        const expanded = row.groupKey !== undefined && this.expanded.has(routeKey([...route, row.groupKey]));
        rows.push({ ...row, key: rowKey(route, row.id), route: [...route], depth: route.length, expanded });
        if (expanded) walk([...route, row.groupKey!]);
      }
    };
    walk([]);
    this.snapshot = { rows, routes: [...this.routes.values()].map(({ route, startRow, endRow, rowCount, revision, loading, error }) => ({
      route: [...route], startRow, endRow, rowCount, revision, loading, error
    })), selection: this.selection.snapshot(), query: normalizeQuery(this.query), revision: this.revision,
    cachedBlockCount: this.cache.snapshot().cachedBlockCount };
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void { this.assertLive(); this.listeners.add(listener); return () => this.listeners.delete(listener); }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.generation++;
    this.cache.purge();
    for (const controller of this.transactions) controller.abort();
    this.transactions.clear(); this.routes.clear(); this.blocks.clear(); this.indices.clear();
    this.expanded.clear(); this.selection.clear(); this.listeners.clear();
    this.snapshot = null;
  }
}

/** Hierarchical route paging, deliberately separate from the default row model. */
export function createServerSideStore<T>(options: ServerSideStoreOptions<T>): ServerSideStore<T> {
  return new RouteStore(options);
}
