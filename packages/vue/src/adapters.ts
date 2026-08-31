import {
  h,
  render,
  renderSlot,
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

/** Uses an explicit app context, or captures the current Vue component context. */
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
  const Root = { setup: () => () => h(component, { ...props }) };
  const vnode = h(Root);
  if (appContext) vnode.appContext = appContext;
  render(vnode, host);
  return () => render(null, host);
}

function mountSlot(
  slot: Slot,
  props: () => Record<string, any>,
  host: HTMLElement,
  appContext?: AppContext,
  defer = true
): () => void {
  const Root = {
    name: "MachTableSlot",
    setup: () => () => renderSlot({ default: slot }, "default", props())
  };
  const vnode = h(Root);
  if (appContext) vnode.appContext = appContext;
  let disposed = false;
  const mount = () => {
    if (disposed) return;
    render(vnode, host);
  };
  if (defer) queueMicrotask(mount);
  else mount();
  return () => {
    disposed = true;
    render(null, host);
  };
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
    const reactiveParams = shallowReactive({ ...params }) as CellRendererParams<TData, TValue>;
    const unmount = mountComponent(component, reactiveParams as Record<string, any>, host, appContext);
    let destroyed = false;
    return {
      el: host,
      refresh: (next) => {
        Object.assign(reactiveParams, next);
        return true;
      },
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
    const reactiveParams = shallowReactive({ ...params }) as CellRendererParams<TData, TValue>;
    const unmount = mountSlot(slot, () => reactiveParams, host, appContext);
    return {
      el: host,
      refresh: (next) => {
        Object.assign(reactiveParams, next);
        return true;
      },
      destroy: unmount
    };
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
      commit: () => { void params.api.editing.stop(); },
      cancel: () => { void params.api.editing.stop({ cancel: true }); }
    });
    const unmount = mountSlot(slot, slotProps as () => Record<string, any>, host, appContext, false);
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
