import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GridApi, PaginationChangedEvent, SortChangedEvent } from "@agile-team/mach-table";
import { useMachTableQuery, type MachTablePageResult, type UseMachTableQueryOptions, type UseMachTableQueryReturn } from "../useMachTableQuery";

type Row = { id: string };
const disposers: (() => Promise<void>)[] = [];
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => { for (const dispose of disposers.splice(0)) await dispose(); document.body.textContent = ""; });

function deferred() {
  let resolve!: (result: MachTablePageResult<Row>) => void;
  const promise = new Promise<MachTablePageResult<Row>>((done) => { resolve = done; });
  return { promise, resolve };
}

async function setup(options: Partial<UseMachTableQueryOptions<Row, { status: string }>> = {}) {
  let query = { status: "old" };
  const request = vi.fn<UseMachTableQueryOptions<Row, { status: string }>["request"]>();
  const onSuccess = vi.fn();
  let remote!: UseMachTableQueryReturn<Row>;
  function Harness() {
    remote = useMachTableQuery({ query, request, onSuccess, rowKey: "id", initialPage: 3,
      pageSize: 2, immediate: false, ...options });
    return null;
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(Harness)));
  disposers.push(async () => { await act(async () => root.unmount()); });
  return {
    get remote() { return remote; }, request, onSuccess,
    async changeQuery() { query = { status: "new" }; await act(async () => root.render(createElement(Harness))); }
  };
}

