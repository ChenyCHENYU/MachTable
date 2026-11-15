import { createGrid, type ColDef, type GridApi, type InfiniteGetRowsParams } from "../../packages/core/dist/index.js";

interface SoakRow {
  id: string;
  name: string;
  amount: number;
  status: string;
}

export interface CycleSnapshot {
  cycle: number;
  cachedBlocks: number;
  renderedCells: number;
  selectedRows: number;
  dirtyRowsAfterRollback: number;
  destroyedCacheBlocks: number;
  remainingRoots: number;
  pendingTransports: number;
  pendingBeforeQueryChange: number;
  queryTransportAborts: number;
  pendingBeforeDestroy: number;
  destroyTransportAborts: number;
  gridErrors: string[];
}

export interface ResourceSnapshot {
  liveDetachedRoots: number;
  pendingTransports: number;
  remainingRoots: number;
  lateModelEvents: number;
  transportRequests: number;
  transportAborts: number;
  gridErrors: string[];
}

export interface StabilityFixture {
  cycle(iteration: number): Promise<CycleSnapshot>;
  resources(): ResourceSnapshot;
}

declare global { interface Window { machStabilityFixture: StabilityFixture } }

const host = document.getElementById("grid")!;
let active: GridApi<SoakRow> | null = null;
let pendingTransports = 0;
let lateModelEvents = 0;
let transportRequests = 0;
let transportAborts = 0;
let queryAborts = 0;
let destroyAborts = 0;
const pendingQueries = new Map<string, number>();
const transportStarts = new Map<string, () => void>();
const gridErrors: string[] = [];
let retiredRoots: WeakRef<Element>[] = [];

/** 两帧让滚动/布局调度与销毁后的回调获得实际执行机会。 */
function settle(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

/** 模拟传输自身也闭环移除取消监听，避免测量夹具制造泄漏。 */
function delay(signal: AbortSignal, holdUntilAbort: boolean): Promise<void> {
  return new Promise(resolve => {
    const finish = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    // 被测取消请求保持在途，必须由真实 AbortSignal 结束；不靠固定延迟碰运气。
    const timer = holdUntilAbort ? undefined : setTimeout(finish, 12);
    if (signal.aborted) finish();
    else signal.addEventListener("abort", finish, { once: true });
  });
}

async function getRows(request: InfiniteGetRowsParams<SoakRow>): Promise<void> {
  const query = request.quickFilterText ?? "base";
  pendingTransports++;
  transportRequests++;
  pendingQueries.set(query, (pendingQueries.get(query) ?? 0) + 1);
  try {
    if (!request.signal.aborted) transportStarts.get(query)?.();
    await delay(request.signal, query === "cancelled" || query === "destroying");
    if (request.signal.aborted) {
      transportAborts++;
      if (query === "cancelled") queryAborts++;
      if (query === "destroying") destroyAborts++;
      return;
    }
    request.onSuccess(Array.from({ length: request.endRow - request.startRow }, (_, offset) => {
      const index = request.startRow + offset;
      return { id: `${query}:${index}`, name: `计划 ${query}-${index}`, amount: index, status: index % 2 ? "执行中" : "待下达" };
    }), 10_000);
  } finally {
    pendingTransports--;
    const remaining = (pendingQueries.get(query) ?? 1) - 1;
    if (remaining) pendingQueries.set(query, remaining);
    else pendingQueries.delete(query);
  }
}

/** 等待指定查询实际进入 getRows；超时只用于报告夹具失败，不驱动取消时序。 */
function startTransport(api: GridApi<SoakRow>, query: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      transportStarts.delete(query);
      reject(new Error(`The ${query} transport did not start.`));
    }, 5000);
    transportStarts.set(query, () => {
      clearTimeout(timeout);
      transportStarts.delete(query);
      resolve();
    });
    try {
      api.filtering.setQuickText(query);
    } catch (error) {
      clearTimeout(timeout);
      transportStarts.delete(query);
      reject(error);
    }
  });
}

function columns(extended: boolean): ColDef<SoakRow>[] {
  return [
    { field: "id", headerName: "订单完整编号", width: 160, pinned: "left" },
    { field: "name", headerName: "生产计划名称", editable: true, width: 180 },
    { field: "amount", headerName: "计划重量（吨）", width: 130 },
    ...Array.from({ length: extended ? 28 : 8 }, (_, index) => ({
      colId: `status-${index}`, field: "status", headerName: `状态字段 ${index + 1}`, width: 120
    })),
    { colId: "action", headerName: "操作", width: 90, pinned: "right", valueGetter: () => "查看" }
  ];
}

