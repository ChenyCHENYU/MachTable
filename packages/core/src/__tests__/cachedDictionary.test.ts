import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCachedDictionary, type CachedDictionary, type CachedDictionaryOptions, type DictionaryEntry, type DictionaryKey } from "../lib/businessColumns";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function controlledLoader<TKey extends DictionaryKey = string>() {
  const requests: Array<ReturnType<typeof deferred<readonly DictionaryEntry<TKey>[]>> & { keys: readonly TKey[]; signal: AbortSignal }> = [];
  const load = vi.fn((keys: readonly TKey[], signal: AbortSignal) => {
    const result = deferred<readonly DictionaryEntry<TKey>[]>();
    requests.push({ ...result, keys: [...keys], signal });
    return result.promise;
  });
  return { requests, load };
}

const dictionaries: CachedDictionary<any>[] = [];
function create<TKey extends DictionaryKey = string>(options: CachedDictionaryOptions<TKey>): CachedDictionary<TKey> {
  const dictionary = createCachedDictionary(options);
  dictionaries.push(dictionary);
  return dictionary;
}
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const dictionary of dictionaries.splice(0)) dictionary.destroy();
  vi.useRealTimers();
});

describe("cached dictionary request ownership", () => {
  it("shares the same pending lookup before and during a load, then batches new keys once", async () => {
    const { load, requests } = controlledLoader();
    const dictionary = create({ load });
    const first = dictionary.resolve("A");
    expect(dictionary.resolve("A")).toBe(first);
    await flush();
    expect(dictionary.resolve("A")).toBe(first);
    const next = dictionary.resolve("B");
    expect(dictionary.resolve("B")).toBe(next);
    requests[0].resolve([{ value: "A", label: "Alpha" }]);
    expect(await first).toBe("Alpha");
    await flush();
    expect(requests.map(request => request.keys)).toEqual([["A"], ["B"]]);
    requests[1].resolve([{ value: "B", label: "Beta" }]);
    expect(await next).toBe("Beta");
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("invalidates one key without dropping other keys from its active batch", async () => {
    const { load, requests } = controlledLoader();
    const dictionary = create({ load });
    const first = dictionary.resolve("A");
    const other = dictionary.resolve("B");
    await flush();
    dictionary.invalidate(["A"]);
    expect(await first).toBeUndefined();
    expect(requests[0].signal.aborted).toBe(false);
    dictionary.prime([{ value: "A", label: "new-scope" }]);
    expect(await dictionary.resolve("A")).toBe("new-scope");
    requests[0].resolve([{ value: "A", label: "old-scope" }, { value: "B", label: "Beta" }]);
    expect(await other).toBe("Beta");
    expect(dictionary.get("A")).toBe("new-scope");
    expect(dictionary.get("B")).toBe("Beta");
  });

  it("starts a fresh batch after full invalidation and ignores a late response in reverse order", async () => {
    const { load, requests } = controlledLoader();
    const dictionary = create({ load });
    const old = dictionary.resolveMany(["A", "B"]);
    await flush();
    dictionary.invalidate();
    expect(await old).toEqual(new Map());
    expect(requests[0].signal.aborted).toBe(true);
    const next = dictionary.resolveMany(["A", "B"]);
    await flush();
    expect(requests).toHaveLength(2);
    requests[1].resolve([{ value: "A", label: "new-A" }, { value: "B", label: "new-B" }]);
    expect(await next).toEqual(new Map([["A", "new-A"], ["B", "new-B"]]));
    requests[0].resolve([{ value: "A", label: "old-A" }, { value: "B", label: "old-B" }]);
    await flush();
    expect(dictionary.get("A")).toBe("new-A");
    expect(dictionary.get("B")).toBe("new-B");
  });

  it("does not reject a new generation when the invalidated loader fails late", async () => {
    const { load, requests } = controlledLoader();
    const onError = vi.fn();
    const dictionary = create({ load, onError });
    const old = dictionary.resolve("A");
    await flush();
    dictionary.invalidate(["A"]);
    expect(await old).toBeUndefined();
    const next = dictionary.resolve("A");
    await flush();
    requests[0].reject(new Error("old scope failed"));
    await flush();
    expect(onError).not.toHaveBeenCalled();
    requests[1].resolve([{ value: "A", label: "current" }]);
    expect(await next).toBe("current");
  });

  it("only rejects still-owned keys when part of a failed batch was invalidated", async () => {
    const { load, requests } = controlledLoader();
    const onError = vi.fn();
    const dictionary = create({ load, onError });
    const a = dictionary.resolve("A");
    const b = dictionary.resolve("B");
    const results = Promise.allSettled([a, b]);
    await flush();
    dictionary.invalidate(["A"]);
    const nextA = dictionary.resolve("A");
    const failure = new Error("failed");
    requests[0].reject(failure);
    expect(await results).toEqual([{ status: "fulfilled", value: undefined }, { status: "rejected", reason: failure }]);
    expect(onError).toHaveBeenCalledWith(failure, ["B"]);
    await flush();
    expect(requests[1].keys).toEqual(["A"]);
    requests[1].resolve([{ value: "A", label: "fresh" }]);
    expect(await nextA).toBe("fresh");
  });

  it("removes invalidated queued keys before a batch starts", async () => {
    const { load, requests } = controlledLoader();
    const dictionary = create({ load, batchDelayMs: 20 });
    const a = dictionary.resolve("A");
    const b = dictionary.resolve("B");
    dictionary.invalidate(["A"]);
    expect(await a).toBeUndefined();
    await vi.advanceTimersByTimeAsync(20);
    expect(requests[0].keys).toEqual(["B"]);
    requests[0].resolve([{ value: "B", label: "Beta" }]);
    expect(await b).toBe("Beta");
  });

  it("lets explicit prime settle queued and active lookups without stale overwrites", async () => {
    const { load, requests } = controlledLoader();
    const dictionary = create({ load });
    const queued = dictionary.resolve("A");
    dictionary.prime([{ value: "A", label: "" }]);
    expect(await queued).toBe("");
    expect(await dictionary.resolve("A")).toBe("");
    await flush();
    expect(load).not.toHaveBeenCalled();
    const b = dictionary.resolve("B");
    const c = dictionary.resolve("C");
    await flush();
    dictionary.prime([{ value: "B", label: "fresh-B" }]);
    expect(await b).toBe("fresh-B");
    expect(requests[0].signal.aborted).toBe(false);
    requests[0].resolve([{ value: "B", label: "old-B" }, { value: "C", label: "Gamma" }]);
    expect(await c).toBe("Gamma");
    expect(dictionary.get("B")).toBe("fresh-B");
  });

  it("uses the last explicit duplicate label and touch order when priming a bounded cache", async () => {
    const dictionary = create({ load: async () => [], maxSize: 1 });
    const pending = dictionary.resolve("A");
    dictionary.prime([{ value: "A", label: "old" }, { value: "B", label: "Beta" }, { value: "A", label: "new" }]);
    expect(await pending).toBe("new");
    expect(dictionary.get("A")).toBe("new");
    expect(dictionary.get("B")).toBeUndefined();
    expect(dictionary.size).toBe(1);
  });

  it("does not cache extra entries with no request ownership", async () => {
    const { load, requests } = controlledLoader();
    const dictionary = create({ load });
    const a = dictionary.resolve("A");
    await flush();
    dictionary.invalidate(["Z"]);
    requests[0].resolve([{ value: "A", label: "Alpha" }, { value: "Z", label: "stale-extra" }]);
    expect(await a).toBe("Alpha");
    expect(dictionary.get("Z")).toBeUndefined();
    expect(dictionary.size).toBe(1);
  });
});

describe("cached dictionary capacity, missing values and failures", () => {
  it("caches successful missing keys for the TTL and refetches after expiry or invalidation", async () => {
    const load = vi.fn(async () => []);
    const dictionary = create({ load, ttlMs: 10 });
    const first = dictionary.resolve("unknown");
    await flush();
    expect(await first).toBeUndefined();
    expect(dictionary.size).toBe(1);
    expect(await dictionary.resolve("unknown")).toBeUndefined();
    expect(await dictionary.resolveMany(["unknown", "unknown"])).toEqual(new Map());
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10);
    const expired = dictionary.resolve("unknown");
    await flush();
    expect(await expired).toBeUndefined();
    expect(load).toHaveBeenCalledTimes(2);
    dictionary.invalidate(["unknown"]);
    const invalidated = dictionary.resolve("unknown");
    await flush();
    expect(await invalidated).toBeUndefined();
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("settles every batch value even when the batch exceeds LRU capacity", async () => {
    const load = vi.fn(async (keys: readonly string[]) => keys.map(value => ({ value, label: value.toLowerCase() })));
    const dictionary = create({ load, maxSize: 1 });
    const values = dictionary.resolveMany(["A", "B", "C"]);
    await flush();
    expect(await values).toEqual(new Map([["A", "a"], ["B", "b"], ["C", "c"]]));
    expect(dictionary.size).toBe(1);
    expect(dictionary.get("A")).toBeUndefined();
    expect(dictionary.get("C")).toBe("c");
  });

  it("keeps typed keys distinct and applies one LRU bound to labels and missing keys", async () => {
    const load = vi.fn(async (keys: readonly DictionaryKey[]) => keys
      .filter(value => value !== "missing")
      .map(value => ({ value, label: `${typeof value}:${value}` })));
    const dictionary = create<DictionaryKey>({ load, maxSize: 2, ttlMs: 0 });
    const pair = dictionary.resolveMany([1, "1"]);
    await flush();
    expect(await pair).toEqual(new Map<DictionaryKey, string>([[1, "number:1"], ["1", "string:1"]]));
    expect(dictionary.get(1)).toBe("number:1");
    const missing = dictionary.resolve("missing");
    await flush();
    expect(await missing).toBeUndefined();
    expect(dictionary.size).toBe(2);
    expect(dictionary.get("1")).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1_000_000);
    expect(await dictionary.resolve(1)).toBe("number:1");
    expect(await dictionary.resolve("missing")).toBeUndefined();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("rejects all failed waiters before a throwing error observer and allows retry", async () => {
    const failure = new Error("lookup failed");
    const load = vi.fn<(keys: readonly string[], signal: AbortSignal) => Promise<readonly DictionaryEntry[]>>()
      .mockImplementationOnce(() => { throw failure; })
      .mockImplementationOnce(async keys => keys.map(value => ({ value, label: "retried" })));
    const onError = vi.fn(() => { throw new Error("observer failed"); });
    const dictionary = create({ load, onError });
    const first = dictionary.resolve("A");
    const repeated = dictionary.resolve("A");
    const second = dictionary.resolve("B");
    const results = Promise.allSettled([first, repeated, second]);
    await flush();
    expect(await results).toEqual(Array.from({ length: 3 }, () => ({ status: "rejected", reason: failure })));
    expect(dictionary.size).toBe(0);
    expect(onError).toHaveBeenCalledWith(failure, ["A", "B"]);
    const retry = dictionary.resolveMany(["A", "B"]);
    await flush();
    expect(await retry).toEqual(new Map([["A", "retried"], ["B", "retried"]]));
  });

  it("contains rejected observer promises and permits a retry requested inside the observer", async () => {
    const failure = new Error("lookup failed");
    const load = vi.fn<(keys: readonly string[], signal: AbortSignal) => Promise<readonly DictionaryEntry[]>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce([{ value: "A", label: "retry" }]);
    let retry: Promise<string | undefined> | undefined;
    const dictionary = create({ load, onError: async () => {
      retry = dictionary.resolve("A");
      throw new Error("async observer failed");
    } });
    const first = dictionary.resolve("A");
    const result = Promise.allSettled([first]);
    await flush();
    expect(await result).toEqual([{ status: "rejected", reason: failure }]);
    await flush();
    await vi.runAllTimersAsync();
    expect(await retry).toBe("retry");
  });

  it("destroys queued and active lookups, aborts loading and ignores late values or prime", async () => {
    const { load, requests } = controlledLoader();
    const dictionary = create({ load });
    const a = dictionary.resolve("A");
    await flush();
    const b = dictionary.resolve("B");
    const results = Promise.allSettled([a, b]);
    dictionary.destroy();
    dictionary.destroy();
    expect(requests[0].signal.aborted).toBe(true);
    const settled = await results;
    expect(settled).toHaveLength(2);
    for (const result of settled) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") expect(String(result.reason)).toContain("destroyed");
    }
    requests[0].resolve([{ value: "A", label: "late" }]);
    dictionary.prime([{ value: "B", label: "resurrected" }]);
    await flush();
    expect(dictionary.size).toBe(0);
    expect(load).toHaveBeenCalledTimes(1);
    await expect(dictionary.resolve("B")).rejects.toThrow("destroyed");
  });

  it("cancels the timer on destroy before any loader starts", async () => {
    const load = vi.fn(async () => []);
    const dictionary = create({ load });
    const result = Promise.allSettled([dictionary.resolve("A")]);
    dictionary.destroy();
    await flush();
    expect((await result)[0].status).toBe("rejected");
    expect(load).not.toHaveBeenCalled();
  });
});
