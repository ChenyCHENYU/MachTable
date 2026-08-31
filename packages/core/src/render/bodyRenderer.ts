import type { GridCore } from "../core/gridCore";
import type { PaneType } from "../services/columnModel";
import type { Column } from "../services/column";
import { hasColumnType } from "../core/resolveOptions";
import type { RowNode } from "../types/row";
import type { RefreshCellsParams } from "../types/api";
import { RangeSelectionModel, type NormalizedRange } from "../services/rangeSelectionModel";
import { RowDragController } from "../services/rowDragController";
import { ColumnViewportIndex } from "../services/columnViewportIndex";
import { VariableSizeIndex } from "../services/variableSizeIndex";
import { el, clamp } from "../lib/dom";
import { renderCellContent, cleanupCellContent, applyCellClasses, applyCellStyle, formatCellValue, formatCellValueWith, defaultFormat } from "./cellContent";
import {
  getCellRuntimeState,
  setDetailDestroyer,
  takeDetailDestroyer
} from "./runtimeState";

const PANES: PaneType[] = ["left", "center", "right"];
type BodyContext = Pick<
  GridCore<any>,
  | "buildDefaultEmptyState"
  | "buildDefaultErrorState"
  | "columnModel"
  | "contextMenuService"
  | "editingService"
  | "emit"
  | "getApi"
  | "getCellValue"
  | "gridId"
  | "headerRenderer"
  | "isDestroyed"
  | "options"
  | "performanceMonitor"
  | "pinnedRowsRenderer"
  | "reportError"
  | "resolveCellRenderer"
  | "rowModel"
  | "selectionService"
  | "setCellValue"
  | "skeleton"
  | "summaryRenderer"
  | "toggleDetail"
  | "tooltipService"
  | "undoService"
>;

interface RowSlot {
  index: number;
  nodeId: string;
  kind: "master" | "detail";
  rows: Partial<Record<PaneType, HTMLElement>>;
  cells: Partial<Record<PaneType, HTMLElement[]>>;
  cellColIds: Partial<Record<PaneType, string[]>>;
  detailRow?: HTMLElement;
}

interface RowLayoutState {
  autoHeightColumns: Column[];
  positionedCount: number;
  rowCount: number;
  rowHeight: number;
  signature: string;
  variable: boolean;
}

interface FillPattern {
  difference: number;
  integer: boolean;
  numeric: boolean;
  values: any[];
}

interface MasterRowState {
  expanded: boolean;
  expandable: boolean;
  level: number | null;
}

function isFillableColumn(column: Column | undefined): column is Column {
  return !!column && !column.hasCheckbox && !column.isDetailToggle && !column.colDef.rowDrag;
}

function createFillPattern(values: any[]): FillPattern {
  const numeric = values.length > 1 && values.every(
    (value) => typeof value === "number" && !Number.isNaN(value)
  );
  const difference = numeric
    ? (values[values.length - 1] - values[0]) / (values.length - 1)
    : 0;
  const integer = !numeric || values.every((value) => Number.isInteger(value));
  return { difference, integer, numeric, values };
}

function fillPatternValue(pattern: FillPattern, offset: number): any {
  const count = pattern.values.length;
  if (count === 1) return pattern.values[0];
  if (!pattern.numeric) return pattern.values[offset % count];
  const raw = pattern.values[count - 1] + pattern.difference * (offset - count + 1);
  return pattern.integer ? Math.round(raw) : Math.round(raw * 1e6) / 1e6;
}

type CellRenderKind = "standard" | "group" | "detail" | "checkbox" | "drag" | "index" | "tree";

export interface FocusedCell {
  rowIndex: number;
  colId: string;
}

export class BodyRenderer {
  private pool: RowSlot[] = [];
  private poolSize = 0;
  private first = 0;
  private lastExcl = -1;
  private rafId = 0;
  private hoverIndex = -1;
  private rowSizes = new VariableSizeIndex<RowNode<any>>();
  private columnViewport = new ColumnViewportIndex();
  private rangeSelection = new RangeSelectionModel();
  private rangeDragging = false;
  private colFirst = 0;
  private colLastExcl = Number.MAX_SAFE_INTEGER;
  focusedCell: FocusedCell | null = null;
  private rowDragController: RowDragController;

  constructor(private core: BodyContext) {
    this.rowDragController = new RowDragController(
      core,
      (index) => this.rowTop(index),
      (offset) => this.rowAtOffset(offset, this.core.rowModel.getDisplayedRowCount())
    );
  }

  init(): void {
    const viewport = this.core.skeleton.bodyViewports.center;
    viewport.addEventListener("scroll", this.onScroll, { passive: true });
    const body = this.core.skeleton.bodyEl;
    body.addEventListener("click", this.onBodyClick);
    body.addEventListener("dblclick", this.onBodyDblClick);
    body.addEventListener("contextmenu", this.onContextMenu);
    body.addEventListener("mousedown", this.onMouseDown);
    body.addEventListener("mouseover", this.onMouseOver);
    body.addEventListener("mouseleave", this.onMouseLeave);
    body.addEventListener("pointerdown", this.onDragHandlePointerDown);
    window.addEventListener("mouseup", this.onWindowMouseUp);
  }

  destroy(): void {
    cancelAnimationFrame(this.rafId);
    const viewport = this.core.skeleton.bodyViewports.center;
    viewport.removeEventListener("scroll", this.onScroll);
    const body = this.core.skeleton.bodyEl;
    body.removeEventListener("click", this.onBodyClick);
    body.removeEventListener("dblclick", this.onBodyDblClick);
    body.removeEventListener("contextmenu", this.onContextMenu);
    body.removeEventListener("mousedown", this.onMouseDown);
    body.removeEventListener("mouseover", this.onMouseOver);
    body.removeEventListener("mouseleave", this.onMouseLeave);
    body.removeEventListener("pointerdown", this.onDragHandlePointerDown);
    window.removeEventListener("mouseup", this.onWindowMouseUp);
    this.cancelFillDrag();
    this.rowDragController.destroy();
    for (const slot of this.pool) {
      if (slot.detailRow) this.cleanupDetail(slot.detailRow);
      for (const pane of PANES) {
        for (const cell of slot.cells[pane] ?? []) {
          if (slot.index >= 0) this.core.editingService.releaseCell(slot.index, cell.dataset.colId ?? "", cell);
          cleanupCellContent(this.core, cell);
        }
      }
    }
    this.fillHandleEl?.remove();
    this.fillDragIndicator?.remove();
    this.pool = [];
    this.poolSize = 0;
    this.pendingFlash = [];
    this.dirtyHeightNodes.clear();
    this.rowSizes.reset([], () => this.core.options.rowHeight);
    this.columnViewport.update([]);
    this.measureCanvas = null;
  }

  paneForColumn(column: Column): PaneType {
    return column.pinned === "left" ? "left" : column.pinned === "right" ? "right" : "center";
  }

