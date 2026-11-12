import { effectScope, nextTick, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GridApi, PaginationChangedEvent, SortChangedEvent } from "@agile-team/mach-table";
import { useMachTableQuery, type MachTablePageResult, type UseMachTableQueryOptions } from "../useMachTableQuery";

type Row = { id: string };
const disposers: (() => void)[] = [];
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); });

function deferred() {
  let resolve!: (result: MachTablePageResult<Row>) => void;
  const promise = new Promise<MachTablePageResult<Row>>((done) => { resolve = done; });
  return { promise, resolve };
}

function setup(options: Partial<UseMachTableQueryOptions<Row, { status: string }>> = {}) {
  const query = ref({ status: "old" });
  const quickFilterText = ref<string | null>(null);
  const request = vi.fn<UseMachTableQueryOptions<Row, { status: string }>["request"]>();
  const onSuccess = vi.fn();
  const scope = effectScope();
  const remote = scope.run(() => useMachTableQuery({
    query, quickFilterText, request, onSuccess, rowKey: "id", initialPage: 3,
    pageSize: 2, immediate: false, ...options
  }))!;
  disposers.push(() => scope.stop());
  return { remote, request, onSuccess, query, quickFilterText };
}

describe("Vue remote page recovery", () => {
  it("reloads the last valid page once without publishing an empty page or pruning selection", async () => {
    const { remote, request, onSuccess } = setup({ selectionScope: "page" });
    const existing = { id: "shared" };
    request.mockResolvedValueOnce({ rows: [existing], total: 5 });
    await remote.reload();
    remote.applySelectionState({ mode: "explicit", selectedKeys: ["shared"] });
    const recovered = deferred();
    request.mockResolvedValueOnce({ rows: [], total: 4 }).mockReturnValueOnce(recovered.promise);
    const pending = remote.reload();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    expect(remote.rows.value).toEqual([existing]);
    expect(remote.selectedKeys.value).toEqual(["shared"]);
    expect(remote.page.value).toBe(3);
    expect(remote.loading.value).toBe(true);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    const result = { rows: [{ id: "shared" }, { id: "last" }], total: 4 };
    recovered.resolve(result);
    await pending;
    expect(request.mock.calls.map(([params]) => params.page)).toEqual([3, 3, 2]);
    expect(remote.page.value).toBe(2);
    expect(remote.total.value).toBe(4);
    expect(remote.rows.value).toEqual(result.rows);
    expect(remote.selectedKeys.value).toEqual(["shared"]);
    expect(remote.selectedRows.value[0]).toBe(result.rows[0]);
    expect(onSuccess).toHaveBeenLastCalledWith(result);
    expect(onSuccess).toHaveBeenCalledTimes(2);
    expect(remote.loading.value).toBe(false);
  });

  it("jumps across multiple removed pages and normalizes a completely empty result without another request", async () => {
    const { remote, request } = setup({ initialPage: 9 });
    request.mockResolvedValueOnce({ rows: [], total: 3 }).mockResolvedValueOnce({ rows: [{ id: "last" }], total: 3 });
    await remote.reload();
    expect(request.mock.calls.map(([params]) => params.page)).toEqual([9, 2]);
    expect(remote.page.value).toBe(2);
    request.mockResolvedValueOnce({ rows: [], total: 0 });
    await remote.reload();
    expect(request).toHaveBeenCalledTimes(3);
    expect(remote.page.value).toBe(1);
    expect(remote.rows.value).toEqual([]);
    expect(remote.total.value).toBe(0);
  });

  it("bounds recovery when totals keep shrinking and lets explicit retry recover", async () => {
    const { remote, request, onSuccess } = setup({ initialPage: 9 });
    request.mockResolvedValueOnce({ rows: [{ id: "kept" }], total: 17 });
    await remote.reload();
    remote.applySelectionState({ mode: "explicit", selectedKeys: ["kept"] });
    request.mockResolvedValueOnce({ rows: [], total: 10 }).mockResolvedValueOnce({ rows: [], total: 4 });
    await remote.reload();
    expect(request.mock.calls.map(([params]) => params.page)).toEqual([9, 9, 5]);
    expect(remote.error.value).toBeInstanceOf(RangeError);
    expect(remote.rows.value).toEqual([{ id: "kept" }]);
    expect(remote.page.value).toBe(9);
    expect(remote.total.value).toBe(17);
    expect(remote.selectedKeys.value).toEqual(["kept"]);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    request.mockResolvedValueOnce({ rows: [], total: 4 }).mockResolvedValueOnce({ rows: [{ id: "fresh" }], total: 4 });
    await remote.retry();
    expect(remote.error.value).toBeNull();
    expect(remote.page.value).toBe(2);
    expect(remote.rows.value).toEqual([{ id: "fresh" }]);
  });

  it("cancels recovery on a new query even when the backend ignores its signal", async () => {
    const { remote, request, query, onSuccess } = setup({ initialPage: 9 });
    const recovered = deferred();
    request.mockResolvedValueOnce({ rows: [], total: 10 }).mockReturnValueOnce(recovered.promise)
      .mockResolvedValueOnce({ rows: [{ id: "new" }], total: 1 });
    const pending = remote.reload();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    query.value = { status: "new" };
    await nextTick();
    await pending;
    await vi.waitFor(() => expect(remote.rows.value).toEqual([{ id: "new" }]));
    recovered.resolve({ rows: [{ id: "stale" }], total: 10 });
    await nextTick();
    expect(request.mock.calls.map(([params]) => params.page)).toEqual([9, 5, 1]);
    expect(remote.page.value).toBe(1);
    expect(remote.rows.value).toEqual([{ id: "new" }]);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("does not start recovery for an obsolete response", async () => {
    const { remote, request, onSuccess } = setup({ initialPage: 9 });
    const old = deferred();
    request.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ rows: [{ id: "new" }], total: 1 });
    const pending = remote.reload();
    await remote.reload({ resetPage: true });
    await pending;
    old.resolve({ rows: [], total: 10 });
    await nextTick();
    expect(request).toHaveBeenCalledTimes(2);
    expect(remote.rows.value).toEqual([{ id: "new" }]);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it.each([
    { rows: [{ id: "duplicate" }, { id: "duplicate" }], total: 4 },
    { rows: [], total: -1 }
  ])("keeps the accepted state when recovery returns invalid rows or totals", async (invalid) => {
    const { remote, request, onSuccess } = setup({ selectionScope: "page" });
    request.mockResolvedValueOnce({ rows: [{ id: "kept" }], total: 5 });
    await remote.reload();
    remote.applySelectionState({ mode: "explicit", selectedKeys: ["kept"] });
    request.mockResolvedValueOnce({ rows: [], total: 4 }).mockResolvedValueOnce(invalid);
    await remote.reload();
    expect(remote.error.value).toBeInstanceOf(Error);
    expect(remote.page.value).toBe(3);
    expect(remote.total.value).toBe(5);
    expect(remote.rows.value).toEqual([{ id: "kept" }]);
    expect(remote.selectedKeys.value).toEqual(["kept"]);
    expect(request).toHaveBeenCalledTimes(3);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("aborts manual recovery without refetching and safely consumes a late backend rejection", async () => {
    const { remote, request, query, onSuccess } = setup({ mode: "manual" });
    let reject!: (error: Error) => void;
    const recovered = new Promise<MachTablePageResult<Row>>((_, fail) => { reject = fail; });
    request.mockResolvedValueOnce({ rows: [], total: 4 }).mockReturnValueOnce(recovered);
    const pending = remote.reload();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    query.value = { status: "new" };
    await nextTick();
    await pending;
    reject(new Error("late server failure"));
    await nextTick();
    expect(request.mock.calls[1][0].signal.aborted).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
    expect(remote.page.value).toBe(1);
    expect(remote.error.value).toBeNull();
    expect(remote.loading.value).toBe(false);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it.each(["query", "page", "sort", "filter", "quick"] as const)("invalidates manual %s changes without issuing another request", async (change) => {
    const { remote, request, query, quickFilterText, onSuccess } = setup({ mode: "manual" });
    const old = deferred();
    request.mockReturnValueOnce(old.promise);
    const pending = remote.reload();
    if (change === "query") query.value = { status: "new" };
    if (change === "quick") quickFilterText.value = "new";
    if (change === "page") remote.bindings.value.onPaginationChanged?.({ page: 2, pageSize: 2 } as PaginationChangedEvent<Row>);
    if (change === "sort") remote.bindings.value.onSortChanged?.({ sortModel: [{ colId: "id", direction: "asc" }] } as SortChangedEvent<Row>);
    if (change === "filter") remote.bindings.value.onFilterChanged?.({
      type: "filterChanged", advancedFilterModel: null,
      filterModel: { id: { type: "text", conditions: [{ match: "contains", value: "new" }] } },
      api: { filtering: { getQuickText: () => null } } as unknown as GridApi<Row>
    });
    await nextTick();
    expect(request.mock.calls[0][0].signal.aborted).toBe(true);
    await pending;
    old.resolve({ rows: [{ id: "old" }], total: 10 });
    await nextTick();
    expect(request).toHaveBeenCalledTimes(1);
    expect(remote.rows.value).toEqual([]);
    expect(remote.loading.value).toBe(false);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("keeps a fresh manual reload when the mounted grid echoes submitted criteria", async () => {
    const { remote, request, quickFilterText, onSuccess } = setup({ mode: "manual" });
    quickFilterText.value = "new";
    const result = deferred();
    request.mockReturnValueOnce(result.promise);
    const pending = remote.reload();
    remote.bindings.value.onFilterChanged?.({
      type: "filterChanged", filterModel: {}, advancedFilterModel: null,
      api: { filtering: { getQuickText: () => "new" } } as unknown as GridApi<Row>
    });
    expect(request.mock.calls[0][0].signal.aborted).toBe(false);
    result.resolve({ rows: [{ id: "new" }], total: 1 });
    await pending;
    expect(remote.rows.value).toEqual([{ id: "new" }]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});
