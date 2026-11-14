import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaginationChangedEvent, SelectionChangedEvent } from "@agile-team/mach-table";
import { useMachTableQuery, type UseMachTableQueryOptions, type UseMachTableQueryReturn } from "../useMachTableQuery";

type Row = { id: string; revision: number };
const disposers: (() => Promise<void>)[] = [];
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => { for (const dispose of disposers.splice(0)) await dispose(); document.body.textContent = ""; });

async function setup(selectionScope: "page" | "preserve" | "query") {
  let revision = 0;
  const request = vi.fn<UseMachTableQueryOptions<Row>["request"]>(async ({ page, pageSize }) => ({
    rows: Array.from({ length: pageSize }, (_, index) => ({ id: String((page - 1) * pageSize + index), revision: ++revision })),
    total: 2000
  }));
  const query = {};
  let remote!: UseMachTableQueryReturn<Row>;
  function Harness() {
    remote = useMachTableQuery({ query, rowKey: "id", request, mode: "manual", pageSize: 100, selectionScope });
    return null;
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(Harness)));
  disposers.push(async () => { await act(async () => root.unmount()); });
  const loadPage = async (page: number) => {
    await act(async () => {
      remote.bindings.onPaginationChanged?.({ page, pageSize: 100 } as PaginationChangedEvent<Row>);
      await remote.reload();
    });
  };
  const selectRows = async (selectedRows: Row[]) => {
    await act(async () => remote.bindings.onSelectionChanged?.({ selectedRows } as SelectionChangedEvent<Row>));
  };
  return { get remote() { return remote; }, request, loadPage, selectRows };
}

describe("React query selection snapshots", () => {
  it.each(["page", "preserve", "query"] as const)("bounds allMatching snapshots to the accepted page with %s scope", async (scope) => {
    const fixture = await setup(scope);
    await act(async () => fixture.remote.selectAllMatching());
    await fixture.loadPage(1);
    await fixture.selectRows(fixture.remote.rows.slice(2));
    const savedState = fixture.remote.selectionState;
    expect(fixture.remote.selectedRows).toEqual(fixture.remote.rows.slice(2));

    for (let page = 2; page <= 20; page++) {
      await fixture.loadPage(page);
      expect(fixture.remote.selectedRows).toEqual(fixture.remote.rows);
      expect(fixture.remote.selectedRows).toHaveLength(100);
      expect(fixture.remote.selectedKeys).toEqual([]);
      expect(fixture.remote.selectionState).toEqual({ mode: "allMatching", excludedKeys: ["0", "1"] });
    }

    await fixture.loadPage(1);
    expect(fixture.remote.selectedRows).toEqual(fixture.remote.rows.slice(2));
    await fixture.selectRows([...fixture.remote.rows, { id: "off-page", revision: -1 }]);
    expect(fixture.remote.selectedRows).toEqual(fixture.remote.rows);
    expect(fixture.remote.selectionState).toEqual({ mode: "allMatching", excludedKeys: [] });
    expect(savedState).toEqual({ mode: "allMatching", excludedKeys: ["0", "1"] });
  });

  it.each(["page", "preserve", "query"] as const)("preserves explicit %s semantics when entering and leaving allMatching", async (scope) => {
    const fixture = await setup(scope);
    const explicitRows: Row[] = [];
    for (let page = 1; page <= 20; page++) {
      await fixture.loadPage(page);
      const selectedRow = fixture.remote.rows[0];
      explicitRows.push(selectedRow);
      await fixture.selectRows([selectedRow]);
      expect(fixture.remote.selectedRows).toEqual(scope === "page" ? [selectedRow] : explicitRows);
    }
    await act(async () => fixture.remote.selectAllMatching());
    expect(fixture.remote.selectedRows).toEqual(fixture.remote.rows);
    expect(fixture.remote.selectedKeys).toEqual([]);
    await act(async () => fixture.remote.applySelectionState({ mode: "explicit", selectedKeys: ["0", "1900"] }));
    expect(fixture.remote.selectedKeys).toEqual(["0", "1900"]);
    expect(fixture.remote.selectedRows).toEqual([fixture.remote.rows[0]]);
    await fixture.loadPage(1);
    expect(fixture.remote.selectedRows.map((row) => row.id)).toEqual(scope === "page" ? ["0"] : ["1900", "0"]);
    await act(async () => fixture.remote.clearSelection());
    expect(fixture.remote.selectedRows).toEqual([]);
    expect(fixture.remote.selectionState).toEqual({ mode: "explicit", selectedKeys: [] });
  });

  it("keeps the accepted allMatching snapshots after a rejected page and replaces them on retry", async () => {
    const fixture = await setup("preserve");
    await act(async () => fixture.remote.applySelectionState({ mode: "allMatching", excludedKeys: ["101"] }));
    await fixture.loadPage(1);
    const accepted = fixture.remote.selectedRows;
    fixture.request.mockResolvedValueOnce({ rows: [{ id: "duplicate", revision: 0 }, { id: "duplicate", revision: 1 }], total: 2000 });
    await fixture.loadPage(2);
    expect(fixture.remote.error).toBeInstanceOf(Error);
    expect(fixture.remote.selectedRows).toEqual(accepted);
    await act(async () => { await fixture.remote.retry(); });
    expect(fixture.remote.selectedRows).toEqual(fixture.remote.rows.filter((row) => row.id !== "101"));
    expect(fixture.remote.selectionState).toEqual({ mode: "allMatching", excludedKeys: ["101"] });
  });
});
