import { describe, expect, it, vi } from "vitest";
import { createServerSideStore } from "../server-side/store";
import { ServerSideVersionConflictError } from "../server-side/types";
import type { ServerSideRequest, ServerSideResult, ServerSideStoreOptions } from "../server-side/types";
import { RemoteBlockCache } from "../services/remoteBlockCache";

interface Order { name: string; amount: number }
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function server(overrides: Partial<ServerSideStoreOptions<Order>> = {}) {
  let revision = 1;
  let increment = 0;
  const calls: ServerSideRequest[] = [];
  const result = (request: ServerSideRequest): ServerSideResult<Order> => {
    const rows = request.route.length ? Array.from({ length: 3 }, (_, index) => ({
      id: String(index + 1), data: { name: `${request.route[0]}-${index + 1}`, amount: (index + 1) * 10 + increment }
    })) : ["A", "B", "C"].map(groupKey => ({ id: groupKey, groupKey, childCount: 3,
      data: { name: groupKey, amount: 60 + increment * 3 }, aggValues: { amount: 60 + increment * 3 } }));
    return { rows: rows.slice(request.startRow, request.endRow), rowCount: rows.length, revision: String(revision) };
  };
  const store = createServerSideStore<Order>({ blockSize: 2, maxBlocks: 2, maxConcurrentRequests: 2, retryCount: 0,
    query: { rowGroupCols: [{ colId: "name" }], valueCols: [{ colId: "amount", aggFunc: "sum" }] },
    getRows: async request => { calls.push(request); return result(request); },
    transact: async transaction => {
      if (transaction.expectedRevision !== String(revision)) throw new ServerSideVersionConflictError(transaction.expectedRevision, String(revision));
      revision++; increment = 5;
      return { revision: String(revision) };
    }, ...overrides });
  return { store, calls, result };
}

