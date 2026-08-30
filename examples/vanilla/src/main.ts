import "@agile-team/mach-table/styles/mach-table.css";
import { createGrid, buildColDefsFromSchema } from "@agile-team/mach-table";
import type { GridApi, ColDef, CellRendererParams, DetailRowRendererParams } from "@agile-team/mach-table";

interface MachineRow {
  id: string;
  code: string;
  name: string;
  workshop: string;
  status: "运行中" | "待机" | "故障";
  temperature: number;
  output: number;
  updatedAt: string;
}

const WORKSHOPS = ["炼钢一车间", "炼钢二车间", "轧钢车间", "连铸车间", "能源车间"];
const STATUSES: MachineRow["status"][] = ["运行中", "待机", "故障"];

function makeRows(count: number): MachineRow[] {
  const rows: MachineRow[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      id: `M${100000 + i}`,
      code: `RG-${String(i + 1).padStart(5, "0")}`,
      name: `${i % 3 === 0 ? "智能" : i % 3 === 1 ? "高速" : "精密"}设备-${i + 1}号`,
      workshop: WORKSHOPS[i % WORKSHOPS.length],
      status: STATUSES[i % 17 === 0 ? 2 : i % 5 === 0 ? 1 : 0],
      temperature: Math.round((30 + Math.random() * 60) * 10) / 10,
      output: Math.round(500 + Math.random() * 4500),
      updatedAt: new Date(Date.now() - Math.random() * 1000 * 60 * 60 * 72).toISOString()
    });
  }
  return rows;
}

function statusRenderer(params: CellRendererParams<MachineRow>) {
  const value = params.value as MachineRow["status"];
  const cls = value === "运行中" ? "badge-active" : value === "故障" ? "badge-error" : "badge-idle";
  const badge = document.createElement("span");
  badge.className = `status-badge ${cls}`;
  badge.textContent = value;
  return badge;
}

const columnDefs: ColDef<MachineRow>[] = [
  {
    colId: "select",
    headerName: "",
    width: 46,
    pinned: "left",
    checkboxSelection: true,
    resizable: false,
    sortable: false,
    movable: false
  },
  { field: "code", headerName: "设备编号", width: 120, pinned: "left", filter: "text", editable: true },
  { field: "name", headerName: "设备名称", flex: 1, filter: "text", editable: true },
  { field: "workshop", headerName: "车间", width: 130, filter: "set" },
  {
    field: "status",
    headerName: "状态",
    width: 110,
    filter: "set",
    cellRenderer: statusRenderer
  },
  {
    field: "temperature",
    headerName: "温度 (℃)",
    width: 110,
    filter: "number",
    editable: true,
    valueFormatter: (p) => `${p.value} ℃`
  },
  {
    field: "output",
    headerName: "产出 (吨)",
    width: 120,
    filter: "number",
    editable: true,
    type: "rightAligned"
  },
  {
    field: "updatedAt",
    headerName: "更新时间",
    width: 150,
    filter: "date",
    valueFormatter: (p) => String(p.value ?? "").slice(0, 16).replace("T", " ")
  }
];

const host = document.getElementById("gridHost")!;
const logEl = document.getElementById("log")!;
const infoEl = document.getElementById("info")!;

let theme = "light";

const api: GridApi<MachineRow> = createGrid<MachineRow>(host, {
  columnDefs,
  rowData: makeRows(10000),
  rowSelection: "multiple",
  getRowId: (params) => params.data.id,
  rowBuffer: 10,
  size: "compact",
  stripedRows: true,
  pagination: false,
  columnMenu: true,
  enableColumnResize: true,
  columnStateKey: "demo-main-grid",
  enableRangeSelection: true,
  contextMenu: true,
  statusBar: true,
  defaultColDef: { filter: true },
  overlayNoRowsTemplate: () => {
    const message = document.createElement("span");
    message.className = "mach-overlay-text";
    message.textContent = "没有符合条件的数据";
    return message;
  },
  onGridReady: () => appendLog("grid ready"),
  onSelectionChanged: (e) => {
    infoEl.textContent = `已选中 ${e.selectedRows.length} 行`;
  },
  onCellValueChanged: (e) => {
    appendLog(`单元格更新: ${e.colDef.field} = ${e.newValue} (行 ${e.rowIndex + 1})`);
  },
  onSortChanged: (e) => {
    appendLog(`排序变更: ${e.sortModel.map((s) => `${s.colId}:${s.direction}`).join(", ") || "无"}`);
  },
  onFilterChanged: () => {
    appendLog(`过滤后剩余 ${api.getDisplayedRowCount()} 行`);
  }
});

