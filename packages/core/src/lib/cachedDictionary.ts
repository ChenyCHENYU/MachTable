export type DictionaryKey = string | number;

export interface DictionaryEntry<TKey extends DictionaryKey = DictionaryKey> {
  value: TKey;
  label: string;
}

export interface CachedDictionaryOptions<TKey extends DictionaryKey = DictionaryKey> {
  load(keys: readonly TKey[], signal: AbortSignal): Promise<readonly DictionaryEntry<TKey>[]>;
  /** Positive values expire labels and missing keys; 0 caches until invalidation. */
  ttlMs?: number;
  /** LRU capacity shared by resolved labels and missing keys. */
  maxSize?: number;
  batchDelayMs?: number;
  onError?(error: unknown, keys: readonly TKey[]): void;
}

export interface CachedDictionary<TKey extends DictionaryKey = DictionaryKey> {
  get(key: TKey): string | undefined;
  resolve(key: TKey): Promise<string | undefined>;
  resolveMany(keys: readonly TKey[]): Promise<ReadonlyMap<TKey, string>>;
  /** Explicit entries supersede queued/in-flight work for the same keys. */
  prime(entries: readonly DictionaryEntry<TKey>[]): void;
  /** Evicts keys and settles their pending lookups with undefined; later resolves load anew. */
  invalidate(keys?: readonly TKey[]): void;
  destroy(): void;
  /** Cached labels and missing keys, bounded by maxSize. */
  readonly size: number;
}

interface CacheValue {
  label: string | undefined;
  expiresAt: number;
}

interface PendingLookup<TKey extends DictionaryKey> {
  id: string;
  key: TKey;
  promise: Promise<string | undefined>;
  resolve(value: string | undefined): void;
  reject(error: unknown): void;
  batch?: DictionaryBatch<TKey>;
}

interface DictionaryBatch<TKey extends DictionaryKey> {
  controller: AbortController;
  entries: PendingLookup<TKey>[];
  pendingCount: number;
}

