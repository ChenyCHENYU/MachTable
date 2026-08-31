// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGrid } from "../index";
import { PerformanceMonitor } from "../services/performanceMonitor";
import { RemoteBlockCache } from "../services/remoteBlockCache";

interface Row { id: string; name: string; amount: number }

function host(): HTMLElement {
  const element = document.createElement("div");
  Object.defineProperty(element, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(element, "clientHeight", { value: 360, configurable: true });
  document.body.appendChild(element);
  return element;
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  document.body.textContent = "";
  vi.unstubAllGlobals();
});

describe("0.23 API contract", () => {
  it("keeps domain facades stable, lazy and responsibility-focused", () => {
    const api = createGrid<Row>(host(), {
      columnDefs: [{ field: "name", filter: "text" }, { field: "amount" }],
      rowData: [{ id: "1", name: "Alpha", amount: 1 }],
      rowKey: "id",
      pagination: { pageSize: 20 }
    });
    expect(api.filtering).toBe(api.filtering);
    expect(api.pagination).toBe(api.pagination);
    api.filtering.setQuickText("Alpha");
    expect(api.filtering.isPresent()).toBe(true);
    expect(api.pagination.getPageSize()).toBe(20);
    api.destroy();
  });

  it("commits one option patch through one scheduled visual update", () => {
    const api = createGrid<Row>(host(), {
      columnDefs: [{ field: "name" }],
      rowData: [{ id: "1", name: "Alpha", amount: 1 }],
      rowKey: "id",
      pagination: false
    });
    const before = api.getDiagnostics().updates.flushCount;
    api.updateOptions({ size: "compact", theme: "dark", rowHeight: 32, stripedRows: true });
    expect(api.getDiagnostics().updates.flushCount - before).toBe(1);
    expect(api.getGridOption("rowHeight")).toBe(32);
    api.updateOptions({ rowHeight: "invalid" } as any);
    expect(api.getGridOption("rowHeight")).toBe(32);
    api.destroy();
  });

  it("refreshes simple row replacements without rebuilding the local pipeline", () => {
    const api = createGrid<Row>(host(), {
      columnDefs: [{ field: "name" }, { field: "amount" }],
      rowData: [{ id: "1", name: "Alpha", amount: 1 }],
      rowKey: "id",
      pagination: false
    });
    const before = api.getPerformanceSnapshot().modelSampleCount;
    api.applyTransaction({ update: [{ id: "1", name: "Updated", amount: 2 }] });
    expect(api.getPerformanceSnapshot().modelSampleCount).toBe(before);
    expect(document.querySelector('.mach-cell[data-col-id="name"]')?.textContent).toBe("Updated");
    api.destroy();
  });
});

describe("0.23 bounded resources", () => {
  it("limits concurrent block requests and starts the highest-priority queued block first", async () => {
    const cache = new RemoteBlockCache<number>(8, undefined, 2);
    const started: number[] = [];
    const completions = new Map<number, (value: { rows: readonly number[] }) => void>();
    const load = (block: number, priority: number) => cache.load(block, () => {
      started.push(block);
      return new Promise((resolve) => completions.set(block, resolve));
    }, undefined, priority);
    const requests = [load(0, 0), load(1, 0), load(2, 1), load(3, 10)];
    await tick();
    expect(started).toEqual([0, 1]);
    expect(cache.snapshot()).toEqual(expect.objectContaining({ activeRequestCount: 2, queuedRequestCount: 2 }));
    completions.get(0)!({ rows: [0] });
    await tick();
    expect(started).toEqual([0, 1, 3]);
    completions.get(1)!({ rows: [1] });
    completions.get(3)!({ rows: [3] });
    await tick();
    completions.get(2)!({ rows: [2] });
    await Promise.all(requests);
  });

  it("removes an aborted queued request before it consumes a network slot", async () => {
    const cache = new RemoteBlockCache<number>(4, undefined, 1);
    let finishActive!: (value: { rows: readonly number[] }) => void;
    const active = cache.load(0, () => new Promise((resolve) => { finishActive = resolve; }));
    const controller = new AbortController();
    const queuedLoader = vi.fn(async () => ({ rows: [1] }));
    const queued = cache.load(1, queuedLoader, controller.signal);
    await tick();
    controller.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    expect(cache.snapshot().queuedRequestCount).toBe(0);
    expect(queuedLoader).not.toHaveBeenCalled();
    finishActive({ rows: [0] });
    await active;
  });

  it("shares one Long Tasks observer across mounted monitors and releases it after the last destroy", () => {
    let constructions = 0;
    let disconnects = 0;
    class ObserverStub {
      constructor() { constructions++; }
      observe() {}
      disconnect() { disconnects++; }
      takeRecords() { return []; }
    }
    vi.stubGlobal("PerformanceObserver", ObserverStub);
    const first = new PerformanceMonitor();
    const second = new PerformanceMonitor();
    expect(constructions).toBe(1);
    first.destroy();
    expect(disconnects).toBe(0);
    second.destroy();
    expect(disconnects).toBe(1);
  });
});
