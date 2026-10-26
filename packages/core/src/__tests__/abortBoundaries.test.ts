// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { GridCore } from "../core/gridCore";
import { RemoteBlockCache } from "../services/remoteBlockCache";
import { abortable, createAbortError } from "../lib/abortable";
import { withAbort as serverWait } from "../server-side/protocol";
import { createWorkerDataProcessor, processFieldDataRequest } from "../worker";

const grids: GridCore[] = [];
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
afterEach(() => { grids.splice(0).forEach(grid => grid.destroy()); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("cancellation observation boundaries", () => {
  it("observes an existing task even when its signal is aborted synchronously before GridApi wraps it", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    const core = new GridCore(host, {}); grids.push(core);
    const late = deferred<void>(), controller = new AbortController(), reason = new Error("cancelled during request setup");
    const observed = vi.spyOn(late.promise, "then");
    // A spy on the method would itself observe returned promises and mask the bug.
    core.rowModel.ensureRowsLoaded = () => { controller.abort(reason); return late.promise; };
    await expect(core.api.rows.ensureLoaded(0, 1, { signal: controller.signal })).rejects.toBe(reason);
    try {
      expect(observed).toHaveBeenCalledWith(expect.any(Function), expect.any(Function));
    } finally {
      // The observer assertion makes the old implementation fail without leaking
      // its deliberate late rejection into Vitest's own unhandled-error channel.
      void late.promise.catch(() => undefined);
      late.reject(new Error("transport rejected after cancellation"));
      await Promise.resolve();
    }
  });

  it("does not start a block loader cancelled in the microtask gap after scheduling", async () => {
    const cache = new RemoteBlockCache<number>(1);
    const controller = new AbortController(), reason = new Error("cancel before transport starts");
    const loader = vi.fn(async () => ({ rows: [1] }));
    const pending = cache.load(0, loader, controller.signal);
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(loader).not.toHaveBeenCalled();
    expect(cache.snapshot().activeRequestCount).toBe(0);
  });

  it("releases a cancelled waiter's listener before an ignored transport eventually rejects", async () => {
    const late = deferred<number>(), controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const result = abortable(late.promise, controller.signal);
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    late.reject(new Error("late failure"));
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  it("preserves each owner's historical reason policy and fallback message", async () => {
    const reason = new Error("business failure must not replace fixed cancellation semantics");
    const controller = new AbortController(); controller.abort(reason);
    await expect(abortable(Promise.resolve(1), controller.signal)).rejects.toMatchObject({ name: "AbortError", message: "[MachTable] Operation cancelled." });
    await expect(serverWait(Promise.resolve(1), controller.signal)).rejects.toMatchObject({ name: "AbortError", message: "[MachTable] Server-side operation cancelled or replaced." });
    expect(createAbortError(reason, "fallback")).toBe(reason);
    expect(createAbortError("cancel reason", "fallback")).toMatchObject({ name: "AbortError", message: "cancel reason" });
    expect(createAbortError({}, "fallback")).toMatchObject({ name: "AbortError", message: "fallback" });
    const createWorker = vi.fn<() => Worker>();
    const processor = createWorkerDataProcessor(createWorker);
    await expect(processor.process({ rows: [], columns: [], sortModel: [], filterModel: {}, advancedFilterModel: null, quickFilterText: null, signal: controller.signal })).rejects.toBe(reason);
    expect(createWorker).not.toHaveBeenCalled();
    processor.destroy?.();
    await expect(processFieldDataRequest({ rows: [{ id: "a", data: {} }], columns: [], sortModel: [], filterModel: {}, advancedFilterModel: null, quickFilterText: null }, { isCancelled: () => true }))
      .rejects.toMatchObject({ name: "AbortError", message: "Data processing aborted" });
  });

  it("observes a reentrant loader rejection after cancellation and frees the next queue slot", async () => {
    const cache = new RemoteBlockCache<number>(1, undefined, 1), controller = new AbortController();
    const reason = new Error("cancel from loader");
    const first = cache.load(0, () => { controller.abort(reason); return Promise.reject(new Error("late transport failure")); }, controller.signal);
    const next = cache.load(1, async () => ({ rows: [2] }));
    await expect(first).rejects.toBe(reason);
    await expect(next).resolves.toEqual({ rows: [2] });
    expect(cache.snapshot().queuedRequestCount).toBe(0);
  });
});