function appendLog(text: string) {
  const line = document.createElement("div");
  line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  logEl.prepend(line);
  while (logEl.childElementCount > 30) logEl.lastChild?.remove();
}

document.getElementById("quickFilter")!.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    api.setQuickFilter((e.target as HTMLInputElement).value);
  }
});

document.getElementById("btnCsv")!.addEventListener("click", () => {
  const csv = api.getDataAsCsv({ prependBOM: true });
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "mach-table-export.csv";
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("sizeSel")!.addEventListener("change", (e) => {
  api.updateOptions({ size: (e.target as HTMLSelectElement).value as "compact" | "normal" | "large" });
});

document.getElementById("stripedChk")!.addEventListener("change", (e) => {
  api.updateOptions({ stripedRows: (e.target as HTMLInputElement).checked });
});

document.getElementById("bordersChk")!.addEventListener("change", (e) => {
  api.updateOptions({ showCellBorders: (e.target as HTMLInputElement).checked });
});

document.getElementById("btnAutoSize")!.addEventListener("click", () => api.autoSizeAllColumns());
document.getElementById("btnReset")!.addEventListener("click", () => api.resetColumnState());
document.getElementById("btnSelectAll")!.addEventListener("click", () => api.selectAll(true));
document.getElementById("btnClearSort")!.addEventListener("click", () => api.setSortModel([]));

document.getElementById("btnTheme")!.addEventListener("click", (e) => {
  theme = theme === "light" ? "dark" : "light";
  const next = theme;
  api.updateOptions({ theme: next });
  schemaApi.updateOptions({ theme: next });
  infiniteApi.updateOptions({ theme: next });
  (e.target as HTMLElement).textContent = theme === "light" ? "深色模式" : "浅色模式";
});

infoEl.textContent = `共 ${api.getDisplayedRowCount()} 行`;

interface WorkItem {
  itemId: string;
  title: string;
  owner: string;
  progress: number;
  level: "P1" | "P2" | "P3";
  done: boolean;
  updatedAt: string;
}

const WORK_OWNERS = ["张三", "李四", "王五", "赵六", "陈七"];
const workSchema = {
  fields: [
    { field: "itemId", title: "任务号", type: "string", width: 130 },
    { field: "title", title: "任务名称", type: "string", flex: 1, editable: true },
    { field: "owner", title: "负责人", type: "select", width: 110, editable: true, options: WORK_OWNERS.map((o) => ({ label: o, value: o })) },
    { field: "level", title: "优先级", type: "select", width: 90, options: [
      { label: "P1-紧急", value: "P1" },
      { label: "P2-常规", value: "P2" },
      { label: "P3-低", value: "P3" }
    ] },
    { field: "progress", title: "进度", type: "number", width: 90, editable: true },
    { field: "done", title: "完成", type: "boolean", width: 70 },
    { field: "updatedAt", title: "更新时间", type: "date", format: "datetime", width: 150 }
  ],
  groups: [{ title: "执行信息", fields: ["owner", "level", "progress"] }]
} as const;

function makeWorkRows(count: number): WorkItem[] {
  return Array.from({ length: count }, (_, i) => ({
    itemId: `WI-${String(i + 1).padStart(4, "0")}`,
    title: `工单任务-${i + 1}`,
    owner: WORK_OWNERS[i % WORK_OWNERS.length],
    progress: Math.round(Math.random() * 100),
    level: (["P1", "P2", "P3"] as const)[i % 3],
    done: i % 4 === 0,
    updatedAt: new Date(Date.now() - Math.random() * 86400000 * 7).toISOString()
  }));
}

const schemaHost = document.getElementById("schemaHost")!;

const schemaApi: GridApi<WorkItem> = createGrid<WorkItem>(schemaHost, {
  columnDefs: buildColDefsFromSchema<WorkItem>(workSchema as any),
  rowData: makeWorkRows(300),
  getRowId: (p) => p.data.itemId,
  size: "compact",
  stripedRows: true,
  columnMenu: true,
  columnStateKey: "demo-schema-grid",
  enableRangeSelection: true,
  contextMenu: true,
  masterDetail: true,
  detailRowHeight: 260,
  detailRowRenderer: (params) => {
    const wrap = document.createElement("div");
    wrap.style.height = "100%";
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.gap = "6px";

    const bar = document.createElement("div");
    bar.style.fontSize = "12px";
    bar.style.color = "#64748b";
    bar.textContent = `${params.data?.itemId} · ${params.data?.title} · 负责人 ${params.data?.owner} · 子任务明细：`;
    wrap.appendChild(bar);

    const childHost = document.createElement("div");
    childHost.style.flex = "1";
    childHost.style.minHeight = "0";
    wrap.appendChild(childHost);

    const childApi = createGrid<WorkItem>(childHost, {
      columnDefs: [
        { field: "itemId", headerName: "子任务", width: 130 },
        { field: "title", headerName: "名称", flex: 1 },
        { field: "owner", headerName: "负责人", width: 100 },
        { field: "progress", headerName: "进度", width: 90, type: "rightAligned" }
      ] as ColDef<WorkItem>[],
      rowData: makeWorkRows(6),
      size: "compact"
    });

    return {
      el: wrap,
      destroy: () => {
        childApi.destroy();
      }
    };
  },
  onCellValueChanged: (e) => appendLog(`Schema表格更新: ${e.colDef.field} = ${String(e.newValue)}`),
  onDetailToggled: (e) => appendLog(`明细${e.expanded ? "展开" : "收起"}: ${e.rowId}`)
});

void schemaApi;

interface OrderRow {
  orderNo: string;
  customer: string;
  amount: number;
  createdAt: string;
}

const ORDER_TOTAL = 2000;
const CUSTOMERS = ["华新丽华", "宝武集团", "沙钢集团", "建龙集团", "中信特钢"];

function makeOrderRows(start: number, end: number): OrderRow[] {
  const rows: OrderRow[] = [];
  for (let i = start; i < end && i < ORDER_TOTAL; i++) {
    rows.push({
      orderNo: `SO-${String(i + 1).padStart(6, "0")}`,
      customer: CUSTOMERS[i % CUSTOMERS.length],
      amount: Math.round(1000 + Math.random() * 99000),
      createdAt: new Date(Date.now() - Math.random() * 86400000 * 30).toISOString().slice(0, 10)
    });
  }
  return rows;
}

const infiniteHost = document.getElementById("infiniteHost")!;
const infiniteApi: GridApi<OrderRow> = createGrid<OrderRow>(infiniteHost, {
  columnDefs: [
    { field: "orderNo", headerName: "订单号", width: 140 },
    { field: "customer", headerName: "客户", flex: 1 },
    { field: "amount", headerName: "金额", width: 120, type: "rightAligned", aggFunc: "sum" },
    { field: "createdAt", headerName: "下单日期", width: 120 }
  ],
  size: "compact",
  stripedRows: true,
  statusBar: true,
  blockSize: 100,
  datasource: {
    getRows(params) {
      appendLog(`服务端请求: ${params.startRow} - ${params.endRow}`);
      window.setTimeout(() => {
        params.onSuccess(makeOrderRows(params.startRow, params.endRow), ORDER_TOTAL);
      }, 400);
    }
  }
});

void infiniteApi;
