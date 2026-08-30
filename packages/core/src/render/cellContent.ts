import type { GridCore } from "../core/gridCore";
import type { RowNode } from "../types/row";
import type { Column } from "../services/column";
import { hasColumnType } from "../core/resolveOptions";
import type { CellClassParams, CellRendererParams } from "../types/params";
import { getCellRuntimeState, peekCellRuntimeState } from "./runtimeState";

type ErrorContext = Pick<GridCore<any>, "reportError">;
type CellValueContext = Pick<GridCore<any>, "getApi" | "getCellValue" | "reportError">;
type CellRenderContext = CellValueContext & Pick<GridCore<any>, "options" | "resolveCellRenderer">;

export function defaultFormat(value: any): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toLocaleDateString();
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function cleanupCellContent(core: ErrorContext, cell: HTMLElement): void {
  const state = peekCellRuntimeState(cell);
  if (!state) return;
  if (state.flashTimer) clearTimeout(state.flashTimer);
  state.flashTimer = undefined;
  const destroy = state.destroy;
  state.destroy = undefined;
  state.refresh = undefined;
  state.rendererDefinition = undefined;
  state.rendererRowId = undefined;
  state.rendererColumnId = undefined;
  if (!destroy) return;
  try {
    destroy();
  } catch (error) {
    core.reportError(error, "cellRenderer.destroy", { colId: cell.dataset.colId });
  }
}

function updateCellTooltip(
  core: CellRenderContext,
  cell: HTMLElement,
  node: RowNode<any>,
  column: Column,
  value: any,
  formatted: string
): void {
  let tooltip = core.options.tooltipComponent ? "" : formatted;
  const tooltipGetter = column.colDef.tooltipValueGetter;
  if (tooltipGetter) {
    try {
      tooltip = tooltipGetter({
        api: core.getApi(), colDef: column.colDef, column, node, data: node.data, value
      }) ?? formatted;
    } catch (error) {
      core.reportError(error, "tooltipValueGetter", { colId: column.id, rowId: node.id });
    }
  }
  if (tooltip) cell.setAttribute("title", tooltip);
  else cell.removeAttribute("title");
}

function tryRefreshRenderer(
  core: CellRenderContext,
  cell: HTMLElement,
  node: RowNode<any>,
  column: Column,
  renderer: unknown,
  params: CellRendererParams
): boolean {
  const state = peekCellRuntimeState(cell);
  if (
    !state?.refresh ||
    state.rendererDefinition !== renderer ||
    state.rendererRowId !== node.id ||
    state.rendererColumnId !== column.id
  ) return false;
  try {
    cell.querySelector(":scope > .mach-cell-edit-trigger")?.remove();
    return state.refresh(params) !== false;
  } catch (error) {
    core.reportError(error, "cellRenderer.refresh", { colId: column.id, rowId: node.id });
    return false;
  }
}

export function formatCellValue(core: CellValueContext, node: RowNode<any>, column: Column): string {
  const value = core.getCellValue(node, column);
  const formatter = column.colDef.valueFormatter;
  if (formatter) {
    try {
      const out = formatter({
        api: core.getApi(),
        colDef: column.colDef,
        column,
        node,
        data: node.data,
        value
      });
      return out == null ? "" : String(out);
    } catch (error) {
      core.reportError(error, "valueFormatter", { colId: column.id, rowId: node.id });
    }
  }
  return defaultFormat(value);
}

export function formatCellValueWith(core: CellValueContext, node: RowNode<any>, column: Column, value: any): string {
  const formatter = column.colDef.valueFormatter;
  if (formatter) {
    try {
      const out = formatter({
        api: core.getApi(),
        colDef: column.colDef,
        column,
        node,
        data: node.data,
        value
      });
      return out == null ? "" : String(out);
    } catch (error) {
      core.reportError(error, "valueFormatter", { colId: column.id, rowId: node.id });
    }
  }
  return defaultFormat(value);
}

