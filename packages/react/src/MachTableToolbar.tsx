import { createElement, type ChangeEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import type { GridApi, GridSize, MachTableCommands } from "@agile-team/mach-table";

export interface MachTableToolbarFeatures {
  search?: boolean;
  refresh?: boolean;
  columns?: boolean;
  density?: boolean;
  export?: boolean;
  undoRedo?: boolean;
  fullscreen?: boolean;
}

export interface MachTableToolbarProps<TData = any> {
  api?: GridApi<TData> | null;
  commands?: MachTableCommands | null;
  search?: string;
  onSearchChange?(value: string): void;
  onRefresh?(): void;
  onClearSelection?(): void;
  loading?: boolean;
  selectedCount?: number;
  searchPlaceholder?: string;
  exportFilename?: string;
  features?: MachTableToolbarFeatures;
  start?: ReactNode;
  children?: ReactNode;
  end?: ReactNode;
}

const DEFAULT_FEATURES: Required<MachTableToolbarFeatures> = {
  search: true, refresh: true, columns: true, density: true,
  export: true, undoRedo: false, fullscreen: false
};

function enabled(features: MachTableToolbarFeatures | undefined, key: keyof MachTableToolbarFeatures): boolean {
  return features?.[key] ?? DEFAULT_FEATURES[key];
}

function button(label: string, icon: string, onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void, disabled = false) {
  return createElement("button", {
    key: label, type: "button", className: "mach-toolbar__button", title: label, "aria-label": label, disabled, onClick
  }, icon);
}

function renderMain<TData>(props: MachTableToolbarProps<TData>): ReactNode[] {
  const main: ReactNode[] = [props.start];
  const placeholder = props.searchPlaceholder ?? "搜索当前结果";
  if (enabled(props.features, "search")) main.push(createElement("label", { className: "mach-toolbar__search", key: "search" },
    createElement("span", { className: "mach-sr-only" }, placeholder),
    createElement("span", { "aria-hidden": true }, "⌕"),
    createElement("input", {
      type: "search",
      value: props.search ?? "",
      placeholder,
      onChange: (event: ChangeEvent<HTMLInputElement>) => {
        const value = event.currentTarget.value;
        props.onSearchChange?.(value);
        if (!props.onSearchChange) {
          if (props.commands) props.commands.search(value || null);
          else props.api?.setQuickFilter(value || null);
        }
      }
    })
  ));
  if (enabled(props.features, "refresh")) main.push(button("刷新", props.loading ? "…" : "↻", () => {
    props.onRefresh?.();
    if (!props.onRefresh) {
      if (props.commands) void props.commands.refresh();
      else if (props.api?.isInfinite()) void props.api.reload();
      else props.api?.refreshCells();
    }
  }, props.loading));
  if (enabled(props.features, "columns")) main.push(button("列设置", "☷", (event) => {
    if (props.commands) props.commands.openColumns(event.currentTarget);
    else props.api?.openColumnWorkbench(event.currentTarget);
  }));
  if (enabled(props.features, "density")) main.push(createElement("select", {
    key: "density",
    className: "mach-toolbar__select",
    value: props.api?.getGridOption("size") ?? "normal",
    "aria-label": "表格密度",
    onChange: (event: ChangeEvent<HTMLSelectElement>) => {
      const size = event.currentTarget.value as GridSize;
      if (props.commands) props.commands.setDensity(size);
      else props.api?.setGridOption("size", size);
    }
  }, createElement("option", { value: "compact" }, "紧凑"), createElement("option", { value: "normal" }, "标准"), createElement("option", { value: "large" }, "宽松")));
  main.push(props.children);
  return main;
}

function runUndo<TData>(props: MachTableToolbarProps<TData>): void {
  if (props.commands) props.commands.undo();
  else props.api?.undo();
}

function runRedo<TData>(props: MachTableToolbarProps<TData>): void {
  if (props.commands) props.commands.redo();
  else props.api?.redo();
}

function renderAside<TData>(props: MachTableToolbarProps<TData>): ReactNode[] {
  const aside: ReactNode[] = [];
  if ((props.selectedCount ?? 0) > 0) aside.push(createElement("button", {
    type: "button", className: "mach-toolbar__selection", onClick: () => props.onClearSelection?.()
  }, `已选 ${props.selectedCount} 项 ×`));
  if (enabled(props.features, "undoRedo")) {
    aside.push(button("撤销", "↶", () => runUndo(props), props.commands ? !props.commands.canUndo() : !props.api?.canUndo()));
    aside.push(button("重做", "↷", () => runRedo(props), props.commands ? !props.commands.canRedo() : !props.api?.canRedo()));
  }
  if (enabled(props.features, "export")) aside.push(button("导出 CSV", "⇩", () => { props.commands?.exportCsv(props.exportFilename); }, !props.commands));
  if (enabled(props.features, "fullscreen")) aside.push(button("全屏", "⛶", () => { void props.commands?.toggleFullscreen(); }, !props.commands));
  aside.push(props.end);
  return aside;
}

export function MachTableToolbar<TData = any>(props: MachTableToolbarProps<TData>) {
  return createElement("div", { className: "mach-toolbar", role: "toolbar", "aria-label": "表格工具栏" },
    createElement("div", { className: "mach-toolbar__main" }, ...renderMain(props)),
    createElement("div", { className: "mach-toolbar__aside" }, ...renderAside(props))
  );
}
