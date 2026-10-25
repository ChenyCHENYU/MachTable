import type { GridBatchSaveResult, GridChange, SaveChangeConflict, SaveChangeIssue, SaveChangesHandler } from "../types/api";
import type { RowNode } from "../types/row";
import type { ColDef, ColDefGroup } from "../types/colDef";
import { leafColumns } from "./columns";
import { resolveSaveConflict } from "../lib/batchSave";
import { button, createWorkbench, element, errorText, focusControl, type WorkbenchHandle, type WorkbenchOptions } from "./shared";

export interface ChangeReviewOptions<TData = any> extends WorkbenchOptions<TData> {
  save?: SaveChangesHandler<TData>;
}
type SaveOwners<TData> = Map<string, { node: RowNode<TData> | undefined; data: TData | null | undefined }>;
interface ReviewIssue<TData> { kind: "失败" | "冲突"; detail: SaveChangeIssue | SaveChangeConflict<TData>; node: RowNode<TData>; data: TData | null }

/** Save/rollback semantics belong to GridApi; this panel only owns presentation and retry selection. */
export function mountChangeReview<TData>(host: HTMLElement, options: ChangeReviewOptions<TData>): WorkbenchHandle {
  return new ChangeReview(host, options);
}

class ChangeReview<TData> implements WorkbenchHandle {
  private panel: ReturnType<typeof createWorkbench>;
  private destroyed = false;
  private busy = false;
  private refreshQueued = false;
  private page = 0;
  private cellPages = new Map<string, number>();
  private issues = new Map<string, ReviewIssue<TData>>();
  private labels = new Map<string, string>();
  private unsubscribes: Array<() => void>;

  constructor(host: HTMLElement, private options: ChangeReviewOptions<TData>) {
    if (options.api.isDestroyed()) throw new Error("Cannot mount review on a destroyed grid");
    this.panel = createWorkbench(host, "修改审阅", () => {
      if (this.destroyed) return;
      this.destroy();
      options.onClose?.();
    }, options.api);
    this.unsubscribes = [options.api.on("dirtyStateChanged", () => this.scheduleRefresh()), options.api.on("gridDestroyed", () => this.destroy())];
    this.refresh();
    this.panel.root.focus();
  }

  refresh(): void {
    if (!this.alive()) return;
    const changes = this.options.api.editing.getChanges();
    this.labels = columnLabels(this.options.api.columns.getDefinitions() ?? []);
    const ids = new Set(changes.map((change) => change.rowId));
    for (const [id, issue] of this.issues) if (!ids.has(id) || !this.owns(issue)) this.issues.delete(id);
    for (const id of this.cellPages.keys()) if (!ids.has(id)) this.cellPages.delete(id);
    this.page = Math.min(this.page, Math.max(0, Math.ceil(changes.length / 20) - 1));
    this.panel.syncTheme();
    this.panel.root.setAttribute("aria-busy", String(this.busy));
    this.panel.body.replaceChildren();
    if (!changes.length) this.panel.body.append(element("p", "mach-workbench__empty", "当前没有未保存的修改。"));
    for (const row of changes.slice(this.page * 20, (this.page + 1) * 20)) this.panel.body.append(this.renderRow(row));
    this.renderFooter(changes.length);
    if (this.busy) this.panel.status.textContent = "正在保存；新修改会保留，关闭不取消请求。";
    else if (!this.options.save) this.panel.status.textContent = "尚未提供保存处理器，可查看、定位或撤销。";
    else this.panel.status.textContent = `${changes.length} 行待保存 · ${this.issues.size} 行存在失败或冲突。`;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribes.splice(0).forEach((unsubscribe) => unsubscribe());
    this.panel.destroy();
    this.issues.clear();
    this.cellPages.clear();
  }

  private alive(): boolean { return !this.destroyed && !this.options.api.isDestroyed(); }

  /** One paste/fill may emit thousands of changes; render at most once before the next paint. */
  private scheduleRefresh(): void {
    if (this.refreshQueued || !this.alive()) return;
    this.refreshQueued = true;
    queueMicrotask(() => {
      this.refreshQueued = false;
      if (this.alive()) this.refresh();
    });
  }

  private owns(issue: ReviewIssue<TData>): boolean {
    const node = this.options.api.rows.getById(issue.detail.rowId);
    return node === issue.node && node?.data === issue.data;
  }

