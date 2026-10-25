import "@agile-team/mach-table/styles/workbench.css";
import type { GridApi, SaveChangesHandler } from "@agile-team/mach-table";
import { mountAdvancedFilterBuilder, mountChangeReview, mountDiagnostics, type WorkbenchHandle } from "@agile-team/mach-table/workbench";
import { mountAnalysis } from "@agile-team/mach-table/analysis";

/** Optional controls reuse the existing device grid; the original demonstrations stay independent. */
export function installWorkbenchDemo<TData extends object>(api: GridApi<TData>): void {
  const gridHost = document.getElementById("gridHost");
  if (!gridHost) return;
  const wrapper = document.createElement("section");
  wrapper.id = "workbenchDemo";
  wrapper.style.marginTop = "12px";
  const tools = document.createElement("div");
  tools.className = "toolbar";
  tools.setAttribute("aria-label", "可选工作台");
  const host = document.createElement("div");
  const note = document.createElement("p");
  note.textContent = "可选工作台：先编辑上方表格，再审阅修改。保存为本地模拟：首次返回失败/冲突，重试成功；数据分析只读取已加载记录。";
  note.style.cssText = "font-size:12px;color:#64748b;margin:6px 0 10px";
  wrapper.append(tools, note, host);
  gridHost.after(wrapper);
  let active: WorkbenchHandle | null = null;
  let firstSave = true;
  const save: SaveChangesHandler<TData> = async (changes) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (!firstSave) return;
    firstSave = false;
    return {
      failures: changes.slice(0, 1).map((change) => ({ rowId: change.rowId, message: "模拟校验失败：确认修改后可重试", retryable: true, colIds: change.cells.map((cell) => cell.colId) })),
      conflicts: changes.slice(1, 2).map((change) => ({ rowId: change.rowId, message: "模拟版本冲突：请审阅后重试", retryable: true, serverVersion: 2, serverData: { ...change.data } }))
    };
  };
  const close = () => { active?.destroy(); active = null; };
  const add = (label: string, mount: () => WorkbenchHandle) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => { close(); button.focus(); active = mount(); });
    tools.append(button);
  };
  add("高级筛选", () => mountAdvancedFilterBuilder(host, { api, onClose: close }));
  add("修改审阅", () => mountChangeReview(host, { api, save, onClose: close }));
  add("数据分析", () => mountAnalysis(host, { api, pivot: { rowFields: ["workshop"], columnFields: ["status"], values: [{ field: "output", aggregate: "sum" }] }, onClose: close }));
  add("诊断", () => mountDiagnostics(host, { api, onClose: close }));
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.textContent = "关闭工作台";
  closeButton.addEventListener("click", close);
  tools.append(closeButton);
  const themeButton = document.getElementById("btnTheme");
  const refreshTheme = () => active?.refresh();
  themeButton?.addEventListener("click", refreshTheme);
  api.on("gridDestroyed", () => { close(); themeButton?.removeEventListener("click", refreshTheme); wrapper.remove(); });
}
