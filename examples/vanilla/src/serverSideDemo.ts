import "@agile-team/mach-table/styles/server-side.css";
import { createGrid, type GridApi } from "@agile-team/mach-table";
import {
  bindServerSideGrid, createServerSideGroupColumn, createServerSideStore, serverSideDataColumn,
  ServerSideVersionConflictError, type ServerSideProjection, type ServerSideQuery
} from "@agile-team/mach-table/server-side";

interface Order { id: string; orderNo: string; region: string; amount: number; status: string }

/** A deliberately local backend simulation demonstrates the real route/CAS protocol. */
export function installServerSideDemo<T>(parentApi: GridApi<T>): void {
  const section = document.createElement("section"); section.id = "serverSideDemo";
  section.style.marginTop = "24px";
  const heading = document.createElement("h2"); heading.textContent = "服务端分组与聚合 · 模拟接口";
  const description = document.createElement("p");
  description.textContent = "按区域展开订单，每层独立翻页；聚合与版本事务由本地模拟服务端返回。这里展示 route Store 协议，不会发出真实业务写入。";
  const tools = document.createElement("div"); tools.className = "toolbar";
  const search = document.createElement("input"); search.placeholder = "按区域或订单号搜索";
  search.setAttribute("aria-label", "服务端订单搜索");
  const status = document.createElement("p"); status.setAttribute("role", "status"); status.style.minHeight = "20px";
  const host = document.createElement("div"); host.id = "serverSideHost"; host.style.height = "380px";
  section.append(heading, description, tools, status, host); document.querySelector("main")?.append(section);
  if (!section.isConnected) document.body.append(section);
  const regions = ["华东", "华南", "华北"];
  let rows: Order[] = Array.from({ length: 18 }, (_, index) => ({ id: String(index + 1),
    orderNo: `SS-${String(index + 1).padStart(4, "0")}`, region: regions[index % 3],
    amount: 1_000 + index * 150, status: index % 2 ? "履约中" : "待确认" }));
  let revision = 1;
  const matching = (query: ServerSideQuery) => {
    const text = query.quickFilterText?.trim().toLowerCase() ?? "";
    return rows.filter(row => !text || `${row.region} ${row.orderNo}`.toLowerCase().includes(text));
  };
  const store = createServerSideStore<Order>({ blockSize: 2, maxBlocks: 8,
    query: { rowGroupCols: [{ colId: "region" }], valueCols: [{ colId: "amount", aggFunc: "sum" }] },
    async getRows(request) {
      await new Promise(resolve => setTimeout(resolve, 120));
      if (request.signal.aborted) throw new DOMException("Cancelled", "AbortError");
      const records = matching(request);
      let result = request.route.length
        ? records.filter(row => row.region === request.route[0]).map(data => ({ id: data.id, data }))
        : regions.flatMap(region => {
          const children = records.filter(row => row.region === region);
          if (!children.length) return [];
          const amount = children.reduce((sum, row) => sum + row.amount, 0);
          return [{ id: region, groupKey: region, childCount: children.length, aggValues: { amount },
            data: { id: region, orderNo: region, region, amount, status: "分组汇总" } }];
        });
      for (const sort of [...request.sortModel].reverse()) {
        result = result.sort((left, right) => {
          const a = left.data[sort.colId as keyof Order], b = right.data[sort.colId as keyof Order];
          const comparison = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
          return sort.direction === "asc" ? comparison : -comparison;
        });
      }
      return { rows: result.slice(request.startRow, request.endRow), rowCount: result.length, revision: String(revision) };
    },
    async transact(transaction) {
      if (transaction.expectedRevision !== String(revision)) throw new ServerSideVersionConflictError(transaction.expectedRevision, String(revision));
      const updates = new Map(transaction.update?.map(row => [row.id, row.data]));
      rows = rows.filter(row => !transaction.remove?.includes(row.id)).map(row => updates.get(row.id) ?? row);
      rows.push(...(transaction.add?.map(row => row.data) ?? []));
      return { revision: String(++revision) };
    }, onError: error => { status.textContent = `加载失败：${String(error)}`; }
  });
  const api = createGrid<ServerSideProjection<Order>>(host, { rowData: [], theme: parentApi.getOption("theme"),
    columnDefs: [createServerSideGroupColumn(store, { headerName: "区域 / 订单", width: 480, label: row => row.groupKey ?? row.data.orderNo }),
      serverSideDataColumn<Order>("amount", { headerName: "金额", width: 160, sortable: true, filter: false }),
      serverSideDataColumn<Order>("status", { headerName: "状态", width: 140, filter: false })] });
  bindServerSideGrid(api, store);
  search.addEventListener("input", () => api.filtering.setQuickText(search.value || null)); tools.append(search);
  const addButton = (label: string, action: () => void | Promise<void>) => {
    const button = document.createElement("button"); button.type = "button"; button.textContent = label;
    button.addEventListener("click", () => { void Promise.resolve().then(action).catch(error => {
      status.textContent = error instanceof ServerSideVersionConflictError ? "版本冲突：请先刷新并审阅，再提交模拟事务。" : String(error);
    }); }); tools.append(button);
  };
  addButton("模拟增加订单金额", async () => {
    const group = store.getSnapshot().rows.find(row => row.groupKey !== undefined);
    if (!group?.groupKey) return;
    await store.expand([group.groupKey]);
    const child = store.getSnapshot().rows.find(row => row.route[0] === group.groupKey && row.groupKey === undefined);
    const route = store.getSnapshot().routes.find(item => item.route[0] === group.groupKey);
    if (!child || !route?.revision) return;
    await store.transact({ route: [group.groupKey], expectedRevision: route.revision,
      update: [{ id: child.id, data: { ...child.data, amount: child.data.amount + 1_000 } }] });
    status.textContent = "模拟事务成功，父级总金额已从服务端刷新。";
  });
  addButton("模拟并发版本变化", () => { revision++; status.textContent = "模拟服务端版本已变化，旧版本提交将被拒绝。"; });
  addButton("刷新服务端视图", () => store.refresh());
  const themeButton = document.getElementById("btnTheme");
  const syncTheme = () => api.updateOptions({ theme: parentApi.getOption("theme") });
  themeButton?.addEventListener("click", syncTheme);
  parentApi.on("gridDestroyed", () => { themeButton?.removeEventListener("click", syncTheme); api.destroy(); section.remove(); });
}
