import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWorkerDataProcessor,
  installGridDataWorker,
  type GridDataProcessorPayload,
  type GridDataProcessorRequest,
  type GridDataWorkerScope,
  type GridWorkerProcessMessage,
  type GridWorkerRequestMessage,
  type GridWorkerResponseMessage
} from "../worker";

class FakeWorker extends EventTarget {
  messages: GridWorkerRequestMessage[] = [];
  terminate = vi.fn();
  failCancellation = false;

  postMessage(message: GridWorkerRequestMessage): void {
    if (this.failCancellation && message.type === "mach-table:cancel") throw new Error("Worker unavailable");
    this.messages.push(message);
  }

  get requests(): GridWorkerProcessMessage[] {
    return this.messages.filter(message => message.type === "mach-table:process");
  }

  reply(message: GridWorkerResponseMessage): void {
    this.dispatchEvent(new MessageEvent("message", { data: message }));
  }
}

const payload: GridDataProcessorPayload = {
  rows: [{ id: "a", data: { amount: 2 } }, { id: "b", data: { amount: 1 } }],
  columns: [{ colId: "amount", field: "amount" }],
  sortModel: [],
  filterModel: {},
  advancedFilterModel: null,
  quickFilterText: null
};

function request(signal = new AbortController().signal): GridDataProcessorRequest {
  return { ...payload, signal };
}

function workerProcessor(worker: FakeWorker, terminateOnDestroy = false) {
  return createWorkerDataProcessor(() => worker as unknown as Worker, { terminateOnDestroy });
}

function installWorker() {
  let listener!: (event: MessageEvent<GridWorkerRequestMessage>) => void;
  const responses: GridWorkerResponseMessage[] = [];
  const scope: GridDataWorkerScope = {
    addEventListener: (_type, next) => { listener = next; },
    postMessage: message => { responses.push(message); }
  };
  installGridDataWorker(scope);
  return {
    responses,
    send: (message: GridWorkerRequestMessage) => listener(new MessageEvent("message", { data: message }))
  };
}

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

afterEach(() => { vi.useRealTimers(); });

