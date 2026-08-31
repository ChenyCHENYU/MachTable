import "@agile-team/mach-table/styles/mach-table.css";
import { createGrid, createActionButtonsRenderer } from "@agile-team/mach-table";
import type { GridApi, ColDef } from "@agile-team/mach-table";

interface BenchRow {
  id: string;
  c0: string;
  c1: string;
  c2: number;
  c3: string;
  c4: number;
  c5: string;
  c6: string;
  c7: number;
  [key: string]: any;
}

const STATUSES = ["运行中", "待机", "故障"];

function makeRows(n: number): BenchRow[] {
  const rows: BenchRow[] = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      id: `r${i}`,
      c0: `RG-${String(i + 1).padStart(6, "0")}`,
      c1: `设备-${i + 1}`,
      c2: Math.round(Math.random() * 100000) / 100,
      c3: STATUSES[i % 3],
      c4: Math.round(Math.random() * 100),
      c5: `车间-${(i % 12) + 1}`,
      c6: new Date(Date.now() - Math.random() * 86400000 * 30).toISOString(),
      c7: Math.round(Math.random() * 1000)
    });
  }
  return rows;
}

function buildDefs(colCount: number): ColDef<BenchRow>[] {
  const base: ColDef<BenchRow>[] = [
    { field: "c0", headerName: "编号", width: 130 },
    { field: "c1", headerName: "名称", width: 160 },
    { field: "c2", headerName: "数值", width: 110, type: "rightAligned" },
    { field: "c3", headerName: "状态", width: 110, cellRenderer: "statusTag" },
    { field: "c4", headerName: "进度", width: 140, cellRenderer: "progressBar" },
    { field: "c5", headerName: "车间", width: 100 },
    { field: "c6", headerName: "更新时间", width: 170 },
    { field: "c7", headerName: "计数", width: 90, type: "rightAligned" }
  ];
  const defs = base.slice(0, Math.min(colCount, 6));
  for (let i = defs.length; i < colCount - 1; i++) {
    defs.push({ field: `x${i}`, headerName: `扩展列 ${i}`, width: 120, valueGetter: (p) => (p.rowIndex + i) % 997 });
  }
  defs.push({
    colId: "op",
    headerName: "操作",
    width: 120,
    pinned: "right",
    sortable: false,
    resizable: false,
    movable: false,
    cellRenderer: createActionButtonsRenderer({
      actions: [
        { icon: "view", title: "查看", onClick: () => undefined },
        { icon: "edit", title: "编辑", onClick: () => undefined },
        { icon: "delete", title: "删除", danger: true, onClick: () => undefined }
      ]
    })
  });
  return defs;
}

const host = document.getElementById("host")!;
const statEl = document.getElementById("stat")!;
let api: GridApi<BenchRow> | null = null;
let lastInitMs = 0;

interface BenchSnapshot {
  api: GridApi<BenchRow>;
  initMs: number;
  rowCount: number;
  colCount: number;
  cellCount: number;
}

function rebuild(): void {
  const rowCount = Number((document.getElementById("rows") as HTMLSelectElement).value);
  const colCount = Number((document.getElementById("cols") as HTMLSelectElement).value);
  api?.destroy();
  const t0 = performance.now();
  api = createGrid<BenchRow>(host, {
    columnDefs: buildDefs(colCount),
    rowData: makeRows(rowCount),
    rowKey: (row) => row.id,
    size: "compact",
    stripedRows: true,
    pagination: false,
    enableRangeSelection: true,
    statusBar: true
  });
  const t1 = performance.now();
  lastInitMs = t1 - t0;
  updateStat(lastInitMs);
  (window as typeof window & { __MACH_BENCH__?: BenchSnapshot }).__MACH_BENCH__ = {
    api,
    initMs: t1 - t0,
    rowCount,
    colCount,
    cellCount: host.querySelectorAll(".mach-cell").length
  };
}

function updateStat(initMs: number, scrollInfo?: string): void {
  const cellCount = host.querySelectorAll(".mach-cell").length;
  statEl.innerHTML =
    `首帧 <b>${initMs.toFixed(0)}ms</b> · 可见 DOM 单元格 <b>${cellCount}</b>` +
    (scrollInfo ? ` · ${scrollInfo}` : "");
}

document.getElementById("rebuild")!.addEventListener("click", rebuild);

document.getElementById("scroll")!.addEventListener("click", () => {
  if (!api) return;
  api.diagnostics.resetPerformance();
  const viewport = host.querySelector(".mach-body-viewport--scroll") as HTMLElement;
  const startTop = viewport.scrollTop;
  const maxScroll = viewport.scrollHeight - viewport.clientHeight;
  const t0 = performance.now();
  let frames = 0;
  let lastYield = t0;

  const tick = () => {
    const now = performance.now();
    if (now - lastYield > 8) frames++;
    lastYield = now;
    const progress = Math.min(1, (now - t0) / 3000);
    viewport.scrollTop = startTop + (maxScroll - startTop) * progress;
    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      const elapsed = performance.now() - t0;
      const measuredFrames = Math.max(1, frames);
      const avgFrame = elapsed / measuredFrames;
      const metrics = api?.diagnostics.getPerformance();
      const internal = metrics
        ? `，内核 P95 <b>${metrics.p95RenderMs.toFixed(2)}ms</b>，长渲染 ${metrics.longRenderCount}/${metrics.sampleCount}`
        : "";
      updateStat(lastInitMs, `滚动 ${Math.round(maxScroll)}px：平均帧 <b>${avgFrame.toFixed(2)}ms</b>（≈${Math.min(60, Math.round(1000 / avgFrame))} FPS，${measuredFrames} 帧${internal}）`);
    }
  };
  requestAnimationFrame(tick);
});

rebuild();
