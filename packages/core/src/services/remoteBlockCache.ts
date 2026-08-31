import type { RemoteBlockCacheSnapshot } from "../types/api";

export interface RemoteBlockResult<TData> {
  rows: readonly TData[];
  lastRow?: number;
}

interface RemoteBlockEntry<TData> extends RemoteBlockResult<TData> {
  touchedAt: number;
}

type BlockLoader<TData> = (signal: AbortSignal) => Promise<RemoteBlockResult<TData>>;

interface InflightBlock<TData> {
  controller: AbortController;
  promise: Promise<RemoteBlockResult<TData>>;
  consumers: number;
  loader: BlockLoader<TData>;
  priority: number;
  state: "queued" | "active";
  resolve: (result: RemoteBlockResult<TData>) => void;
  reject: (reason: unknown) => void;
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error(typeof signal.reason === "string" ? signal.reason : "Block request aborted");
  error.name = "AbortError";
  return error;
}

function normalizeBlockLimit(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : 1;
}

/** Request-deduplicating LRU cache used by the random-access datasource row model. */
export class RemoteBlockCache<TData> {
  private blocks = new Map<number, RemoteBlockEntry<TData>>();
  private inflight = new Map<number, InflightBlock<TData>>();
  private clock = 0;
  private generation = 0;
  private hitCount = 0;
  private missCount = 0;
  private evictionCount = 0;
  private activeRequests = 0;

  constructor(
    private maxBlocks: number,
    private readonly onEvict?: (blockIndex: number, block: RemoteBlockResult<TData>) => void,
    private maxConcurrentRequests = 4
  ) {
    this.maxBlocks = normalizeBlockLimit(maxBlocks);
    this.maxConcurrentRequests = normalizeBlockLimit(maxConcurrentRequests);
  }

  configure(maxBlocks: number, maxConcurrentRequests = this.maxConcurrentRequests): void {
    this.maxBlocks = normalizeBlockLimit(maxBlocks);
    this.maxConcurrentRequests = normalizeBlockLimit(maxConcurrentRequests);
    this.evictOverflow();
    this.drainQueue();
  }

  peek(blockIndex: number): RemoteBlockResult<TData> | undefined {
    const entry = this.blocks.get(blockIndex);
    if (!entry) return undefined;
    entry.touchedAt = ++this.clock;
    return entry;
  }

  has(blockIndex: number): boolean {
    return this.blocks.has(blockIndex);
  }

  load(
    blockIndex: number,
    loader: BlockLoader<TData>,
    signal?: AbortSignal,
    priority = 0
  ): Promise<RemoteBlockResult<TData>> {
    if (signal?.aborted) return Promise.reject(abortError(signal));
    const existing = this.peek(blockIndex);
    if (existing) {
      this.hitCount++;
      return Promise.resolve(existing);
    }
    const pending = this.inflight.get(blockIndex);
    if (pending) {
      this.hitCount++;
      pending.priority = Math.max(pending.priority, priority);
      this.drainQueue();
      return this.attachConsumer(blockIndex, pending, signal);
    }
    this.missCount++;
    const controller = new AbortController();
    let resolveRequest!: (result: RemoteBlockResult<TData>) => void;
    let rejectRequest!: (reason: unknown) => void;
    const promise = new Promise<RemoteBlockResult<TData>>((resolve, reject) => {
      resolveRequest = resolve;
      rejectRequest = reject;
    });
    const entry: InflightBlock<TData> = {
      controller,
      promise,
      consumers: 0,
      loader,
      priority,
      state: "queued",
      resolve: resolveRequest,
      reject: rejectRequest
    };
    this.inflight.set(blockIndex, entry);
    const consumer = this.attachConsumer(blockIndex, entry, signal);
    this.drainQueue();
    return consumer;
  }

  purge(): void {
    this.generation++;
    for (const request of this.inflight.values()) {
      request.controller.abort();
      if (request.state === "queued") request.reject(abortError(request.controller.signal));
    }
    this.inflight.clear();
    for (const [index, block] of this.blocks) this.onEvict?.(index, block);
    this.blocks.clear();
  }

