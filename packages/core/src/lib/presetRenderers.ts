import type { CellRendererParams } from "../types/params";
import type { CellRendererFn } from "../types/colDef";

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
  const a = document.createElement("span");
  a.className = "mach-link";
  a.textContent = params.formatted || String(params.value);
  return a;
}

const ICON_PATHS: Record<string, string> = {
  edit: '<path d="M11.5 2.5l2 2L5 13H3v-2l8.5-8.5z"/>',
  delete: '<path d="M3 5h10M6 5V3h4v2M5 5l.7 8h4.6L11 5"/>',
  view: '<path d="M1.5 8s2.4-4.2 6.5-4.2S14.5 8 14.5 8s-2.4 4.2-6.5 4.2S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.8"/>',
  copy: '<rect x="5" y="5" width="8" height="8" rx="1"/><path d="M3 11V3h8"/>',
  download: '<path d="M8 2v8m0 0l-3-3m3 3l3-3M2.5 13.5h11"/>',
  refresh: '<path d="M13 3v4h-4M3 13V9h4"/><path d="M13 7a5.5 5.5 0 00-9.7-2.6M3 9a5.5 5.5 0 009.7 2.6"/>',
  close: '<path d="M3.5 3.5l9 9m0-9l-9 9"/>',
  check: '<path d="M2.5 8.5l3.5 3.5 7.5-8"/>',
  plus: '<path d="M8 2.5v11M2.5 8h11"/>',
  search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>'
};

function iconSvg(name: string, size = 14): string {
  const path = ICON_PATHS[name] ?? "";
  return `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

export interface ActionItem<TData = any> {
  icon?: string;
  label?: string;
  title?: string;
  danger?: boolean;
  show?: (params: CellRendererParams<TData>) => boolean;
  onClick: (params: CellRendererParams<TData>) => void;
}

export interface ActionButtonsConfig {
  actions: ActionItem[];
  max?: number;
}

let openActionMenu: HTMLElement | null = null;
let openActionAnchor: HTMLElement | null = null;

function closeActionMenu(): void {
  openActionMenu?.remove();
  openActionMenu = null;
  openActionAnchor = null;
  document.removeEventListener("mousedown", onActionMenuOutside, true);
}

function onActionMenuOutside(e: MouseEvent): void {
  if (openActionMenu && !openActionMenu.contains(e.target as Node)) closeActionMenu();
}

function showActionMenu(anchor: HTMLElement, items: Array<{ label: string; danger?: boolean; pick: () => void }>): void {
  closeActionMenu();
  const menu = document.createElement("div");
  menu.className = "mach-context-menu";
  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mach-context-menu-item";
    if (item.danger) btn.classList.add("mach-context-menu-item--danger");
    btn.textContent = item.label;
    btn.addEventListener("click", () => {
      closeActionMenu();
      item.pick();
    });
    menu.appendChild(btn);
  }
  document.body.appendChild(menu);
  const rect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(Math.max(8, rect.left), window.innerWidth - menuRect.width - 8)}px`;
  menu.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - menuRect.height - 8)}px`;
  openActionMenu = menu;
  openActionAnchor = anchor;
  document.addEventListener("mousedown", onActionMenuOutside, true);
}

export function createActionButtonsRenderer(config: ActionButtonsConfig): CellRendererFn {
  const max = config.max ?? 3;
  return (params: CellRendererParams) => {
    const visible = config.actions.filter((action) => {
      if (!action.show) return true;
      try {
        return action.show(params);
      } catch {
        return false;
      }
    });
    if (visible.length === 0) return "";

    const wrap = document.createElement("div");
    wrap.className = "mach-actions";

    const shown = visible.slice(0, max);
    const overflow = visible.slice(max);

    for (const action of shown) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mach-action-btn";
      if (action.danger) btn.classList.add("mach-action-btn--danger");
      const title = action.title ?? action.label ?? "";
      if (title) btn.title = title;
      if (action.icon && ICON_PATHS[action.icon]) {
        btn.innerHTML = iconSvg(action.icon);
        btn.classList.add("mach-action-btn--icon");
      } else {
        btn.textContent = action.label ?? title;
      }
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        action.onClick(params);
      });
      wrap.appendChild(btn);
    }

    if (overflow.length > 0) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "mach-action-btn mach-action-btn--icon";
      more.title = "more";
      more.textContent = "⋯";
      more.addEventListener("click", (e) => {
        e.stopPropagation();
        showActionMenu(
          more,
          overflow.map((action) => ({
            label: action.label ?? action.title ?? "",
            danger: action.danger,
            pick: () => action.onClick(params)
          }))
        );
      });
      wrap.appendChild(more);
    }

    return {
      el: wrap,
      destroy: () => {
        if (openActionAnchor && wrap.contains(openActionAnchor)) closeActionMenu();
      }
    };
  };
}

export const presetStatusTagRenderer = createStatusTagRenderer();
export const presetProgressBarRenderer = createProgressBarRenderer();

export function registerBuiltinRenderers(register: (name: string, fn: CellRendererFn) => void): void {
  register("statusTag", presetStatusTagRenderer);
  register("progressBar", presetProgressBarRenderer);
  register("link", linkRenderer);
}
