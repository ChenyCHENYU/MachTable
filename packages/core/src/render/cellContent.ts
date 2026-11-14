import type { GridCore } from "../core/gridCore";
import type { RowNode } from "../types/row";
import type { Column } from "../services/column";
import type { CellClassParams, CellRendererParams } from "../types/params";
import type { CellRendererFn } from "../types/colDef";
import { getCellRuntimeState, peekCellRuntimeState } from "./runtimeState";
import { el } from "../lib/dom";

type ErrorContext = Pick<GridCore<any>, "reportError">;
type CellValueContext = Pick<GridCore<any>, "api" | "readCellValue" | "reportError">;
type CellRenderContext = CellValueContext & Pick<GridCore<any>, "gridOptions" | "resolveCellRenderer">;

/** Shared identity/value payload for style, class, editability and span callbacks. */
export function createCellValueParams(core: Pick<CellValueContext, "api">, node: RowNode<any>, column: Column, value: any, rowIndex = node.rowIndex): CellClassParams {
  return { api: core.api, colDef: column.colDef, column, node, data: node.data, value, rowIndex };
}

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
  let tooltip = core.gridOptions.tooltipComponent ? "" : formatted;
  const tooltipGetter = column.colDef.tooltipValueGetter;
  if (tooltipGetter) {
    try {
      tooltip = tooltipGetter({
        api: core.api, colDef: column.colDef, column, node, data: node.data, value
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
  return formatCellValueWith(core, node, column, core.readCellValue(node, column));
}

export function formatCellValueWith(core: CellValueContext, node: RowNode<any>, column: Column, value: any): string {
  const formatter = column.colDef.valueFormatter;
  if (formatter) {
    try {
      const out = formatter({
        api: core.api,
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
    const value = core.readCellValue(node, column);
    try {
      styles = rule(createCellValueParams(core, node, column, value));
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

/** Keep a shrinkable text item across refreshes; rich renderers retain ownership of their DOM. */
function renderTextContent(cell: HTMLElement, value: string): void {
  const previous = cell.firstElementChild;
  const label = previous?.className === "mach-cell-text" ? previous : el("span", "mach-cell-text");
  if (label.textContent !== value) label.textContent = value;
  cell.replaceChildren(label);
}

export function renderCellContent(core: CellRenderContext, cell: HTMLElement, node: RowNode<any>, column: Column): void {
  const value = core.readCellValue(node, column);
  const formatted = formatCellValueWith(core, node, column, value);
  const rendererDef = column.colDef.cellRenderer;
  const renderer =
    typeof rendererDef === "string" ? core.resolveCellRenderer(rendererDef) : rendererDef;
  let out: ReturnType<CellRendererFn> = formatted;

  if (renderer) {
    const params: CellRendererParams = {
      api: core.api,
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
    try {
      out = renderer(params);
    } catch (error) {
      core.reportError(error, "cellRenderer", { colId: column.id, rowId: node.id });
    }
  } else {
    cleanupCellContent(core, cell);
  }
  if (typeof out === "string") {
    renderTextContent(cell, out);
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
  updateCellTooltip(core, cell, node, column, value, formatted);
}

export function cellAlignmentClass(column: Column): string {
  const { align } = column.colDef;
  if (align === "left") return "mach-cell--left";
  return align === "right" ? "mach-cell--right" : "mach-cell--center";
}

function appendConfiguredClasses(
  core: CellValueContext,
  classes: string[],
  node: RowNode<any>,
  column: Column
): void {
  const rule = column.colDef.cellClass;
  if (!rule) return;
  if (typeof rule === "string") {
    classes.push(rule);
    return;
  }
  if (Array.isArray(rule)) {
    classes.push(...rule);
    return;
  }
  const params = createCellValueParams(core, node, column, core.readCellValue(node, column));
  try {
    const result = rule(params);
    if (typeof result === "string") classes.push(result);
    else if (Array.isArray(result)) classes.push(...result);
  } catch (error) {
    core.reportError(error, "cellClass", { colId: column.id, rowId: node.id });
  }
}

function appendRuntimeClasses(classes: string[], cell: HTMLElement, column: Column): void {
  if (cell.classList.contains("mach-cell--focus")) classes.push("mach-cell--focus");
  if (cell.classList.contains("mach-cell--editing")) classes.push("mach-cell--editing");
  if (column.colDef.wrapText) classes.push("mach-cell--wrap");
}

export function applyCellClasses(core: CellValueContext, cell: HTMLElement, node: RowNode<any>, column: Column): void {
  const classes = ["mach-cell", cellAlignmentClass(column)];
  appendConfiguredClasses(core, classes, node, column);
  appendRuntimeClasses(classes, cell, column);
  const className = classes.join(" ");
  if (cell.className !== className) cell.className = className;
}

export function renderDataCell(core: CellRenderContext, cell: HTMLElement, node: RowNode<any>, column: Column): void {
  renderCellContent(core, cell, node, column);
  applyCellClasses(core, cell, node, column);
  applyCellStyle(core, cell, node, column);
}
