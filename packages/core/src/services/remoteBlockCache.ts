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

  constructor(
    private maxBlocks: number,
    private readonly onEvict?: (blockIndex: number, block: RemoteBlockResult<TData>) => void
  ) {
    this.maxBlocks = normalizeBlockLimit(maxBlocks);
  }

  configure(maxBlocks: number): void {
    this.maxBlocks = normalizeBlockLimit(maxBlocks);
    this.evictOverflow();
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
    signal?: AbortSignal
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
      return this.attachConsumer(blockIndex, pending, signal);
    }
    this.missCount++;
    const generation = this.generation;
    const controller = new AbortController();
    const promise = Promise.resolve().then(() => loader(controller.signal)).then((result) => {
      if (generation !== this.generation || controller.signal.aborted) return result;
      this.blocks.set(blockIndex, {
        rows: result.rows,
        ...(result.lastRow == null ? {} : { lastRow: result.lastRow }),
        touchedAt: ++this.clock
      });
      this.evictOverflow();
      return result;
    }).finally(() => {
      if (this.inflight.get(blockIndex)?.promise === promise) this.inflight.delete(blockIndex);
    });
    const entry = { controller, promise, consumers: 0 };
    this.inflight.set(blockIndex, entry);
    return this.attachConsumer(blockIndex, entry, signal);
  }

  purge(): void {
    this.generation++;
    for (const request of this.inflight.values()) request.controller.abort();
    this.inflight.clear();
    for (const [index, block] of this.blocks) this.onEvict?.(index, block);
    this.blocks.clear();
  }

  snapshot(): RemoteBlockCacheSnapshot {
    let cachedRowCount = 0;
    for (const block of this.blocks.values()) cachedRowCount += block.rows.length;
    return {
      cachedBlockCount: this.blocks.size,
      loadingBlockCount: this.inflight.size,
      cachedRowCount,
      hitCount: this.hitCount,
      missCount: this.missCount,
      evictionCount: this.evictionCount
    };
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