function dictionaryId(key: DictionaryKey): string {
  return `${typeof key}:${String(key)}`;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Bounded TTL/LRU resolver; pending entry identity isolates invalidated generations. */
export function createCachedDictionary<TKey extends DictionaryKey = DictionaryKey>(
  options: CachedDictionaryOptions<TKey>
): CachedDictionary<TKey> {
  const ttlMs = Math.max(0, finiteOr(options.ttlMs, 5 * 60_000));
  const maxSize = Math.max(1, Math.floor(finiteOr(options.maxSize, 2_000)));
  const delay = Math.max(0, finiteOr(options.batchDelayMs, 0));
  const cache = new Map<string, CacheValue>();
  const pending = new Map<string, PendingLookup<TKey>>();
  const queued = new Map<string, PendingLookup<TKey>>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let activeBatch: DictionaryBatch<TKey> | null = null;
  let destroyed = false;

  const read = (id: string): CacheValue | undefined => {
    const hit = cache.get(id);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
      cache.delete(id);
      return undefined;
    }
    cache.delete(id);
    cache.set(id, hit);
    return hit;
  };
  const write = (id: string, label: string | undefined): void => {
    cache.delete(id);
    cache.set(id, { label, expiresAt: ttlMs === 0 ? Infinity : Date.now() + ttlMs });
    while (cache.size > maxSize) cache.delete(cache.keys().next().value!);
  };
  const owns = (entry: PendingLookup<TKey>): boolean => pending.get(entry.id) === entry;
  const finish = (entry: PendingLookup<TKey>, label: string | undefined, error?: { cause: unknown }): void => {
    if (!owns(entry)) return;
    pending.delete(entry.id);
    queued.delete(entry.id);
    if (entry.batch) entry.batch.pendingCount--;
    entry.batch = undefined;
    if (error) entry.reject(error.cause);
    else entry.resolve(label);
  };
  const schedule = (): void => {
    if (!destroyed && queued.size > 0 && timer == null && activeBatch == null) {
      timer = setTimeout(() => { void flush(); }, delay);
    }
  };
  const retireEmptyBatch = (): void => {
    if (activeBatch?.pendingCount === 0) {
      const retired = activeBatch;
      activeBatch = null;
      retired.controller.abort();
    }
    if (queued.size === 0 && timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    schedule();
  };
  const applyBatch = (batch: DictionaryBatch<TKey>, loaded: readonly DictionaryEntry<TKey>[]): void => {
    const requested = new Set(batch.entries.map(entry => entry.id));
    const labels = new Map<string, string>();
    // A loader may return extras, but they have no request ownership and cannot safely refill cache.
    for (const entry of loaded) {
      const id = dictionaryId(entry.value);
      if (requested.has(id)) labels.set(id, String(entry.label));
    }
    for (const entry of batch.entries) {
      if (!owns(entry)) continue;
      const label = labels.get(entry.id);
      write(entry.id, label);
      // Settle from the response, not cache: a small LRU may already have evicted an earlier key.
      finish(entry, label);
    }
  };
  const rejectBatch = (batch: DictionaryBatch<TKey>, error: unknown): void => {
    const keys: TKey[] = [];
    for (const entry of batch.entries) {
      if (!owns(entry)) continue;
      keys.push(entry.key);
      finish(entry, undefined, { cause: error });
    }
    if (keys.length === 0 || batch.controller.signal.aborted) return;
    try {
      // Observers run after every waiter settles; neither a throw nor a rejected Promise owns lookup state.
      void Promise.resolve(options.onError?.(error, keys)).catch(() => undefined);
    } catch { /* An error observer cannot replace the original lookup failure. */ }
  };
  const flush = async (): Promise<void> => {
    timer = null;
    if (destroyed || activeBatch || queued.size === 0) return;
    const entries = [...queued.values()];
    queued.clear();
    const batch: DictionaryBatch<TKey> = { entries, controller: new AbortController(), pendingCount: entries.length };
    for (const entry of entries) entry.batch = batch;
    activeBatch = batch;
    try {
      const loaded = await options.load(entries.map(entry => entry.key), batch.controller.signal);
      if (!destroyed && !batch.controller.signal.aborted) applyBatch(batch, loaded);
    } catch (error) {
      rejectBatch(batch, error);
    } finally {
      if (activeBatch === batch) activeBatch = null;
      schedule();
    }
  };
  const resolve = (key: TKey): Promise<string | undefined> => {
    if (destroyed) return Promise.reject(new Error("[MachTable] Dictionary resolver has been destroyed."));
    const id = dictionaryId(key);
    const cached = read(id);
    if (cached) return Promise.resolve(cached.label);
    const current = pending.get(id);
    if (current) return current.promise;
    let resolveValue!: PendingLookup<TKey>["resolve"];
    let reject!: PendingLookup<TKey>["reject"];
    const promise = new Promise<string | undefined>((done, fail) => { resolveValue = done; reject = fail; });
    const entry: PendingLookup<TKey> = { id, key, promise, resolve: resolveValue, reject };
    pending.set(id, entry);
    queued.set(id, entry);
    schedule();
    return promise;
  };

  return {
    get: key => read(dictionaryId(key))?.label,
    resolve,
    async resolveMany(keys) {
      const labels = await Promise.all(keys.map(async key => [key, await resolve(key)] as const));
      return new Map(labels.filter((entry): entry is readonly [TKey, string] => entry[1] !== undefined));
    },
    prime(entries) {
      if (destroyed) return;
      const labels = new Map<string, string>();
      for (const entry of entries) {
        const id = dictionaryId(entry.value);
        labels.delete(id);
        labels.set(id, String(entry.label));
      }
      for (const [id, label] of labels) {
        write(id, label);
        const entry = pending.get(id);
        if (entry) finish(entry, label);
      }
      retireEmptyBatch();
    },
    invalidate(keys) {
      if (keys) {
        for (const key of keys) {
          const id = dictionaryId(key);
          cache.delete(id);
          const entry = pending.get(id);
          if (entry) finish(entry, undefined);
        }
      } else {
        cache.clear();
        for (const entry of pending.values()) finish(entry, undefined);
      }
      retireEmptyBatch();
    },
    destroy() {
      destroyed = true;
      if (timer != null) clearTimeout(timer);
      timer = null;
      activeBatch?.controller.abort();
      activeBatch = null;
      const error = new Error("[MachTable] Dictionary resolver has been destroyed.");
      for (const entry of pending.values()) finish(entry, undefined, { cause: error });
      cache.clear();
    },
    get size() { return cache.size; }
  };
}