  snapshot(): RemoteBlockCacheSnapshot {
    let cachedRowCount = 0;
    let activeRequestCount = 0;
    for (const block of this.blocks.values()) cachedRowCount += block.rows.length;
    for (const request of this.inflight.values()) {
      if (request.state === "active") activeRequestCount++;
    }
    return {
      cachedBlockCount: this.blocks.size,
      loadingBlockCount: this.inflight.size,
      activeRequestCount,
      queuedRequestCount: Math.max(0, this.inflight.size - activeRequestCount),
      cachedRowCount,
      hitCount: this.hitCount,
      missCount: this.missCount,
      evictionCount: this.evictionCount
    };
  }

  private drainQueue(): void {
    while (this.activeRequests < this.maxConcurrentRequests) {
      let selectedIndex: number | undefined;
      let selected: InflightBlock<TData> | undefined;
      for (const [blockIndex, entry] of this.inflight) {
        if (entry.state !== "queued" || entry.controller.signal.aborted) continue;
        if (!selected || entry.priority > selected.priority) {
          selectedIndex = blockIndex;
          selected = entry;
        }
      }
      if (selectedIndex == null || !selected) return;
      this.startEntry(selectedIndex, selected);
    }
  }

  private startEntry(blockIndex: number, entry: InflightBlock<TData>): void {
    entry.state = "active";
    this.activeRequests++;
    const generation = this.generation;
    void this.runLoader(entry).then((result) => {
      if (generation === this.generation && !entry.controller.signal.aborted) {
        this.blocks.set(blockIndex, {
          rows: result.rows,
          ...(result.lastRow == null ? {} : { lastRow: result.lastRow }),
          touchedAt: ++this.clock
        });
        this.evictOverflow();
      }
      entry.resolve(result);
    }, entry.reject).finally(() => {
      this.activeRequests = Math.max(0, this.activeRequests - 1);
      if (this.inflight.get(blockIndex) === entry) this.inflight.delete(blockIndex);
      this.drainQueue();
    });
  }

  private runLoader(entry: InflightBlock<TData>): Promise<RemoteBlockResult<TData>> {
    const { signal } = entry.controller;
    if (signal.aborted) return Promise.reject(abortError(signal));
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(abortError(signal));
      signal.addEventListener("abort", onAbort, { once: true });
      void Promise.resolve().then(() => entry.loader(signal)).then(resolve, reject).finally(() => {
        signal.removeEventListener("abort", onAbort);
      });
    });
  }

  private attachConsumer(
    blockIndex: number,
    entry: InflightBlock<TData>,
    signal?: AbortSignal
  ): Promise<RemoteBlockResult<TData>> {
    entry.consumers++;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        entry.consumers = Math.max(0, entry.consumers - 1);
        callback();
      };
      const onAbort = () => finish(() => {
        if (entry.consumers === 0 && this.inflight.get(blockIndex) === entry) {
          this.inflight.delete(blockIndex);
          entry.controller.abort(signal?.reason);
          if (entry.state === "queued") entry.reject(abortError(entry.controller.signal));
        }
        reject(abortError(signal!));
      });
      signal?.addEventListener("abort", onAbort, { once: true });
      void entry.promise.then(
        (result) => finish(() => resolve(result)),
        (reason) => finish(() => reject(
          reason instanceof Error ? reason : new Error(String(reason ?? "Block request failed"))
        ))
      );
    });
  }

  private evictOverflow(): void {
    while (this.blocks.size > this.maxBlocks) {
      let oldestIndex = -1;
      let oldestTime = Number.POSITIVE_INFINITY;
      for (const [index, entry] of this.blocks) {
        if (entry.touchedAt < oldestTime) {
          oldestIndex = index;
          oldestTime = entry.touchedAt;
        }
      }
      if (oldestIndex < 0) return;
      const evicted = this.blocks.get(oldestIndex);
      this.blocks.delete(oldestIndex);
      this.evictionCount++;
      if (evicted) this.onEvict?.(oldestIndex, evicted);
    }
  }
}
