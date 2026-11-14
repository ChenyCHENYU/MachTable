import { effectScope } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaginationChangedEvent, SelectionChangedEvent } from "@agile-team/mach-table";
import { useMachTableQuery, type UseMachTableQueryOptions } from "../useMachTableQuery";

type Row = { id: string; revision: number };
const disposers: (() => void)[] = [];
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); });

function setup(selectionScope: "page" | "preserve" | "query") {
  let revision = 0;
  const request = vi.fn<UseMachTableQueryOptions<Row>["request"]>(async ({ page, pageSize }) => ({
    rows: Array.from({ length: pageSize }, (_, index) => ({ id: String((page - 1) * pageSize + index), revision: ++revision })),
    total: 2000
  }));
  const scope = effectScope();
  const remote = scope.run(() => useMachTableQuery({
    query: {}, rowKey: "id", request, mode: "manual", pageSize: 100, selectionScope
  }))!;
  disposers.push(() => scope.stop());
  const loadPage = async (page: number) => {
    remote.bindings.value.onPaginationChanged?.({ page, pageSize: 100 } as PaginationChangedEvent<Row>);
    await remote.reload();
  };
  const selectRows = (selectedRows: Row[]) => remote.bindings.value.onSelectionChanged?.({ selectedRows } as SelectionChangedEvent<Row>);
  return { remote, request, loadPage, selectRows };
}

describe("Vue query selection snapshots", () => {
  it.each(["page", "preserve", "query"] as const)("bounds allMatching snapshots to the accepted page with %s scope", async (scope) => {
    const { remote, loadPage, selectRows } = setup(scope);
    remote.selectAllMatching();
    await loadPage(1);
    selectRows(remote.rows.value.slice(2));
    const savedState = remote.selectionState.value;
    expect(remote.selectedRows.value).toEqual(remote.rows.value.slice(2));

    for (let page = 2; page <= 20; page++) {
      await loadPage(page);
      expect(remote.selectedRows.value).toEqual(remote.rows.value);
      expect(remote.selectedRows.value).toHaveLength(100);
      expect(remote.selectedKeys.value).toEqual([]);
      expect(remote.selectionState.value).toEqual({ mode: "allMatching", excludedKeys: ["0", "1"] });
    }

    await loadPage(1);
    expect(remote.selectedRows.value).toEqual(remote.rows.value.slice(2));
    selectRows([...remote.rows.value, { id: "off-page", revision: -1 }]);
    expect(remote.selectedRows.value).toEqual(remote.rows.value);
    expect(remote.selectionState.value).toEqual({ mode: "allMatching", excludedKeys: [] });
    expect(savedState).toEqual({ mode: "allMatching", excludedKeys: ["0", "1"] });
  });

  it.each(["page", "preserve", "query"] as const)("preserves explicit %s semantics when entering and leaving allMatching", async (scope) => {
    const { remote, loadPage, selectRows } = setup(scope);
    const explicitRows: Row[] = [];
    for (let page = 1; page <= 20; page++) {
      await loadPage(page);
      const selectedRow = remote.rows.value[0];
      explicitRows.push(selectedRow);
      selectRows([selectedRow]);
      expect(remote.selectedRows.value).toEqual(scope === "page" ? [selectedRow] : explicitRows);
    }
    remote.selectAllMatching();
    expect(remote.selectedRows.value).toEqual(remote.rows.value);
    expect(remote.selectedKeys.value).toEqual([]);
    remote.applySelectionState({ mode: "explicit", selectedKeys: ["0", "1900"] });
    expect(remote.selectedKeys.value).toEqual(["0", "1900"]);
    expect(remote.selectedRows.value).toEqual([remote.rows.value[0]]);
    await loadPage(1);
    expect(remote.selectedRows.value.map((row) => row.id)).toEqual(scope === "page" ? ["0"] : ["0", "1900"]);
    remote.clearSelection();
    expect(remote.selectedRows.value).toEqual([]);
    expect(remote.selectionState.value).toEqual({ mode: "explicit", selectedKeys: [] });
  });

  it("keeps the accepted allMatching snapshots after a rejected page and replaces them on retry", async () => {
    const { remote, request, loadPage } = setup("preserve");
    remote.applySelectionState({ mode: "allMatching", excludedKeys: ["101"] });
    await loadPage(1);
    const accepted = remote.selectedRows.value;
    request.mockResolvedValueOnce({ rows: [{ id: "duplicate", revision: 0 }, { id: "duplicate", revision: 1 }], total: 2000 });
    await loadPage(2);
    expect(remote.error.value).toBeInstanceOf(Error);
    expect(remote.selectedRows.value).toEqual(accepted);
    await remote.retry();
    expect(remote.selectedRows.value).toEqual(remote.rows.value.filter((row) => row.id !== "101"));
    expect(remote.selectionState.value).toEqual({ mode: "allMatching", excludedKeys: ["101"] });
  });
});