describe("React remote page recovery", () => {
  it("reloads the last valid page once without publishing an empty page or pruning selection", async () => {
    const fixture = await setup({ selectionScope: "page" });
    const { request, onSuccess } = fixture;
    const existing = { id: "shared" };
    request.mockResolvedValueOnce({ rows: [existing], total: 5 });
    await act(async () => { await fixture.remote.reload(); });
    await act(async () => fixture.remote.applySelectionState({ mode: "explicit", selectedKeys: ["shared"] }));
    const recovered = deferred();
    request.mockResolvedValueOnce({ rows: [], total: 4 }).mockReturnValueOnce(recovered.promise);
    let pending!: Promise<void>;
    await act(async () => { pending = fixture.remote.reload(); });
    expect(request).toHaveBeenCalledTimes(3);
    expect(fixture.remote.rows).toEqual([existing]);
    expect(fixture.remote.selectedKeys).toEqual(["shared"]);
    expect(fixture.remote.page).toBe(3);
    expect(fixture.remote.loading).toBe(true);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    const result = { rows: [{ id: "shared" }, { id: "last" }], total: 4 };
    await act(async () => { recovered.resolve(result); await pending; });
    expect(request.mock.calls.map(([params]) => params.page)).toEqual([3, 3, 2]);
    expect(fixture.remote.page).toBe(2);
    expect(fixture.remote.total).toBe(4);
    expect(fixture.remote.rows).toEqual(result.rows);
    expect(fixture.remote.selectedKeys).toEqual(["shared"]);
    expect(fixture.remote.selectedRows[0]).toBe(result.rows[0]);
    expect(onSuccess).toHaveBeenLastCalledWith(result);
    expect(onSuccess).toHaveBeenCalledTimes(2);
    expect(fixture.remote.loading).toBe(false);
  });

  it("jumps across multiple removed pages and normalizes a completely empty result without another request", async () => {
    const fixture = await setup({ initialPage: 9 });
    const { request } = fixture;
    request.mockResolvedValueOnce({ rows: [], total: 3 }).mockResolvedValueOnce({ rows: [{ id: "last" }], total: 3 });
    await act(async () => { await fixture.remote.reload(); });
    expect(request.mock.calls.map(([params]) => params.page)).toEqual([9, 2]);
    expect(fixture.remote.page).toBe(2);
    request.mockResolvedValueOnce({ rows: [], total: 0 });
    await act(async () => { await fixture.remote.reload(); });
    expect(request).toHaveBeenCalledTimes(3);
    expect(fixture.remote.page).toBe(1);
    expect(fixture.remote.rows).toEqual([]);
    expect(fixture.remote.total).toBe(0);
  });

  it("bounds recovery when totals keep shrinking and lets explicit retry recover", async () => {
    const fixture = await setup({ initialPage: 9 });
    const { request, onSuccess } = fixture;
    request.mockResolvedValueOnce({ rows: [{ id: "kept" }], total: 17 });
    await act(async () => { await fixture.remote.reload(); });
    await act(async () => fixture.remote.applySelectionState({ mode: "explicit", selectedKeys: ["kept"] }));
    request.mockResolvedValueOnce({ rows: [], total: 10 }).mockResolvedValueOnce({ rows: [], total: 4 });
    await act(async () => { await fixture.remote.reload(); });
    expect(request.mock.calls.map(([params]) => params.page)).toEqual([9, 9, 5]);
    expect(fixture.remote.error).toBeInstanceOf(RangeError);
    expect(fixture.remote.rows).toEqual([{ id: "kept" }]);
    expect(fixture.remote.page).toBe(9);
    expect(fixture.remote.total).toBe(17);
    expect(fixture.remote.selectedKeys).toEqual(["kept"]);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    request.mockResolvedValueOnce({ rows: [], total: 4 }).mockResolvedValueOnce({ rows: [{ id: "fresh" }], total: 4 });
    await act(async () => { await fixture.remote.retry(); });
    expect(fixture.remote.error).toBeNull();
    expect(fixture.remote.page).toBe(2);
    expect(fixture.remote.rows).toEqual([{ id: "fresh" }]);
  });

  it("cancels recovery on a new query even when the backend ignores its signal", async () => {
    const fixture = await setup({ initialPage: 9 });
    const { request, onSuccess } = fixture;
    const recovered = deferred();
    request.mockResolvedValueOnce({ rows: [], total: 10 }).mockReturnValueOnce(recovered.promise)
      .mockResolvedValueOnce({ rows: [{ id: "new" }], total: 1 });
    let pending!: Promise<void>;
    await act(async () => { pending = fixture.remote.reload(); });
    expect(request).toHaveBeenCalledTimes(2);
    await fixture.changeQuery();
    await act(async () => { await pending; });
    await act(async () => { recovered.resolve({ rows: [{ id: "stale" }], total: 10 }); });
    expect(request.mock.calls.map(([params]) => params.page)).toEqual([9, 5, 1]);
    expect(fixture.remote.page).toBe(1);
    expect(fixture.remote.rows).toEqual([{ id: "new" }]);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("does not start recovery for an obsolete response", async () => {
    const fixture = await setup({ initialPage: 9 });
    const { request, onSuccess } = fixture;
    const old = deferred();
    request.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ rows: [{ id: "new" }], total: 1 });
    let pending!: Promise<void>;
    await act(async () => { pending = fixture.remote.reload(); });
    await act(async () => { await fixture.remote.reload({ resetPage: true }); await pending; });
    await act(async () => { old.resolve({ rows: [], total: 10 }); });
    expect(request).toHaveBeenCalledTimes(2);
    expect(fixture.remote.rows).toEqual([{ id: "new" }]);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it.each([
    { rows: [{ id: "duplicate" }, { id: "duplicate" }], total: 4 },
    { rows: [], total: -1 }
  ])("keeps the accepted state when recovery returns invalid rows or totals", async (invalid) => {
    const fixture = await setup({ selectionScope: "page" });
    const { request, onSuccess } = fixture;
    request.mockResolvedValueOnce({ rows: [{ id: "kept" }], total: 5 });
    await act(async () => { await fixture.remote.reload(); });
    await act(async () => fixture.remote.applySelectionState({ mode: "explicit", selectedKeys: ["kept"] }));
    request.mockResolvedValueOnce({ rows: [], total: 4 }).mockResolvedValueOnce(invalid);
    await act(async () => { await fixture.remote.reload(); });
    expect(fixture.remote.error).toBeInstanceOf(Error);
    expect(fixture.remote.page).toBe(3);
    expect(fixture.remote.total).toBe(5);
    expect(fixture.remote.rows).toEqual([{ id: "kept" }]);
    expect(fixture.remote.selectedKeys).toEqual(["kept"]);
    expect(request).toHaveBeenCalledTimes(3);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("aborts manual recovery without refetching and safely consumes a late backend rejection", async () => {
    const fixture = await setup({ mode: "manual" });
    const { request, onSuccess } = fixture;
    let reject!: (error: Error) => void;
    const recovered = new Promise<MachTablePageResult<Row>>((_, fail) => { reject = fail; });
    request.mockResolvedValueOnce({ rows: [], total: 4 }).mockReturnValueOnce(recovered);
    let pending!: Promise<void>;
    await act(async () => { pending = fixture.remote.reload(); });
    expect(request).toHaveBeenCalledTimes(2);
    await fixture.changeQuery();
    await act(async () => { await pending; reject(new Error("late server failure")); });
    expect(request.mock.calls[1][0].signal.aborted).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
    expect(fixture.remote.page).toBe(1);
    expect(fixture.remote.error).toBeNull();
    expect(fixture.remote.loading).toBe(false);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it.each(["query", "page", "sort", "filter", "quick"] as const)("invalidates manual %s changes without issuing another request", async (change) => {
    const fixture = await setup({ mode: "manual" });
    const { request, onSuccess } = fixture;
    const old = deferred();
    request.mockReturnValueOnce(old.promise);
    let pending!: Promise<void>;
    await act(async () => { pending = fixture.remote.reload(); });
    if (change === "query") await fixture.changeQuery();
    else await act(async () => {
      if (change === "quick") fixture.remote.setQuickFilterText("new");
      if (change === "page") fixture.remote.bindings.onPaginationChanged?.({ page: 2, pageSize: 2 } as PaginationChangedEvent<Row>);
      if (change === "sort") fixture.remote.bindings.onSortChanged?.({ sortModel: [{ colId: "id", direction: "asc" }] } as SortChangedEvent<Row>);
      if (change === "filter") fixture.remote.bindings.onFilterChanged?.({
        type: "filterChanged", advancedFilterModel: null,
        filterModel: { id: { type: "text", conditions: [{ match: "contains", value: "new" }] } },
        api: { filtering: { getQuickText: () => null }, selection: { clear: vi.fn() } } as unknown as GridApi<Row>
      });
    });
    expect(request.mock.calls[0][0].signal.aborted).toBe(true);
    await act(async () => { await pending; old.resolve({ rows: [{ id: "old" }], total: 10 }); });
    expect(request).toHaveBeenCalledTimes(1);
    expect(fixture.remote.rows).toEqual([]);
    expect(fixture.remote.loading).toBe(false);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("keeps a fresh manual reload when the mounted grid echoes submitted criteria", async () => {
    const fixture = await setup({ mode: "manual" });
    const { request, onSuccess } = fixture;
    await act(async () => fixture.remote.setQuickFilterText("new"));
    const result = deferred();
    request.mockReturnValueOnce(result.promise);
    let pending!: Promise<void>;
    await act(async () => { pending = fixture.remote.reload(); });
    await act(async () => fixture.remote.bindings.onFilterChanged?.({
      type: "filterChanged", filterModel: {}, advancedFilterModel: null,
      api: { isDestroyed: () => false, filtering: { getQuickText: () => "new" }, selection: { clear: vi.fn(), setRows: vi.fn() } } as unknown as GridApi<Row>
    }));
    expect(request.mock.calls[0][0].signal.aborted).toBe(false);
    await act(async () => { result.resolve({ rows: [{ id: "new" }], total: 1 }); await pending; });
    expect(fixture.remote.rows).toEqual([{ id: "new" }]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});