  private async save(rowIds?: readonly string[]): Promise<void> {
    if (!this.alive() || this.busy || !this.options.save) return;
    const selected = rowIds ? new Set(rowIds) : null;
    const submitted = this.options.api.editing.getChanges().filter((change) => !selected || selected.has(change.rowId));
    if (!submitted.length) return;
    const owners: SaveOwners<TData> = new Map(submitted.map((change) => {
      const node = this.options.api.rows.getById(change.rowId);
      return [change.rowId, { node, data: node?.data }];
    }));
    this.busy = true;
    this.refresh();
    try {
      const result = await this.options.api.editing.save(this.options.save, rowIds);
      if (!this.alive()) return;
      this.applyResult(submitted, owners, result);
    } catch (error) {
      if (!this.alive()) return;
      for (const row of submitted) {
        const node = this.currentOwner(row.rowId, owners);
        if (node) this.issues.set(row.rowId, { kind: "失败", detail: { rowId: row.rowId, retryable: true, message: errorText(error) }, node, data: node.data });
      }
    } finally {
      if (this.alive()) { this.busy = false; this.refresh(); }
    }
  }

  private currentOwner(rowId: string, owners: SaveOwners<TData>): RowNode<TData> | undefined {
    const owner = owners.get(rowId);
    return owner?.node === this.options.api.rows.getById(rowId) && owner?.node?.data === owner?.data ? owner?.node : undefined;
  }

  private applyResult(submitted: GridChange<TData>[], owners: SaveOwners<TData>, result: GridBatchSaveResult<TData>): void {
    const conflicts = new Map(result.conflicts.map((issue) => [issue.rowId, issue]));
    const failures = new Map(result.failures.map((issue) => [issue.rowId, issue]));
    for (const row of submitted) {
      const node = this.currentOwner(row.rowId, owners);
      if (!node) continue;
      this.issues.delete(row.rowId);
      const conflict = conflicts.get(row.rowId);
      const detail = conflict ?? failures.get(row.rowId);
      if (detail) this.issues.set(row.rowId, { kind: conflict ? "冲突" : "失败", detail, node, data: node.data });
    }
  }

  private rollback(rowIds?: readonly string[]): void {
    if (!this.alive() || this.busy) return;
    this.options.api.editing.rollback(rowIds);
    this.refresh();
  }

  private retryIds(): string[] {
    return [...this.issues].filter(([, issue]) => issue.detail.retryable !== false && this.owns(issue)).map(([id]) => id);
  }

  private renderFooter(count: number): void {
    this.panel.footer.replaceChildren();
    const save = button("保存全部修改", () => { void this.save(); }, "mach-workbench__button--primary");
    save.disabled = this.busy || !this.options.save || !count;
    const retry = button("仅重试失败与冲突", () => { void this.save(this.retryIds()); });
    retry.disabled = this.busy || !this.options.save || !this.retryIds().length;
    const rollback = button("撤销全部修改", () => this.rollback());
    rollback.disabled = this.busy || !count;
    const navigation = element("nav", "mach-workbench__tools");
    navigation.setAttribute("aria-label", "修改记录分页");
    const previous = button("上一页", () => { this.page--; this.refresh(); focusControl(this.panel.footer, "上一页"); });
    const next = button("下一页", () => { this.page++; this.refresh(); focusControl(this.panel.footer, "下一页"); });
    previous.disabled = this.page <= 0;
    next.disabled = (this.page + 1) * 20 >= count;
    navigation.append(previous, element("span", undefined, `第 ${this.page + 1} / ${Math.max(1, Math.ceil(count / 20))} 页`), next);
    this.panel.footer.append(navigation, rollback, retry, save);
  }

  private renderRow(change: GridChange<TData>): HTMLElement {
    const root = element("article", "mach-review__row");
    root.dataset.rowId = change.rowId;
    const header = element("div", "mach-workbench__tools");
    header.append(element("h3", "mach-review__title", `记录 ${change.rowId} · ${change.cells.length} 处修改`));
    const rollback = button("撤销本行", () => this.rollback([change.rowId]));
    rollback.disabled = this.busy;
    header.append(rollback);
    const issue = this.issues.get(change.rowId);
    if (issue) this.renderIssue(root, issue);
    root.prepend(header);
    const table = element("table", "mach-review__table");
    table.setAttribute("aria-label", `记录 ${change.rowId} 的修改明细`);
    const head = element("thead");
    const titles = element("tr");
    for (const text of ["字段", "原值", "新值", "定位"]) { const cell = element("th", undefined, text); cell.scope = "col"; titles.append(cell); }
    head.append(titles);
    const body = element("tbody");
    const page = Math.min(this.cellPages.get(change.rowId) ?? 0, Math.max(0, Math.ceil(change.cells.length / 20) - 1));
    for (const cell of change.cells.slice(page * 20, (page + 1) * 20)) {
      const row = element("tr");
      const invalid = issue?.detail.colIds?.includes(cell.colId);
      if (invalid) row.classList.add("mach-review__cell--issue");
      const heading = element("th", undefined, this.labels.get(cell.colId) ?? cell.colId);
      heading.title = cell.colId;
      if (invalid) heading.append(element("small", "mach-workbench__hint", " · 问题字段"));
      heading.scope = "row";
      const locate = element("td");
      locate.append(button("定位字段", () => this.locate(change.rowId, cell.colId)));
      row.append(heading, element("td", "mach-review__old", describeValue(cell.originalValue)), element("td", "mach-review__new", describeValue(cell.value)), locate);
      body.append(row);
    }
    table.append(head, body);
    root.append(table);
    if (change.cells.length > 20) root.append(this.cellNavigation(change, page));
    return root;
  }

