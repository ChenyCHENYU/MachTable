import { createElement, isValidElement, type ComponentType, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { CellRendererParams, CellRendererFn, DetailRowRendererParams, GridApi, RowNode } from "@agile-team/mach-table";

export interface ReactCellRendererProps<TData = any, TValue = any> extends CellRendererParams<TData, TValue> {
  children?: ReactNode;
}

export interface ReactDetailProps<TData = any> {
  data: TData | null;
  node: RowNode<TData>;
  api: GridApi<TData>;
}

export function reactCellRenderer<TData = any, TValue = any>(
  Component: ComponentType<ReactCellRendererProps<TData, TValue>>
): CellRendererFn {
  return (params) => {
    const host = document.createElement("div");
    host.className = "mach-cell-react";
    host.style.width = "100%";
    const root = createRoot(host);
    root.render(createElement(Component, params as ReactCellRendererProps<TData, TValue>));
    let destroyed = false;
    return {
      el: host,
      refresh: (next) => {
        root.render(createElement(Component, next as ReactCellRendererProps<TData, TValue>));
        return true;
      },
      destroy: () => {
        if (destroyed) return;
        destroyed = true;
        window.setTimeout(() => {
          root.unmount();
        }, 0);
      }
    };
  };
}

export function reactDetailRenderer<TData = any>(
  Component: ComponentType<ReactDetailProps<TData>>
): (params: DetailRowRendererParams<TData>) => { el: HTMLElement; destroy?: () => void } {
  return (params) => {
    const host = document.createElement("div");
    host.style.height = "100%";
    const root = createRoot(host);
    root.render(createElement(Component, params));
    let destroyed = false;
    return {
      el: host,
      destroy: () => {
        if (destroyed) return;
        destroyed = true;
        window.setTimeout(() => {
          root.unmount();
        }, 0);
      }
    };
  };
}

export function isReactElement(value: unknown): boolean {
  return isValidElement(value);
}
