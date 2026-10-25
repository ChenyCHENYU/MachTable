import type { GridApi } from "../types/api";
import type { ColDef } from "../types/colDef";
import type { FieldPath } from "../types/path";
import { getByPath } from "../lib/path";
import { canReplaceGridData } from "../lib/adapterLifecycle";
import { routeKey } from "./selection";
import type { ServerSideProjection, ServerSideRouteSnapshot, ServerSideStore } from "./types";

type Row<T> = ServerSideProjection<T>;

function button(label: string, action: () => void | Promise<void>, disabled = false): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button"; element.className = "mach-server-button";
  element.textContent = label; element.disabled = disabled;
  element.addEventListener("click", event => {
    event.stopPropagation();
    try { void Promise.resolve(action()).catch(() => undefined); } catch { /* store reports operation failures */ }
  });
  return element;
}

function rangeText(state: ServerSideRouteSnapshot | undefined): string {
  if (!state) return "尚未加载";
  if (state.loading) return "加载中…";
  if (state.error) return "加载失败";
  const first = state.endRow > state.startRow ? state.startRow + 1 : 0;
  return `${first}–${state.endRow} / ${state.rowCount ?? "?"}`;
}

function paging<T>(store: ServerSideStore<T>, route: readonly string[]): HTMLElement {
  const state = store.getSnapshot().routes.find(item => routeKey(item.route) === routeKey(route));
  const element = document.createElement("span"); element.className = "mach-server-paging";
  const hint = document.createElement("span"); hint.className = "mach-server-range";
  hint.textContent = rangeText(state); hint.setAttribute("aria-live", "polite"); element.append(hint);
  element.append(button("上一页", () => store.load(route, Math.max(0, (state?.startRow ?? 0) - 1)), !state || state.loading || state.startRow === 0));
  element.append(button("下一页", () => store.load(route, state?.endRow ?? 0), !state || state.loading || state.rowCount === null || state.endRow >= state.rowCount));
  if (state?.error) element.append(button("重试", () => store.refresh(route)));
  return element;
}

export interface ServerSideGroupColumnOptions<T> {
  headerName?: string;
  width?: number;
  label?(row: Row<T>): string;
}

/** Accessible group, hierarchy-selection and route-paging controls; no synthetic data rows. */
export function createServerSideGroupColumn<T>(store: ServerSideStore<T>, options: ServerSideGroupColumnOptions<T> = {}): ColDef<Row<T>> {
  return {
    colId: "__server_group", headerName: options.headerName ?? "服务端分组", width: options.width ?? 420,
    minWidth: 260, pinned: "left", sortable: false, filter: false, editable: false,
    headerComponent: () => {
      const el = document.createElement("div"); el.className = "mach-server-header";
      const render = () => {
        el.replaceChildren(paging(store, []), button("刷新", () => store.refresh()), button("清除选择", () => store.clearSelection()));
      };
      render();
      return { el, destroy: store.subscribe(render) };
    },
    cellRenderer: ({ data }) => {
      if (!data) return "";
      const el = document.createElement("div"); el.className = "mach-server-cell";
      el.style.paddingInlineStart = `${data.depth * 16}px`;
      const select = document.createElement("input"); select.type = "checkbox";
      const selection = store.getSelection(data);
      select.checked = selection === "selected"; select.indeterminate = selection === "partial";
      select.setAttribute("aria-label", `选择 ${data.groupKey ?? data.id}`);
      select.addEventListener("click", event => { event.stopPropagation(); store.select(data, select.checked); });
      el.append(select);
      if (data.groupKey !== undefined) {
        const route = [...data.route, data.groupKey];
        const toggle = button(data.expanded ? "▾" : "▸", () => data.expanded ? store.collapse(route) : store.expand(route));
        toggle.setAttribute("aria-expanded", String(data.expanded));
        toggle.setAttribute("aria-label", `${data.expanded ? "收起" : "展开"} ${data.groupKey || "空白分组"}`);
        el.append(toggle);
      }
      const label = document.createElement("span"); label.className = "mach-server-label";
      label.textContent = options.label?.(data) ?? data.groupKey ?? data.id; el.append(label);
      if (data.expanded && data.groupKey !== undefined) el.append(paging(store, [...data.route, data.groupKey]));
      return el;
    }
  };
}