  private onScroll = (): void => {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      this.syncScroll();
    });
  };

  syncScroll(): void {
    if (this.core.isDestroyed()) return;
    const sk = this.core.skeleton;
    const viewport = sk.bodyViewports.center;
    sk.headerRowContainers.center.style.transform = `translateX(${-viewport.scrollLeft}px)`;
    this.core.headerRenderer.updateColumnWindow();
    sk.rowContainers.left.style.transform = `translateY(${-viewport.scrollTop}px)`;
    sk.rowContainers.right.style.transform = `translateY(${-viewport.scrollTop}px)`;
    this.core.pinnedRowsRenderer.onScrollLeft(viewport.scrollLeft);
    this.core.tooltipService.hide();
    this.updateRange();
    this.core.rowModel.checkInfiniteScroll(this.lastExcl - 1);
  }

  private paneWidths(): Record<PaneType, number> {
    const widths: Record<PaneType, number> = { left: 0, center: 0, right: 0 };
    for (const pane of PANES) {
      widths[pane] = this.core.columnModel.getPaneColumns(pane).reduce((a, c) => a + c.currentWidth, 0);
    }
    return widths;
  }

  private lastMinRowHeight = 0;
  private rowHeightCache = new WeakMap<RowNode<any>, number>();
  private dirtyHeightNodes = new Set<RowNode<any>>();
  private rowLayoutSignature = "";
  private pendingFlash: Array<[number, string]> = [];
  private measureCanvas: HTMLCanvasElement | null = null;

  applyContainerSizes(): void {
    const sk = this.core.skeleton;
    const widths = this.paneWidths();
    this.columnViewport.update(this.core.columnModel.getPaneColumns("center"));
    widths.center = this.columnViewport.totalWidth();
    const displayed = this.core.rowModel.getDisplayedRows();
    const layout = this.resolveRowLayout(displayed.length);
    this.syncRowSizeIndex(displayed, layout);
    const totalHeight = this.totalRowLayoutHeight(layout);
    this.applyRowContainerDimensions(widths, totalHeight);
    this.applyDomLayoutHeight(totalHeight);
    sk.root.setAttribute("aria-rowcount", String(layout.rowCount + sk.getHeaderRowCount()));
  }

  private resolveRowLayout(displayedCount: number): RowLayoutState {
    const rowCount = this.core.rowModel.getDisplayTotalCount();
    const rowHeight = this.core.options.rowHeight;
    const autoHeightColumns = this.core.options.masterDetail ? [] : this.collectAutoHeightColumns();
    // Sparse random-access blocks cannot materialize a variable-height prefix for every remote row.
    const variable = this.core.options.datasourceMode !== "block" && (
      this.core.options.masterDetail ||
      this.core.options.getRowHeight != null ||
      autoHeightColumns.length > 0
    );
    const signature = variable
      ? this.variableRowLayoutSignature(rowHeight, autoHeightColumns)
      : `fixed|${rowHeight}`;
    return {
      autoHeightColumns,
      positionedCount: Math.min(rowCount, displayedCount),
      rowCount,
      rowHeight,
      signature,
      variable
    };
  }

  private variableRowLayoutSignature(rowHeight: number, columns: Column[]): string {
    const columnWidths = columns.map((column) => `${column.id}:${column.currentWidth}`).join(",");
    return `${this.core.rowModel.getDisplayRevision()}|${rowHeight}|${this.core.options.detailRowHeight}|${columnWidths}`;
  }

  private syncRowSizeIndex(displayed: RowNode<any>[], layout: RowLayoutState): void {
    if (!layout.variable) {
      this.resetFixedRowSizes(layout);
      return;
    }
    if (layout.signature !== this.rowLayoutSignature || this.rowSizes.length !== layout.positionedCount) {
      const positioned = displayed.slice(0, layout.positionedCount);
      this.rowSizes.reset(positioned, (node) => this.resolveRowHeight(node, layout.autoHeightColumns));
      this.completeRowSizeSync(layout);
      return;
    }
    if (this.dirtyHeightNodes.size === 0) return;
    for (const node of this.dirtyHeightNodes) {
      const index = this.rowSizes.indexOf(node);
      if (index >= 0) this.rowSizes.update(index, this.resolveRowHeight(node, layout.autoHeightColumns));
    }
    this.completeRowSizeSync(layout);
  }

  private resetFixedRowSizes(layout: RowLayoutState): void {
    if (this.rowSizes.length > 0) this.rowSizes.reset([], () => layout.rowHeight);
    this.rowLayoutSignature = layout.signature;
    this.dirtyHeightNodes.clear();
    this.lastMinRowHeight = layout.rowHeight;
  }

  private completeRowSizeSync(layout: RowLayoutState): void {
    this.rowLayoutSignature = layout.signature;
    this.dirtyHeightNodes.clear();
    this.lastMinRowHeight = this.rowSizes.minimumSize() || layout.rowHeight;
  }

  private totalRowLayoutHeight(layout: RowLayoutState): number {
    const positionedHeight = layout.variable
      ? this.rowSizes.totalSize()
      : layout.positionedCount * layout.rowHeight;
    return positionedHeight + Math.max(0, layout.rowCount - layout.positionedCount) * layout.rowHeight;
  }

  private applyRowContainerDimensions(widths: Record<PaneType, number>, totalHeight: number): void {
    const sk = this.core.skeleton;
    const viewport = sk.bodyViewports.center;
    const centerAvailable = Math.max(0, viewport.clientWidth - widths.left - widths.right);
    const centerWidth = Math.max(widths.center, centerAvailable);
    for (const pane of PANES) {
      const container = sk.rowContainers[pane];
      container.style.height = `${totalHeight}px`;
      if (pane === "center") container.style.width = `${centerWidth}px`;
    }
  }

  invalidateRowHeight(node: RowNode<any>): void {
    this.rowHeightCache.delete(node);
    this.dirtyHeightNodes.add(node);
  }

  private applyDomLayoutHeight(totalHeight: number): void {
    this.core.skeleton.bodyEl.style.height = this.core.options.domLayout === "autoHeight" ? `${totalHeight}px` : "";
  }

  invalidateAllRowHeights(): void {
    this.rowHeightCache = new WeakMap();
    this.dirtyHeightNodes.clear();
    this.rowLayoutSignature = "";
  }

  private resolveRowHeight(node: RowNode<any>, autoHeightCols: Column[]): number {
    if (node.isDetail) return this.core.options.detailRowHeight;
    const cached = this.rowHeightCache.get(node);
    if (cached !== undefined) return cached;
    let height = this.core.options.rowHeight;
    const getRowHeight = this.core.options.getRowHeight;
    if (getRowHeight) {
      try {
        const requested = getRowHeight({ data: node.data, node, api: this.core.getApi() });
        height = Number.isFinite(requested) ? Math.max(1, requested || height) : height;
      } catch (error) {
        this.core.reportError(error, "getRowHeight", { rowId: node.id });
      }
    }
    if (autoHeightCols.length > 0) height = Math.max(height, this.measureAutoHeight(node, autoHeightCols));
    this.rowHeightCache.set(node, height);
    return height;
  }

  private rowTop(index: number): number {
    const positioned = this.rowSizes.length;
    if (positioned === 0) return Math.max(0, index) * this.core.options.rowHeight;
    if (index <= positioned) return this.rowSizes.offsetAt(index);
    return this.rowSizes.totalSize() + (index - positioned) * this.core.options.rowHeight;
  }

  private rowAtOffset(offset: number, rowCount: number): number {
    if (rowCount <= 0) return 0;
    const positioned = this.rowSizes.length;
    const positionedHeight = this.rowSizes.totalSize();
    if (positioned > 0 && offset < positionedHeight) return this.rowSizes.findIndex(offset);
    const index = positioned + Math.floor(Math.max(0, offset - positionedHeight) / this.core.options.rowHeight);
    return Math.max(0, Math.min(index, rowCount - 1));
  }

  private collectAutoHeightColumns(): Column[] {
    return this.core.columnModel.getOrderedVisible().filter((c) => c.colDef.autoHeight === true);
  }

  private get hasAnyAutoHeight(): boolean {
    return this.core.columnModel.getOrderedVisible().some((c) => c.colDef.autoHeight === true);
  }

  private measureAutoHeight(node: RowNode<any>, cols: Column[]): number {
    this.measureCanvas ??= document.createElement("canvas");
    const ctx = this.measureCanvas.getContext("2d");
    if (!ctx) return 0;
    const style = window.getComputedStyle(this.core.skeleton.root);
    const fontSize = parseFloat(style.fontSize) || 13;
    ctx.font = `${style.fontStyle} ${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
    const padding = parseFloat(style.getPropertyValue("--mach-cell-padding")) || 9;
    const lineHeight = Math.round(fontSize * 1.45);
    let maxLines = 1;

    for (const col of cols) {
      const text = formatCellValue(this.core, node, col);
      if (!text) continue;
      const availW = Math.max(10, col.currentWidth - padding * 2 - 2);
      let lines = 1;
      let w = 0;
      for (const ch of text) {
        const cw = ctx.measureText(ch).width;
        if (w > 0 && w + cw > availW) {
          lines++;
          w = cw;
        } else {
          w += cw;
        }
        if (lines >= 12) break;
      }
      if (lines > maxLines) maxLines = lines;
    }
    return maxLines * lineHeight + Math.round(padding * 0.9);
  }

  queueFlash(rowIndexes: number[], colIds: string[]): void {
    if (!this.core.options.flashCells) return;
    for (const rowIndex of rowIndexes) {
      for (const colId of colIds) this.pendingFlash.push([rowIndex, colId]);
    }
  }

  flushFlash(): void {
    if (this.pendingFlash.length === 0) return;
    const entries = this.pendingFlash;
    this.pendingFlash = [];
    for (const [rowIndex, colId] of entries) {
      const cell = this.getCellElement(rowIndex, colId);
      if (!cell) continue;
      cell.classList.remove("mach-cell--flash");
      void cell.offsetWidth;
      cell.classList.add("mach-cell--flash");
      const runtime = getCellRuntimeState(cell);
      const timer = runtime.flashTimer;
      if (timer) clearTimeout(timer);
      runtime.flashTimer = setTimeout(() => {
        cell.classList.remove("mach-cell--flash");
        runtime.flashTimer = undefined;
      }, 800);
    }
  }

  relayout(): void {
    this.applyContainerSizes();
    const viewport = this.core.skeleton.bodyViewports.center;
    const rowHeight = this.core.options.rowHeight;
    let minRowHeight = rowHeight;
    if (this.core.options.masterDetail) {
      minRowHeight = Math.min(minRowHeight, this.core.options.detailRowHeight);
    }
    if (this.lastMinRowHeight > 0) {
      minRowHeight = Math.min(minRowHeight, this.lastMinRowHeight);
    }
    const visible = Math.ceil(viewport.clientHeight / Math.max(1, minRowHeight));
    const needed = this.core.options.domLayout === "autoHeight"
      ? this.core.rowModel.getDisplayedRowCount()
      : visible + this.core.options.rowBuffer * 2 + 1;
    const colWindowChanged = this.computeColWindow();
    if (colWindowChanged) {
      for (const slot of this.pool) this.reconcilePaneCells(slot, "center");
    }
    if (needed > this.poolSize) this.growPool(needed);
    this.applyCellLayout();
    this.updateRange(true);
    this.refreshOverlays();
  }

  private growPool(needed: number): void {
    while (this.poolSize < needed) {
      const slot: RowSlot = { index: -1, nodeId: "", kind: "master", rows: {}, cells: {}, cellColIds: {} };
      const sk = this.core.skeleton;
      for (const pane of PANES) {
        const cols = this.core.columnModel.getPaneColumns(pane);
        if (cols.length === 0) continue;
        const row = el("div", "mach-row");
        row.style.height = `${this.core.options.rowHeight}px`;
        row.setAttribute("role", "row");
        row.style.display = "none";
        sk.rowContainers[pane].appendChild(row);
        slot.rows[pane] = row;
        slot.cells[pane] = [];
        slot.cellColIds[pane] = [];
        this.reconcilePaneCells(slot, pane);
      }
      if (this.core.options.masterDetail) {
        const detailRow = el("div", "mach-row mach-detail-row");
        detailRow.style.height = `${this.core.options.detailRowHeight}px`;
        detailRow.setAttribute("role", "row");
        detailRow.style.display = "none";
        sk.rowContainers.center.appendChild(detailRow);
        slot.detailRow = detailRow;
      }
      this.pool.push(slot);
      this.poolSize++;
    }
  }

  private activePaneColumns(pane: PaneType): Column[] {
    const cols = this.core.columnModel.getPaneColumns(pane);
    if (pane !== "center" || cols.length <= 20 || this.core.columnModel.hasColSpan()) return cols;
    return cols.slice(this.colFirst, this.colLastExcl);
  }

  private createCell(column: Column): HTMLElement {
    const cell = el("div", "mach-cell");
    cell.dataset.colId = column.id;
    cell.setAttribute("role", "gridcell");
    if (column.hasCheckbox) {
      const input = document.createElement("input");
      input.type = this.core.options.rowSelection === "single" ? "radio" : "checkbox";
      input.className = "mach-row-checkbox";
      if (input.type === "radio") input.name = `mach-radio-${this.core.gridId}`;
      input.setAttribute("aria-label", "select row");
      cell.appendChild(input);
      cell.classList.add("mach-cell--selection");
    }
    return cell;
  }

  private reconcilePaneCells(slot: RowSlot, pane: PaneType): void {
    const row = slot.rows[pane];
    if (!row) return;
    const columns = this.activePaneColumns(pane);
    const existingCells = slot.cells[pane] ?? [];
    const existingIds = slot.cellColIds[pane] ?? [];
    if (existingIds.length === columns.length && existingIds.every((id, index) => id === columns[index].id)) return;

    const byId = new Map<string, HTMLElement>();
    existingIds.forEach((id, index) => byId.set(id, existingCells[index]));
    const nextCells: HTMLElement[] = [];
    const nextIds: string[] = [];
    for (const column of columns) {
      const cell = byId.get(column.id) ?? this.createCell(column);
      byId.delete(column.id);
      row.appendChild(cell);
      nextCells.push(cell);
      nextIds.push(column.id);
    }
    for (const cell of byId.values()) {
      if (slot.index >= 0) this.core.editingService.releaseCell(slot.index, cell.dataset.colId ?? "", cell);
      cleanupCellContent(this.core, cell);
      cell.remove();
    }
    slot.cells[pane] = nextCells;
    slot.cellColIds[pane] = nextIds;
  }

  rebuildPool(): void {
    this.treeColumnCache = undefined;
    this.invalidateRangeCache();
    for (const slot of this.pool) {
      if (slot.detailRow) this.cleanupDetail(slot.detailRow);
      for (const pane of PANES) {
        for (const cell of slot.cells[pane] ?? []) cleanupCellContent(this.core, cell);
        slot.rows[pane]?.remove();
      }
      slot.detailRow?.remove();
    }
    this.pool = [];
    this.poolSize = 0;
    this.first = 0;
    this.lastExcl = -1;
    this.relayout();
  }

  applyCellLayout(): void {
    const variableHeights = this.hasVariableRowHeights();
    for (const pane of PANES) {
      const allPaneCols = this.core.columnModel.getPaneColumns(pane);
      const columns = this.activePaneColumns(pane);
      const lefts = this.paneColumnLefts(pane, columns, allPaneCols);
      this.layoutPoolPane(pane, columns, lefts, variableHeights);
    }
    this.applyDetailRowHeight();
  }

  private hasVariableRowHeights(): boolean {
    return this.core.options.masterDetail || this.core.options.getRowHeight != null || this.hasAnyAutoHeight;
  }

  private paneColumnLefts(pane: PaneType, columns: Column[], allPaneColumns: Column[]): number[] {
    let offset = 0;
    if (pane === "center" && columns.length > 0) {
      this.columnViewport.update(allPaneColumns);
      offset = this.columnViewport.offsetAt(allPaneColumns.indexOf(columns[0]));
    }
    const lefts: number[] = [];
    for (const column of columns) {
      lefts.push(offset);
      offset += column.currentWidth;
    }
    return lefts;
  }

  private layoutPoolPane(
    pane: PaneType,
    columns: Column[],
    lefts: number[],
    variableHeights: boolean
  ): void {
    for (const slot of this.pool) {
      const cells = slot.cells[pane];
      const row = slot.rows[pane];
      if (!cells || !row) continue;
      if (!variableHeights) row.style.height = `${this.core.options.rowHeight}px`;
      const count = Math.min(columns.length, cells.length);
      for (let index = 0; index < count; index++) {
        const column = columns[index];
        cells[index].style.width = `${column.currentWidth}px`;
        cells[index].style.left = `${lefts[index]}px`;
        cells[index].setAttribute("aria-colindex", String(this.core.columnModel.getFlatIndex(column.id) + 1));
      }
    }
  }

  private applyDetailRowHeight(): void {
    if (!this.core.options.masterDetail) return;
    const height = `${this.core.options.detailRowHeight}px`;
    for (const slot of this.pool) slot.detailRow?.style.setProperty("--mach-detail-h", height);
  }

  private computeColWindow(): boolean {
    const viewport = this.core.skeleton.bodyViewports.center;
    const cols = this.core.columnModel.getPaneColumns("center");
    const prevFirst = this.colFirst;
    const prevLast = this.colLastExcl;
    this.columnViewport.update(cols);
    const range = cols.length > 20
      ? this.columnViewport.visibleRange(viewport.scrollLeft, viewport.clientWidth, 2)
      : { first: 0, lastExcl: cols.length };
    this.colFirst = range.first;
    this.colLastExcl = range.lastExcl;
    return range.first !== prevFirst || range.lastExcl !== prevLast;
  }

  updateRange(force = false): void {
    const startedAt = this.core.performanceMonitor.start();
    if (!this.updateRangeInner(force)) return;
    const rows = Math.max(0, this.lastExcl - this.first);
    const columns = this.core.columnModel.getPaneColumns("left").length +
      this.activePaneColumns("center").length +
      this.core.columnModel.getPaneColumns("right").length;
    this.core.performanceMonitor.recordRender(startedAt, rows, columns);
  }

  private updateRangeInner(force: boolean): boolean {
    const viewport = this.core.skeleton.bodyViewports.center;
    const rowCount = this.core.rowModel.getDisplayedRowCount();
    const buffer = this.core.options.rowBuffer;
    const colWindowChanged = this.computeColWindow();
    this.reconcileColumnWindow(colWindowChanged);

    if (rowCount === 0) {
      for (const slot of this.pool) this.hideSlot(slot);
      this.first = 0;
      this.lastExcl = 0;
      return true;
    }

    if (this.renderAutoHeightRange(rowCount, force)) return true;

    const { first, lastExcl } = this.calculateVisibleRange(viewport, rowCount, buffer);

    if (!force && first === this.first && lastExcl === this.lastExcl) return colWindowChanged;
    this.first = first;
    this.lastExcl = lastExcl;
    this.hideOutsideRange(first, lastExcl);
    this.renderVirtualRange(first, lastExcl, force, colWindowChanged);
    return true;
  }

  private calculateVisibleRange(
    viewport: HTMLElement,
    rowCount: number,
    buffer: number
  ): { first: number; lastExcl: number } {
    const firstVisible = this.rowAtOffset(viewport.scrollTop, rowCount);
    const viewBottom = viewport.scrollTop + viewport.clientHeight;
    const lastVisible = Math.min(rowCount, this.rowAtOffset(viewBottom, rowCount) + 1);
    return {
      first: clamp(firstVisible - buffer, 0, rowCount - 1),
      lastExcl: clamp(lastVisible + buffer, 1, rowCount)
    };
  }

  private hideOutsideRange(first: number, lastExcl: number): void {
    for (const slot of this.pool) {
      if (slot.index !== -1 && (slot.index < first || slot.index >= lastExcl)) this.hideSlot(slot);
    }
  }

  private renderVirtualRange(first: number, lastExcl: number, force: boolean, columnsChanged: boolean): void {
    for (let i = first; i < lastExcl; i++) {
      const node = this.core.rowModel.getDisplayedRow(i);
      const slot = this.pool[i % this.poolSize];
      if (!slot || !node) continue;
      if (!force && slot.index === i && slot.nodeId === node.id) {
        if (columnsChanged && slot.kind === "master") this.renderPaneCells(slot, node, "center");
        continue;
      }
      this.assignSlot(slot, i);
    }
  }

  private reconcileColumnWindow(changed: boolean): void {
    if (!changed) return;
    for (const slot of this.pool) this.reconcilePaneCells(slot, "center");
    this.applyCellLayout();
  }

  private renderAutoHeightRange(rowCount: number, force: boolean): boolean {
    if (this.core.options.domLayout !== "autoHeight") return false;
    if (!force && this.first === 0 && this.lastExcl === rowCount) return true;
    this.first = 0;
    this.lastExcl = rowCount;
    for (let index = 0; index < rowCount; index++) {
      const node = this.core.rowModel.getDisplayedRow(index);
      const slot = this.pool[index];
      if (!slot || !node) continue;
      if (force || slot.index !== index || slot.nodeId !== node.id) this.assignSlot(slot, index);
    }
    return true;
  }

  private hideSlot(slot: RowSlot): void {
    this.releaseSlotEditors(slot);
    if (this.focusedCell?.rowIndex === slot.index) {
      this.core.skeleton.root.removeAttribute("aria-activedescendant");
    }
    slot.index = -1;
    slot.nodeId = "";
    slot.kind = "master";
    for (const pane of PANES) {
      const row = slot.rows[pane];
      if (row) row.style.display = "none";
    }
    if (slot.detailRow) {
      this.cleanupDetail(slot.detailRow);
      slot.detailRow.style.display = "none";
    }
  }

  private assignSlot(slot: RowSlot, index: number): void {
    if (slot.index >= 0 && slot.index !== index) this.releaseSlotEditors(slot);
    const node = this.core.rowModel.getDisplayedRow(index);
    if (!node) {
      this.hideSlot(slot);
      return;
    }
    slot.index = index;
    slot.nodeId = node.id;
    const y = this.rowTop(index);
    const h = this.rowTop(index + 1) - y;

    if (node.isDetail) {
      this.assignDetailSlot(slot, node, index, y, h);
      return;
    }
    this.assignMasterSlot(slot, node, index, y, h);
  }

  private assignDetailSlot(slot: RowSlot, node: RowNode<any>, index: number, y: number, h: number): void {
    slot.kind = "detail";
    for (const pane of PANES) {
      const row = slot.rows[pane];
      if (row) row.style.display = "none";
    }
    const detailRow = slot.detailRow;
    if (!detailRow) return;
    detailRow.style.display = "";
    detailRow.style.transform = `translateY(${y}px)`;
    detailRow.style.height = `${h}px`;
    detailRow.dataset.index = String(index);
    detailRow.setAttribute("aria-rowindex", String(index + this.core.skeleton.getHeaderRowCount() + 1));
    this.renderDetailContent(detailRow, node);
  }

  private assignMasterSlot(slot: RowSlot, node: RowNode<any>, index: number, y: number, h: number): void {
    slot.kind = "master";
    if (slot.detailRow) slot.detailRow.style.display = "none";
    const state = this.resolveMasterRowState(node);
    for (const pane of PANES) {
      const row = slot.rows[pane];
      if (!row) continue;
      this.applyMasterRowState(row, node, index, y, h, state);
      this.renderPaneCells(slot, node, pane);
    }
    if (this.focusedCell && this.focusedCell.rowIndex === index) {
      this.applyFocusClass();
    }
  }

  private resolveMasterRowState(node: RowNode<any>): MasterRowState {
    const isTreeRow = this.core.rowModel.isTree;
    const isGroupRow = node.isGroup === true;
    const hasTreeChildren = isTreeRow && this.core.rowModel.hasChildren(node.id);
    const expandable = isGroupRow || hasTreeChildren ||
      (this.core.options.masterDetail && this.core.rowModel.isRowExpandable(node));
    const expanded = isGroupRow
      ? this.core.rowModel.isGroupExpanded(node.id)
      : this.core.rowModel.isRowExpanded(node.id);
    let level: number | null = null;
    if (isGroupRow) level = (node.groupLevel ?? 0) + 1;
    else if (isTreeRow) level = this.core.rowModel.getTreeDepth(node) + 1;
    return { expanded, expandable, level };
  }

  private applyMasterRowState(
    row: HTMLElement,
    node: RowNode<any>,
    index: number,
    y: number,
    h: number,
    state: MasterRowState
  ): void {
    row.style.display = "";
    row.style.transform = `translateY(${y}px)`;
    row.style.height = `${h}px`;
    row.dataset.index = String(index);
    row.dataset.id = node.id;
    row.setAttribute("aria-rowindex", String(index + this.core.skeleton.getHeaderRowCount() + 1));
    row.classList.toggle("mach-row--selected", node.selected);
    const hovered = this.hoverIndex === index && !this.core.options.suppressRowHoverHighlight;
    row.classList.toggle("mach-row--hover", hovered);
    row.classList.toggle("mach-row--odd", index % 2 === 1);
    row.setAttribute("aria-selected", node.selected ? "true" : "false");
    this.applyExpandableRowState(row, state);
  }

  private applyExpandableRowState(row: HTMLElement, state: MasterRowState): void {
    if (state.expandable) row.setAttribute("aria-expanded", state.expanded ? "true" : "false");
    else row.removeAttribute("aria-expanded");
    if (state.level != null) row.setAttribute("aria-level", String(state.level));
    else row.removeAttribute("aria-level");
  }

  private renderPaneCells(slot: RowSlot, node: RowNode<any>, pane: PaneType): void {
    const cols = this.activePaneColumns(pane);
    const cells = slot.cells[pane];
    if (!cells) return;
    const index = slot.index;
    const hasColSpan = pane === "center" && this.core.columnModel.hasColSpan();
    let coverage = 0;
    slot.rows[pane]?.classList.toggle("mach-row--editing", this.core.editingService.isRowEditing(index));

    for (let i = 0; i < cols.length; i++) {
      const col = cols[i];
      const cell = cells[i];

      if (hasColSpan && coverage > 0) {
        coverage--;
        cleanupCellContent(this.core, cell);
        cell.setAttribute("aria-hidden", "true");
        if (cell.style.display !== "none") cell.style.display = "none";
        continue;
      }

      if (cell.style.display === "none") cell.style.display = "";
      cell.removeAttribute("aria-hidden");

      if (hasColSpan) {
        const span = this.resolveColSpan(node, col, index, cols.length - i);
        if (span > 1) {
          coverage = span - 1;
          this.applySpanWidth(cell, cols, i, span);
        } else {
          cell.removeAttribute("aria-colspan");
          if (cell.style.width !== `${col.currentWidth}px`) cell.style.width = `${col.currentWidth}px`;
        }
      } else {
        cell.removeAttribute("aria-colspan");
      }

      if (this.core.editingService.renderEditor(index, node, col, cell)) continue;
      this.renderCell(cell, node, col);
      this.applyRangeClass(cell, index, col);
    }
  }

  private resolveColSpan(node: RowNode<any>, column: Column, rowIndex: number, remaining: number): number {
    const fn = column.colDef.colSpan;
    if (!fn) return 1;
    try {
      const span = fn({
        api: this.core.getApi(),
        colDef: column.colDef,
        column,
        node,
        data: node.data,
        value: this.core.getCellValue(node, column),
        rowIndex
      });
      return Math.max(1, Math.min(Math.round(span) || 1, remaining));
    } catch (error) {
      this.core.reportError(error, "colSpan", { colId: column.id, rowId: node.id });
      return 1;
    }
  }

  private applySpanWidth(cell: HTMLElement, cols: Column[], start: number, span: number): void {
    let w = 0;
    for (let i = start; i < start + span && i < cols.length; i++) w += cols[i].currentWidth;
    cell.style.width = `${w}px`;
    cell.setAttribute("aria-colspan", String(span));
  }

  private renderDetailContent(row: HTMLElement, node: RowNode<any>): void {
    this.cleanupDetail(row);
    const master = node.masterId != null ? this.core.rowModel.getNodeById(node.masterId) : node;
    const container = el("div", "mach-detail");
    row.appendChild(container);
    const renderer = this.core.options.detailRowRenderer;
    if (renderer) {
      const params = { data: node.data, node: master ?? node, api: this.core.getApi() };
      let out: string | HTMLElement | { el: HTMLElement; destroy?: () => void } | null | undefined;
      try {
        out = renderer(params);
      } catch (err) {
        this.core.reportError(err, "detailRowRenderer", { rowId: node.id });
        out = null;
      }
      if (typeof out === "string") {
        container.textContent = out;
      } else if (out instanceof HTMLElement) {
        container.appendChild(out);
      } else if (out && typeof out === "object" && out.el instanceof HTMLElement) {
        container.appendChild(out.el);
        setDetailDestroyer(row, out.destroy);
      }
    }
  }

  private cleanupDetail(row: HTMLElement): void {
    const destroy = takeDetailDestroyer(row);
    if (destroy) {
      try {
        destroy();
      } catch (err) {
        this.core.reportError(err, "detailRowRenderer.destroy");
      }
    }
    row.textContent = "";
  }

  private renderCell(cell: HTMLElement, node: RowNode<any>, column: Column): void {
    if (node.loading) {
      cleanupCellContent(this.core, cell);
      cell.className = "mach-cell mach-cell--loading";
      cell.setAttribute("aria-readonly", "true");
      cell.setAttribute("aria-busy", "true");
      const bar = document.createElement("span");
      bar.className = "mach-cell-loading-bar";
      bar.style.width = `${34 + (column.id.length * 13 + node.rowIndex * 7) % 44}%`;
      cell.replaceChildren(bar);
      this.resetSpanStyle(cell);
      return;
    }
    cell.removeAttribute("aria-busy");
    cell.setAttribute("aria-readonly", this.core.editingService.isEditable(node, column) ? "false" : "true");
    cell.removeAttribute("aria-expanded");
    cell.removeAttribute("aria-level");
    const kind = this.cellRenderKind(node, column);
    if (kind !== "standard") {
      cleanupCellContent(this.core, cell);
      this.renderStructuralCell(kind, cell, node, column);
      return;
    }
    renderCellContent(this.core, cell, node, column);
    applyCellClasses(this.core, cell, node, column);
    applyCellStyle(this.core, cell, node, column);
    this.applyCellSpanStyle(cell, node, column);
    this.appendEditableIndicator(cell, node, column);
  }

  private cellRenderKind(node: RowNode<any>, column: Column): CellRenderKind {
    if (node.isGroup) return "group";
    if (column.isDetailToggle) return "detail";
    if (column.hasCheckbox) return "checkbox";
    if (column.colDef.rowDrag) return "drag";
    if (hasColumnType(column.colDef, "index")) return "index";
    if (this.core.rowModel.isTree && this.getTreeColumn()?.id === column.id) return "tree";
    return "standard";
  }

  private renderStructuralCell(
    kind: Exclude<CellRenderKind, "standard">,
    cell: HTMLElement,
    node: RowNode<any>,
    column: Column
  ): void {
    if (kind === "group") {
      this.renderGroupCell(cell, node, column);
    } else if (kind === "detail") {
      const expanded = this.core.rowModel.isRowExpanded(node.id);
      const toggle = el("span", `mach-detail-toggle${expanded ? " mach-detail-toggle--open" : ""}`);
      toggle.textContent = "▶";
      cell.replaceChildren(toggle);
      cell.classList.add("mach-cell--detail-toggle");
      this.resetSpanStyle(cell);
    } else if (kind === "checkbox") {
      const input = cell.querySelector<HTMLInputElement>(".mach-row-checkbox");
      if (input) {
        input.checked = node.selected;
        input.indeterminate = this.core.selectionService.isIndeterminate(node.id);
        input.disabled = !this.core.selectionService.isSelectable(node);
      }
      if (cell.className !== "mach-cell mach-cell--selection") cell.className = "mach-cell mach-cell--selection";
      this.resetSpanStyle(cell);
    } else if (kind === "drag") {
      const handle = el("span", "mach-row-drag-handle");
      handle.textContent = "⠿";
      cell.replaceChildren(handle);
      if (cell.className !== "mach-cell mach-cell--drag") cell.className = "mach-cell mach-cell--drag";
      this.resetSpanStyle(cell);
    } else if (kind === "index") {
      cell.textContent = String(this.core.rowModel.getRowSeq(node) + this.core.options.indexOffset);
      if (cell.className !== "mach-cell mach-cell--index") cell.className = "mach-cell mach-cell--index";
      this.applyCellSpanStyle(cell, node, column);
    } else {
      this.renderTreeCell(cell, node, column);
    }
  }

  private appendEditableIndicator(cell: HTMLElement, node: RowNode<any>, column: Column): void {
    if (
      this.core.options.editType !== "cell" ||
      this.core.options.editableIndicator === "none" ||
      !this.core.editingService.isEditable(node, column)
    ) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `mach-cell-edit-trigger mach-cell-edit-trigger--${this.core.options.editableIndicator}`;
    button.tabIndex = -1;
    button.title = "Edit cell";
    button.setAttribute("aria-label", "Edit cell");
    button.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m10.8 2.7 2.5 2.5L5.5 13H3v-2.5z"/><path d="m9.5 4 2.5 2.5"/></svg>';
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.setFocusedCell(node.rowIndex, column.id);
      this.core.editingService.start(node.rowIndex, column);
    });
    cell.appendChild(button);
  }

  private releaseSlotEditors(slot: RowSlot): void {
    if (slot.index < 0) return;
    for (const pane of PANES) {
      for (const cell of slot.cells[pane] ?? []) {
        this.core.editingService.releaseCell(slot.index, cell.dataset.colId ?? "", cell);
      }
    }
  }

  private treeColumnCache: Column | null | undefined;

  private getTreeColumn(): Column | null {
    if (this.treeColumnCache !== undefined) return this.treeColumnCache;
    this.treeColumnCache =
      this.core.columnModel.getOrderedVisible().find(
        (c) => !c.hasCheckbox && !c.isDetailToggle && !c.colDef.rowDrag && !hasColumnType(c.colDef, "index")
      ) ?? null;
    return this.treeColumnCache;
  }

  private renderTreeCell(cell: HTMLElement, node: RowNode<any>, column: Column): void {
    const expandable = this.core.rowModel.isRowExpandable(node);
    const depth = this.getNodeDepth(node);
    const indent = el("span", "mach-tree-indent");
    indent.style.width = `${depth * 16}px`;
    const wrap = el("span", "mach-tree-cell");
    wrap.appendChild(indent);
    if (expandable) {
      const expanded = this.core.rowModel.isRowExpanded(node.id);
      cell.setAttribute("aria-expanded", expanded ? "true" : "false");
      cell.setAttribute("aria-level", String(depth + 1));
      const stateClass = node.treeLoading
        ? " mach-detail-toggle--loading"
        : node.treeLoadError
          ? " mach-detail-toggle--error"
          : "";
      const toggle = el("span", `mach-detail-toggle${expanded ? " mach-detail-toggle--open" : ""}${stateClass}`);
      if (node.treeLoadError) toggle.title = "Retry loading children";
      toggle.textContent = "▶";
      wrap.appendChild(toggle);
    } else {
      const spacer = el("span", "mach-tree-toggle-spacer");
      wrap.appendChild(spacer);
    }
    const text = el("span", "mach-tree-text");
    text.textContent = formatCellValueWith(this.core, node, column, this.core.getCellValue(node, column));
    wrap.appendChild(text);
    cell.replaceChildren(wrap);
    applyCellClasses(this.core, cell, node, column);
  }

  private getNodeDepth(node: RowNode<any>): number {
    return this.core.rowModel.getTreeDepth(node);
  }

  private resetSpanStyle(cell: HTMLElement): void {
    if (cell.style.height !== "") cell.style.height = "";
    if (cell.style.zIndex !== "") cell.style.zIndex = "";
    if (cell.style.display === "none") cell.style.display = "";
    cell.removeAttribute("aria-rowspan");
  }

  private applyCellSpanStyle(cell: HTMLElement, node: RowNode<any>, column: Column): void {
    const spans = this.core.rowModel.getSpanInfo(column.id);
    if (!spans || node.isDetail) {
      this.resetSpanStyle(cell);
      return;
    }
    const idx = this.core.rowModel.getRowSeq(node) - 1;
    if (idx < 0 || idx >= spans.length) {
      this.resetSpanStyle(cell);
      return;
    }
    const value = spans[idx];
    if (value === -1) {
      cell.style.display = "none";
      cell.setAttribute("aria-hidden", "true");
      return;
    }
    if (cell.style.display === "none") cell.style.display = "";
    cell.removeAttribute("aria-hidden");
    if (value > 1) {
      const end = Math.min(idx + value, this.core.rowModel.getDisplayedRowCount());
      const height = this.rowTop(end) - this.rowTop(idx);
      cell.style.height = `${height > 0 ? height : value * this.core.options.rowHeight}px`;
      cell.style.zIndex = "1";
      cell.setAttribute("aria-rowspan", String(value));
    } else {
      this.resetSpanStyle(cell);
    }
  }

  private renderGroupCell(cell: HTMLElement, node: RowNode<any>, column: Column): void {
    if (column.hasCheckbox) {
      this.renderGroupCheckbox(cell, node);
      return;
    }
    if (column.isDetailToggle) {
      this.clearGroupCell(cell);
      return;
    }
    const labelCol = this.core.columnModel.getGroupLabelColumn();
    if (labelCol && column.id === labelCol.id) {
      this.renderGroupLabel(cell, node);
      return;
    }
    if (this.renderGroupAggregate(cell, node, column)) return;
    this.clearGroupCell(cell);
  }

  private renderGroupCheckbox(cell: HTMLElement, node: RowNode<any>): void {
    const input = cell.querySelector<HTMLInputElement>(".mach-row-checkbox");
    if (input) {
      const state = this.core.selectionService.getGroupSelectionState(node);
      input.checked = state.all;
      input.indeterminate = state.some && !state.all;
    }
    if (cell.className !== "mach-cell mach-cell--selection") {
      cell.className = "mach-cell mach-cell--selection";
    }
  }

  private renderGroupLabel(cell: HTMLElement, node: RowNode<any>): void {
    const expanded = this.core.rowModel.isGroupExpanded(node.id);
    const level = node.groupLevel ?? 0;
    cell.setAttribute("aria-expanded", expanded ? "true" : "false");
    cell.setAttribute("aria-level", String(level + 1));
    const wrap = el("span", "mach-group-label");
    wrap.style.paddingLeft = `${level * 16}px`;
    const toggle = el("span", `mach-detail-toggle${expanded ? " mach-detail-toggle--open" : ""}`);
    toggle.textContent = "▶";
    const text = el("span", "mach-group-text");
    const groupColumn = this.core.columnModel.getRowGroupColumns()[level];
    const prefix = groupColumn?.colDef.headerName ? `${groupColumn.colDef.headerName}: ` : "";
    text.textContent = `${prefix}${node.groupKey ?? ""}`;
    const count = el("span", "mach-group-count");
    count.textContent = `(${node.leafNodes?.length ?? 0})`;
    wrap.append(toggle, text, count);
    cell.replaceChildren(wrap);
    if (cell.className !== "mach-cell mach-cell--group") cell.className = "mach-cell mach-cell--group";
  }

  private renderGroupAggregate(cell: HTMLElement, node: RowNode<any>, column: Column): boolean {
    if (!column.colDef.aggFunc || !node.aggValues) return false;
    if (!Object.prototype.hasOwnProperty.call(node.aggValues, column.id)) return false;
    const value = node.aggValues[column.id];
    cell.textContent = column.colDef.valueFormatter != null
      ? formatCellValueWith(this.core, node, column, value)
      : defaultFormat(value);
    if (cell.className !== "mach-cell mach-cell--num") cell.className = "mach-cell mach-cell--num";
    return true;
  }

  private clearGroupCell(cell: HTMLElement): void {
    cell.textContent = "";
    if (cell.className !== "mach-cell") cell.className = "mach-cell";
  }

  refreshRows(indexes: number[]): void {
    if (this.core.isDestroyed()) return;
    const seen = new Set<number>();
    for (const index of indexes) {
      if (index < 0 || seen.has(index)) continue;
      seen.add(index);
      const slot = this.pool[index % this.poolSize];
      if (!slot || slot.index !== index) continue;
      const node = this.core.rowModel.getDisplayedRow(index);
      if (!node) continue;
      if (slot.kind === "detail") {
        if (slot.detailRow) this.renderDetailContent(slot.detailRow, node);
        continue;
      }
      for (const pane of PANES) {
        const cells = slot.cells[pane];
        if (!cells) continue;
        this.renderPaneCells(slot, node, pane);
      }
    }
    this.applyFocusClass();
    this.flushFlash();
  }

  refreshAllCells(): void {
    this.refreshCells();
  }

  refreshCells(params: RefreshCellsParams = {}): void {
    if (this.core.isDestroyed()) return;
    const rowIds = params.rowIds == null ? null : new Set(params.rowIds);
    const rowIndexes = params.rowIndexes == null ? null : new Set(params.rowIndexes);
    const columns = params.columns == null ? null : new Set(params.columns);
    for (const slot of this.pool) {
      const node = this.core.rowModel.getDisplayedRow(slot.index);
      if (!node || !this.matchesRefreshRow(slot, node, rowIds, rowIndexes)) continue;
      this.refreshSlotCells(slot, node, columns, params.force === true);
    }
    this.applyFocusClass();
    this.flushFlash();
  }

  private matchesRefreshRow(
    slot: RowSlot,
    node: RowNode<any>,
    rowIds: ReadonlySet<string> | null,
    rowIndexes: ReadonlySet<number> | null
  ): boolean {
    if (slot.index < 0) return false;
    if (rowIds == null && rowIndexes == null) return true;
    return rowIds?.has(node.id) === true || rowIndexes?.has(slot.index) === true;
  }

  private refreshSlotCells(
    slot: RowSlot,
    node: RowNode<any>,
    columns: ReadonlySet<string> | null,
    force: boolean
  ): void {
    if (slot.kind === "detail") {
      if (columns == null && slot.detailRow) this.renderDetailContent(slot.detailRow, node);
      return;
    }
    const refreshPane = columns == null || this.core.columnModel.hasColSpan();
    for (const pane of PANES) {
      if (refreshPane) this.renderPaneCells(slot, node, pane);
      else this.refreshPaneCells(slot, node, pane, columns, force);
    }
  }

  private refreshPaneCells(
    slot: RowSlot,
    node: RowNode<any>,
    pane: PaneType,
    columns: ReadonlySet<string>,
    force: boolean
  ): void {
    const paneColumns = this.activePaneColumns(pane);
    const cells = slot.cells[pane];
    if (!cells) return;
    for (let index = 0; index < paneColumns.length; index++) {
      const column = paneColumns[index];
      if (!columns.has(column.id)) continue;
      const cell = cells[index];
      if (!cell) continue;
      if (this.core.editingService.renderEditor(slot.index, node, column, cell)) continue;
      if (force) cleanupCellContent(this.core, cell);
      this.renderCell(cell, node, column);
      this.applyRangeClass(cell, slot.index, column);
    }
  }

  onDataChanged(): void {
    if (this.core.isDestroyed()) return;
    if (this.focusedCell && this.focusedCell.rowIndex >= this.core.rowModel.getDisplayedRowCount()) {
      this.setFocusedCell(null, null);
    }
    this.invalidateRangeCache();
    this.applyContainerSizes();
    this.updateRange(true);
    this.updateFillHandle();
    this.refreshOverlays();
    this.core.summaryRenderer.refresh();
  }

  refreshOverlays(): void {
    const options = this.core.options;
    if (options.loading) {
      this.core.skeleton.showOverlay("loading", options.overlayLoadingTemplate, options.allowUnsafeOverlayHtml);
      return;
    }
    if (options.error != null) {
      const template = options.overlayErrorTemplate || this.core.buildDefaultErrorState();
      this.core.skeleton.showOverlay("error", template, options.allowUnsafeOverlayHtml);
      return;
    }
    if (this.core.rowModel.getDisplayedRowCount() === 0 && !options.suppressNoRowsOverlay) {
      const template = options.overlayNoRowsTemplate || this.core.buildDefaultEmptyState();
      this.core.skeleton.showOverlay("noRows", template, options.allowUnsafeOverlayHtml);
      return;
    }
    this.core.skeleton.hideOverlay();
  }

  getCellElement(rowIndex: number, colId: string): HTMLElement | null {
    const column = this.core.columnModel.getColumn(colId);
    if (!column) return null;
    const pane = this.paneForColumn(column);
    const colIdx = this.pool[rowIndex % Math.max(1, this.poolSize)]?.cellColIds[pane]?.indexOf(column.id) ?? -1;
    if (colIdx < 0) return null;
    const slot = this.pool[rowIndex % this.poolSize];
    if (!slot || slot.index !== rowIndex || slot.kind !== "master") return null;
    return slot.cells[pane]?.[colIdx] ?? null;
  }

  private invalidateRangeCache(): void {
    this.rangeSelection.invalidate();
  }

  normalizedRange(): NormalizedRange | null {
    const rowCount = this.core.rowModel.getDisplayedRowCount();
    const colCount = this.core.columnModel.getOrderedVisible().length;
    return this.rangeSelection.normalize(rowCount, colCount);
  }

  getNormalizedRangeOrFocus(): NormalizedRange | null {
    const range = this.normalizedRange();
    if (range) return range;
    const focus = this.focusedCell;
    if (focus) {
      const ci = this.core.columnModel.getFlatIndex(focus.colId);
      if (ci >= 0) return { r1: focus.rowIndex, c1: ci, r2: focus.rowIndex, c2: ci };
    }
    return null;
  }

  getRangeSelection(): { row1: number; row2: number; colId1: string; colId2: string } | null {
    const range = this.normalizedRange();
    if (!range) return null;
    const flat = this.core.columnModel.getOrderedVisible();
    return {
      row1: range.r1,
      row2: range.r2,
      colId1: flat[range.c1]?.id ?? "",
      colId2: flat[range.c2]?.id ?? ""
    };
  }

  getPasteStart(): { row: number; colIdx: number } | null {
    const anchor = this.rangeSelection.getAnchor();
    if (anchor) {
      return { row: anchor.row, colIdx: anchor.colIdx };
    }
    const focus = this.getNormalizedRangeOrFocus();
    return focus ? { row: focus.r1, colIdx: focus.c1 } : null;
  }

  clearRangeSelection(): void {
    const old = this.normalizedRange();
    this.rangeSelection.clear();
    if (old) {
      this.refreshRowRange(old, null);
      this.updateFillHandle();
      this.core.emit("rangeSelectionChanged", { range: null });
    }
  }

  private refreshRowRange(
    a: { r1: number; r2: number } | null,
    b: { r1: number; r2: number } | null
  ): void {
    const indexes: number[] = [];
    const collect = (r: { r1: number; r2: number } | null) => {
      if (!r) return;
      for (let i = r.r1; i <= r.r2; i++) indexes.push(i);
    };
    collect(a);
    collect(b);
    if (indexes.length > 0) this.refreshRows(indexes);
  }

  startRange(row: number, colIdx: number, extend: boolean): void {
    const old = this.normalizedRange();
    this.rangeSelection.start({ row, colIdx }, extend);
    const next = this.normalizedRange();
    this.refreshRowRange(old, next);
    this.updateFillHandle();
    this.core.emit("rangeSelectionChanged", { range: this.getRangeSelection() });
  }

  moveRangeEnd(row: number, colIdx: number): void {
    if (!this.rangeSelection.hasAnchor()) {
      const focus = this.focusedCell;
      if (!focus) return;
      const col = this.core.columnModel.getFlatIndex(focus.colId);
      if (!this.rangeSelection.ensureAnchor({ row: focus.rowIndex, colIdx: col })) return;
    }
    const rowCount = this.core.rowModel.getDisplayedRowCount();
    const colCount = this.core.columnModel.getOrderedVisible().length;
    const old = this.normalizedRange();
    this.rangeSelection.setEnd({
      row: Math.max(0, Math.min(row, rowCount - 1)),
      colIdx: Math.max(0, Math.min(colIdx, colCount - 1))
    });
    const next = this.normalizedRange();
    this.refreshRowRange(old, next);
    this.updateFillHandle();
    const flat = this.core.columnModel.getOrderedVisible();
    const end = this.rangeSelection.getEnd();
    if (end && end.colIdx < flat.length) {
      this.setFocusedCell(end.row, flat[end.colIdx].id);
    }
    this.core.emit("rangeSelectionChanged", { range: this.getRangeSelection() });
  }

  private applyRangeClass(cell: HTMLElement, rowIndex: number, column: Column): void {
    const range = this.normalizedRange();
    if (!range) {
      if (cell.classList.contains("mach-cell--range")) {
        cell.classList.remove("mach-cell--range", "mach-cell--range-top", "mach-cell--range-bottom", "mach-cell--range-left", "mach-cell--range-right");
      }
      return;
    }
    const ci = this.core.columnModel.getFlatIndex(column.id);
    if (ci < 0) return;
    const inRange = rowIndex >= range.r1 && rowIndex <= range.r2 && ci >= range.c1 && ci <= range.c2;
    cell.classList.toggle("mach-cell--range", inRange);
    if (inRange) {
      cell.classList.toggle("mach-cell--range-top", rowIndex === range.r1);
      cell.classList.toggle("mach-cell--range-bottom", rowIndex === range.r2);
      cell.classList.toggle("mach-cell--range-left", ci === range.c1);
      cell.classList.toggle("mach-cell--range-right", ci === range.c2);
    } else {
      cell.classList.remove("mach-cell--range-top", "mach-cell--range-bottom", "mach-cell--range-left", "mach-cell--range-right");
    }
  }

  private fillHandleEl: HTMLElement | null = null;
  private fillDrag: {
    r1: number;
    r2: number;
    c1: number;
    c2: number;
    startX: number;
    startY: number;
    axis: "h" | "v" | null;
    active: boolean;
  } | null = null;
  private fillFromPointer = false;

  private ensureFillHandle(): HTMLElement {
    if (this.fillHandleEl) return this.fillHandleEl;
    const handle = el("div", "mach-fill-handle");
    handle.style.display = "none";
    handle.addEventListener("pointerdown", (e) => {
      this.fillFromPointer = true;
      this.onFillHandleDown(e);
    });
    handle.addEventListener("mousedown", (e) => {
      if (this.fillFromPointer) return;
      this.onFillHandleDown(e);
    });
    this.core.skeleton.rowContainers.center.appendChild(handle);
    this.fillHandleEl = handle;
    return handle;
  }

  private updateFillHandle(): void {
    const handle = this.ensureFillHandle();
    const range = this.normalizedRange();
    if (
      !this.core.options.enableRangeSelection ||
      !this.core.options.fillHandle ||
      !range
    ) {
      handle.style.display = "none";
      return;
    }
    const cm = this.core.columnModel;
    const leftCount = cm.getPaneColumns("left").length;
    const centerCols = cm.getPaneColumns("center");
    if (range.c2 < leftCount || range.c2 >= leftCount + centerCols.length) {
      handle.style.display = "none";
      return;
    }
    const local = range.c2 - leftCount;
    this.columnViewport.update(centerCols);
    const x = this.columnViewport.offsetAt(local + 1);
    const bottom = this.rowTop(Math.min(range.r2 + 1, this.core.rowModel.getDisplayedRowCount()));
    handle.style.display = "";
    handle.style.left = `${x - 4}px`;
    handle.style.top = `${bottom - 4}px`;
  }

  private onFillHandleDown(e: MouseEvent): void {
    if (this.core.isDestroyed() || e.button !== 0) return;
    const range = this.normalizedRange();
    if (!range) return;
    e.preventDefault();
    e.stopPropagation();
    this.fillDrag = {
      r1: range.r1,
      r2: range.r2,
      c1: range.c1,
      c2: range.c2,
      startX: e.clientX,
      startY: e.clientY,
      axis: null,
      active: false
    };
    window.addEventListener("pointermove", this.onFillMove);
    window.addEventListener("mousemove", this.onFillMove);
    window.addEventListener("pointerup", this.onFillUp);
    window.addEventListener("mouseup", this.onFillUp);
    window.addEventListener("pointercancel", this.onFillUp);
  }

  private fillTargetRow(e: MouseEvent): number {
    const container = this.core.skeleton.rowContainers.center;
    const rect = container.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const rowCount = this.core.rowModel.getDisplayedRowCount();
    const row = this.rowAtOffset(y, rowCount);
    return Math.max(this.fillDrag!.r2, Math.min(row, rowCount - 1));
  }

  private fillTargetCol(e: MouseEvent): number {
    const container = this.core.skeleton.rowContainers.center;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const cm = this.core.columnModel;
    const leftCount = cm.getPaneColumns("left").length;
    const centerCols = cm.getPaneColumns("center");
    this.columnViewport.update(centerCols);
    const local = this.columnViewport.indexAt(x);
    if (local < 0) return leftCount;
    const midpoint = this.columnViewport.offsetAt(local) + centerCols[local].currentWidth / 2;
    if (x < midpoint) return leftCount + local;
    if (local + 1 < centerCols.length) return leftCount + local + 1;
    return leftCount + centerCols.length - 1;
  }

  private fillDragIndicator: HTMLElement | null = null;

  private cancelFillDrag(): void {
    this.fillDrag = null;
    this.fillFromPointer = false;
    window.removeEventListener("pointermove", this.onFillMove);
    window.removeEventListener("mousemove", this.onFillMove);
    window.removeEventListener("pointerup", this.onFillUp);
    window.removeEventListener("mouseup", this.onFillUp);
    window.removeEventListener("pointercancel", this.onFillUp);
    this.core.skeleton.root.classList.remove("mach-root--filling");
  }

  private onFillMove = (e: Event): void => {
    const drag = this.fillDrag;
    if (!drag) return;
    const me = e as MouseEvent;
    if (typeof me.clientX !== "number") return;

    if (!drag.active) {
      const dx = Math.abs(me.clientX - drag.startX);
      const dy = Math.abs(me.clientY - drag.startY);
      if (dx < 4 && dy < 4) return;
      drag.active = true;
      drag.axis = dx >= dy ? "h" : "v";
      this.core.skeleton.root.classList.add("mach-root--filling");
    }

    if (drag.axis === "v") {
      const target = this.fillTargetRow(me);
      const end = this.rangeSelection.getEnd();
      if (end && end.row !== target) {
        const old = this.normalizedRange();
        this.rangeSelection.setEnd({ row: target, colIdx: end.colIdx });
        this.refreshRowRange(old, this.normalizedRange());
        this.core.emit("rangeSelectionChanged", { range: this.getRangeSelection() });
      }
      return;
    }

    const targetCol = Math.max(drag.c2 + 1, this.fillTargetCol(me));
    const end = this.rangeSelection.getEnd();
    if (end && end.colIdx !== targetCol) {
      const old = this.normalizedRange();
      this.rangeSelection.setEnd({ row: end.row, colIdx: targetCol });
      this.refreshRowRange(old, this.normalizedRange());
      this.updateFillHandle();
      this.core.emit("rangeSelectionChanged", { range: this.getRangeSelection() });
    }
  };

  private fillHorizontal(
    r1: number,
    r2: number,
    c1: number,
    c2: number,
    targetEnd: number
  ): void {
    const flat = this.core.columnModel.getOrderedVisible();
    const changedRows = new Set<number>();
    this.core.undoService.beginBatch();
    try {
      for (let r = r1; r <= r2; r++) {
        this.fillHorizontalRow(r, c1, c2, targetEnd, flat, changedRows);
      }
    } finally {
      this.core.undoService.endBatch();
    }

    if (changedRows.size > 0) {
      this.refreshRows([...changedRows]);
      this.core.summaryRenderer.refresh();
      this.core.emit("rangeSelectionChanged", { range: this.getRangeSelection() });
    }
  }

  private fillHorizontalRow(
    rowIndex: number,
    sourceStart: number,
    sourceEnd: number,
    targetEnd: number,
    columns: Column[],
    changedRows: Set<number>
  ): void {
    const node = this.core.rowModel.getDisplayedRow(rowIndex);
    if (!node || node.isDetail || node.isGroup) return;
    const sources: any[] = [];
    for (let index = sourceStart; index <= sourceEnd; index++) {
      const column = columns[index];
      sources.push(column ? this.core.getCellValue(node, column) : undefined);
    }
    const pattern = createFillPattern(sources);
    for (let index = sourceEnd + 1; index <= targetEnd; index++) {
      const column = columns[index];
      if (!isFillableColumn(column) || !this.core.editingService.isEditable(node, column)) continue;
      const value = fillPatternValue(pattern, index - sourceStart);
      const oldValue = this.core.getCellValue(node, column);
      if (this.core.setCellValue(node, column, value, oldValue)) changedRows.add(rowIndex);
    }
  }

  private onFillUp = (e: Event): void => {
    const drag = this.fillDrag;
    if (!drag) return;
    const me = e as MouseEvent;

    const finish = (): void => {
      this.cancelFillDrag();
    };

    if (!drag.active) {
      finish();
      return;
    }

    if (drag.axis === "h") {
      const targetCol =
        typeof me.clientX === "number" ? Math.max(drag.c2 + 1, this.fillTargetCol(me)) : drag.c2 + 1;
      finish();
      if (targetCol > drag.c2) {
        this.fillHorizontal(drag.r1, drag.r2, drag.c1, drag.c2, targetCol);
        this.updateFillHandle();
      } else {
        const end = this.rangeSelection.getEnd();
        if (!end || end.colIdx === drag.c2) return;
        const old = this.normalizedRange();
        this.rangeSelection.setEnd({ row: end.row, colIdx: drag.c2 });
        this.refreshRowRange(old, this.normalizedRange());
      }
      return;
    }

    const targetRow = typeof me.clientY === "number" ? this.fillTargetRow(me) : drag.r2;
    finish();
    if (targetRow > drag.r2) {
      this.fillValues(drag.r1, drag.r2, drag.c1, drag.c2, targetRow);
      this.updateFillHandle();
    } else {
      const end = this.rangeSelection.getEnd();
      if (!end || end.row === drag.r2) return;
      const old = this.normalizedRange();
      this.rangeSelection.setEnd({ row: drag.r2, colIdx: end.colIdx });
      this.refreshRowRange(old, this.normalizedRange());
    }
  };

  private fillValues(r1: number, r2: number, c1: number, c2: number, targetEnd: number): void {
    const flat = this.core.columnModel.getOrderedVisible();
    const changedRows = new Set<number>();
    this.core.undoService.beginBatch();
    try {
      this.fillValuesInner(r1, r2, c1, c2, targetEnd, flat, changedRows);
    } finally {
      this.core.undoService.endBatch();
    }

    if (changedRows.size > 0) {
      this.refreshRows([...changedRows]);
      this.core.summaryRenderer.refresh();
      this.core.emit("rangeSelectionChanged", { range: this.getRangeSelection() });
    }
  }

  private fillValuesInner(
    r1: number,
    r2: number,
    c1: number,
    c2: number,
    targetEnd: number,
    flat: Column[],
    changedRows: Set<number>
  ): void {
    for (let c = c1; c <= c2; c++) {
      const col = flat[c];
      if (!isFillableColumn(col)) continue;
      this.fillColumnDown(col, r1, r2, targetEnd, changedRows);
    }
  }

  private fillColumnDown(
    column: Column,
    sourceStart: number,
    sourceEnd: number,
    targetEnd: number,
    changedRows: Set<number>
  ): void {
    const values = this.verticalSourceValues(column, sourceStart, sourceEnd);
    if (values.length === 1 && values[0] === undefined) return;
    const pattern = createFillPattern(values);
    for (let rowIndex = sourceEnd + 1; rowIndex <= targetEnd; rowIndex++) {
      const node = this.core.rowModel.getDisplayedRow(rowIndex);
      if (!node || node.isDetail || node.isGroup) continue;
      if (!this.core.editingService.isEditable(node, column)) continue;
      const value = fillPatternValue(pattern, rowIndex - sourceStart);
      const oldValue = this.core.getCellValue(node, column);
      if (this.core.setCellValue(node, column, value, oldValue)) changedRows.add(rowIndex);
    }
  }

  private verticalSourceValues(column: Column, start: number, end: number): any[] {
    const values: any[] = [];
    for (let rowIndex = start; rowIndex <= end; rowIndex++) {
      const node = this.core.rowModel.getDisplayedRow(rowIndex);
      values.push(node ? this.core.getCellValue(node, column) : undefined);
    }
    return values;
  }

  setFocusedCell(rowIndex: number | null, colId: string | null): void {
    this.clearFocusClass();
    if (rowIndex == null || colId == null) {
      this.focusedCell = null;
      return;
    }
    this.focusedCell = { rowIndex, colId };
    this.applyFocusClass();
    this.ensureFocusedCellVisible();
  }

  private applyFocusClass(): void {
    if (!this.focusedCell) return;
    const cell = this.getCellElement(this.focusedCell.rowIndex, this.focusedCell.colId);
    if (cell) {
      const colIndex = Math.max(0, this.core.columnModel.getFlatIndex(this.focusedCell.colId));
      cell.id = `mach-grid-${this.core.gridId}-r${this.focusedCell.rowIndex}-c${colIndex}`;
      cell.classList.add("mach-cell--focus");
      this.core.skeleton.root.setAttribute("aria-activedescendant", cell.id);
    }
  }

  private clearFocusClass(): void {
    if (this.focusedCell) {
      const cell = this.getCellElement(this.focusedCell.rowIndex, this.focusedCell.colId);
      if (cell) {
        cell.classList.remove("mach-cell--focus");
        cell.removeAttribute("id");
      }
    }
    this.core.skeleton.root.removeAttribute("aria-activedescendant");
  }

  private ensureFocusedCellVisible(): void {
    if (!this.focusedCell) return;
    this.scrollToIndex(this.focusedCell.rowIndex, "nearest");

    const column = this.core.columnModel.getColumn(this.focusedCell.colId);
    if (!column || column.pinned) return;
    const viewport = this.core.skeleton.bodyViewports.center;
    const centerColumns = this.core.columnModel.getPaneColumns("center");
    this.columnViewport.update(centerColumns);
    const x = this.columnViewport.offsetAt(centerColumns.indexOf(column));
    const left = viewport.scrollLeft;
    const width = viewport.clientWidth;
    if (x < left) viewport.scrollLeft = x;
    else if (x + column.currentWidth > left + width) {
      viewport.scrollLeft = x + column.currentWidth - width;
    }
  }

  scrollToIndex(rowIndex: number, position: "top" | "bottom" | "middle" | "nearest" = "top"): void {
    const viewport = this.core.skeleton.bodyViewports.center;
    const rowCount = this.core.rowModel.getDisplayedRowCount();
    if (rowCount === 0) return;
    const index = clamp(rowIndex, 0, rowCount - 1);
    const viewportHeight = viewport.clientHeight;
    const scrollTop = viewport.scrollTop;
    const rowTop = this.rowTop(index);
    const rowBottom = this.rowTop(index + 1);

    let target = scrollTop;
    if (position === "top") {
      target = rowTop;
    } else if (position === "bottom") {
      target = rowBottom - viewportHeight;
    } else if (position === "middle") {
      target = rowTop - (viewportHeight - (rowBottom - rowTop)) / 2;
    } else {
      if (rowTop < scrollTop) target = rowTop;
      else if (rowBottom > scrollTop + viewportHeight) target = rowBottom - viewportHeight;
    }

    const maxScroll = Math.max(0, this.rowTop(rowCount) - viewportHeight);
    viewport.scrollTop = clamp(target, 0, maxScroll);
  }

  private setHoverIndex(index: number): void {
    if (this.hoverIndex === index) return;
    const prev = this.hoverIndex;
    this.hoverIndex = index;
    this.toggleHover(prev, false);
    this.toggleHover(index, true);
  }

  private toggleHover(index: number, hover: boolean): void {
    if (index < 0) return;
    const slot = this.pool[index % this.poolSize];
    if (!slot || slot.index !== index || slot.kind !== "master") return;
    for (const pane of PANES) {
      slot.rows[pane]?.classList.toggle("mach-row--hover", hover);
    }
  }

  focusGridRoot(): void {
    this.core.skeleton.root.focus({ preventScroll: true });
  }

  private resolveEventTarget(e: MouseEvent): { node: RowNode<any>; index: number; cellEl: HTMLElement | null } | null {
    const target = e.target as HTMLElement;
    const rowEl = target.closest<HTMLElement>(".mach-row");
    if (!rowEl) return null;
    const index = Number(rowEl.dataset.index);
    if (Number.isNaN(index)) return null;
    const node = this.core.rowModel.getDisplayedRow(index);
    if (!node) return null;
    const cellEl = target.closest<HTMLElement>(".mach-cell");
    return { node, index, cellEl };
  }

  private onBodyClick = (e: MouseEvent): void => {
    if (this.core.isDestroyed()) return;
    const resolved = this.resolveEventTarget(e);
    if (!resolved) return;
    const { node, index, cellEl } = resolved;
    const target = e.target as HTMLElement;
    if (this.handleGroupRowClick(target, node, cellEl)) return;
    if (this.handleTreeToggleClick(target, node, cellEl)) return;
    const colId = cellEl?.dataset.colId ?? "";
    const column = colId ? this.core.columnModel.getColumn(colId) : undefined;
    if (this.handleDetailToggleClick(node, column)) return;
    if (node.isDetail) return;
    if (this.handleSelectionCheckboxClick(target, node, index, e)) return;
    if (!cellEl || !column) return;
    this.focusGridRoot();
    if (!this.core.options.suppressCellFocus) this.setFocusedCell(index, colId);
    this.core.selectionService.onRowClick(node, e, false);
    this.emitCellClick(e, node, index, column);
    this.maybeStartSingleClickEdit(node, index, column);
  };

  private handleGroupRowClick(target: HTMLElement, node: RowNode<any>, cell: HTMLElement | null): boolean {
    if (!node.isGroup) return false;
    this.focusGridRoot();
    if (target.closest(".mach-row-checkbox")) {
      const selected = this.core.selectionService.getGroupSelectionState(node).all;
      this.core.selectionService.setGroupSelected(node, !selected);
      return true;
    }
    const labelColumn = this.core.columnModel.getGroupLabelColumn();
    if (!labelColumn || !cell || cell.dataset.colId === labelColumn.id) {
      this.core.rowModel.toggleGroup(node.id);
    }
    return true;
  }

  private handleDetailToggleClick(node: RowNode<any>, column: Column | undefined): boolean {
    if (!column?.isDetailToggle || node.isDetail) return false;
    this.focusGridRoot();
    this.core.toggleDetail(node.id);
    return true;
  }

  private handleSelectionCheckboxClick(
    target: HTMLElement,
    node: RowNode<any>,
    index: number,
    event: MouseEvent
  ): boolean {
    if (!target.closest(".mach-row-checkbox")) return false;
    this.focusGridRoot();
    if (!this.core.options.suppressCellFocus) this.setFocusedCell(index, this.firstCheckboxColId());
    this.core.selectionService.onRowClick(node, event, true);
    return true;
  }

  private emitCellClick(event: MouseEvent, node: RowNode<any>, index: number, column: Column): void {
    const value = this.core.getCellValue(node, column);
    const cellEvent = this.core.emit("cellClicked", {
      event,
      rowNode: node,
      rowIndex: index,
      column,
      colDef: column.colDef,
      value
    });
    column.colDef.onCellClick?.(cellEvent);
    this.core.emit("rowClicked", { event, rowNode: node, rowIndex: index });
  }

  private maybeStartSingleClickEdit(node: RowNode<any>, index: number, column: Column): void {
    const singleClick = this.core.options.singleClickEdit || column.colDef.singleClickEdit === true;
    if (singleClick && this.core.editingService.isEditable(node, column)) {
      this.core.editingService.start(index, column);
    }
  }

  private handleTreeToggleClick(target: HTMLElement, node: RowNode<any>, cell: HTMLElement | null): boolean {
    if (!this.core.rowModel.isTree || !target.closest(".mach-detail-toggle")) return false;
    const treeColumn = this.getTreeColumn();
    if (!treeColumn || cell?.dataset.colId !== treeColumn.id || !this.core.rowModel.isRowExpandable(node)) return false;
    this.focusGridRoot();
    if (node.treeLoadError) void this.core.rowModel.loadTreeChildren(node.id, true).catch(() => undefined);
    else this.core.rowModel.toggleDetail(node.id);
    return true;
  }

  private firstCheckboxColId(): string {
    for (const col of this.core.columnModel.getOrderedVisible()) {
      if (col.hasCheckbox) return col.id;
    }
    return this.core.columnModel.getOrderedVisible()[0]?.id ?? "";
  }

  private onBodyDblClick = (e: MouseEvent): void => {
    if (this.core.isDestroyed()) return;
    const resolved = this.resolveEventTarget(e);
    if (!resolved) return;
    const { node, index, cellEl } = resolved;
    if (node.isDetail || node.isGroup || !cellEl) return;
    const colId = cellEl.dataset.colId ?? "";
    const column = this.core.columnModel.getColumn(colId);
    if (!column) return;

    const value = this.core.getCellValue(node, column);
    const event = this.core.emit("cellDoubleClicked", {
      event: e,
      rowNode: node,
      rowIndex: index,
      column,
      colDef: column.colDef,
      value
    });
    column.colDef.onCellDoubleClick?.(event);
    this.core.emit("rowDoubleClicked", { event: e, rowNode: node, rowIndex: index });

    if (this.core.editingService.isEditable(node, column)) {
      this.core.editingService.start(index, column);
    }
  };

  private onContextMenu = (e: MouseEvent): void => {
    if (this.core.isDestroyed()) return;
    const resolved = this.resolveEventTarget(e);
    if (!resolved || resolved.node.isDetail || resolved.node.isGroup || !resolved.cellEl) return;
    const { node, index, cellEl } = resolved;
    const colId = cellEl.dataset.colId ?? "";
    const column = this.core.columnModel.getColumn(colId);
    if (!column) return;
    this.core.emit("cellContextMenu", {
      event: e,
      rowNode: node,
      rowIndex: index,
      column,
      colDef: column.colDef,
      value: this.core.getCellValue(node, column)
    });
    if (this.core.options.contextMenu) {
      e.preventDefault();
      if (this.core.options.enableRangeSelection && !this.normalizedRange()) {
        const colIdx = this.core.columnModel.getFlatIndex(colId);
        if (colIdx >= 0) this.startRange(index, colIdx, false);
      }
      this.core.contextMenuService.open(e.clientX, e.clientY, { rowIndex: index, colId });
    }
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (this.core.editingService.isCellEditing()) {
      this.core.editingService.stop(false);
    }
    if (this.core.options.enableRangeSelection && e.button === 0) {
      const resolved = this.resolveEventTarget(e);
      if (
        resolved &&
        !resolved.node.isDetail &&
        !resolved.node.isGroup &&
        resolved.cellEl &&
        !(e.target as HTMLElement).closest?.(".mach-row-checkbox")
      ) {
        const colIdx = this.core.columnModel.getFlatIndex(resolved.cellEl.dataset.colId ?? "");
        if (colIdx >= 0) {
          this.startRange(resolved.index, colIdx, e.shiftKey);
          this.rangeDragging = true;
          if (!e.shiftKey && !this.core.options.suppressCellFocus) {
            this.setFocusedCell(resolved.index, resolved.cellEl.dataset.colId ?? "");
          }
        }
      }
    }
  };

  private onWindowMouseUp = (): void => {
    this.rangeDragging = false;
  };

  private onMouseOver = (e: MouseEvent): void => {
    if (this.core.isDestroyed()) return;
    const resolved = this.resolveEventTarget(e);
    if (this.rangeDragging) {
      if (resolved && !resolved.node.isDetail && !resolved.node.isGroup && resolved.cellEl) {
        const colIdx = this.core.columnModel.getFlatIndex(resolved.cellEl.dataset.colId ?? "");
        const end = this.rangeSelection.getEnd();
        if (colIdx >= 0 && end && (end.row !== resolved.index || end.colIdx !== colIdx)) {
          this.startRange(resolved.index, colIdx, true);
        }
      }
    }
    if (this.core.options.suppressRowHoverHighlight) return;
    if (!resolved || resolved.node.isDetail) return;
    this.setHoverIndex(resolved.index);
  };

  private onMouseLeave = (): void => {
    this.setHoverIndex(-1);
  };

  private onDragHandlePointerDown = (e: PointerEvent): void => {
    if (this.core.isDestroyed() || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (!target.closest(".mach-row-drag-handle")) return;
    const resolved = this.resolveEventTarget(e);
    if (!resolved || resolved.node.isDetail || resolved.node.isGroup) return;

    this.rowDragController.start(e, resolved.node);
    e.preventDefault();
  };
}