describe("Worker request ownership", () => {
  it("keeps old results separate when the host reuses a retained Worker", async () => {
    const worker = new FakeWorker();
    const previous = workerProcessor(worker);
    const oldRequest = previous.process(request()).catch((error: unknown) => error);
    const oldId = worker.requests[0].requestId;
    previous.destroy?.();
    expect(await oldRequest).toMatchObject({ name: "AbortError" });

    const current = workerProcessor(worker);
    let settled = false;
    const currentRequest = current.process(request()).then(result => { settled = true; return result; });
    const currentId = worker.requests[1].requestId;
    expect(currentId).not.toBe(oldId);
    worker.reply({ type: "mach-table:result", requestId: oldId, rowIds: ["b", "a"] });
    await flush();
    expect(settled).toBe(false);
    worker.reply({ type: "mach-table:result", requestId: currentId, rowIds: ["a", "b"] });
    await expect(currentRequest).resolves.toEqual({ rowIds: ["a", "b"] });
    current.destroy?.();
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it("isolates concurrent processors sharing a retained Worker", async () => {
    const worker = new FakeWorker();
    const first = workerProcessor(worker), second = workerProcessor(worker);
    const firstRequest = first.process(request());
    let secondSettled = false;
    const secondRequest = second.process(request()).then(result => { secondSettled = true; return result; });
    const [firstId, secondId] = worker.requests.map(message => message.requestId);
    expect(firstId).not.toBe(secondId);
    worker.reply({ type: "mach-table:result", requestId: firstId, rowIds: ["a"] });
    await expect(firstRequest).resolves.toEqual({ rowIds: ["a"] });
    expect(secondSettled).toBe(false);
    worker.reply({ type: "mach-table:result", requestId: secondId, rowIds: ["b"] });
    await expect(secondRequest).resolves.toEqual({ rowIds: ["b"] });
    first.destroy?.(); second.destroy?.();
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it("cancels only unfinished requests and removes their listeners when retaining a Worker", async () => {
    const worker = new FakeWorker();
    const removeWorkerListener = vi.spyOn(worker, "removeEventListener");
    const processor = workerProcessor(worker);
    const controllers = [new AbortController(), new AbortController(), new AbortController()];
    const removeAbortListeners = controllers.map(controller => vi.spyOn(controller.signal, "removeEventListener"));
    const waits = controllers.map(controller => processor.process(request(controller.signal)).catch((error: unknown) => error));
    const ids = worker.requests.map(message => message.requestId);
    worker.reply({ type: "mach-table:result", requestId: ids[2], rowIds: ["a"] });
    await expect(waits[2]).resolves.toEqual({ rowIds: ["a"] });

    processor.destroy?.(); processor.destroy?.();
    expect(await waits[0]).toMatchObject({ name: "AbortError" });
    expect(await waits[1]).toMatchObject({ name: "AbortError" });
    expect(worker.messages.filter(message => message.type === "mach-table:cancel").map(message => message.requestId)).toEqual(ids.slice(0, 2));
    expect(removeWorkerListener.mock.calls.map(([type]) => type)).toEqual(["message", "error"]);
    for (const remove of removeAbortListeners) expect(remove).toHaveBeenCalledOnce();
    expect(worker.terminate).not.toHaveBeenCalled();
    controllers.forEach(controller => controller.abort());
    expect(worker.messages).toHaveLength(5);
  });

  it("settles cancellation even when a retained Worker cannot accept cancel messages", async () => {
    const worker = new FakeWorker();
    worker.failCancellation = true;
    const removeWorkerListener = vi.spyOn(worker, "removeEventListener");
    const processor = workerProcessor(worker);
    const wait = processor.process(request()).catch((error: unknown) => error);
    expect(() => processor.destroy?.()).not.toThrow();
    expect(await wait).toMatchObject({ name: "AbortError" });
    expect(removeWorkerListener).toHaveBeenCalledTimes(2);
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it("keeps default termination and lazy ownership unchanged", async () => {
    const unused = new FakeWorker();
    const create = vi.fn(() => unused as unknown as Worker);
    const lazy = createWorkerDataProcessor(create);
    lazy.destroy?.();
    expect(create).not.toHaveBeenCalled();

    const worker = new FakeWorker();
    const processor = workerProcessor(worker, true);
    const wait = processor.process(request()).catch((error: unknown) => error);
    processor.destroy?.(); processor.destroy?.();
    expect(await wait).toMatchObject({ name: "AbortError" });
    expect(worker.terminate).toHaveBeenCalledOnce();
    await expect(processor.process(request())).rejects.toThrow(/destroyed/);
  });

  it("recovers with a new Worker after a worker error", async () => {
    const first = new FakeWorker(), next = new FakeWorker();
    const create = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(next);
    const processor = createWorkerDataProcessor(create);
    const failed = processor.process(request()).catch((error: unknown) => error);
    const error = new Event("error");
    Object.assign(error, { message: "Worker failed" });
    first.dispatchEvent(error);
    expect(await failed).toMatchObject({ message: "Worker failed" });
    expect(first.terminate).toHaveBeenCalledOnce();
    const retried = processor.process(request());
    next.reply({ type: "mach-table:result", requestId: next.requests[0].requestId, rowIds: ["b", "a"] });
    await expect(retried).resolves.toEqual({ rowIds: ["b", "a"] });
    processor.destroy?.();
    expect(next.terminate).toHaveBeenCalledOnce();
  });
});

describe("Worker-side active cancellation", () => {
  it("suppresses an active request result and lets other requests finish", async () => {
    vi.useFakeTimers();
    const worker = installWorker();
    worker.send({ type: "mach-table:process", requestId: 1, payload: {
      ...payload, rows: Array.from({ length: 4_001 }, (_, index) => ({ id: String(index), data: { amount: index } }))
    } });
    worker.send({ type: "mach-table:process", requestId: 2, payload });
    worker.send({ type: "mach-table:cancel", requestId: 1 });
    await vi.runAllTimersAsync();
    expect(worker.responses).toEqual([{ type: "mach-table:result", requestId: 2, rowIds: ["a", "b"] }]);
  });

  it("ignores large batches of late and unknown cancels without affecting subsequent work", async () => {
    const worker = installWorker();
    const empty = { ...payload, rows: [] };
    for (let id = 1; id <= 1_000; id++) worker.send({ type: "mach-table:process", requestId: id, payload: empty });
    await flush();
    expect(worker.responses).toHaveLength(1_000);
    for (let id = 1; id <= 2_000; id++) worker.send({ type: "mach-table:cancel", requestId: id });
    worker.send({ type: "mach-table:process", requestId: 2_001, payload });
    await flush();
    expect(worker.responses).toHaveLength(1_001);
    expect(worker.responses[worker.responses.length - 1]).toEqual({ type: "mach-table:result", requestId: 2_001, rowIds: ["a", "b"] });
  });

  it("cleans up error and cancellation state before processing later requests", async () => {
    const worker = installWorker();
    worker.send({ type: "mach-table:process", requestId: 1, payload: { ...payload, rows: null } as never });
    await flush();
    expect(worker.responses).toEqual([expect.objectContaining({ type: "mach-table:error", requestId: 1 })]);
    worker.send({ type: "mach-table:cancel", requestId: 1 });
    worker.send({ type: "mach-table:cancel", requestId: 2 });
    worker.send({ type: "mach-table:process", requestId: 2, payload });
    await flush();
    expect(worker.responses[worker.responses.length - 1]).toEqual({ type: "mach-table:result", requestId: 2, rowIds: ["a", "b"] });
  });
});
