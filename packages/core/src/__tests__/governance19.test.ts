// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGrid,
  resolveGridFeatures,
  validateGridOptions,
  type GridDatasource
} from "../index";
import { createWorkerDataProcessor, processFieldDataRequest } from "../worker";
import { ColumnViewportIndex } from "../services/columnViewportIndex";
import { RemoteBlockCache } from "../services/remoteBlockCache";
import { GridUpdateScheduler } from "../services/updateScheduler";
import { VariableSizeIndex } from "../services/variableSizeIndex";

interface Row { id: string; name: string; amount: number }

function host(): HTMLElement {
  const element = document.createElement("div");
  Object.defineProperty(element, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(element, "clientHeight", { value: 360, configurable: true });
  document.body.appendChild(element);
  return element;
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
afterEach(() => { document.body.textContent = ""; });

describe("0.19 indexed virtualization", () => {
  it("finds horizontal windows without scanning every column", () => {
    const index = new ColumnViewportIndex();
    const columns = Array.from({ length: 100 }, (_, i) => ({ id: `c${i}`, currentWidth: 50 }));
    index.update(columns as any);
    expect(index.totalWidth()).toBe(5_000);
    expect(index.indexAt(1_025)).toBe(20);
    expect(index.visibleRange(1_000, 200, 1)).toEqual({ first: 19, lastExcl: 25 });
  });

  it("updates one variable row height in logarithmic indexed storage", () => {
    const rows = [{}, {}, {}, {}];
    const index = new VariableSizeIndex<object>();
    index.reset(rows, () => 30);
    expect(index.offsetAt(3)).toBe(90);
    expect(index.update(1, 60)).toBe(true);
    expect(index.offsetAt(3)).toBe(120);
    expect(index.findIndex(91)).toBe(2);
    expect(index.minimumSize()).toBe(30);
  });
});

describe("0.19 update and API governance", () => {
  it("coalesces nested synchronous update batches", () => {
    const apply = vi.fn();
    const scheduler = new GridUpdateScheduler(apply);
    scheduler.batch(() => {
      scheduler.schedule({ layout: true, cells: { rowIds: ["1"], columns: ["name"] } });
      scheduler.batch(() => scheduler.schedule({ cells: { rowIds: ["2"], columns: ["amount"] } }));
    });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({
      layout: true,
      cells: expect.objectContaining({ rowIds: ["1", "2"], columns: ["name", "amount"] })
    }));
    expect(scheduler.snapshot()).toEqual(expect.objectContaining({ flushCount: 1, coalescedRequestCount: 1 }));
  });

  it("keeps domain APIs coherent while batching cross-domain updates", () => {
    const api = createGrid<Row>(host(), {
      columnDefs: [{ field: "name" }, { field: "amount" }],
      rowData: [{ id: "1", name: "A", amount: 1 }],
      rowKey: "id",
      pagination: false
    });
    const before = api.diagnostics.get().updates.flushCount;
    api.batch((grid) => {
      grid.columns.setVisible("amount", false);
      grid.columns.setVisible("amount", true);
      grid.view.refreshCells({ rowIds: ["1"], columns: ["name"] });
    });
    expect(api.diagnostics.get().updates.flushCount - before).toBe(1);
    expect(api.rows.getCount()).toBe(api.rows.getCount());
    expect(api.columns.getState()).toEqual(api.columns.getState());
    expect(api.diagnostics.get()).toEqual(api.diagnostics.get());
    api.destroy();
  });

  it("enforces optional feature dependency versions", () => {
    const setup = vi.fn();
    const resolved = resolveGridFeatures([
      { key: "base", version: "0.19.2", setup() {} },
      { key: "ok", requires: [{ key: "base", version: "^0.19.0" }], setup },
      { key: "future", requires: [{ key: "base", version: ">=1" }], setup() {} }
    ]);
    expect(resolved.features.map((feature) => feature.key)).toEqual(["base", "ok"]);
    expect(resolved.issues).toContainEqual(expect.objectContaining({ code: "UNSUPPORTED_FEATURE_VERSION" }));
  });

  it("rejects unsafe sparse-row option combinations", () => {
    const datasource = { getRows() {} };
    expect(validateGridOptions({ datasourceMode: "block" })).toContainEqual(
      expect.objectContaining({ code: "OPTION_CONFLICT", option: "datasourceMode" })
    );
    const issues = validateGridOptions({
      datasourceMode: "block",
      datasource,
      getRowHeight: () => 40,
      masterDetail: true
    });
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ option: "getRowHeight" }),
      expect.objectContaining({ option: "masterDetail" }),
      expect.objectContaining({ code: "MISSING_STABLE_ROW_ID" })
    ]));
  });
});

