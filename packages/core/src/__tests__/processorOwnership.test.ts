// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { GridCore } from "../core/gridCore";
import { normalizeMachTableConfig, resolveMachTableGridOptions } from "../lib/configuration";
import type { GridDataProcessor, GridOptions } from "../types/options";
import { createWorkerDataProcessor, type GridWorkerRequestMessage } from "../worker";

const grids: GridCore[] = [];
function mount(options: Partial<GridOptions> = {}): GridCore {
  const host = document.createElement("div");
  document.body.append(host);
  const grid = new GridCore(host, { columnDefs: [{ field: "id" }], rowKey: "id", rowData: [{ id: "a" }], ...options });
  grids.push(grid);
  return grid;
}
const processor = (): GridDataProcessor => ({ process: async request => ({ rowIds: request.rows.map(row => row.id) }), destroy: vi.fn() });
afterEach(() => { grids.splice(0).forEach(grid => grid.destroy()); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("per-grid data processor ownership", () => {
  it("creates one independent processor per grid from reusable application defaults", async () => {
    const instances: GridDataProcessor[] = [];
    const factory = vi.fn(() => { const value = processor(); instances.push(value); return value; });
    const config = normalizeMachTableConfig({ defaults: { dataProcessor: factory } });
    const options = () => resolveMachTableGridOptions(config, undefined, {}).options;
    const first = mount(options()), second = mount(options());
    expect(factory).toHaveBeenCalledTimes(2);
    expect(instances).toHaveLength(2);
    first.destroy();
    expect(instances[0].destroy).toHaveBeenCalledOnce();
    expect(instances[1].destroy).not.toHaveBeenCalled();
    await expect(second.gridOptions.dataProcessor!.process({ rows: [{ id: "b", data: {} }], columns: [], sortModel: [], filterModel: {}, advancedFilterModel: null, quickFilterText: null, signal: new AbortController().signal })).resolves.toEqual({ rowIds: ["b"] });
  });

  it("rejects shared instances in defaults and presets, while retaining explicit per-grid instances", () => {
    const shared = processor();
    expect(() => normalizeMachTableConfig({ defaults: { dataProcessor: shared } } as never)).toThrow(/dataProcessor/);
    expect(() => normalizeMachTableConfig({ presets: { list: { dataProcessor: shared } } } as never)).toThrow(/dataProcessor/);
    const warning = vi.fn();
    expect(normalizeMachTableConfig({ strict: false, defaults: { dataProcessor: shared }, onConfigWarning: warning } as never).defaults).not.toHaveProperty("dataProcessor");
    expect(warning).toHaveBeenCalledOnce();
    const grid = mount({ dataProcessor: shared });
    grid.destroy(); grid.destroy();
    expect(shared.destroy).toHaveBeenCalledOnce();
  });

  it("keeps an unchanged factory stable and releases replaced instances exactly once", () => {
    const first = processor(), second = processor();
    const createFirst = vi.fn(() => first), createSecond = vi.fn(() => second);
    const grid = mount({ dataProcessor: createFirst });
    grid.api.updateOptions({ dataProcessor: createFirst });
    expect(createFirst).toHaveBeenCalledOnce();
    grid.api.updateOptions({ dataProcessor: createSecond });
    expect(first.destroy).toHaveBeenCalledOnce();
    expect(grid.gridOptions.dataProcessor).toBe(second);
    grid.api.updateOptions({ dataProcessor: undefined });
    expect(second.destroy).toHaveBeenCalledOnce();
    grid.destroy();
    expect(first.destroy).toHaveBeenCalledOnce();
    expect(second.destroy).toHaveBeenCalledOnce();
  });

  it("retains the previous owner when replacement construction fails", () => {
    const previous = processor();
    const grid = mount({ dataProcessor: previous });
    expect(() => grid.api.updateOptions({ dataProcessor: () => { throw new Error("factory failed"); } })).toThrow("factory failed");
    expect(grid.gridOptions.dataProcessor).toBe(previous);
    expect(previous.destroy).not.toHaveBeenCalled();
    grid.destroy();
    expect(previous.destroy).toHaveBeenCalledOnce();
  });

  it("releases a constructed processor when later grid initialization fails", () => {
    const value = processor();
    const grid = mount({ dataProcessor: () => value });
    grid.destroy();
    // Constructor failure before the DOM is installed must also release its owned instance.
    vi.spyOn(GridCore.prototype, "validateDefs").mockImplementationOnce(() => { throw new Error("later initialization failed"); });
    const next = processor();
    expect(() => mount({ dataProcessor: () => next })).toThrow("later initialization failed");
    expect(next.destroy).toHaveBeenCalledOnce();
    expect(value.destroy).toHaveBeenCalledOnce();
  });

  it("does not leave a partial grid behind when its factory throws", () => {
    const host = document.createElement("div");
    document.body.append(host);
    expect(() => new GridCore(host, { dataProcessor: () => { throw new Error("cannot create processor"); } })).toThrow("cannot create processor");
    expect(host.childElementCount).toBe(0);
  });

  it("keeps the newest owner when an old processor destroy reenters option updates", () => {
    const newest = processor(), intermediate = processor(), previous = processor();
    const grid = mount({ dataProcessor: previous });
    vi.mocked(previous.destroy!).mockImplementation(() => grid.api.updateOptions({ dataProcessor: newest }));
    grid.api.updateOptions({ dataProcessor: () => intermediate });
    expect(grid.gridOptions.dataProcessor).toBe(newest);
    expect(previous.destroy).toHaveBeenCalledOnce();
    expect(intermediate.destroy).toHaveBeenCalledOnce();
    grid.destroy();
    expect(newest.destroy).toHaveBeenCalledOnce();
  });

  it("terminates only its own lazily created worker across two application-default grids", async () => {
    class FakeWorker extends EventTarget {
      terminate = vi.fn();
      postMessage(message: GridWorkerRequestMessage): void {
        if (message.type === "mach-table:process") queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", {
          data: { type: "mach-table:result", requestId: message.requestId, rowIds: message.payload.rows.map(row => row.id).reverse() }
        })));
      }
    }
    const workers: FakeWorker[] = [];
    const config = normalizeMachTableConfig({ defaults: { dataProcessorMinRows: 1, dataProcessor: () => createWorkerDataProcessor(() => {
      const worker = new FakeWorker(); workers.push(worker); return worker as unknown as Worker;
    }) } });
    const options = resolveMachTableGridOptions(config, undefined, { rowData: [{ id: "a" }, { id: "b" }], pagination: false }).options;
    const first = mount(options), second = mount(options);
    expect(workers).toHaveLength(0);
    first.api.sorting.setModel([{ colId: "id", direction: "desc" }]);
    second.api.sorting.setModel([{ colId: "id", direction: "desc" }]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(workers).toHaveLength(2);
    first.destroy();
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(workers[1].terminate).not.toHaveBeenCalled();
    second.api.sorting.setModel([{ colId: "id", direction: "asc" }]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(second.api.rows.getAt(0)?.id).toBe("b");
    expect(workers).toHaveLength(2);
    second.destroy();
    expect(workers[1].terminate).toHaveBeenCalledOnce();
  });

  it("does not install late results from a processor replaced while its request was pending", async () => {
    let complete!: (result: { rowIds: string[] }) => void;
    let signal!: AbortSignal;
    const previous: GridDataProcessor = { destroy: vi.fn(), process(request) {
      signal = request.signal;
      return new Promise(resolve => { complete = resolve; });
    } };
    const grid = mount({ rowData: [{ id: "a" }, { id: "b" }], pagination: false, dataProcessorMinRows: 1, dataProcessor: previous });
    grid.api.sorting.setModel([{ colId: "id", direction: "desc" }]);
    await Promise.resolve();
    grid.api.updateOptions({ dataProcessor: () => ({ process: async () => ({ rowIds: ["b", "a"] }) }) });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(signal.aborted).toBe(true);
    complete({ rowIds: ["a", "b"] });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(grid.api.rows.getAt(0)?.id).toBe("b");
    expect(previous.destroy).toHaveBeenCalledOnce();
  });
});
