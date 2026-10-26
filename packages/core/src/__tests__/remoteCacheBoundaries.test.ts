// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { GridCore } from "../core/gridCore";
import { RemoteBlockCache } from "../services/remoteBlockCache";
import { BodyRenderer } from "../render/bodyRenderer";
import type { GridOptions } from "../types/options";

interface Row { id: string; amount: number }
const cores: GridCore<Row>[] = [];
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function grid(options: Partial<GridOptions<Row>> = {}) {
  const host = document.createElement("div");
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 360 } });
  document.body.appendChild(host);
  const core = new GridCore<Row>(host, {
    columnDefs: [{ field: "amount", editable: true, cellEditor: "number" }],
    rowKey: "id",
    datasourceMode: "block",
    datasourceRowCount: 100,
    blockSize: 10,
    maxBlocksInCache: 1,
    blockPrefetch: 0,
    datasource: {
      getRows({ startRow, endRow, onSuccess }) {
        onSuccess(Array.from({ length: endRow - startRow }, (_, offset) => ({
          id: String(startRow + offset), amount: startRow + offset
        })), 100);
      }
    },
    ...options
  });
  cores.push(core);
  return { core, api: core.api, host };
}

function change(core: GridCore<Row>, id: string, value: number): void {
  const node = core.rowModel.getNodeById(id)!;
  const column = core.columnModel.getColumn("amount")!;
  const previous = node.data!.amount;
  core.writeValue(node, column, value);
  core.notifyCellValueChanged(node, column, previous, value);
}

