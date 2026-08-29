import type { GridCore } from "../core/gridCore";
import type { PaneType } from "../services/columnModel";
import type { Column } from "../services/column";
import type { RowNode } from "../types/row";
import { RangeSelectionModel, type NormalizedRange } from "../services/rangeSelectionModel";
import { RowDragController } from "../services/rowDragController";
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
  | "columnModel"
  | "contextMenuService"
  | "editingService"
  | "emit"
  | "getApi"
  | "getCellValue"
  | "gridId"
  | "isDestroyed"
  | "options"
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

export interface FocusedCell {
  rowIndex: number;
  colId: string;
}

function lowerBound(positions: Float64Array, y: number, count: number): number {
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (positions[mid + 1] <= y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export class BodyRenderer {
  private pool: RowSlot[] = [];
  private poolSize = 0;
  private first = 0;
  private lastExcl = -1;
  private rafId = 0;
  private hoverIndex = -1;
  private positions = new Float64Array(1);
  private rangeSelection = new RangeSelectionModel();
  private rangeDragging = false;
  private colFirst = 0;
  private colLastExcl = Number.MAX_SAFE_INTEGER;
  focusedCell: FocusedCell | null = null;
  private rowDragController: RowDragController;

  constructor(private core: BodyContext) {
    this.rowDragController = new RowDragController(core, () => this.positions);
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

  private positionsBuf = new Float64Array(new ArrayBuffer(64 * 8));
  private lastMinRowHeight = 0;
  private rowHeightCache = new WeakMap<RowNode<any>, number>();
  private pendingFlash: Array<[number, string]> = [];
  private measureCanvas: HTMLCanvasElement | null = null;

  applyContainerSizes(): void {
    const sk = this.core.skeleton;
    const widths = this.paneWidths();
    const viewport = sk.bodyViewports.center;
    const displayed = this.core.rowModel.getDisplayedRows();
    const rowCount = this.core.rowModel.getDisplayTotalCount();
    const positionedCount = Math.min(rowCount, displayed.length);
    const rowHeight = this.core.options.rowHeight;
    const detailHeight = this.core.options.detailRowHeight;
    const getRowHeight = this.core.options.getRowHeight;
    const api = this.core.getApi();

    if (this.positionsBuf.length < positionedCount + 1) {
      let cap = this.positionsBuf.length;
      while (cap < positionedCount + 1) cap *= 2;
      this.positionsBuf = new Float64Array(new ArrayBuffer(cap * 8));
    }
    const positions = this.positionsBuf;
    const autoHeightCols = this.core.options.masterDetail ? [] : this.collectAutoHeightColumns();
    let y = 0;
    let minH = rowHeight;
    for (let i = 0; i < positionedCount; i++) {
      positions[i] = y;
      const node = i < displayed.length ? displayed[i] : undefined;
      let h: number;
      if (node?.isDetail) {
        h = detailHeight;
      } else if (node && (getRowHeight || autoHeightCols.length > 0)) {
        const cached = this.rowHeightCache.get(node);
        if (cached !== undefined) {
          h = cached;
        } else {
          h = rowHeight;
          if (getRowHeight) {
            try {
              const requested = getRowHeight({ data: node.data, node, api });
              h = Number.isFinite(requested) ? Math.max(1, requested || rowHeight) : rowHeight;
            } catch (error) {
              this.core.reportError(error, "getRowHeight", { rowId: node.id });
            }
          }
          if (autoHeightCols.length > 0) {
            const measured = this.measureAutoHeight(node, autoHeightCols);
            if (measured > h) h = measured;
          }
          this.rowHeightCache.set(node, h);
        }
        if (h < minH) minH = h;
      } else {
        h = rowHeight;
      }
      y += h;
    }
    positions[positionedCount] = y;
    const totalHeight = y + Math.max(0, rowCount - positionedCount) * rowHeight;
    this.lastMinRowHeight = minH;
    this.positions = positions.subarray(0, positionedCount + 1);

    const centerAvailable = Math.max(0, viewport.clientWidth - widths.left - widths.right);
    const centerWidth = Math.max(widths.center, centerAvailable);

    for (const pane of PANES) {
      const container = sk.rowContainers[pane];
      container.style.height = `${totalHeight}px`;
      if (pane === "center") container.style.width = `${centerWidth}px`;
    }

    sk.root.setAttribute("aria-rowcount", String(rowCount + sk.getHeaderRowCount()));
  }

  invalidateRowHeight(node: RowNode<any>): void {
    this.rowHeightCache.delete(node);
  }

  invalidateAllRowHeights(): void {
    this.rowHeightCache = new WeakMap();
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
    const needed = visible + this.core.options.rowBuffer * 2 + 1;
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
    const variableHeights =
      this.core.options.masterDetail ||
      this.core.options.getRowHeight != null ||
      this.hasAnyAutoHeight;
    for (const pane of PANES) {
      const allPaneCols = this.core.columnModel.getPaneColumns(pane);
      const cols = this.activePaneColumns(pane);
      let x = 0;
      const lefts: number[] = [];
      if (pane === "center" && cols.length > 0) {
        const first = allPaneCols.indexOf(cols[0]);
        for (let i = 0; i < first; i++) x += allPaneCols[i].currentWidth;
      }
      for (const col of cols) {
        lefts.push(x);
        x += col.currentWidth;
      }
      for (const slot of this.pool) {
        const cells = slot.cells[pane];
        const row = slot.rows[pane];
        if (!cells || !row) continue;
        if (!variableHeights) {
          row.style.height = `${this.core.options.rowHeight}px`;
        }
        for (let i = 0; i < cols.length && i < cells.length; i++) {
          cells[i].style.width = `${cols[i].currentWidth}px`;
          cells[i].style.left = `${lefts[i]}px`;
          cells[i].setAttribute("aria-colindex", String(this.core.columnModel.getFlatIndex(cols[i].id) + 1));
        }
      }
      if (this.core.options.masterDetail) {
        for (const slot of this.pool) {
          slot.detailRow?.style.setProperty("--mach-detail-h", `${this.core.options.detailRowHeight}px`);
        }
      }
    }
  }

  private computeColWindow(): boolean {
    const viewport = this.core.skeleton.bodyViewports.center;
    const cols = this.core.columnModel.getPaneColumns("center");
    const prevFirst = this.colFirst;
    const prevLast = this.colLastExcl;
    let first = 0;
    let last = cols.length;

    if (cols.length > 20) {
      const width = viewport.clientWidth;
      let total = 0;
      for (const col of cols) total += col.currentWidth;
      if (width > 0 && total > width) {
        const scrollLeft = viewport.scrollLeft;
        let x = 0;
        for (let i = 0; i < cols.length; i++) {
          if (x + cols[i].currentWidth <= scrollLeft) first = i + 1;
          else break;
          x += cols[i].currentWidth;
        }
        let acc = x;
        for (let i = first; i < cols.length; i++) {
          acc += cols[i].currentWidth;
          if (acc >= scrollLeft + width) {
            last = i + 1;
            break;
          }
        }
        if (last > cols.length) last = cols.length;
        first = Math.max(0, first - 2);
        last = Math.min(cols.length, last + 2);
      }
    }

    this.colFirst = first;
    this.colLastExcl = last;
    return first !== prevFirst || last !== prevLast;
  }

  updateRange(force = false): void {
    const viewport = this.core.skeleton.bodyViewports.center;
    const rowCount = this.core.rowModel.getDisplayedRowCount();
    const buffer = this.core.options.rowBuffer;
    const colWindowChanged = this.computeColWindow();
    if (colWindowChanged) {
      for (const slot of this.pool) this.reconcilePaneCells(slot, "center");
      this.applyCellLayout();
    }

    if (rowCount === 0) {
      for (const slot of this.pool) this.hideSlot(slot);
      this.first = 0;
      this.lastExcl = 0;
      return;
    }

    const scrollTop = viewport.scrollTop;
    const viewBottom = scrollTop + viewport.clientHeight;
    const firstVisible = lowerBound(this.positions, scrollTop, rowCount);
    let lastVisible = lowerBound(this.positions, viewBottom, rowCount) + 1;
    if (lastVisible > rowCount) lastVisible = rowCount;

    const first = clamp(firstVisible - buffer, 0, rowCount - 1);
    const lastExcl = clamp(lastVisible + buffer, 1, rowCount);

    if (!force && first === this.first && lastExcl === this.lastExcl) return;
    this.first = first;
    this.lastExcl = lastExcl;

    for (const slot of this.pool) {
      if (slot.index !== -1 && (slot.index < first || slot.index >= lastExcl)) {
        this.hideSlot(slot);
      }
    }

    for (let i = first; i < lastExcl; i++) {
      const node = this.core.rowModel.getDisplayedRow(i);
      const slot = this.pool[i % this.poolSize];
      if (!slot || !node) continue;
      if (!force && slot.index === i && slot.nodeId === node.id) {
        if (colWindowChanged && slot.kind === "master") {
          this.renderPaneCells(slot, node, "center");
        }
        continue;
      }
      this.assignSlot(slot, i);
    }
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
    const y = this.positions[index];
    const h = this.positions[index + 1] - this.positions[index];

    if (node.isDetail) {
      slot.kind = "detail";
      for (const pane of PANES) {
        const row = slot.rows[pane];
        if (row) row.style.display = "none";
      }
      const detailRow = slot.detailRow;
      if (detailRow) {
        detailRow.style.display = "";
        detailRow.style.transform = `translateY(${y}px)`;
        detailRow.style.height = `${h}px`;
        detailRow.dataset.index = String(index);
        detailRow.setAttribute("aria-rowindex", String(index + this.core.skeleton.getHeaderRowCount() + 1));
        this.renderDetailContent(detailRow, node);
      }
      return;
    }

    slot.kind = "master";
    if (slot.detailRow) slot.detailRow.style.display = "none";

    const isTreeRow = this.core.rowModel.isTree;
    const isGroupRow = node.isGroup === true;
    const hasTreeChildren = isTreeRow && this.core.rowModel.hasChildren(node.id);
    const isExpandable = isGroupRow || hasTreeChildren ||
      (this.core.options.masterDetail && this.core.rowModel.isRowExpandable(node));
    const expanded = isGroupRow
      ? this.core.rowModel.isGroupExpanded(node.id)
      : this.core.rowModel.isRowExpanded(node.id);
    const level = isGroupRow
      ? (node.groupLevel ?? 0) + 1
      : isTreeRow
        ? this.core.rowModel.getTreeDepth(node) + 1
        : null;

    for (const pane of PANES) {
      const row = slot.rows[pane];
      if (!row) continue;
      row.style.display = "";
      row.style.transform = `translateY(${y}px)`;
      row.style.height = `${h}px`;
      row.dataset.index = String(index);
      row.dataset.id = node.id;
      row.setAttribute("aria-rowindex", String(index + this.core.skeleton.getHeaderRowCount() + 1));
      row.classList.toggle("mach-row--selected", node.selected);
      row.classList.toggle("mach-row--hover", this.hoverIndex === index && !this.core.options.suppressRowHoverHighlight);
      row.classList.toggle("mach-row--odd", index % 2 === 1);
      row.setAttribute("aria-selected", node.selected ? "true" : "false");
      if (isExpandable) row.setAttribute("aria-expanded", expanded ? "true" : "false");
      else row.removeAttribute("aria-expanded");
      if (level != null) row.setAttribute("aria-level", String(level));
      else row.removeAttribute("aria-level");

      this.renderPaneCells(slot, node, pane);
    }

    if (this.focusedCell && this.focusedCell.rowIndex === index) {
      this.applyFocusClass();
    }
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
    cleanupCellContent(this.core, cell);
    cell.setAttribute("aria-readonly", this.core.editingService.isEditable(node, column) ? "false" : "true");
    cell.removeAttribute("aria-expanded");
    cell.removeAttribute("aria-level");
    if (node.isGroup) {
      this.renderGroupCell(cell, node, column);
      return;
    }
    if (column.isDetailToggle) {
      const expanded = this.core.rowModel.isRowExpanded(node.id);
      const toggle = el("span", `mach-detail-toggle${expanded ? " mach-detail-toggle--open" : ""}`);
      toggle.textContent = "▶";
      cell.replaceChildren(toggle);
      cell.classList.add("mach-cell--detail-toggle");
      this.resetSpanStyle(cell);
      return;
    }
    if (column.hasCheckbox) {
      const input = cell.querySelector<HTMLInputElement>(".mach-row-checkbox");
      if (input) {
        input.checked = node.selected;
        input.indeterminate = this.core.selectionService.isIndeterminate(node.id);
        input.disabled = !this.core.selectionService.isSelectable(node);
      }
      if (cell.className !== "mach-cell mach-cell--selection") cell.className = "mach-cell mach-cell--selection";
      this.resetSpanStyle(cell);
      return;
    }
    if (column.colDef.rowDrag) {
      const handle = el("span", "mach-row-drag-handle");
      handle.textContent = "⠿";
      cell.replaceChildren(handle);
      if (cell.className !== "mach-cell mach-cell--drag") cell.className = "mach-cell mach-cell--drag";
      this.resetSpanStyle(cell);
      return;
    }
    if (column.colDef.type === "index" && !node.isDetail) {
      cell.textContent = String(this.core.rowModel.getRowSeq(node) + this.core.options.indexOffset);
      if (cell.className !== "mach-cell mach-cell--index") cell.className = "mach-cell mach-cell--index";
      this.applyCellSpanStyle(cell, node, column);
      return;
    }
    if (this.core.rowModel.isTree && this.getTreeColumn()?.id === column.id) {
      this.renderTreeCell(cell, node, column);
      return;
    }
    renderCellContent(this.core, cell, node, column);
    applyCellClasses(this.core, cell, node, column);
    applyCellStyle(this.core, cell, node, column);
    this.applyCellSpanStyle(cell, node, column);
    this.appendEditableIndicator(cell, node, column);
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
        (c) => !c.hasCheckbox && !c.isDetailToggle && !c.colDef.rowDrag && c.colDef.type !== "index"
      ) ?? null;
    return this.treeColumnCache;
  }

  private renderTreeCell(cell: HTMLElement, node: RowNode<any>, column: Column): void {
    const hasChildren = this.core.rowModel.hasChildren(node.id);
    const depth = this.getNodeDepth(node);
    const indent = el("span", "mach-tree-indent");
    indent.style.width = `${depth * 16}px`;
    const wrap = el("span", "mach-tree-cell");
    wrap.appendChild(indent);
    if (hasChildren) {
      const expanded = this.core.rowModel.isRowExpanded(node.id);
      cell.setAttribute("aria-expanded", expanded ? "true" : "false");
      cell.setAttribute("aria-level", String(depth + 1));
      const toggle = el("span", `mach-detail-toggle${expanded ? " mach-detail-toggle--open" : ""}`);
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
      const end = Math.min(idx + value, this.positions.length - 1);
      const height = this.positions[end] - this.positions[idx];
      cell.style.height = `${height > 0 ? height : value * this.core.options.rowHeight}px`;
      cell.style.zIndex = "1";
      cell.setAttribute("aria-rowspan", String(value));
    } else {
      this.resetSpanStyle(cell);
    }
  }

  private renderGroupCell(cell: HTMLElement, node: RowNode<any>, column: Column): void {
    const base = "mach-cell";
    if (column.hasCheckbox) {
      const input = cell.querySelector<HTMLInputElement>(".mach-row-checkbox");
      if (input) {
        const state = this.core.selectionService.getGroupSelectionState(node);
        input.checked = state.all;
        input.indeterminate = state.some && !state.all;
      }
      if (cell.className !== `${base} mach-cell--selection`) cell.className = `${base} mach-cell--selection`;
      return;
    }
    if (column.isDetailToggle) {
      cell.textContent = "";
      if (cell.className !== base) cell.className = base;
      return;
    }
    const labelCol = this.core.columnModel.getGroupLabelColumn();
    if (labelCol && column.id === labelCol.id) {
      cell.setAttribute("aria-expanded", this.core.rowModel.isGroupExpanded(node.id) ? "true" : "false");
      cell.setAttribute("aria-level", String((node.groupLevel ?? 0) + 1));
      const wrap = el("span", "mach-group-label");
      wrap.style.paddingLeft = `${(node.groupLevel ?? 0) * 16}px`;
      const toggle = el("span", `mach-detail-toggle${this.core.rowModel.isGroupExpanded(node.id) ? " mach-detail-toggle--open" : ""}`);
      toggle.textContent = "▶";
      const text = el("span", "mach-group-text");
      const groupCol = this.core.columnModel.getRowGroupColumns()[node.groupLevel ?? 0];
      const prefix = groupCol?.colDef.headerName ? `${groupCol.colDef.headerName}: ` : "";
      text.textContent = `${prefix}${node.groupKey ?? ""}`;
      const count = el("span", "mach-group-count");
      count.textContent = `(${node.leafNodes?.length ?? 0})`;
      wrap.append(toggle, text, count);
      cell.replaceChildren(wrap);
      if (cell.className !== `${base} mach-cell--group`) cell.className = `${base} mach-cell--group`;
      return;
    }
    if (column.colDef.aggFunc && node.aggValues && Object.prototype.hasOwnProperty.call(node.aggValues, column.id)) {
      const value = node.aggValues[column.id];
      const formatted =
        column.colDef.valueFormatter != null
          ? formatCellValueWith(this.core, node, column, value)
          : defaultFormat(value);
      cell.textContent = formatted;
      if (cell.className !== `${base} mach-cell--num`) cell.className = `${base} mach-cell--num`;
      return;
    }
    cell.textContent = "";
    if (cell.className !== base) cell.className = base;
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
    if (this.core.isDestroyed()) return;
    for (const slot of this.pool) {
      if (slot.index < 0) continue;
      const node = this.core.rowModel.getDisplayedRow(slot.index);
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
      this.onFillHandleDown(e as unknown as MouseEvent);
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
    let x = 0;
    for (let i = 0; i <= local && i < centerCols.length; i++) x += centerCols[i].currentWidth;
    const bottom = this.positions[Math.min(range.r2 + 1, this.positions.length - 1)] ?? (range.r2 + 1) * this.core.options.rowHeight;
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
    const row = lowerBound(this.positions, y, rowCount);
    return Math.max(this.fillDrag!.r2, Math.min(row, rowCount - 1));
  }

  private fillTargetCol(e: MouseEvent): number {
    const container = this.core.skeleton.rowContainers.center;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const cm = this.core.columnModel;
    const leftCount = cm.getPaneColumns("left").length;
    const centerCols = cm.getPaneColumns("center");
    let acc = 0;
    for (let i = 0; i < centerCols.length; i++) {
      if (x < acc + centerCols[i].currentWidth / 2) return leftCount + i;
      acc += centerCols[i].currentWidth;
    }
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
        const srcNode = this.core.rowModel.getDisplayedRow(r);
        if (!srcNode || srcNode.isDetail || srcNode.isGroup) continue;
        const sources: any[] = [];
        for (let c = c1; c <= c2; c++) {
          const col = flat[c];
          sources.push(col ? this.core.getCellValue(srcNode, col) : undefined);
        }
        const n = c2 - c1 + 1;
        const allNumeric =
          n > 1 && sources.every((v) => typeof v === "number" && !isNaN(v));
        const diff = allNumeric ? (sources[n - 1] - sources[0]) / (n - 1) : 0;
        const intPattern =
          !allNumeric || sources.every((v) => Number.isInteger(v));

        for (let t = c2 + 1; t <= targetEnd; t++) {
          const col = flat[t];
          if (!col || col.hasCheckbox || col.isDetailToggle || col.colDef.rowDrag) continue;
          if (!this.core.editingService.isEditable(srcNode, col)) continue;
          const colOffset = t - c1;
          let value: any;
          if (n === 1) {
            value = sources[0];
          } else if (allNumeric) {
            const steps = colOffset - (n - 1);
            value = sources[n - 1] + diff * steps;
            value = intPattern ? Math.round(value) : Math.round(value * 1e6) / 1e6;
          } else {
            value = sources[colOffset % n];
          }
          const old = this.core.getCellValue(srcNode, col);
          if (this.core.setCellValue(srcNode, col, value, old)) changedRows.add(r);
        }
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
      if (!col || col.hasCheckbox || col.isDetailToggle || col.colDef.rowDrag) continue;

      const sources: any[] = [];
      let allNumeric = r1 < r2;
      for (let r = r1; r <= r2; r++) {
        const node = this.core.rowModel.getDisplayedRow(r);
        if (!node) {
          allNumeric = false;
          sources.push(undefined);
          continue;
        }
        const v = this.core.getCellValue(node, col);
        sources.push(v);
        if (typeof v !== "number" || isNaN(v)) allNumeric = false;
      }
      if (sources[0] === undefined && sources.length === 1) continue;

      const n = r2 - r1 + 1;
      let diff = 0;
      let intPattern = true;
      if (allNumeric) {
        diff = (sources[n - 1] - sources[0]) / (n - 1);
        for (const v of sources) if (!Number.isInteger(v)) intPattern = false;
      }

      for (let r = r2 + 1; r <= targetEnd; r++) {
        const node = this.core.rowModel.getDisplayedRow(r);
        if (!node || node.isDetail || node.isGroup) continue;
        if (!this.core.editingService.isEditable(node, col)) continue;
        let value: any;
        if (n === 1) {
          value = sources[0];
        } else if (allNumeric) {
          const steps = r - r2;
          value = sources[n - 1] + diff * steps;
          value = intPattern ? Math.round(value) : Math.round(value * 1e6) / 1e6;
        } else {
          value = sources[(r - r1) % n];
        }
        const old = this.core.getCellValue(node, col);
        if (this.core.setCellValue(node, col, value, old)) changedRows.add(r);
      }
    }
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
    let x = 0;
    for (const col of this.core.columnModel.getPaneColumns("center")) {
      if (col.id === column.id) break;
      x += col.currentWidth;
    }
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
    const rowTop = this.positions[index];
    const rowBottom = this.positions[index + 1];

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

    const maxScroll = Math.max(0, this.positions[rowCount] - viewportHeight);
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

    if (node.isGroup) {
      this.focusGridRoot();
      const checkbox = (e.target as HTMLElement).closest?.(".mach-row-checkbox");
      if (checkbox) {
        this.core.selectionService.setGroupSelected(node, !this.core.selectionService.getGroupSelectionState(node).all);
        return;
      }
      const labelCol = this.core.columnModel.getGroupLabelColumn();
      if (!labelCol || !cellEl || cellEl.dataset.colId === labelCol.id) {
        this.core.rowModel.toggleGroup(node.id);
      }
      return;
    }

    const target = e.target as HTMLElement;

    if (this.core.rowModel.isTree) {
      const treeCol = this.getTreeColumn();
      if (treeCol && cellEl?.dataset.colId === treeCol.id && target.closest(".mach-detail-toggle")) {
        if (this.core.rowModel.hasChildren(node.id)) {
          this.focusGridRoot();
          this.core.rowModel.toggleDetail(node.id);
          return;
        }
      }
    }

    const colId = cellEl?.dataset.colId ?? "";
    const column = colId ? this.core.columnModel.getColumn(colId) : undefined;

    if (column?.isDetailToggle && !node.isDetail) {
      this.focusGridRoot();
      this.core.toggleDetail(node.id);
      return;
    }

    if (node.isDetail) return;

    if (target.closest?.(".mach-row-checkbox")) {
      this.focusGridRoot();
      if (!this.core.options.suppressCellFocus) this.setFocusedCell(index, this.firstCheckboxColId());
      this.core.selectionService.onRowClick(node, e, true);
      return;
    }

    if (!cellEl || !column) return;

    this.focusGridRoot();
    if (!this.core.options.suppressCellFocus) this.setFocusedCell(index, colId);
    this.core.selectionService.onRowClick(node, e, false);

    const value = this.core.getCellValue(node, column);
    const event = this.core.emit("cellClicked", {
      event: e,
      rowNode: node,
      rowIndex: index,
      column,
      colDef: column.colDef,
      value
    });
    column.colDef.onCellClick?.(event);
    this.core.emit("rowClicked", { event: e, rowNode: node, rowIndex: index });

    const singleClick = this.core.options.singleClickEdit || column.colDef.singleClickEdit === true;
    if (singleClick && !node.isGroup && this.core.editingService.isEditable(node, column)) {
      this.core.editingService.start(index, column);
    }
  };

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
    const resolved = this.resolveEventTarget(e as unknown as MouseEvent);
    if (!resolved || resolved.node.isDetail || resolved.node.isGroup) return;

    this.rowDragController.start(e, resolved.node);
    e.preventDefault();
  };
}
