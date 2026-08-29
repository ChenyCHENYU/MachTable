import type { ColDef } from "../types/colDef";
import type { ActionButtonsConfig, RowActionsConfig } from "./presetRenderers";
import { createActionButtonsRenderer, createRowActionsRenderer } from "./presetRenderers";

const NO_INTERACT = {
  sortable: false,
  resizable: false,
  movable: false,
  filter: false,
  suppressSizeToFit: true
} as const;

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
  config: ActionButtonsConfig<TData> & { width?: number; pinned?: "left" | "right" } = { actions: [] }
): ColDef<TData> {
  const { width, pinned, ...rendererConfig } = config;
  const count = rendererConfig.actions?.length ?? 0;
  const shown = rendererConfig.overflow === "inline" ? count : Math.min(count, rendererConfig.max ?? 3);
  const hasMore = rendererConfig.overflow !== "inline" && count > shown;
  const defaultWidth = Math.max(1, shown) * 26 + (hasMore ? 26 : 0) + 10;
  return {
    colId: "op",
    headerName: "操作",
    width: width ?? Math.max(64, defaultWidth),
    pinned: pinned ?? "right",
    cellRenderer: createActionButtonsRenderer(rendererConfig),
    ...NO_INTERACT,
    cellRendererParams: undefined
  };
}

export function rowActionsColumn<TData = any>(
  config: RowActionsConfig<TData> & { width?: number; pinned?: "left" | "right" } = {}
): ColDef<TData> {
  const { width, pinned, ...rendererConfig } = config;
  const count =
    (rendererConfig.onView ? 1 : 0) +
    (rendererConfig.edit === false ? 0 : 1) +
    (rendererConfig.onDelete ? 1 : 0) +
    (rendererConfig.extraActions?.length ?? 0);
  const shown = rendererConfig.overflow === "inline" ? count : Math.min(count, rendererConfig.max ?? 3);
  const hasMore = rendererConfig.overflow !== "inline" && count > shown;
  const defaultWidth = Math.max(2, shown) * 26 + (hasMore ? 26 : 0) + 10;
  return {
    colId: "op",
    headerName: "操作",
    width: width ?? Math.max(72, defaultWidth),
    pinned: pinned ?? "right",
    cellRenderer: createRowActionsRenderer(rendererConfig),
    ...NO_INTERACT,
    cellRendererParams: undefined
  };
}