afterEach(() => {
  for (const core of cores.splice(0)) core.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("remote cache operation boundaries", () => {
  it("fills an initial render window spanning several small blocks without a scroll request", async () => {
    vi.spyOn(BodyRenderer.prototype, "getRenderedRowRange").mockReturnValue({ first: 0, lastExcl: 35 });
    const { api } = grid();
    await tick();
    expect([0, 10, 20, 30].map(index => api.rows.getAt(index)?.data?.amount)).toEqual([0, 10, 20, 30]);
    expect(api.rows.getCacheSnapshot().cachedBlockCount).toBe(4);
  });

  it("bounds retained windows and returns to the configured budget when they are released", async () => {
    const cache = new RemoteBlockCache<number>(1);
    const load = (index: number) => cache.load(index, async () => ({ rows: [index] }));
    cache.retain(new Set([0, 1]));
    for (let index = 0; index < 12; index++) await load(index);
    expect(cache.has(0)).toBe(true);
    expect(cache.has(1)).toBe(true);
    expect(cache.has(11)).toBe(true);
    expect(cache.snapshot().cachedBlockCount).toBe(3);
    cache.retain(new Set());
    expect(cache.snapshot().cachedBlockCount).toBe(1);
    cache.purge();
    await load(12);
    expect(cache.snapshot().cachedBlockCount).toBe(1);
  });

  it.each(["cell", "row"])("retains rendered blocks, focus and an active %s draft while other requests churn", async (mode) => {
    const { core, api } = grid();
    await tick();
    await api.rows.ensureLoaded(50, 60);
    expect(mode === "row" ? api.editing.startRow(0) : api.editing.startCell({ rowIndex: 0, colId: "amount" })).toBe(true);
    vi.spyOn(core.bodyRenderer, "getRenderedRowRange").mockReturnValue({ first: 20, lastExcl: 35 });
    core.bodyRenderer.focusedCell = { rowIndex: 50, colId: "amount" };
    await api.rows.ensureLoaded(20, 40);
    for (let start = 40; start < 100; start += 10) await api.rows.ensureLoaded(start, start + 10);
    expect(core.editingService.getEditingRowIndex()).toBe(0);
    expect(api.rows.getAt(0)?.data?.amount).toBe(0);
    expect(api.rows.getAt(20)?.data?.amount).toBe(20);
    expect(api.rows.getAt(30)?.data?.amount).toBe(30);
    expect(api.rows.getAt(50)?.data?.amount).toBe(50);
    expect(api.rows.getCacheSnapshot().cachedBlockCount).toBeLessThanOrEqual(5);
    await api.editing.stop({ cancel: true });
    core.bodyRenderer.focusedCell = null;
    vi.mocked(core.bodyRenderer.getRenderedRowRange).mockReturnValue({ first: 0, lastExcl: 0 });
    await api.rows.ensureLoaded(90, 100);
    expect(api.rows.getCacheSnapshot().cachedBlockCount).toBe(1);
  });

  it("loads every block intersecting the rendered window even when speculative prefetch is off", async () => {
    const { core, api } = grid();
    await tick();
    vi.spyOn(core.bodyRenderer, "getRenderedRowRange").mockReturnValue({ first: 25, lastExcl: 45 });
    core.rowModel.checkInfiniteScroll(44);
    await tick();
    expect(api.rows.getAt(25)?.data?.amount).toBe(25);
    expect(api.rows.getAt(35)?.data?.amount).toBe(35);
    expect(api.rows.getAt(44)?.data?.amount).toBe(44);
    expect(api.rows.getCacheSnapshot().cachedBlockCount).toBeLessThanOrEqual(4);
  });

  it("hands off a focused row editor before an explicit scroll returns and restores its draft", async () => {
    const { core, api, host } = grid({ rowHeight: 32, rowBuffer: 1, blockSize: 4 });
    const viewport = core.skeleton.bodyViewports.center;
    Object.defineProperties(viewport, { clientHeight: { value: 320 }, clientWidth: { value: 800 } });
    api.view.refreshLayout();
    await tick();
    expect(api.editing.startRow(0)).toBe(true);
    const input = host.querySelector<HTMLInputElement>('.mach-row[data-index="0"] .mach-editor-input')!;
    input.value = "999";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.activeElement).toBe(input);

    api.view.scrollToRow(40, "top");
    // No native scroll event/RAF has run here. The old focused input must be
    // released now, so a queued native caret reveal cannot restore its viewport.
    expect(input.isConnected).toBe(false);
    expect(viewport.scrollTop).toBe(1280);
    expect(host.querySelector('.mach-row[data-index="40"]')).not.toBeNull();
    expect(api.editing.isRowActive(0)).toBe(true);
    expect(api.rows.getById("0")?.data?.amount).toBe(0);
    await tick();
    expect(api.rows.getAt(40)?.data?.amount).toBe(40);

    api.view.scrollToRow(0, "top");
    const restored = host.querySelector<HTMLInputElement>('.mach-row[data-index="0"] .mach-editor-input')!;
    expect(restored.value).toBe("999");
    expect(api.rows.getById("0")?.data?.amount).toBe(0);
    await api.editing.stop({ cancel: true });
    expect(api.editing.getChanges()).toEqual([]);
  });

  it("keeps only sparse dirty nodes outside the loaded cache and reuses their local data on refetch", async () => {
    const { core, api } = grid();
    await tick();
    vi.spyOn(core.bodyRenderer, "getRenderedRowRange").mockReturnValue({ first: 0, lastExcl: 0 });
    change(core, "0", 999);
    await api.rows.ensureLoaded(20, 30);
    expect(api.rows.getCacheSnapshot().cachedRowCount).toBe(10);
    expect(api.rows.getAt(0)?.loading).toBe(true);
    expect(api.rows.getById("0")?.data?.amount).toBe(999);
    expect(api.editing.getChanges()).toMatchObject([{ rowId: "0", data: { amount: 999 } }]);
    const loaded: string[] = [];
    api.rows.forEach((node) => loaded.push(node.id));
    expect(loaded).not.toContain("0");
    await api.rows.ensureLoaded(0, 10);
    expect(api.rows.getAt(0)?.data?.amount).toBe(999);
    expect(api.editing.getChanges()[0]?.cells[0]).toMatchObject({ originalValue: 0, value: 999 });
    await api.rows.ensureLoaded(20, 30);
    api.editing.markSaved();
    await api.rows.ensureLoaded(30, 40);
    expect(api.rows.getById("0")).toBeUndefined();
    expect(api.editing.getChanges()).toEqual([]);
  });

  it("can roll back an evicted dirty node, then reclaim it on the next cache operation", async () => {
    const { core, api } = grid();
    await tick();
    vi.spyOn(core.bodyRenderer, "getRenderedRowRange").mockReturnValue({ first: 0, lastExcl: 0 });
    change(core, "0", 999);
    await api.rows.ensureLoaded(20, 30);
    expect(api.editing.rollback()).toBe(true);
    expect(api.rows.getById("0")?.data?.amount).toBe(0);
    await api.rows.ensureLoaded(30, 40);
    expect(api.rows.getById("0")).toBeUndefined();
  });

  it("preserves dirty state when one same-query request is cancelled, then releases nodes on destroy", async () => {
    const { core, api } = grid();
    await tick();
    vi.spyOn(core.bodyRenderer, "getRenderedRowRange").mockReturnValue({ first: 0, lastExcl: 0 });
    change(core, "0", 999);
    await api.rows.ensureLoaded(20, 30);
    const revision = core.rowModel.getDataRevision();
    const controller = new AbortController();
    const pending = api.rows.ensureLoaded(40, 50, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(core.rowModel.getDataRevision()).toBe(revision);
    expect(api.editing.getChanges()).toMatchObject([{ rowId: "0", data: { amount: 999 } }]);
    api.destroy();
    expect(core.rowModel.getNodeById("0")).toBeUndefined();
    expect(core.rowModel.getAllNodes()).toEqual([]);
    expect(core.rowModel.getDisplayedRows()).toEqual([]);
    expect(core.rowModel.getDatasourceCacheSnapshot().cachedBlockCount).toBe(0);
  });

  it("never installs results already evicted by concurrent loads", async () => {
    const { core, api } = grid();
    await tick();
    vi.spyOn(core.bodyRenderer, "getRenderedRowRange").mockReturnValue({ first: 0, lastExcl: 0 });
    await api.rows.ensureLoaded(20, 80);
    const loaded: string[] = [];
    api.rows.forEach((node) => loaded.push(node.id));
    expect(loaded).toHaveLength(api.rows.getCacheSnapshot().cachedRowCount);
    expect(loaded).toHaveLength(10);
  });

  it("replaces edits and dirty state only at an explicit reload or purge boundary", async () => {
    const { core, api } = grid();
    await tick();
    change(core, "0", 999);
    expect(api.editing.startRow(0)).toBe(true);
    await api.rows.reload();
    expect(api.editing.isRowActive()).toBe(false);
    expect(api.editing.getChanges()).toEqual([]);
    expect(api.rows.getAt(0)?.data?.amount).toBe(0);
    change(core, "0", 888);
    api.rows.purgeCache();
    expect(api.editing.getChanges()).toEqual([]);
    expect(api.rows.getCacheSnapshot().cachedRowCount).toBe(0);
    expect(api.rows.getById("0")).toBeUndefined();
  });

  it("discards a resolved old-query microtask at a reload boundary", async () => {
    let query = 0;
    let complete!: () => void;
    const { core, api } = grid({
      maxBlocksInCache: 2,
      datasource: {
        getRows({ startRow, onSuccess }) {
          const rows = [{ id: String(startRow), amount: query }];
          if (startRow === 20) complete = () => onSuccess(rows, 100);
          else onSuccess(rows, 100);
        }
      }
    });
    await tick();
    vi.spyOn(core.bodyRenderer, "getRenderedRowRange").mockReturnValue({ first: 0, lastExcl: 0 });
    const first = api.rows.ensureLoaded(20, 30);
    await tick();
    complete();
    // Stop in the real microtask gap between caching a response and installing
    // it into the row model; a new query can own the grid during that gap.
    for (let turn = 0; turn < 20 && api.rows.getCacheSnapshot().cachedBlockCount < 2; turn++) {
      await Promise.resolve();
    }
    expect(api.rows.getCacheSnapshot().cachedBlockCount).toBe(2);
    expect(api.rows.getById("20")).toBeUndefined();
    query = 1;
    const reloaded = api.rows.reload();
    await Promise.allSettled([first, reloaded]);
    expect(api.rows.getById("20")).toBeUndefined();
    expect(api.rows.getById("0")?.data?.amount).toBe(1);
    expect(api.rows.getCacheSnapshot().cachedBlockCount).toBe(1);
  });
});