export function applyCellStyle(core: CellValueContext, cell: HTMLElement, node: RowNode<any>, column: Column): void {
  const rule = column.colDef.cellStyle;
  const state = getCellRuntimeState(cell);
  const prevKeys = state.styleKeys;
  if (prevKeys) {
    for (const key of prevKeys) {
      Reflect.set(cell.style, key, "");
    }
  }
  if (!rule) {
    state.styleKeys = undefined;
    return;
  }
  let styles: Partial<CSSStyleDeclaration> | null | undefined;
  if (typeof rule === "function") {
    const value = core.getCellValue(node, column);
    try {
      styles = rule({
        api: core.getApi(),
        colDef: column.colDef,
        column,
        node,
        data: node.data,
        value,
        rowIndex: node.rowIndex
      });
    } catch (error) {
      core.reportError(error, "cellStyle", { colId: column.id, rowId: node.id });
      styles = null;
    }
  } else {
    styles = rule;
  }
  if (!styles) {
    state.styleKeys = undefined;
    return;
  }
  const keys = Object.keys(styles);
  for (const key of keys) {
    Reflect.set(cell.style, key, Reflect.get(styles, key));
  }
  state.styleKeys = keys;
}

export function renderCellContent(core: CellRenderContext, cell: HTMLElement, node: RowNode<any>, column: Column): void {
  const value = core.getCellValue(node, column);
  const formatted = formatCellValue(core, node, column);
  const rendererDef = column.colDef.cellRenderer;
  const renderer =
    typeof rendererDef === "string" ? core.resolveCellRenderer(rendererDef) : rendererDef;

  if (renderer) {
    const params: CellRendererParams = {
      api: core.getApi(),
      colDef: column.colDef,
      column,
      node,
      data: node.data,
      value,
      formatted,
      rowIndex: node.rowIndex,
      rendererParams: column.colDef.cellRendererParams
    };
    if (tryRefreshRenderer(core, cell, node, column, renderer, params)) {
      updateCellTooltip(core, cell, node, column, value, formatted);
      return;
    }
    cleanupCellContent(core, cell);
    let out: ReturnType<typeof renderer>;
    try {
      out = renderer(params);
    } catch (error) {
      core.reportError(error, "cellRenderer", { colId: column.id, rowId: node.id });
      cell.textContent = formatted;
      return;
    }
    if (typeof out === "string") {
      cell.textContent = out;
    } else if (out instanceof HTMLElement) {
      cell.replaceChildren(out);
    } else if (out && typeof out === "object" && out.el instanceof HTMLElement) {
      const result = out;
      cell.replaceChildren(result.el);
      const state = getCellRuntimeState(cell);
      state.destroy = result.destroy;
      if (result.refresh) {
        state.refresh = (next) => result.refresh!(next);
        state.rendererDefinition = renderer;
        state.rendererRowId = node.id;
        state.rendererColumnId = column.id;
      }
    } else {
      cell.textContent = "";
    }
  } else {
    cleanupCellContent(core, cell);
    cell.textContent = formatted;
  }
  updateCellTooltip(core, cell, node, column, value, formatted);
}

export function applyCellClasses(core: CellValueContext, cell: HTMLElement, node: RowNode<any>, column: Column): void {
  const value = core.getCellValue(node, column);
  const classes = ["mach-cell"];
  const align = column.colDef.align;
  if (align === "center") {
    classes.push("mach-cell--center");
  } else if (align === "right") {
    classes.push("mach-cell--right");
  } else if (hasColumnType(column.colDef, "rightAligned") || hasColumnType(column.colDef, "numericColumn") || (typeof value === "number" && value != null)) {
    classes.push("mach-cell--num");
  }

  const rule = column.colDef.cellClass;
  if (rule) {
    if (typeof rule === "function") {
      const params: CellClassParams = {
        api: core.getApi(),
        colDef: column.colDef,
        column,
        node,
        data: node.data,
        value,
        rowIndex: node.rowIndex
      };
      try {
        const result = rule(params);
        if (typeof result === "string") classes.push(result);
        else if (Array.isArray(result)) classes.push(...result);
      } catch (error) {
        core.reportError(error, "cellClass", { colId: column.id, rowId: node.id });
      }
    } else if (typeof rule === "string") {
      classes.push(rule);
    } else if (Array.isArray(rule)) {
      classes.push(...rule);
    }
  }

  const hadFocus = cell.classList.contains("mach-cell--focus");
  const hadEditing = cell.classList.contains("mach-cell--editing");
  if (hadFocus) classes.push("mach-cell--focus");
  if (hadEditing) classes.push("mach-cell--editing");
  if (column.colDef.wrapText) classes.push("mach-cell--wrap");

  const className = classes.join(" ");
  if (cell.className !== className) cell.className = className;
}
