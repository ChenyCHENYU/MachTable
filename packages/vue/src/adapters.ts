import { createApp, h, render, getCurrentInstance, type AppContext, type Component } from "vue";
import type { CellRendererParams, CellRendererFn, DetailRowRendererParams } from "@agile-team/mach-table";

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