describe("0.19 random-access datasource", () => {
  it("deduplicates requests and evicts least recently used blocks", async () => {
    const evicted: number[] = [];
    const cache = new RemoteBlockCache<number>(2, (index) => evicted.push(index));
    const loader = vi.fn(async () => ({ rows: [1, 2] }));
    await Promise.all([cache.load(0, loader), cache.load(0, loader)]);
    await cache.load(1, loader);
    cache.peek(0);
    await cache.load(2, loader);
    expect(loader).toHaveBeenCalledTimes(3);
    expect(evicted).toEqual([1]);
    expect(cache.snapshot()).toEqual(expect.objectContaining({ cachedBlockCount: 2, hitCount: 1 }));
  });

  it("keeps a shared block request alive while another consumer is still active", async () => {
    const cache = new RemoteBlockCache<number>(2);
    const firstConsumer = new AbortController();
    let complete!: (result: { rows: readonly number[] }) => void;
    const loader = vi.fn(() => new Promise<{ rows: readonly number[] }>((resolve) => {
      complete = resolve;
    }));
    const cancelled = cache.load(0, loader, firstConsumer.signal);
    const retained = cache.load(0, loader);
    await tick();
    firstConsumer.abort();
    complete({ rows: [7] });
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    await expect(retained).resolves.toEqual({ rows: [7] });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(cache.snapshot()).toEqual(expect.objectContaining({ cachedBlockCount: 1, loadingBlockCount: 0 }));
  });

  it("loads arbitrary ranges, renders placeholders and exposes cache diagnostics", async () => {
    const calls: number[] = [];
    const datasource: GridDatasource<Row> = {
      getRows(params) {
        calls.push(params.startRow);
        const rows = Array.from({ length: params.endRow - params.startRow }, (_, offset) => ({
          id: String(params.startRow + offset),
          name: `Row ${params.startRow + offset}`,
          amount: params.startRow + offset
        }));
        params.onSuccess(rows, 100);
      }
    };
    const api = createGrid<Row>(host(), {
      columnDefs: [{ field: "name" }, { field: "amount" }],
      rowData: [],
      rowKey: "id",
      datasource,
      datasourceMode: "block",
      datasourceRowCount: 100,
      blockSize: 10,
      maxBlocksInCache: 2,
      blockPrefetch: 0
    });
    await tick();
    expect(api.rows.getCount()).toBe(100);
    expect(api.rows.getAt(55)).toEqual(expect.objectContaining({ loading: true, rowIndex: 55 }));
    await api.rows.ensureLoaded(50, 60);
    expect(api.rows.getAt(55)?.data?.name).toBe("Row 55");
    expect(calls).toEqual([0, 50]);
    expect(api.rows.getCacheSnapshot()).toEqual(expect.objectContaining({ cachedBlockCount: 2, cachedRowCount: 20 }));
    api.rows.purgeCache();
    expect(api.rows.getCacheSnapshot().cachedBlockCount).toBe(0);
    api.destroy();
  });
});

describe("0.19 Worker-ready local processing", () => {
  it("cancels pending work and detaches Worker listeners on destroy", async () => {
    const messageListeners = new Set<EventListener>();
    const errorListeners = new Set<EventListener>();
    const worker = {
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        (type === "message" ? messageListeners : errorListeners).add(listener);
      }),
      removeEventListener: vi.fn((type: string, listener: EventListener) => {
        (type === "message" ? messageListeners : errorListeners).delete(listener);
      }),
      postMessage: vi.fn(),
      terminate: vi.fn()
    } as unknown as Worker;
    const processor = createWorkerDataProcessor<Row>(() => worker);
    const controller = new AbortController();
    const pending = processor.process({
      rows: [{ id: "1", data: { id: "1", name: "Alpha", amount: 1 } }],
      columns: [{ colId: "name", field: "name" }],
      sortModel: [],
      filterModel: {},
      advancedFilterModel: null,
      quickFilterText: null,
      signal: controller.signal
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "mach-table:cancel" }));
    processor.destroy?.();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(messageListeners.size).toBe(0);
    expect(errorListeners.size).toBe(0);
  });

  it("filters and stably sorts serializable field paths", async () => {
    const result = await processFieldDataRequest<Row>({
      rows: [
        { id: "1", data: { id: "1", name: "Beta", amount: 20 } },
        { id: "2", data: { id: "2", name: "Alpha", amount: 40 } },
        { id: "3", data: { id: "3", name: "Gamma", amount: 10 } }
      ],
      columns: [{ colId: "name", field: "name" }, { colId: "amount", field: "amount" }],
      sortModel: [{ colId: "amount", direction: "desc" }],
      filterModel: { amount: { type: "number", conditions: [{ match: "greaterThan", value: 15 }] } },
      advancedFilterModel: null,
      quickFilterText: null
    });
    expect(result.rowIds).toEqual(["2", "1"]);
  });

  it("applies an async processor without blocking the synchronous grid pipeline", async () => {
    const api = createGrid<Row>(host(), {
      columnDefs: [{ field: "name" }, { field: "amount" }],
      rowData: [
        { id: "1", name: "Beta", amount: 20 },
        { id: "2", name: "Alpha", amount: 40 }
      ],
      rowKey: "id",
      pagination: false,
      dataProcessorMinRows: 1,
      dataProcessor: {
        process: vi.fn(async () => ({ rowIds: ["2", "1"] }))
      }
    });
    api.sorting.setModel([{ colId: "amount", direction: "desc" }]);
    await tick();
    expect(api.rows.getAt(0)?.id).toBe("2");
    expect(api.diagnostics.getPerformance().modelSampleCount).toBeGreaterThan(0);
    api.destroy();
  });
});
