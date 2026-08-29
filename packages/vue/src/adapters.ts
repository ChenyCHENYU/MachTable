import {
  createApp,
  h,
  render,
  getCurrentInstance,
  shallowReactive,
  type AppContext,
  type Component,
  type Slot
} from "vue";
import type {
  CellEditorFactory,
  CellEditorParams,
  CellRendererParams,
  CellRendererFn,
  DetailRowRendererParams,
  HeaderComponentParams,
  ICellRendererResult,
  OverlayTemplate
} from "@agile-team/mach-table";

export type VueCellRendererProps<TData = any, TValue = any> = CellRendererParams<TData, TValue>;

/**
 * 解析适配器可用的 appContext：
 * 1. 显式传入优先；
 * 2. 否则在 <script setup> 内同步调用工厂时自动捕获宿主组件上下文
 *    （使单元格/明细内的 naive、EP 组件继承 ConfigProvider 的主题与国际化）。
 */
function resolveAppContext(explicit?: AppContext): AppContext | undefined {
  if (explicit) return explicit;
  try {
    return getCurrentInstance()?.appContext;
  } catch {
    return undefined;
  }
}

function mountComponent(
  component: Component,
  props: Record<string, any>,
  host: HTMLElement,
  appContext?: AppContext
): () => void {
  if (appContext) {
    const vnode = h(component, props);
    vnode.appContext = appContext;
    render(vnode, host);
    return () => render(null, host);
  }
  const app = createApp({ render: () => h(component, props) });
  app.mount(host);
  return () => app.unmount();
}

function mountSlot(
  slot: Slot,
  props: () => Record<string, any>,
  host: HTMLElement,
  appContext?: AppContext
): () => void {
  const Root = { name: "MachTableSlot", setup: () => () => slot(props()) };
  const vnode = h(Root);
  if (appContext) vnode.appContext = appContext;
  render(vnode, host);
  return () => render(null, host);
}

export function vueCellRenderer<TData = any, TValue = any>(
  component: Component,
  options?: { appContext?: AppContext }
): CellRendererFn {
  const appContext = resolveAppContext(options?.appContext);
  return (params: CellRendererParams<TData, TValue>) => {
    const host = document.createElement("div");
    host.className = "mach-cell-vue";
    host.style.width = "100%";
    const unmount = mountComponent(component, params as Record<string, any>, host, appContext);
    let destroyed = false;
    return {
      el: host,
      destroy: () => {
        if (destroyed) return;
        destroyed = true;
        window.setTimeout(unmount, 0);
      }
    };
  };
}

export function vueDetailRenderer<TData = any>(
  component: Component,
  options?: { appContext?: AppContext }
): (params: DetailRowRendererParams<TData>) => { el: HTMLElement; destroy?: () => void } {
  const appContext = resolveAppContext(options?.appContext);
  return (params) => {
    const host = document.createElement("div");
    host.style.height = "100%";
    const unmount = mountComponent(component, params as Record<string, any>, host, appContext);
    let destroyed = false;
    return {
      el: host,
      destroy: () => {
        if (destroyed) return;
        destroyed = true;
        unmount();
      }
    };
  };
}

/** Internal/public bridge used by automatic `#cell-*` Vue slots. */
export function vueCellSlotRenderer<TData = any, TValue = any>(
  slot: Slot,
  options?: { appContext?: AppContext }
): CellRendererFn {
  const appContext = resolveAppContext(options?.appContext);
  return (params: CellRendererParams<TData, TValue>) => {
    const host = document.createElement("div");
    host.className = "mach-cell-vue mach-cell-vue--slot";
    host.style.width = "100%";
    const unmount = mountSlot(slot, () => params, host, appContext);
    return { el: host, destroy: unmount };
  };
}

export function vueHeaderSlotRenderer<TData = any>(
  slot: Slot,
  options?: { appContext?: AppContext }
): (params: HeaderComponentParams<TData>) => ICellRendererResult {
  const appContext = resolveAppContext(options?.appContext);
  return (params) => {
    const host = document.createElement("div");
    host.className = "mach-header-vue-slot";
    const unmount = mountSlot(slot, () => params, host, appContext);
    return { el: host, destroy: unmount };
  };
}

export interface VueCellEditorSlotProps<TData = any, TValue = any>
  extends CellEditorParams<TData, TValue> {
  value: TValue;
  setValue(value: TValue): void;
  commit(): void;
  cancel(): void;
}

export function vueCellEditorSlot<TData = any, TValue = any>(
  slot: Slot,
  options?: { appContext?: AppContext }
): CellEditorFactory {
  const appContext = resolveAppContext(options?.appContext);
  return (params: CellEditorParams<TData, TValue>) => {
    const state = shallowReactive<{ value: TValue }>({ value: params.value });
    const host = document.createElement("div");
    host.className = "mach-cell-vue mach-cell-vue--editor";
    const slotProps = (): VueCellEditorSlotProps<TData, TValue> => ({
      ...params,
      value: state.value,
      setValue: (value) => { state.value = value; },
      commit: () => params.api.stopEditing(false),
      cancel: () => params.api.stopEditing(true)
    });
    const unmount = mountSlot(slot, slotProps as () => Record<string, any>, host, appContext);
    return {
      el: host,
      getValue: () => state.value,
      focus: () => {
        const focusable = host.querySelector<HTMLElement>(
          "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex='-1'])"
        );
        focusable?.focus();
      },
      destroy: unmount
    };
  };
}

export function vueDetailSlotRenderer<TData = any>(
  slot: Slot,
  options?: { appContext?: AppContext }
): (params: DetailRowRendererParams<TData>) => ICellRendererResult {
  const appContext = resolveAppContext(options?.appContext);
  return (params) => {
    const host = document.createElement("div");
    host.className = "mach-detail-vue-slot";
    host.style.height = "100%";
    const unmount = mountSlot(slot, () => params, host, appContext);
    return { el: host, destroy: unmount };
  };
}

export function vueOverlaySlot(
  slot: Slot,
  options?: { appContext?: AppContext }
): OverlayTemplate {
  const appContext = resolveAppContext(options?.appContext);
  return () => {
    const host = document.createElement("div");
    host.className = "mach-overlay-vue-slot";
    const unmount = mountSlot(slot, () => ({}), host, appContext);
    return { el: host, destroy: unmount };
  };
}
