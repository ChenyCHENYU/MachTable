import type { GridApi } from "../types/api";
import { leafColumns } from "./columns";
import { errorText } from "./shared";
import type { RowNode } from "../types/row";

export type GridRowDiagnosticCode = "GRID_DESTROYED" | "ROW_UNAVAILABLE" | "ROW_NOT_DISPLAYED" |
  "OUTSIDE_RENDER_WINDOW" | "ROW_LOADING" | "STRUCTURAL_ROW" | "EDITING_ACTIVE" |
  "GROUPING_ACTIVE" | "MANAGED_TREE" | "MANAGED_DATASOURCE" |
  "MANAGED_PROCESSOR" | "MANAGED_SORT" | "HANDLE_DISABLED" | "POLICY_REJECTED" |
  "POLICY_ERROR" | "INSPECTION_CHANGED";

export interface GridRowDiagnostic { code: GridRowDiagnosticCode; message: string }
export type GridExecutionMode = "client" | "host" | "datasource" | "client-or-processor";
export interface GridExecutionInspection {
  sorting: GridExecutionMode;
  filtering: GridExecutionMode;
  sortActive: boolean;
  filterActive: boolean;
  processorConfigured: boolean;
}
export interface GridRowInspection {
  rowId: string;
  availability: "loaded" | "missing" | "destroyed";
  visibility: "displayed" | "not-displayed" | "unknown";
  rowIndex: number | null;
  rendered: boolean;
  /** null means eligibility cannot be established without a current rendered handle. */
  drag: { allowed: boolean | null; policyEvaluated: boolean; reasons: GridRowDiagnostic[] };
  execution: GridExecutionInspection | null;
  notes: GridRowDiagnostic[];
}

function groupingConfigured<T>(api: GridApi<T>): boolean {
  const fallback = api.getOption("defaultColDef")?.rowGroup;
  for (const column of leafColumns(api.columns.getDefinitions() ?? [])) {
    if ((column.rowGroup ?? fallback) === true) return true;
  }
  return false;
}

function execution<T>(api: GridApi<T>, grouped: boolean): GridExecutionInspection {
  const remote = api.rows.isRemote();
  const processorConfigured = Boolean(api.getOption("dataProcessor"));
  const processorPossible = processorConfigured && !grouped && !api.getOption("treeData") && !api.getOption("masterDetail");
  const local = processorPossible ? "client-or-processor" : "client";
  return {
    sorting: remote ? "datasource" : api.getOption("manualSorting") ? "host" : local,
    filtering: remote ? "datasource" : api.getOption("manualFiltering") ? "host" : local,
    sortActive: api.sorting.getModel().length > 0,
    filterActive: api.filtering.isPresent(),
    processorConfigured
  };
}

function unavailable(rowId: string, destroyed: boolean): GridRowInspection {
  const reason: GridRowDiagnostic = destroyed
    ? { code: "GRID_DESTROYED", message: "表格已销毁，不能检查或发起拖拽。" }
    : { code: "ROW_UNAVAILABLE", message: "当前模型无此 ID：可能未加载、已移除或查询不同；检查不请求数据。" };
  return { rowId, availability: destroyed ? "destroyed" : "missing", visibility: "unknown", rowIndex: null,
    rendered: false, drag: { allowed: false, policyEvaluated: false, reasons: [reason] }, execution: null, notes: [reason] };
}

function dragReasons<T>(api: GridApi<T>, node: RowNode<T>, grouped: boolean, modes: GridExecutionInspection): GridRowDiagnostic[] {
  const reasons: GridRowDiagnostic[] = [];
  const add = (code: GridRowDiagnosticCode, message: string) => { reasons.push({ code, message }); };
  if (node.data == null || node.isGroup || node.isDetail) add("STRUCTURAL_ROW", "分组、明细、无数据行不可拖拽。");
  if (node.loading || node.treeLoading) add("ROW_LOADING", "该行正在加载，不能拖拽。");
  if (api.editing.isRowActive() || api.view.getRoot()?.querySelector(".mach-cell--editing")) add("EDITING_ACTIVE", "存在活动编辑，请先保存或取消。");
  if (grouped) add("GROUPING_ACTIVE", "自动分组模式不支持行拖拽。");
  managedReasons(api, modes, reasons);
  return reasons;
}

