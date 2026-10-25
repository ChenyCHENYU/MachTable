import { createGrid, dragColumn, selectionColumn, type GridApi } from "@agile-team/mach-table";
import { createRowOrderController, type RowOrderController, type RowOrderState } from "@agile-team/mach-table/ordering";

interface OrderItem {
  id: string;
  title: string;
  owner: string;
  stage: string;
  children?: OrderItem[];
}

function sampleRows(tree: boolean): OrderItem[] {
  const tasks = [
    ["需求梳理", "陈晨", "计划"], ["交互方案", "林夕", "计划"],
    ["表格交互", "周宁", "开发"], ["数据接入", "许诺", "开发"],
    ["无障碍检查", "林夕", "验收"], ["集成回归", "陈晨", "验收"]
  ].map(([title, owner, stage], index) => ({ id: `TASK-${101 + index}`, title, owner, stage }));
  if (!tree) return tasks;
  return [
    { id: "PHASE-PLAN", title: "01 · 方案准备", owner: "陈晨", stage: "计划", children: tasks.slice(0, 2) },
    { id: "PHASE-BUILD", title: "02 · 产品开发", owner: "周宁", stage: "开发", children: tasks.slice(2, 4) },
    { id: "PHASE-REVIEW", title: "03 · 交付验收", owner: "许诺", stage: "验收", children: tasks.slice(4) }
  ];
}

/** The simulated request releases its timer and abort listener on every exit. */
function saveDelay(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(new DOMException("保存已取消", "AbortError"));
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, 450);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

function labeledSelect(id: string, label: string, choices: readonly (readonly [string, string])[]): HTMLLabelElement {
  const wrapper = document.createElement("label");
  wrapper.style.cssText = "display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#475569";
  const select = document.createElement("select");
  select.id = id;
  for (const [value, text] of choices) select.add(new Option(text, value));
  wrapper.append(`${label} `, select);
  return wrapper;
}

