import type { CellRendererParams } from "../types/params";
import type { CellRendererFn } from "../types/colDef";
import type { ActionPolicyContext } from "../types/options";
import type { GridChange } from "../types/api";
import { DEFAULT_LOCALE } from "./locale";

export type TagVariant = "success" | "warning" | "danger" | "info" | "neutral";

export interface StatusTagConfig {
  variantMap?: Record<string, TagVariant>;
  labelMap?: Record<string, string>;
}

const DEFAULT_STATUS_VARIANTS: Array<[RegExp, TagVariant]> = [
  [/^(success|ok|done|complete|completed|normal|active|enabled|启用|正常|完成|已完成|运行|运行中|在线|生效)$/i, "success"],
  [/^(warning|warn|hold|pending|standby|待机|待审核|暂停|预警|部分完成)$/i, "warning"],
  [/^(error|fail|failed|danger|fault|offline|disabled|故障|失败|错误|异常|停用|离线|断开)$/i, "danger"],
  [/^(info|processing|new|draft|进行中|新建|草稿|审批中|同步中)$/i, "info"]
];

export function resolveTagVariant(value: any, variantMap?: Record<string, TagVariant>): TagVariant {
  const key = String(value ?? "");
  if (variantMap) {
    const exact = variantMap[key];
    if (exact) return exact;
    const lower = variantMap[key.toLowerCase()];
    if (lower) return lower;
  }
  for (const [pattern, variant] of DEFAULT_STATUS_VARIANTS) {
    if (pattern.test(key)) return variant;
  }
  return "neutral";
}

export function createStatusTagRenderer(config: StatusTagConfig = {}): CellRendererFn {
  return (params: CellRendererParams) => {
    if (params.value == null || params.value === "") return "";
    const variant = resolveTagVariant(params.value, config.variantMap);
    const label = config.labelMap?.[String(params.value)] ?? (params.formatted || String(params.value));
    const tag = document.createElement("span");
    tag.className = `mach-tag mach-tag--${variant}`;
    tag.textContent = label;
    return tag;
  };
}

export interface ProgressConfig {
  showValue?: boolean;
  unit?: string;
  color?: string;
}

export function createProgressBarRenderer(config: ProgressConfig = {}): CellRendererFn {
  return (params: CellRendererParams) => {
    const raw = Number(params.value);
    if (isNaN(raw)) return params.formatted;
    const pct = Math.max(0, Math.min(100, raw));
    const wrap = document.createElement("div");
    wrap.className = "mach-progress";
    const track = document.createElement("div");
    track.className = "mach-progress__track";
    const bar = document.createElement("div");
    bar.className = "mach-progress__bar";
    bar.style.width = `${pct}%`;
    if (config.color) bar.style.background = config.color;
    track.appendChild(bar);
    wrap.appendChild(track);
    if (config.showValue !== false) {
      const label = document.createElement("span");
      label.className = "mach-progress__label";
      label.textContent = `${Math.round(pct)}${config.unit ?? "%"}`;
      wrap.appendChild(label);
    }
    return wrap;
  };
}

export function linkRenderer(params: CellRendererParams): string | HTMLElement {
  if (params.value == null || params.value === "") return "";
  const link = document.createElement("span");
  link.className = "mach-link";
  link.textContent = params.formatted || String(params.value);
  return link;
}

const ICON_PATHS = {
  edit: '<path d="M11.5 2.5l2 2L5 13H3v-2l8.5-8.5z"/>',
  delete: '<path d="M3 5h10M6 5V3h4v2M5 5l.7 8h4.6L11 5"/>',
  view: '<path d="M1.5 8s2.4-4.2 6.5-4.2S14.5 8 14.5 8s-2.4 4.2-6.5 4.2S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.8"/>',
  copy: '<rect x="5" y="5" width="8" height="8" rx="1"/><path d="M3 11V3h8"/>',
  download: '<path d="M8 2v8m0 0l-3-3m3 3l3-3M2.5 13.5h11"/>',
  refresh: '<path d="M13 3v4h-4M3 13V9h4"/><path d="M13 7a5.5 5.5 0 00-9.7-2.6M3 9a5.5 5.5 0 009.7 2.6"/>',
  close: '<path d="M3.5 3.5l9 9m0-9l-9 9"/>',
  check: '<path d="M2.5 8.5l3.5 3.5 7.5-8"/>',
  plus: '<path d="M8 2.5v11M2.5 8h11"/>',
  search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>',
  more: '<circle cx="3" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="13" cy="8" r=".9" fill="currentColor" stroke="none"/>'
} as const;