  private renderIssue(root: HTMLElement, issue: ReviewIssue<TData>): void {
    const message = element("p", "mach-review__issue", `${issue.kind}${issue.detail.code ? ` [${issue.detail.code}]` : ""}：${issue.detail.message}`);
    message.setAttribute("role", "alert");
    const conflict = issue.detail as SaveChangeConflict<TData>;
    if (conflict.serverVersion != null) message.append(element("span", "mach-workbench__hint", ` · 服务端版本 ${conflict.serverVersion}`));
    if (issue.detail.retryable === false) message.append(element("span", "mach-workbench__hint", " · 无法直接重试，请先修正数据。"));
    root.append(message);
    if (conflict.serverData != null) {
      const detail = element("details", "mach-review__server");
      detail.append(element("summary", undefined, "查看服务端记录"), element("pre", undefined, describeValue(conflict.serverData)));
      root.append(detail);
    }
    if (issue.kind === "冲突") {
      const keep = button("保留本地并重试", () => {
        if (!this.alive() || this.busy || !this.owns(issue)) return;
        if (resolveSaveConflict(this.options.api, conflict, "keepLocal")) void this.save([conflict.rowId]);
      });
      keep.disabled = this.busy || !this.options.save || conflict.retryable === false;
      const accept = button("采用服务端记录", () => {
        if (!this.alive() || this.busy || !this.owns(issue)) return;
        this.acceptServer(conflict);
      });
      accept.disabled = this.busy || conflict.serverData == null;
      root.append(keep, accept);
    }
  }

  private acceptServer(conflict: SaveChangeConflict<TData>): void {
    try {
      if (resolveSaveConflict(this.options.api, conflict, "acceptServer")) {
        this.issues.delete(conflict.rowId);
        this.refresh();
        return;
      }
      this.panel.status.textContent = "服务端记录缺失或行标识不一致，无法采用；本地修改已保留。";
    } catch (error) { this.panel.status.textContent = errorText(error); }
    this.panel.status.setAttribute("role", "alert");
  }

  private cellNavigation(change: GridChange<TData>, page: number): HTMLElement {
    const root = element("div", "mach-workbench__tools");
    const previous = button("上一组字段", () => { this.cellPages.set(change.rowId, page - 1); this.refresh(); });
    const next = button("下一组字段", () => { this.cellPages.set(change.rowId, page + 1); this.refresh(); });
    previous.disabled = page === 0;
    next.disabled = (page + 1) * 20 >= change.cells.length;
    root.append(previous, element("span", undefined, `字段第 ${page * 20 + 1}–${Math.min((page + 1) * 20, change.cells.length)} / ${change.cells.length}`), next);
    return root;
  }

  private locate(rowId: string, colId: string): void {
    const node = this.options.api.rows.getById(rowId);
    if (!node || node.rowIndex < 0) { this.panel.status.textContent = "记录未在当前视图，请调整筛选或分页后定位。"; return; }
    this.options.api.view.scrollToRow(node.rowIndex, "nearest");
    const root = this.options.api.view.getRoot();
    const cells = root?.querySelectorAll<HTMLElement>(`.mach-row[data-index="${node.rowIndex}"] .mach-cell`);
    const cell = [...(cells ?? [])].find((element) => element.dataset.colId === colId);
    cell?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    window.dispatchEvent(new MouseEvent("mouseup"));
    if (!cell) this.panel.status.textContent = `已定位记录；字段 ${colId} 未显示，请调整列显示或横向滚动。`;
    root?.focus();
  }
}

function describeValue(value: unknown): string {
  if (value === null) return "空值";
  if (value === undefined) return "未设置";
  if (typeof value === "string") return value || "空字符串";
  if (typeof value === "function") return "[函数]";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint" || typeof value === "symbol") return String(value);
  try { return JSON.stringify(value) ?? "未设置"; }
  catch { return "[无法序列化的值]"; }
}

function columnLabels<TData>(definitions: readonly (ColDef<TData> | ColDefGroup<TData>)[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const column of leafColumns(definitions)) {
    const id = column.colId ?? column.field;
    if (id) labels.set(id, column.headerName ?? id);
  }
  return labels;
}