describe("server-owned route paging", () => {
  it("projects expanded active pages and forwards grouping, aggregation and range intent", async () => {
    const { store, calls } = server();
    await store.load();
    expect(store.getSnapshot().rows.map(row => row.id)).toEqual(["A", "B"]);
    await store.expand(["A"]);
    expect(store.getSnapshot().rows.map(row => row.id)).toEqual(["A", "1", "2", "B"]);
    expect(store.getSnapshot().rows[0].aggValues?.amount).toBe(60);
    expect(calls[1]).toMatchObject({ route: ["A"], startRow: 0, endRow: 2,
      rowGroupCols: [{ colId: "name" }], valueCols: [{ colId: "amount", aggFunc: "sum" }] });
    await store.load(["A"], 2);
    expect(store.getSnapshot().rows.map(row => row.id)).toEqual(["A", "3", "B"]);
    expect(store.getSnapshot().routes.find(route => route.route[0] === "A")).toMatchObject({ startRow: 2, endRow: 3, rowCount: 3 });
    store.collapse(["A"]);
    expect(store.getSnapshot().rows.map(row => row.id)).toEqual(["A", "B"]);
    store.dispose();
  });

  it("keeps selection intent for unloaded descendants with explicit exclusions and partial parents", async () => {
    const { store } = server();
    await store.load(); await store.expand(["A"]);
    const group = store.getSnapshot().rows[0];
    store.select(group, true);
    await store.load(["A"], 2);
    const third = store.getSnapshot().rows[1];
    expect(store.getSelection(third)).toBe("selected");
    store.select(third, false);
    expect(store.getSelection(group)).toBe("partial");
    expect(store.getSnapshot().selection).toMatchObject({ selectedRoutes: [["A"]], excludedKeys: [third.key] });
    await store.load(["A"], 0);
    expect(store.getSelection(store.getSnapshot().rows[1])).toBe("selected");
    store.collapse(["A"]);
    expect(store.getSelection(store.getSnapshot().rows[0])).toBe("partial");
    store.clearSelection();
    expect(store.getSelection(group)).toBe("none");
    store.dispose();
  });

  it("keeps sibling IDs distinct and resets query-scoped selection and expansion", async () => {
    const { store } = server();
    await store.load(); await store.expand(["A"]); await store.expand(["B"]);
    const children = store.getSnapshot().rows.filter(row => row.id === "1");
    expect(children).toHaveLength(2);
    expect(children[0].key).not.toBe(children[1].key);
    store.select(children[0], true);
    await store.setQuery({ quickFilterText: "new" });
    expect(store.getSnapshot().selection.selectedKeys).toEqual([]);
    expect(store.getSnapshot().rows.every(row => !row.expanded)).toBe(true);
    expect(store.getSnapshot().query.quickFilterText).toBe("new");
    store.dispose();
  });

  it("cancels old-query work even when its transport ignores the signal", async () => {
    const old = deferred<ServerSideResult<Order>>();
    const signals: AbortSignal[] = [];
    const { store } = server({ getRows: async request => {
      signals.push(request.signal);
      if (!request.quickFilterText) return old.promise;
      return { rows: [{ id: "new", groupKey: "new", data: { name: "new", amount: 9 } }], rowCount: 1, revision: "new" };
    } });
    const first = store.load();
    await tick();
    await store.setQuery({ quickFilterText: "new" });
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(signals[0].aborted).toBe(true);
    old.resolve({ rows: [{ id: "old", groupKey: "old", data: { name: "old", amount: 1 } }], rowCount: 1, revision: "old" });
    await tick();
    expect(store.getSnapshot().rows.map(row => row.id)).toEqual(["new"]);
    store.dispose();
  });

  it("invalidates only the refreshed route, rejects its late page and keeps the parent cache", async () => {
    const delayed = deferred<ServerSideResult<Order>>();
    let hold = false;
    const base = server(); base.store.dispose();
    const { store } = server({ getRows: async request => hold && request.route[0] === "A" && request.startRow === 2
      ? delayed.promise : base.result(request) });
    await store.load(); await store.expand(["A"]);
    hold = true;
    const pending = store.load(["A"], 2);
    await tick();
    await store.refresh(["A"]);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    delayed.resolve({ rows: [{ id: "late", data: { name: "late", amount: 999 } }], rowCount: 3, revision: "late" });
    await tick();
    expect(store.getSnapshot().rows.map(row => row.id)).toEqual(["A", "1", "2", "B"]);
    expect(store.getSnapshot().cachedBlockCount).toBe(2);
    store.dispose();
  });

  it("refreshes parent aggregates after an authoritative CAS transaction", async () => {
    const { store, calls } = server();
    await store.load(); await store.expand(["A"]);
    const group = store.getSnapshot().rows[0]; store.select(group, true);
    await expect(store.transact({ route: ["A"], expectedRevision: "obsolete", remove: ["1"] })).rejects.toBeInstanceOf(ServerSideVersionConflictError);
    await store.transact({ route: ["A"], expectedRevision: "1", update: [{ id: "1", data: { name: "A-1", amount: 15 } }] });
    expect(store.getSnapshot().rows[0].aggValues?.amount).toBe(75);
    expect(store.getSnapshot().rows[1].data.amount).toBe(15);
    expect(store.getSelection(store.getSnapshot().rows[1])).toBe("selected");
    expect(calls.slice(-2).map(call => call.route)).toEqual([[], ["A"]]);
    store.dispose();
  });

  it("reports load failures and supports retry with bounded cache and route metadata", async () => {
    const error = vi.fn(); let fail = true;
    const base = server(); base.store.dispose();
    const { store } = server({ onError: error, getRows: async request => {
      if (fail) throw new Error("offline"); return base.result(request);
    } });
    await expect(store.load()).rejects.toThrow("offline");
    expect(store.getSnapshot().routes[0].error).toBeInstanceOf(Error);
    fail = false; await store.refresh();
    expect(store.getSnapshot().rows).toHaveLength(2);
    for (let index = 0; index < 270; index++) await store.load([String(index)]);
    expect(store.getSnapshot().routes.length).toBeLessThanOrEqual(256);
    expect(store.getSnapshot().cachedBlockCount).toBeLessThanOrEqual(2);
    expect(error).toHaveBeenCalledOnce();
    store.dispose();
  });

  it("shows the latest page intent when an older response arrives later", async () => {
    const delayed = deferred<ServerSideResult<Order>>();
    const base = server(); base.store.dispose();
    const { store } = server({ getRows: async request => request.route[0] === "A" && request.startRow === 0
      ? delayed.promise : base.result(request) });
    await store.load();
    const first = store.expand(["A"]); await tick();
    await store.load(["A"], 2);
    expect(store.getSnapshot().rows[1].id).toBe("3");
    delayed.resolve({ rows: [{ id: "1", data: { name: "old page", amount: 1 } }], rowCount: 3, revision: "1" });
    await first;
    expect(store.getSnapshot().rows[1].id).toBe("3");
    store.dispose();
  });

  it("restores nested expansion after a root refresh and bounds request concurrency", async () => {
    let active = 0; let peak = 0;
    const { store } = server({ query: { rowGroupCols: [{ colId: "region" }, { colId: "team" }] },
      getRows: async request => {
        active++; peak = Math.max(peak, active);
        await tick(); active--;
        const group = request.route.length < 2;
        return { rows: [{ id: "same", data: { name: "same", amount: 1 }, ...(group ? { groupKey: "same" } : {}) }], rowCount: 1, revision: "1" };
      } });
    await store.load(); await store.expand(["same"]); await store.expand(["same", "same"]);
    expect(store.getSnapshot().rows).toHaveLength(3);
    await store.refresh();
    expect(store.getSnapshot().rows).toHaveLength(3);
    await Promise.all(["a", "b", "c", "d", "e"].map(group => store.load([group])));
    expect(peak).toBeLessThanOrEqual(2);
    store.dispose();
  });

  it("cancels pending transaction waiters on disposal without leaking a late result", async () => {
    const transaction = deferred<{ revision: string }>();
    const { store } = server({ transact: () => transaction.promise });
    await store.load();
    const pending = store.transact({ route: [], expectedRevision: "1", remove: ["A"] });
    await tick(); store.dispose();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    transaction.resolve({ revision: "2" }); await tick();
    expect(store.getSnapshot().rows).toEqual([]);
  });

  it("retries transient loads and clamps a page after the sibling count shrinks", async () => {
    let calls = 0;
    const { store } = server({ retryCount: 1, retryDelay: 0, getRows: async request => {
      calls++;
      if (calls === 1) throw new Error("transient");
      return { rows: request.startRow === 0 ? [{ id: "A", groupKey: "A", data: { name: "A", amount: 1 } }] : [],
        rowCount: 1, revision: "1" };
    } });
    await store.load([], 20);
    expect(calls).toBe(3);
    expect(store.getSnapshot().routes[0]).toMatchObject({ startRow: 0, endRow: 1, rowCount: 1 });
    expect(store.getSnapshot().rows[0].id).toBe("A");
    store.dispose();
  });
});

describe("route block invalidation", () => {
  it("aborts active and queued entries without invalidating other blocks or reattaching a late same-index result", async () => {
    const cache = new RemoteBlockCache<number>(4, undefined, 1);
    await cache.load(9, async () => ({ rows: [9] }));
    const slow = deferred<{ rows: number[] }>();
    const active = cache.load(0, () => slow.promise);
    const queuedLoader = vi.fn(async () => ({ rows: [1] }));
    const queued = cache.load(1, queuedLoader);
    await tick();
    cache.invalidate(0); cache.invalidate(1);
    await expect(active).rejects.toMatchObject({ name: "AbortError" });
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    expect(queuedLoader).not.toHaveBeenCalled();
    await cache.load(0, async () => ({ rows: [100] }));
    slow.resolve({ rows: [0] }); await tick();
    expect(cache.peek(0)?.rows).toEqual([100]);
    expect(cache.peek(9)?.rows).toEqual([9]);
    cache.purge();
  });
});
