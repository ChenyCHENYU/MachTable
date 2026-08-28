import type { ColDef } from "../types/colDef";
import type { ActionButtonsConfig } from "./presetRenderers";
import { createActionButtonsRenderer } from "./presetRenderers";

const NO_INTERACT = { sortable: false, resizable: false, movable: false, filter: false } as const;

export function selectionColumn<TData = any>(overrides: Partial<ColDef<TData>> = {}): ColDef<TData> {
  return {
    colId: "sel",
    headerName: "",
    width: 46,
    pinned: "left",
    checkboxSelection: true,
    ...NO_INTERACT,
    ...overrides
  };
}

export function indexColumn<TData = any>(overrides: Partial<ColDef<TData>> = {}): ColDef<TData> {
  return {
    colId: "idx",
    headerName: "#",
    type: "index",
    width: 60,
    pinned: "left",
    ...NO_INTERACT,
    ...overrides
  };
}

export function dragColumn<TData = any>(overrides: Partial<ColDef<TData>> = {}): ColDef<TData> {
  return {
    colId: "drag",
    headerName: "",
    rowDrag: true,
    width: 40,
    ...NO_INTERACT,
    ...overrides
  };
}

export function actionsColumn<TData = any>(
  config: ActionButtonsConfig & { width?: number; pinned?: "left" | "right" } = { actions: [] }
): ColDef<TData> {
  const { width, pinned, ...rendererConfig } = config;
  const btnCount = Math.min(rendererConfig.actions?.length ?? 0, rendererConfig.max ?? 3);
  const defaultWidth = Math.max(1, btnCount) * 26 + ((rendererConfig.actions?.length ?? 0) > btnCount ? 26 : 0) + 10;
  return {
    colId: "op",
    headerName: "操作",
    width: width ?? Math.max(64, defaultWidth),
    pinned: pinned ?? "right",
    cellRenderer: createActionButtonsRenderer(rendererConfig as ActionButtonsConfig),
    ...NO_INTERACT,
    cellRendererParams: undefined
  };
}