function managedReasons<T>(api: GridApi<T>, modes: GridExecutionInspection, reasons: GridRowDiagnostic[]): void {
  if (api.getOption("applyRowDrag") === false) return;
  const add = (code: GridRowDiagnosticCode, message: string) => { reasons.push({ code, message }); };
  if (api.getOption("treeData")) add("MANAGED_TREE", "托管重排仅支持扁平数据；层级排序需非托管策略。");
  if (api.rows.isRemote()) add("MANAGED_DATASOURCE", "datasource 不允许默认托管重排，请提交稳定 ID 排序意图。");
  if (modes.processorConfigured) add("MANAGED_PROCESSOR", "dataProcessor 不支持托管重排。");
  if (modes.sortActive) add("MANAGED_SORT", "列排序会覆盖业务顺序，请清除排序或使用非托管策略。");
}

function inspectPolicy<T>(api: GridApi<T>, node: RowNode<T>, reasons: GridRowDiagnostic[]): boolean {
  if (reasons.length) return false;
  try {
    const policy = api.getOption("rowDragPolicy");
    if (!policy?.canDrag) return false;
    const decision = policy.canDrag({ api, node }) ?? true;
    if (decision !== true) reasons.push({ code: "POLICY_REJECTED", message: typeof decision === "string" ? decision : "业务 canDrag 判定拒绝拖拽。" });
  } catch (error) {
    reasons.push({ code: "POLICY_ERROR", message: `业务 canDrag 判定异常：${errorText(error)}` });
  }
  return true;
}

function locate<T>(api: GridApi<T>, node: RowNode<T>) {
  // A retained/off-page node may carry an old index. Check exactly one index, not the remote range.
  const displayed = node.rowIndex >= 0 && api.rows.getAt(node.rowIndex) === node;
  const rows = [...(api.view.getRoot()?.querySelectorAll<HTMLElement>(".mach-row[data-id]") ?? [])];
  const rendered = rows.find(row => row.dataset.id === node.id);
  return { displayed, rendered: Boolean(rendered), handle: rendered?.querySelector<HTMLButtonElement>(".mach-row-drag-handle") };
}

function visibilityNotes(location: ReturnType<typeof locate>): GridRowDiagnostic[] {
  if (!location.displayed) return [{ code: "ROW_NOT_DISPLAYED", message: "已加载但未显示：可能被过滤、父项折叠、分页或保留草稿，具体原因未公开。" }];
  return location.rendered ? [] : [{ code: "OUTSIDE_RENDER_WINDOW", message: "显示模型内未渲染 DOM：可能位于虚拟窗口外，不能判定为被过滤。" }];
}

function eligibility(reasons: readonly GridRowDiagnostic[], handle: HTMLButtonElement | null | undefined, changed: boolean): boolean | null {
  if (changed) return null;
  if (reasons.length) return false;
  return handle ? !handle.disabled : null;
}

/** Explicit diagnostic only. Calls a meaningful row's canDrag policy; never enumerates rows or fetches data. */
export function inspectGridRow<T>(api: GridApi<T>, rowId: string): GridRowInspection {
  if (api.isDestroyed()) return unavailable(rowId, true);
  const grouped = groupingConfigured(api);
  const modes = execution(api, grouped);
  const node = api.rows.getById(rowId);
  if (!node) return { ...unavailable(rowId, false), execution: modes };
  const data = node.data;
  const location = locate(api, node);
  const reasons = dragReasons(api, node, grouped, modes);
  const policyEvaluated = inspectPolicy(api, node, reasons);
  if (api.isDestroyed()) return unavailable(rowId, true);
  const notes = visibilityNotes(location);
  if (location.handle?.disabled && !reasons.length) reasons.push({ code: "HANDLE_DISABLED", message: "手柄已禁用，具体原因未公开；服务端分页等场景不支持托管重排。" });
  const changed = api.rows.getById(rowId) !== node || node.data !== data;
  if (changed) notes.push({ code: "INSPECTION_CHANGED", message: "业务判定期间记录被替换，结果已过期，请重新检查。" });
  return { rowId, availability: "loaded", visibility: location.displayed ? "displayed" : "not-displayed",
    rowIndex: location.displayed ? node.rowIndex : null, rendered: location.rendered, execution: modes, notes,
    drag: { allowed: eligibility(reasons, location.handle, changed), policyEvaluated, reasons } };
}