/** Aggregate values take precedence on group rows; business data stays under data. */
export function serverSideDataColumn<T>(field: FieldPath<T>, options: Omit<ColDef<Row<T>>, "field" | "valueGetter" | "editable"> = {}): ColDef<Row<T>> {
  const colId = options.colId ?? field;
  return { ...options, colId, headerName: options.headerName ?? field, editable: false,
    valueGetter: ({ data }) => data?.groupKey !== undefined && data.aggValues && Object.prototype.hasOwnProperty.call(data.aggValues, colId)
      ? data.aggValues[colId] : getByPath(data?.data, field) };
}

function blockControls(root: HTMLElement, pending: boolean): void {
  const controls = root.querySelectorAll<HTMLButtonElement | HTMLInputElement>(".mach-server-header button,.mach-server-cell button,.mach-server-cell input");
  for (const control of controls) {
    if (pending) {
      control.dataset.serverWasDisabled ??= String(control.disabled);
      control.disabled = true;
    } else if (control.dataset.serverWasDisabled !== undefined) {
      control.disabled = control.dataset.serverWasDisabled === "true";
      delete control.dataset.serverWasDisabled;
    }
  }
}

function pendingNotice(api: GridApi<any>, pending: boolean): void {
  const root = api.view.getRoot();
  if (!root) return;
  blockControls(root, pending);
  const existing = root.querySelector(".mach-server-sync-notice");
  if (!pending) { existing?.remove(); delete root.dataset.serverPending; return; }
  root.dataset.serverPending = "true";
  if (existing) return;
  const notice = document.createElement("div");
  notice.className = "mach-server-sync-notice"; notice.setAttribute("role", "status");
  notice.textContent = "新数据等待显示：请先保存、取消编辑或回滚修改";
  root.append(notice);
}

/** One-way projection updates; guarded grid event listeners only change the server query/selection. */
export function bindServerSideGrid<T>(api: GridApi<Row<T>>, store: ServerSideStore<T>): () => void {
  if (!canReplaceGridData(api)) throw new Error("[MachTable] Save or cancel grid edits before binding server-side data.");
  let syncing = false;
  let revision = -1;
  let disposed = false;
  const sync = () => {
    if (syncing || disposed || api.isDestroyed()) return;
    const state = store.getSnapshot();
    const blocked = state.revision !== revision && !canReplaceGridData(api);
    pendingNotice(api, blocked);
    if (blocked) return;
    syncing = true;
    try {
      if (state.revision !== revision) {
        revision = state.revision;
        api.rows.setData([...state.rows]);
      }
      api.selection.setRows(state.rows.filter(row => store.getSelection(row) === "selected"), true);
      api.view.refreshCells();
    } finally { syncing = false; }
  };
  const changeQuery = () => {
    if (syncing || disposed) return;
    void store.setQuery({ sortModel: api.sorting.getModel(), filterModel: api.filtering.getModel(),
      advancedFilterModel: api.filtering.getAdvancedModel(), quickFilterText: api.filtering.getQuickText() }).catch(() => undefined);
  };
  const applyPending = () => { if (store.getSnapshot().revision !== revision) sync(); };
  api.updateOptions({ rowKey: row => row.key, rowSelection: "multiple", manualFiltering: true, manualSorting: true, pagination: false });
  const cleanups = [store.subscribe(sync), api.on("sortChanged", changeQuery), api.on("filterChanged", changeQuery),
    api.on("dirtyStateChanged", applyPending), api.on("cellEditingStopped", applyPending), api.on("rowEditingStopped", applyPending),
    api.on("selectionChanged", () => {
      if (syncing || disposed || store.getSnapshot().revision !== revision) return;
      const selected = new Set(api.selection.getIds());
      const changes = store.getSnapshot().rows.filter(row => selected.has(row.key) !== (store.getSelection(row) === "selected"));
      for (const row of changes) store.select(row, selected.has(row.key));
    })];
  const dispose = () => {
    if (disposed) return;
    disposed = true; for (const cleanup of cleanups) cleanup(); pendingNotice(api, false); store.dispose();
  };
  cleanups.push(api.on("gridDestroyed", dispose));
  sync();
  void store.setQuery({ sortModel: api.sorting.getModel(), filterModel: api.filtering.getModel(),
    advancedFilterModel: api.filtering.getAdvancedModel(), quickFilterText: api.filtering.getQuickText() })
    .then(() => store.getSnapshot().routes.length === 0 ? store.load() : undefined).catch(() => undefined);
  return dispose;
}
