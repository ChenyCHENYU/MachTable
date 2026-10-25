// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createGrid } from "../core/createGrid";
import { bindServerSideGrid, createServerSideGroupColumn, createServerSideStore, serverSideDataColumn } from "../server-side";
import type { GridApi } from "../types/api";
import type { ServerSideProjection } from "../server-side";

interface Row { name: string; amount: number }
const apis: GridApi<ServerSideProjection<Row>>[] = [];
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
afterEach(() => { for (const api of apis.splice(0)) api.destroy(); document.body.replaceChildren(); });

describe("server-side grid projection binding", () => {
  it("uses real grid controls for expansion, aggregate cells, route paging and hierarchy selection", async () => {
    const store = createServerSideStore<Row>({ blockSize: 1, retryCount: 0,
      query: { rowGroupCols: [{ colId: "name" }], valueCols: [{ colId: "amount", aggFunc: "sum" }] },
      getRows: async request => ({ rows: request.route.length
        ? [{ id: String(request.startRow), data: { name: `Order ${request.startRow}`, amount: request.startRow + 10 } }]
        : [{ id: "A", groupKey: "A", data: { name: "A", amount: 0 }, aggValues: { amount: 21 } }],
      rowCount: request.route.length ? 2 : 1, revision: "1" })
    });
    const host = document.createElement("div");
    Object.defineProperties(host, { clientWidth: { value: 900 }, clientHeight: { value: 400 } });
    document.body.appendChild(host);
    const api = createGrid<ServerSideProjection<Row>>(host, { rowData: [], columnDefs: [
      createServerSideGroupColumn(store), serverSideDataColumn<Row>("amount", { width: 130 })
    ] });
    apis.push(api); bindServerSideGrid(api, store); await tick();
    expect(host.querySelector('.mach-cell[data-col-id="amount"]')?.textContent).toBe("21");
    const expand = host.querySelector<HTMLButtonElement>('button[aria-label="展开 A"]')!;
    expect(expand).toBeTruthy(); expand.click(); await tick();
    expect(api.rows.getCount()).toBe(2);
    expect(host.querySelector('button[aria-label="收起 A"]')).toBeTruthy();
    const select = host.querySelector<HTMLInputElement>('input[aria-label="选择 A"]')!;
    select.click(); await tick();
    expect(store.getSnapshot().selection.selectedRoutes).toEqual([["A"]]);
    const groupCell = host.querySelector('.mach-row[data-index="0"] .mach-cell[data-col-id="__server_group"]')!;
    const next = [...groupCell.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "下一页")!;
    next.click(); await tick();
    expect(api.rows.getAt(1)?.data?.data.amount).toBe(11);
    expect(store.getSelection(store.getSnapshot().rows[1])).toBe("selected");
    api.sorting.setModel([{ colId: "amount", direction: "desc" }]); await tick();
    expect(store.getSnapshot().query.sortModel).toEqual([{ colId: "amount", direction: "desc" }]);
    api.destroy();
    await expect(store.load()).rejects.toMatchObject({ name: "AbortError" });
  });

  it.each(["dirty", "cell", "row"])("holds new projection until %s state is explicitly released", async mode => {
    const store = createServerSideStore<Row>({ blockSize: 1, retryCount: 0,
      query: { rowGroupCols: [{ colId: "name" }] },
      getRows: async request => ({ rows: request.route.length
        ? [{ id: String(request.startRow), data: { name: `Order ${request.startRow}`, amount: request.startRow + 10 } }]
        : [{ id: "A", groupKey: "A", data: { name: "A", amount: 0 } }],
      rowCount: request.route.length ? 2 : 1, revision: "1" })
    });
    const host = document.createElement("div");
    Object.defineProperties(host, { clientWidth: { value: 900 }, clientHeight: { value: 400 } });
    document.body.appendChild(host);
    const api = createGrid<ServerSideProjection<Row>>(host, { rowData: [], columnDefs: [
      createServerSideGroupColumn(store), { colId: "amount", field: "data.amount", editable: true }
    ] });
    apis.push(api); bindServerSideGrid(api, store); await tick(); await store.expand(["A"]);
    expect(mode === "row" ? api.editing.startRow(1) : api.editing.startCell({ rowIndex: 1, colId: "amount" })).toBe(true);
    host.querySelector<HTMLInputElement>('.mach-row[data-index="1"] .mach-editor-input')!.value = "99";
    if (mode === "dirty") await api.editing.stop();
    await store.load(["A"], 1);
    expect(store.getSnapshot().rows[1].data.amount).toBe(11);
    expect(api.rows.getAt(1)?.data?.id).toBe("0");
    expect(host.querySelector('[data-server-pending="true"]')).toBeTruthy();
    expect(host.querySelector('.mach-server-sync-notice[role="status"]')?.textContent).toContain("新数据等待显示");
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="收起 A"]')?.disabled).toBe(true);
    if (mode === "dirty") {
      expect(api.editing.getChanges()).toHaveLength(1);
      api.editing.markSaved();
    } else await api.editing.stop({ cancel: true });
    await tick();
    expect(api.rows.getAt(1)?.data?.id).toBe("1");
    expect(api.rows.getAt(1)?.data?.data.amount).toBe(11);
    expect(host.querySelector(".mach-server-sync-notice")).toBeNull();
    expect(api.editing.getChanges()).toEqual([]);
  });
});