export type BuiltInActionIcon = keyof typeof ICON_PATHS;

function iconSvg(name: BuiltInActionIcon, size = 14): string {
  const path = ICON_PATHS[name] ?? "";
  return `<svg viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

export type ActionVariant = "default" | "primary" | "warning" | "success" | "danger";
export type ActionOverflowMode = "menu" | "drawer" | "inline";

export interface ActionItem<TData = any> {
  /** Stable identifier used by permission, telemetry and error policies. */
  id?: string;
  icon?: BuiltInActionIcon;
  label?: string;
  title?: string;
  variant?: ActionVariant;
  show?: (params: CellRendererParams<TData>) => boolean;
  disabled?: boolean | ((params: CellRendererParams<TData>) => boolean);
  loading?: boolean | ((params: CellRendererParams<TData>) => boolean);
  /** One or more UI permissions. Access is resolved by GridOptions.actionPolicy. */
  permission?: string | readonly string[];
  /** Ask for confirmation before running. A string becomes the confirmation message. */
  confirm?: boolean | string | ((params: CellRendererParams<TData>) => boolean | string | Promise<boolean | string>);
  onClick: (params: CellRendererParams<TData>) => unknown | Promise<unknown>;
}

export interface ActionButtonsConfig<TData = any> {
  actions: ActionItem<TData>[];
  max?: number;
  /** menu is compact, drawer suits touch/complex actions, inline never renders an ellipsis. */
  overflow?: ActionOverflowMode;
  moreLabel?: string;
  drawerTitle?: string;
}

export interface RowActionsConfig<TData = any> extends Omit<ActionButtonsConfig<TData>, "actions"> {
  onView?: (params: CellRendererParams<TData>) => unknown | Promise<unknown>;
  onDelete?: (params: CellRendererParams<TData>) => unknown | Promise<unknown>;
  /** Persists the just-validated row. Failures reopen row editing and keep the change dirty. */
  onSave?: (
    params: CellRendererParams<TData>,
    changes: readonly GridChange<TData>[]
  ) => unknown | Promise<unknown>;
  /** Set false when this table has no full-row edit workflow. */
  edit?: boolean;
  extraActions?: ActionItem<TData>[];
  labels?: Partial<Record<"view" | "edit" | "delete" | "confirm" | "save" | "cancel", string>>;
  permissions?: Partial<Record<"view" | "edit" | "delete", string | readonly string[]>>;
  /** Defaults to the translated delete label when true. */
  confirmDelete?: boolean | string | ((params: CellRendererParams<TData>) => boolean | string | Promise<boolean | string>);
}

let openActionSurface: HTMLElement | null = null;
let openActionAnchor: HTMLElement | null = null;

function closeActionSurface(restoreFocus = false): void {
  openActionSurface?.remove();
  openActionSurface = null;
  if (openActionAnchor) {
    openActionAnchor.setAttribute("aria-expanded", "false");
    if (restoreFocus && openActionAnchor.isConnected) openActionAnchor.focus({ preventScroll: true });
  }
  openActionAnchor = null;
  document.removeEventListener("mousedown", onActionSurfaceOutside, true);
  document.removeEventListener("keydown", onActionSurfaceKeyDown, true);
}

function onActionSurfaceOutside(event: MouseEvent): void {
  if (
    openActionSurface &&
    !openActionSurface.contains(event.target as Node) &&
    !openActionAnchor?.contains(event.target as Node)
  ) closeActionSurface();
}

function onActionSurfaceKeyDown(event: KeyboardEvent): void {
  if (!openActionSurface) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeActionSurface(true);
    return;
  }
  const buttons = [...openActionSurface.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
  if (buttons.length === 0) return;
  if (event.key === "Tab") {
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if ((!event.shiftKey && current === buttons.length - 1) || (event.shiftKey && current <= 0)) {
      event.preventDefault();
      buttons[event.shiftKey ? buttons.length - 1 : 0].focus();
    }
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const delta = event.key === "ArrowDown" ? 1 : -1;
  buttons[(current + delta + buttons.length) % buttons.length].focus();
}

interface SurfaceItem {
  label: string;
  icon?: BuiltInActionIcon;
  variant?: ActionVariant;
  disabled?: boolean;
  pick: (button: HTMLButtonElement) => void;
}

function makeSurfaceButton(item: SurfaceItem, className: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  if (item.variant && item.variant !== "default") button.classList.add(`${className}--${item.variant}`);
  button.disabled = item.disabled === true;
  if (item.icon && ICON_PATHS[item.icon]) button.innerHTML = `${iconSvg(item.icon, 16)}<span>${item.label}</span>`;
  else button.textContent = item.label;
  button.addEventListener("click", () => item.pick(button));
  return button;
}

function showActionMenu(anchor: HTMLElement, items: SurfaceItem[]): void {
  closeActionSurface();
  const menu = document.createElement("div");
  menu.className = "mach-context-menu mach-action-menu";
  menu.setAttribute("role", "menu");
  for (const item of items) {
    const button = makeSurfaceButton(item, "mach-context-menu-item");
    button.setAttribute("role", "menuitem");
    menu.appendChild(button);
  }
  document.body.appendChild(menu);
  const rect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(Math.max(8, rect.left), window.innerWidth - menuRect.width - 8)}px`;
  menu.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - menuRect.height - 8)}px`;
  openActionSurface = menu;
  openActionAnchor = anchor;
  anchor.setAttribute("aria-expanded", "true");
  document.addEventListener("mousedown", onActionSurfaceOutside, true);
  document.addEventListener("keydown", onActionSurfaceKeyDown, true);
  menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
}

function showActionDrawer(anchor: HTMLElement, title: string, items: SurfaceItem[]): void {
  closeActionSurface();
  const backdrop = document.createElement("div");
  backdrop.className = "mach-action-drawer-backdrop";
  const drawer = document.createElement("section");
  drawer.className = "mach-action-drawer";
  drawer.setAttribute("role", "dialog");
  drawer.setAttribute("aria-modal", "true");
  drawer.setAttribute("aria-label", title);
  const header = document.createElement("header");
  header.className = "mach-action-drawer__header";
  const heading = document.createElement("strong");
  heading.textContent = title;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "mach-action-drawer__close";
  close.setAttribute("aria-label", "Close");
  close.title = "Close";
  close.innerHTML = iconSvg("close", 16);
  close.addEventListener("click", () => closeActionSurface(true));
  header.append(heading, close);
  const body = document.createElement("div");
  body.className = "mach-action-drawer__body";
  for (const item of items) body.appendChild(makeSurfaceButton(item, "mach-action-drawer__item"));
  drawer.append(header, body);
  backdrop.appendChild(drawer);
  backdrop.addEventListener("mousedown", (event) => {
    if (event.target === backdrop) closeActionSurface(true);
  });
  document.body.appendChild(backdrop);
  openActionSurface = backdrop;
  openActionAnchor = anchor;
  anchor.setAttribute("aria-expanded", "true");
  document.addEventListener("keydown", onActionSurfaceKeyDown, true);
  drawer.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
}

function resolveActionFlag<TData>(
  flag: boolean | ((params: CellRendererParams<TData>) => boolean) | undefined,
  params: CellRendererParams<TData>
): boolean {
  if (typeof flag === "function") {
    try { return flag(params); } catch { return false; }
  }
  return flag === true;
}

function actionVariant(action: ActionItem): ActionVariant {
  return action.variant ?? "default";
}

function actionPermissions<TData>(action: ActionItem<TData>): readonly string[] {
  if (!action.permission) return [];
  return typeof action.permission === "string" ? [action.permission] : action.permission;
}

function actionContext<TData>(
  action: ActionItem<TData>,
  params: CellRendererParams<TData>,
  message?: string
): ActionPolicyContext<TData> {
  return {
    ...(action.id ? { actionId: action.id } : {}),
    permissions: actionPermissions(action),
    ...(message ? { message } : {}),
    params
  };
}

function reportActionError<TData>(
  error: unknown,
  action: ActionItem<TData>,
  params: CellRendererParams<TData>
): void {
  const policy = params.api.getOption("actionPolicy");
  try {
    if (policy?.onError) policy.onError(error, actionContext(action, params));
    else console.error("[mach-table] action handler failed", error);
  } catch (policyError) {
    console.error("[mach-table] action error policy failed", policyError, error);
  }
}

function canAccessAction<TData>(action: ActionItem<TData>, params: CellRendererParams<TData>): boolean {
  const permissions = actionPermissions(action);
  if (permissions.length === 0) return true;
  const policy = params.api.getOption("actionPolicy");
  if (!policy?.canAccess) return true;
  try {
    return policy.canAccess(actionContext(action, params));
  } catch (error) {
    reportActionError(error, action, params);
    return false;
  }
}

function visibleActions<TData>(actions: readonly ActionItem<TData>[], params: CellRendererParams<TData>): ActionItem<TData>[] {
  return actions.filter((action) => {
    if (!canAccessAction(action, params)) return false;
    if (!action.show) return true;
    try { return action.show(params); } catch { return false; }
  });
}

type ActionRunner<TData> = (action: ActionItem<TData>, button: HTMLButtonElement) => void;

function finishActionButton<TData>(
  action: ActionItem<TData>,
  params: CellRendererParams<TData>,
  button: HTMLButtonElement
): void {
  if (!button.isConnected) return;
  button.disabled = resolveActionFlag(action.disabled, params) || resolveActionFlag(action.loading, params);
  button.classList.toggle("mach-action-btn--loading", resolveActionFlag(action.loading, params));
}

function observeActionResult<TData>(
  result: unknown,
  action: ActionItem<TData>,
  params: CellRendererParams<TData>,
  button: HTMLButtonElement
): void {
  void Promise.resolve(result)
    .catch((error) => reportActionError(error, action, params))
    .finally(() => finishActionButton(action, params, button));
}

function runUnconfirmedAction<TData>(
  action: ActionItem<TData>,
  params: CellRendererParams<TData>,
  button: HTMLButtonElement
): void {
  try {
    observeActionResult(action.onClick(params), action, params, button);
  } catch (error) {
    reportActionError(error, action, params);
    finishActionButton(action, params, button);
  }
}

function resolveConfirmation<TData>(
  request: boolean | string,
  action: ActionItem<TData>,
  params: CellRendererParams<TData>
): boolean | Promise<boolean> {
  if (request === false) return false;
  const message = typeof request === "string" ? request : (action.label ?? action.title ?? "Confirm action");
  const policy = params.api.getOption("actionPolicy");
  if (policy?.confirm) return policy.confirm(actionContext(action, params, message));
  if (typeof window === "undefined" || typeof window.confirm !== "function") return false;
  return window.confirm(message);
}

function confirmAction<TData>(
  action: ActionItem<TData>,
  params: CellRendererParams<TData>
): boolean | Promise<boolean> {
  if (action.confirm == null || action.confirm === false) return true;
  if (typeof action.confirm !== "function") return resolveConfirmation(action.confirm, action, params);
  const request = action.confirm(params);
  if (request instanceof Promise) {
    return request.then((resolved) => resolveConfirmation(resolved, action, params));
  }
  return resolveConfirmation(request, action, params);
}

function createActionRunner<TData>(params: CellRendererParams<TData>): ActionRunner<TData> {
  return (action, button) => {
    if (resolveActionFlag(action.disabled, params)) return;
    button.disabled = true;
    button.classList.add("mach-action-btn--loading");
    if (action.confirm == null || action.confirm === false) {
      runUnconfirmedAction(action, params, button);
      return;
    }
    const execute = async (): Promise<void> => {
      if (!await confirmAction(action, params)) return;
      await action.onClick(params);
    };
    void execute().catch((error) => reportActionError(error, action, params)).finally(() => {
      finishActionButton(action, params, button);
    });
  };
}

function createInlineActionButton<TData>(
  action: ActionItem<TData>,
  params: CellRendererParams<TData>,
  run: ActionRunner<TData>
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mach-action-btn";
  const variant = actionVariant(action);
  if (variant !== "default") button.classList.add(`mach-action-btn--${variant}`);
  const title = action.title ?? action.label ?? "Action";
  button.title = title;
  button.setAttribute("aria-label", title);
  button.disabled = resolveActionFlag(action.disabled, params);
  if (resolveActionFlag(action.loading, params)) {
    button.disabled = true;
    button.classList.add("mach-action-btn--loading");
  }
  if (action.icon && ICON_PATHS[action.icon]) {
    button.innerHTML = iconSvg(action.icon);
    button.classList.add("mach-action-btn--icon");
  } else {
    button.textContent = action.label ?? title;
  }
  button.addEventListener("mousedown", (event) => event.stopPropagation());
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    run(action, button);
  });
  return button;
}

function createOverflowActionButton<TData>(
  actions: readonly ActionItem<TData>[],
  mode: ActionOverflowMode,
  config: ActionButtonsConfig<TData>,
  params: CellRendererParams<TData>,
  run: ActionRunner<TData>
): HTMLButtonElement {
  const more = document.createElement("button");
  more.type = "button";
  more.className = "mach-action-btn mach-action-btn--icon";
  const locale = params.api.getOption("locale") ?? {};
  const label = config.moreLabel ?? locale.actionMore ?? DEFAULT_LOCALE.actionMore;
  more.title = label;
  more.setAttribute("aria-label", label);
  more.setAttribute("aria-haspopup", mode === "drawer" ? "dialog" : "menu");
  more.setAttribute("aria-expanded", "false");
  more.innerHTML = `${iconSvg("more", 16)}<span class="mach-sr-only">⋯</span>`;
  more.addEventListener("mousedown", (event) => event.stopPropagation());
  more.addEventListener("click", (event) => {
    event.stopPropagation();
    const items = actions.map((action): SurfaceItem => ({
      label: action.label ?? action.title ?? "Action",
      icon: action.icon,
      variant: actionVariant(action),
      disabled: resolveActionFlag(action.disabled, params) || resolveActionFlag(action.loading, params),
      pick: (button) => {
        closeActionSurface();
        run(action, button);
      }
    }));
    if (mode === "drawer") showActionDrawer(more, config.drawerTitle ?? label, items);
    else showActionMenu(more, items);
  });
  return more;
}

export function createActionButtonsRenderer<TData = any>(config: ActionButtonsConfig<TData>): CellRendererFn {
  const max = Math.max(0, config.max ?? 3);
  const overflowMode = config.overflow ?? "menu";
  return (params: CellRendererParams<TData>) => {
    const visible = visibleActions(config.actions, params);
    if (visible.length === 0) return "";

    const wrap = document.createElement("div");
    wrap.className = "mach-actions";
    const shown = overflowMode === "inline" ? visible : visible.slice(0, max);
    const overflow = overflowMode === "inline" ? [] : visible.slice(max);
    const run = createActionRunner(params);

    for (const action of shown) {
      wrap.appendChild(createInlineActionButton(action, params, run));
    }

    if (overflow.length > 0) {
      wrap.appendChild(createOverflowActionButton(overflow, overflowMode, config, params, run));
    }

    return {
      el: wrap,
      destroy: () => {
        if (openActionAnchor && wrap.contains(openActionAnchor)) closeActionSurface();
      }
    };
  };
}

interface RowActionLabels {
  view: string;
  edit: string;
  delete: string;
  confirm: string;
  save: string;
  cancel: string;
}

function actionLabel(configured: string | undefined, localized: string | undefined, fallback: string): string {
  return configured ?? localized ?? fallback;
}

function resolveRowActionLabels<TData>(
  config: RowActionsConfig<TData>,
  params: CellRendererParams<TData>
): RowActionLabels {
  const locale = params.api.getOption("locale") ?? {};
  return {
    view: actionLabel(config.labels?.view, locale.actionView, DEFAULT_LOCALE.actionView),
    edit: actionLabel(config.labels?.edit, locale.actionEdit, DEFAULT_LOCALE.actionEdit),
    delete: actionLabel(config.labels?.delete, locale.actionDelete, DEFAULT_LOCALE.actionDelete),
    confirm: actionLabel(config.labels?.confirm, locale.actionConfirm, DEFAULT_LOCALE.actionConfirm),
    save: actionLabel(config.labels?.save, locale.actionSave, DEFAULT_LOCALE.actionSave),
    cancel: actionLabel(config.labels?.cancel, locale.actionCancel, DEFAULT_LOCALE.actionCancel)
  };
}

function renderRowEditingActions<TData>(
  config: RowActionsConfig<TData>,
  params: CellRendererParams<TData>,
  labels: RowActionLabels
): ReturnType<CellRendererFn> {
  const confirm = async (): Promise<void> => {
    const committed = await params.api.editing.stop();
    if (!committed || !config.onSave) return;
    const changes = params.api.editing.getChanges().filter((change) => change.rowId === params.node.id);
    try {
      await config.onSave(params, changes);
      params.api.editing.markSaved([params.node.id]);
    } catch (error) {
      params.api.editing.startRow(params.rowIndex);
      throw error;
    }
  };
  const confirmTitle = config.onSave
    ? labels.save
    : (config.labels?.confirm ?? config.labels?.save ?? labels.confirm);
  return createActionButtonsRenderer<TData>({
    actions: [
      { icon: "check", title: confirmTitle, variant: "primary", onClick: confirm },
      { icon: "close", title: labels.cancel, onClick: () => params.api.editing.stop({ cancel: true }).then(() => undefined) }
    ],
    overflow: "inline"
  })(params);
}

function buildRowActions<TData>(
  config: RowActionsConfig<TData>,
  params: CellRendererParams<TData>,
  labels: RowActionLabels
): ActionItem<TData>[] {
  const actions: ActionItem<TData>[] = [];
  if (config.onView) actions.push({
    id: "view", icon: "view", title: labels.view, variant: "primary",
    ...(config.permissions?.view ? { permission: config.permissions.view } : {}),
    onClick: config.onView
  });
  if (config.edit !== false) actions.push({
    id: "edit", icon: "edit", title: labels.edit, variant: "warning",
    ...(config.permissions?.edit ? { permission: config.permissions.edit } : {}),
    onClick: () => { params.api.editing.startRow(params.rowIndex); }
  });
  if (config.onDelete) actions.push({
    id: "delete", icon: "delete", title: labels.delete, variant: "danger",
    ...(config.permissions?.delete ? { permission: config.permissions.delete } : {}),
    ...(config.confirmDelete ? { confirm: config.confirmDelete === true ? labels.delete : config.confirmDelete } : {}),
    onClick: config.onDelete
  });
  actions.push(...(config.extraActions ?? []));
  return actions;
}

export function createRowActionsRenderer<TData = any>(config: RowActionsConfig<TData> = {}): CellRendererFn {
  return (params: CellRendererParams<TData>) => {
    const labels = resolveRowActionLabels(config, params);
    if (params.api.editing.isRowActive(params.rowIndex)) return renderRowEditingActions(config, params, labels);
    const actions = buildRowActions(config, params, labels);
    return createActionButtonsRenderer<TData>({
      actions,
      max: config.max,
      overflow: config.overflow ?? "drawer",
      moreLabel: config.moreLabel,
      drawerTitle: config.drawerTitle
    })(params);
  };
}

export const presetStatusTagRenderer = createStatusTagRenderer();
export const presetProgressBarRenderer = createProgressBarRenderer();
export const BUILTIN_CELL_RENDERERS: Readonly<Record<string, CellRendererFn>> = Object.freeze({
  statusTag: presetStatusTagRenderer,
  progressBar: presetProgressBarRenderer,
  link: linkRenderer
});