/** A complete controlled ordering model: one binding spread, one persistence callback. */
export function installOrderingDemo<TData extends object>(owner: GridApi<TData>): void {
  const section = document.createElement("section");
  section.id = "orderingDemo";
  section.setAttribute("aria-labelledby", "orderingTitle");
  const title = document.createElement("h2");
  title.id = "orderingTitle";
  title.className = "section-title";
  title.textContent = "业务排序 · 多行移动、树层级与保存回滚";
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";
  const modeLabel = labeledSelect("orderingMode", "数据模式", [["flat", "平铺列表"], ["tree", "树形任务"]]);
  const saveLabel = labeledSelect("orderingSaveMode", "模拟保存", [["success", "保存成功"], ["failure", "保存失败"], ["conflict", "版本冲突"]]);
  const mode = modeLabel.querySelector("select")!;
  const saveMode = saveLabel.querySelector("select")!;
  toolbar.append(modeLabel, saveLabel);
  const button = (id: string, text: string) => {
    const element = document.createElement("button");
    element.type = "button";
    element.id = id;
    element.textContent = text;
    toolbar.append(element);
    return element;
  };
  const selectSample = button("orderingSelectSample", "选中两项任务");
  const clearSelection = button("orderingClearSelection", "清除选择");
  const reload = button("orderingReload", "重新加载服务器顺序");
  const reset = button("orderingReset", "重置示例");
  const undo = button("orderingUndo", "撤销排序");
  const redo = button("orderingRedo", "重做排序");
  const selected = document.createElement("span");
  selected.style.cssText = "font-size:12px;color:#64748b";
  toolbar.append(selected);
  const hint = document.createElement("p");
  hint.id = "orderingHint";
  hint.style.cssText = "font-size:12px;line-height:1.7;color:#64748b;margin:0 0 10px";
  const host = document.createElement("div");
  host.id = "orderingGrid";
  host.setAttribute("aria-describedby", hint.id);
  host.style.cssText = "height:370px;border-radius:8px;overflow:hidden;box-shadow:0 4px 16px rgba(15,23,42,.08)";
  const status = document.createElement("p");
  status.id = "orderingStatus";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  status.style.cssText = "font-size:13px;line-height:1.7;margin:8px 0 4px;color:#334155";
  const intent = document.createElement("p");
  intent.id = "orderingIntent";
  intent.style.cssText = "font-size:12px;line-height:1.7;color:#64748b;overflow-wrap:anywhere";
  section.append(title, toolbar, hint, host, status, intent);
  const log = document.getElementById("log");
  if (log) log.before(section);
  else document.body.append(section);

  const events = new AbortController();
  let api: GridApi<OrderItem> | null = null;
  let ordering: RowOrderController<OrderItem> | null = null;
  let unsubscribe = () => {};
  let model: readonly OrderItem[] = [];
  let serverModel: readonly OrderItem[] = [];
  let clientRevision = 1;
  let serverRevision = 1;

  const showSelection = () => { selected.textContent = `已选择 ${api?.selection.getIds().length ?? 0} 项`; };
  const showHistoryAvailability = (state: Readonly<RowOrderState<OrderItem>>) => {
    undo.disabled = state.status === "saving" || !state.canUndo;
    redo.disabled = state.status === "saving" || !state.canRedo;
  };
  const showState = (state: Readonly<RowOrderState<OrderItem>>) => {
    // Do not advance getRevision during save: the controller still owns that optimistic snapshot.
    if (state.status === "saved" && typeof state.revision === "number") clientRevision = state.revision;
    const saving = state.status === "saving";
    showHistoryAvailability(state);
    saveMode.disabled = selectSample.disabled = clearSelection.disabled = saving;
    reload.disabled = saving || clientRevision === serverRevision;
    reset.textContent = saving ? "取消保存并重置" : "重置示例";
    host.setAttribute("aria-busy", String(saving));
    status.dataset.status = state.status;
    const messages = {
      idle: "拖动左侧手柄调整顺序；勾选多行后拖动其中一行可批量移动。",
      saving: "顺序已即时更新，正在保存（450ms）…",
      saved: `已保存 ${state.plan?.rowIds.length ?? 0} 项的顺序。`,
      error: "保存失败，已回滚到移动前的顺序。选择“保存成功”后可重试。",
      conflict: "版本冲突，本次移动已回滚。服务器顺序已变更，请重新加载后再移动。"
    };
    status.textContent = `${messages[state.status]} 客户端 r${clientRevision} · 服务器 r${serverRevision}`;
    status.style.color = state.status === "error" || state.status === "conflict" ? "#b91c1c" : "#334155";
    const move = state.plan?.intent;
    const positions = { before: "之前 / before", inside: "内部 / inside", after: "之后 / after" };
    intent.textContent = move
      ? `最近提交的稳定 ID：${move.rowIds.join("、")} → ${move.targetId}（${positions[move.position]}）；相邻 ID：${move.beforeId ?? "起点"} / ${move.afterId ?? "终点"}；请求版本 r${move.expectedRevision ?? clientRevision}`
      : "每次保存以一个版本 CAS 原子提交；撤销的 operations 批量恢复各行原位，本例原子保存 plan.after 整序。切换模式或重置会取消未完成保存。";
    showSelection();
  };

  const mount = (fromServer = false) => {
    unsubscribe();
    ordering?.dispose();
    api?.destroy();
    api = null;
    const treeData = mode.value === "tree";
    if (!fromServer) {
      serverModel = sampleRows(treeData);
      serverRevision = 1;
    }
    model = serverModel;
    clientRevision = serverRevision;
    hint.textContent = treeData
      ? "树形：目标行上部放到之前（before），中部放入内部（inside），下部放到之后（after）。父项会携带子树；禁止移入自身后代。焦点在手柄时 Alt+↑/↓ 可同级移动。"
      : "平铺：在目标行上半部放到之前（before），下半部放到之后（after）。先勾选多项，再拖动已选项手柄；拖动未选项只移动该项。手柄支持 Alt+↑/↓。";
    ordering = createRowOrderController<OrderItem>({
      rowKey: "id", treeData,
      getRows: () => model,
      applyRows: (next) => { model = next; api?.rows.setData([...next]); },
      getRevision: () => clientRevision,
      save: async (move, { signal, plan, operation, operations }) => {
        host.dataset.orderOperation = operation;
        host.dataset.orderOperations = String(operations.length);
        const outcome = saveMode.value;
        await saveDelay(signal);
        if (move.expectedRevision !== serverRevision) return { status: "conflict", revision: serverRevision };
        if (outcome === "failure") throw new Error("模拟网络保存失败");
        if (outcome === "conflict") {
          serverModel = [...serverModel].reverse();
          return { status: "conflict", revision: ++serverRevision, message: "服务器已调整任务顺序，请重新加载。" };
        }
        // Persist the complete model atomically. A real transport may instead
        // execute all operations in one CAS transaction, especially for undo.
        serverModel = plan.after;
        return { revision: ++serverRevision };
      }
    });
    api = createGrid<OrderItem>(host, {
      ...ordering.bindings,
      columnDefs: [
        dragColumn(), selectionColumn(),
        { field: "title", headerName: "任务 / 阶段", flex: 1, minWidth: 230 },
        { field: "id", headerName: "稳定业务 ID", width: 155 },
        { field: "owner", headerName: "负责人", width: 110 },
        { field: "stage", headerName: "进度阶段", width: 110 }
      ],
      rowKey: "id", rowData: [...model], treeData, defaultExpandAll: true,
      rowSelection: "multiple", autoCheckedChildren: false,
      rowHeight: 36, size: "compact", stripedRows: true, pagination: false,
      theme: owner.getOption("theme"),
      defaultColDef: { sortable: false, filter: false },
      onSelectionChanged: showSelection
    });
    unsubscribe = ordering.subscribe(showState);
    showState(ordering.state);
  };

  mode.addEventListener("change", () => mount(), { signal: events.signal });
  reset.addEventListener("click", () => mount(), { signal: events.signal });
  reload.addEventListener("click", () => mount(true), { signal: events.signal });
  selectSample.addEventListener("click", () => {
    api?.selection.clear();
    api?.selection.setById("TASK-101", true, false);
    api?.selection.setById("TASK-103", true, false);
  }, { signal: events.signal });
  clearSelection.addEventListener("click", () => api?.selection.clear(), { signal: events.signal });
  undo.addEventListener("click", () => { void ordering?.undo().catch(() => undefined); }, { signal: events.signal });
  redo.addEventListener("click", () => { void ordering?.redo().catch(() => undefined); }, { signal: events.signal });
  document.getElementById("btnTheme")?.addEventListener("click", () => {
    api?.updateOptions({ theme: owner.getOption("theme") });
  }, { signal: events.signal });
  const detachOwner = owner.on("gridDestroyed", dispose);
  function dispose() {
    unsubscribe();
    ordering?.dispose();
    api?.destroy();
    api = null;
    events.abort();
    detachOwner();
    section.remove();
  }
  window.addEventListener("pagehide", dispose, { once: true, signal: events.signal });
  mount();
}