/** 用真实 DOM 编辑器和公开 API 提交，随后验证撤销/重做并回滚。 */
async function editRoundTrip(api: GridApi<SoakRow>): Promise<void> {
  const original = api.rows.getAt(0)!.data!.name;
  if (!api.editing.startCell({ rowIndex: 0, colId: "name" })) throw new Error("Failed to start the soak editor.");
  const editor = host.querySelector<HTMLInputElement>(".mach-editor-input");
  if (!editor) throw new Error("The editor input is missing.");
  editor.value = "已修改计划";
  editor.dispatchEvent(new Event("input", { bubbles: true }));
  if (!await api.editing.stop()) throw new Error("The soak edit was rejected.");
  if (api.rows.getAt(0)!.data!.name !== "已修改计划") throw new Error("The edit did not reach the row model.");
  if (!api.editing.undo() || api.rows.getAt(0)!.data!.name !== original) throw new Error("Undo did not restore the original value.");
  if (!api.editing.redo() || api.rows.getAt(0)!.data!.name !== "已修改计划") throw new Error("Redo did not restore the edit.");
  api.editing.rollback();
}

/** 每周期覆盖同一组路径；交替列方案避免把冷路径加载误算为持续泄漏。 */
async function cycle(iteration: number): Promise<CycleSnapshot> {
  let destroyed = false;
  const api = createGrid<SoakRow>(host, {
    rowKey: "id", rowData: [], columnDefs: columns(false), size: "compact",
    rowBuffer: 1, pagination: false, rowSelection: "multiple", enableColumnResize: true,
    datasourceMode: "block", datasourceRowCount: 10_000, blockSize: 50,
    maxBlocksInCache: 4, blockPrefetch: 0, datasourceMaxConcurrentRequests: 2,
    datasource: { getRows },
    onModelUpdated: () => { if (destroyed) lateModelEvents++; },
    // Core 会捕获部分内部异常；仅监听 pageerror 会漏掉这些错误。只存字符串，不保留事件/DOM。
    onGridError: event => {
      if (gridErrors.length < 20) {
        const message = event.error instanceof Error ? event.error.message : String(event.error);
        gridErrors.push(`${event.code} ${event.source}: ${message}`.slice(0, 1000));
      }
    }
  });
  active = api;
  try {
    await api.whenReady();
    await api.rows.ensureLoaded(0, 50);
    await settle();
    const row = api.rows.getAt(0)!;
    api.selection.setById(row.id, true);
    const selectedRows = api.selection.getIds().length;
    await editRoundTrip(api);
    const dirtyRowsAfterRollback = api.editing.getDirtyRowIds().length;
    api.columns.setDefinitions(columns(iteration % 2 === 0));
    api.columns.setWidth("name", 220 + iteration % 3 * 10);
    api.columns.setPinned("amount", iteration % 2 ? "right" : null);
    for (const offset of [200, 600, 1000]) {
      await api.rows.ensureLoaded(offset, offset + 50);
      api.view.scrollToRow(offset, "top");
      await settle();
    }
    const cachedBlocks = api.rows.getCacheSnapshot().cachedBlockCount;
    const renderedCells = host.querySelectorAll(".mach-cell").length;
    const queryAbortsBefore = queryAborts;
    await startTransport(api, "cancelled");
    const pendingBeforeQueryChange = pendingQueries.get("cancelled") ?? 0;
    if (!pendingBeforeQueryChange) throw new Error("The query cancellation has no active transport.");
    api.filtering.setQuickText(`query-${iteration % 2}`);
    await api.rows.ensureLoaded(0, 50);
    const queryTransportAborts = queryAborts - queryAbortsBefore;
    if (!api.rows.getAt(0)?.data?.id.startsWith(`query-${iteration % 2}:`)) throw new Error("An obsolete query replaced the accepted rows.");
    const root = host.querySelector(".mach-root");
    if (root) retiredRoots.push(new WeakRef(root));
    // 留一个在途请求，以实际验证销毁时取消，而不是只销毁完全空闲表格。
    const destroyAbortsBefore = destroyAborts;
    await startTransport(api, "destroying");
    const pendingBeforeDestroy = pendingQueries.get("destroying") ?? 0;
    if (!pendingBeforeDestroy) throw new Error("The destruction has no active transport.");
    destroyed = true;
    api.destroy();
    active = null;
    await settle();
    return {
      cycle: iteration, cachedBlocks, renderedCells, selectedRows, dirtyRowsAfterRollback,
      destroyedCacheBlocks: api.rows.getCacheSnapshot().cachedBlockCount,
      remainingRoots: host.querySelectorAll(".mach-root").length, pendingTransports,
      pendingBeforeQueryChange, queryTransportAborts, pendingBeforeDestroy,
      destroyTransportAborts: destroyAborts - destroyAbortsBefore, gridErrors: [...gridErrors]
    };
  } finally {
    destroyed = true;
    api.destroy();
    active = null;
  }
}

function resources(): ResourceSnapshot {
  retiredRoots = retiredRoots.filter(reference => reference.deref() !== undefined);
  return {
    liveDetachedRoots: retiredRoots.filter(reference => !reference.deref()!.isConnected).length,
    pendingTransports,
    remainingRoots: host.querySelectorAll(".mach-root").length,
    lateModelEvents, transportRequests, transportAborts, gridErrors: [...gridErrors]
  };
}

window.machStabilityFixture = { cycle, resources };
window.addEventListener("pagehide", () => { active?.destroy(); active = null; });
