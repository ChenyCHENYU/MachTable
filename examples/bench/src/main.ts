import "@agile-team/mach-table/styles/mach-table.css";
import { createGrid, type GridApi } from "@agile-team/mach-table";
import { makeRows, buildDefs, type BenchRow } from "./data";

const host = document.getElementById("host")!;
const statEl = document.getElementById("stat")!;
let api: GridApi<BenchRow> | null = null;
let lastInitMs = 0;
let lastDataMs = 0;

declare global { interface Window { __MACH_BENCH__?: BenchSnapshot } }

interface BenchSnapshot {
  api: GridApi<BenchRow>;
  initMs: number;
  dataMs: number;
  seed: number;
  frameReadyMs: number | null;
  rowCount: number;
  colCount: number;
  cellCount: number;
}

function rebuild(): void {
  const rowCount = Number((document.getElementById("rows") as HTMLSelectElement).value);
  const colCount = Number((document.getElementById("cols") as HTMLSelectElement).value);
  api?.destroy();
  const dataStarted = performance.now();
  const rowData = makeRows(rowCount);
  const columnDefs = buildDefs(colCount);
  lastDataMs = performance.now() - dataStarted;
  const t0 = performance.now();
  api = createGrid<BenchRow>(host, {
    columnDefs,
    rowData,
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
  window.__MACH_BENCH__ = {
    api,
    initMs: t1 - t0,
    dataMs: lastDataMs,
    seed: 20261026,
    frameReadyMs: null,
    rowCount,
    colCount,
    cellCount: host.querySelectorAll(".mach-cell").length
  };
  const owner = api;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const current = window.__MACH_BENCH__;
    if (current?.api === owner && !owner.isDestroyed()) current.frameReadyMs = performance.now() - t0;
  }));
}

function updateStat(initMs: number, scrollInfo?: string): void {
  const cellCount = host.querySelectorAll(".mach-cell").length;
  statEl.innerHTML =
    `数据准备 <b>${lastDataMs.toFixed(0)}ms</b> · Grid 构造 <b>${initMs.toFixed(0)}ms</b> · 可见 DOM 单元格 <b>${cellCount}</b>` +
    (scrollInfo ? ` · ${scrollInfo}` : "");
}

document.getElementById("rebuild")!.addEventListener("click", rebuild);

document.getElementById("scroll")!.addEventListener("click", () => {
  if (!api) return;
  const owner = api;
  owner.diagnostics.resetPerformance();
  const viewport = host.querySelector(".mach-body-viewport--scroll") as HTMLElement;
  const startTop = viewport.scrollTop;
  const maxScroll = viewport.scrollHeight - viewport.clientHeight;
  const t0 = performance.now();
  let frames = 0;

  const tick = () => {
    if (api !== owner || owner.isDestroyed()) return;
    const now = performance.now();
    frames++;
    const progress = Math.min(1, (now - t0) / 3000);
    viewport.scrollTop = startTop + (maxScroll - startTop) * progress;
    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      const elapsed = performance.now() - t0;
      const measuredFrames = Math.max(1, frames);
      const avgFrame = elapsed / measuredFrames;
      const metrics = owner.diagnostics.getPerformance();
      const internal = metrics
        ? `，内核 P95 <b>${metrics.p95RenderMs.toFixed(2)}ms</b>，长渲染 ${metrics.longRenderCount}/${metrics.sampleCount}`
        : "";
      updateStat(lastInitMs, `滚动 ${Math.round(maxScroll)}px：rAF 平均间隔 <b>${avgFrame.toFixed(2)}ms</b>（${measuredFrames} 次回调${internal}）`);
    }
  };
  requestAnimationFrame(tick);
});

rebuild();
