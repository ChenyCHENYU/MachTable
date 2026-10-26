// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { GridCore } from "../core/gridCore";
import type { DatasourceMode, InfiniteGetRowsParams } from "../types/options";

interface Row { id: string }
const grids: GridCore<Row>[] = [];
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
async function mount(mode: DatasourceMode = "sequential") {
  let respond = (params: InfiniteGetRowsParams<Row>): void | Promise<void> => params.onSuccess([{ id: "initial" }], 1);
  const errors: unknown[] = [];
  const host = document.body.appendChild(document.createElement("div"));
  const core = new GridCore<Row>(host, {
    columnDefs: [{ field: "id" }], rowKey: "id", blockSize: 1,
    datasourceMode: mode, datasourceRowCount: 1, blockPrefetch: 0,
    datasourceRetryCount: 1, datasourceRetryDelay: 5, datasourceRetryJitter: 0,
    onGridError: event => errors.push(event.error),
    datasource: { getRows: params => respond(params) }
  });
  grids.push(core);
  await tick();
  return { core, errors, respond: (next: typeof respond) => { respond = next; } };
}
afterEach(() => {
  grids.splice(0).forEach(core => core.destroy());
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("datasource transport boundaries", () => {
  it("installs sequential synchronous success before reload returns and observes its late rejection", async () => {
    const { core, errors, respond } = await mount();
    const transport = vi.fn((params: InfiniteGetRowsParams<Row>) => {
      params.onSuccess([{ id: "synchronous" }], 1);
      return Promise.reject(new Error("rejection after successful callback"));
    });
    respond(transport);
    const pending = core.rowModel.startInfinite();
    expect(core.api.rows.getById("synchronous")?.data).toEqual({ id: "synchronous" });
    expect(core.rowModel.isLoadingInfinite()).toBe(false);
    await pending;
    await tick();
    expect(transport).toHaveBeenCalledOnce();
    expect(errors).toEqual([]);
  });

  it("settles a cancelled sequential waiter immediately and ignores its late callbacks", async () => {
    const { core, errors, respond } = await mount();
    let request!: InfiniteGetRowsParams<Row>;
    respond(params => { request = params; });
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const pending = core.rowModel.startInfinite(controller.signal);
    expect(core.rowModel.isLoadingInfinite()).toBe(true);
    controller.abort();
    expect(core.rowModel.isLoadingInfinite()).toBe(false);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    await pending;
    request.onSuccess([{ id: "cancelled" }], 1);
    request.fail(new Error("late failure"));
    expect(core.api.rows.getById("cancelled")).toBeUndefined();
    expect(errors).toEqual([]);
  });

  it("cancels a scheduled sequential retry without starting another attempt", async () => {
    const { core, errors, respond } = await mount();
    vi.useFakeTimers();
    const transport = vi.fn((params: InfiniteGetRowsParams<Row>) => params.fail(new Error("retry later")));
    respond(transport);
    const controller = new AbortController();
    const pending = core.rowModel.startInfinite(controller.signal);
    controller.abort();
    await vi.advanceTimersByTimeAsync(10);
    expect(core.rowModel.isLoadingInfinite()).toBe(false);
    await pending;
    expect(transport).toHaveBeenCalledOnce();
    expect(errors).toEqual([]);
  });

  it.each<DatasourceMode>(["sequential", "block"])("settles each %s attempt once across callbacks and returned promises", async mode => {
    const { core, errors, respond } = await mount(mode);
    vi.useFakeTimers();
    let attempt = 0;
    let obsolete!: InfiniteGetRowsParams<Row>;
    respond(params => {
      attempt++;
      if (attempt === 1) {
        obsolete = params;
        params.fail(new Error("temporary"));
        params.onSuccess([{ id: "failed-attempt" }], 1);
        return Promise.reject(new Error("same attempt failed twice"));
      }
      obsolete.onSuccess([{ id: "obsolete-attempt" }], 1);
      params.onSuccess([{ id: "retried" }], 1);
      params.onSuccess([{ id: "duplicate-success" }], 1);
    });
    const pending = core.rowModel.startInfinite();
    await vi.advanceTimersByTimeAsync(10);
    await pending;
    expect(attempt).toBe(2);
    expect(core.api.rows.getById("retried")?.data).toEqual({ id: "retried" });
    for (const id of ["failed-attempt", "obsolete-attempt", "duplicate-success"]) {
      expect(core.api.rows.getById(id)).toBeUndefined();
    }
    expect(errors).toEqual([]);
  });

  it.each<DatasourceMode>(["sequential", "block"])("keeps %s terminal error normalization at its caller boundary", async mode => {
    const { core, errors, respond } = await mount(mode);
    core.gridOptions.datasourceRetryCount = 0;
    respond(params => params.fail("offline"));
    const pending = core.rowModel.startInfinite();
    if (mode === "block") await expect(pending).rejects.toThrow("offline");
    else await pending;
    expect(errors).toHaveLength(1);
    if (mode === "sequential") expect(errors[0]).toBe("offline");
    else expect(errors[0]).toMatchObject({ message: "offline" });
  });

  it.each<DatasourceMode>(["sequential", "block"])("isolates a replaced %s scope from late success and promise rejection", async mode => {
    const { core, errors, respond } = await mount(mode);
    let oldRequest!: InfiniteGetRowsParams<Row>;
    let rejectOld!: (reason: unknown) => void;
    respond(params => {
      oldRequest = params;
      return new Promise<void>((_, reject) => { rejectOld = reject; });
    });
    const obsolete = core.rowModel.startInfinite();
    void obsolete.catch(() => undefined);
    await tick();
    respond(params => params.onSuccess([{ id: "current-scope" }], 1));
    const current = core.rowModel.startInfinite();
    expect(oldRequest.signal.aborted).toBe(true);
    oldRequest.onSuccess([{ id: "old-scope" }], 1);
    rejectOld(new Error("old transport failed after replacement"));
    await current;
    if (mode === "block") await expect(obsolete).rejects.toMatchObject({ name: "AbortError" });
    else await obsolete;
    await tick();
    expect(core.api.rows.getById("current-scope")?.data).toEqual({ id: "current-scope" });
    expect(core.api.rows.getById("old-scope")).toBeUndefined();
    expect(errors).toEqual([]);
  });
});
