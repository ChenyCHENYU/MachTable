import type { GridCore } from "../core/gridCore";
import type { Column } from "../services/column";
import { ColumnGroup } from "../services/columnGroup";
import type { PaneType } from "../services/columnModel";
import { COLUMN_TOOLS_ICON, el, FILTER_ICON, SORT_ASC_ICON, SORT_DESC_ICON } from "../lib/dom";
import { describeFilter } from "../lib/filterSummary";
import { setRendererDestroyer, takeRendererDestroyer } from "./runtimeState";
import { ColumnViewportIndex } from "../services/columnViewportIndex";
import { PANES } from "./skeleton";

type HeaderContext = Pick<
  GridCore<any>,
  | "columnDragService"
  | "columnMenu"
  | "columnModel"
  | "columnSizing"
  | "commitColumnWidths"
  | "cycleSort"
  | "emit"
  | "filterPopup"
  | "api"
  | "getLocaleText"
  | "isDisposed"
  | "moveColumn"
  | "gridOptions"
  | "relayoutColumns"
  | "reportError"
  | "resizeService"
  | "rowModel"
  | "selectionService"
  | "skeleton"
>;

interface HeaderCell {
  column: Column;
  el: HTMLElement;
  sortEl: HTMLElement;
  filterBtn?: HTMLButtonElement;
  filterTagEl?: HTMLElement;
  selectAllEl?: HTMLInputElement;
}

interface GroupCell {
  group: ColumnGroup<any>;
  el: HTMLElement;
  pane: PaneType;
}

type HeaderComponentOutput = string | HTMLElement | { el: HTMLElement; destroy?: () => void } | null | undefined;

const HEADER_CONTROL_SELECTOR = ".mach-header-resize, .mach-filter-btn, .mach-menu-btn, .mach-select-all";

function isHeaderControl(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest(HEADER_CONTROL_SELECTOR) != null;
}

function isHorizontalArrow(key: string): boolean {
  return key === "ArrowLeft" || key === "ArrowRight";
}

function applyHeaderClass(cell: HTMLElement, headerClass: string | string[] | undefined): void {
  if (typeof headerClass === "string") cell.classList.add(headerClass);
  else if (Array.isArray(headerClass)) cell.classList.add(...headerClass);
}

/** @internal Header callbacks receive public parameters, never the rendering service. */
export class HeaderRenderer {
  private leafCells: HeaderCell[] = [];
  private groupCells: GroupCell[] = [];
  private columnViewport = new ColumnViewportIndex();
  private centerFirst = 0;
  private centerLastExcl = Number.MAX_SAFE_INTEGER;

  constructor(private core: HeaderContext) {}

  build(): void {
    this.updateColumnWindowState();
    this.core.resizeService.cancelResize();
    this.clearCells(false);
    const model = this.core.columnModel;
    const depth = model.getHeaderDepth();
    this.core.skeleton.setHeaderRowCount(depth);

    const activeCenter = new Set(model.getPaneColumns("center").slice(this.centerFirst, this.centerLastExcl));
    const roots = model.getRootChildren();
    const perRowHeight = this.core.gridOptions.headerHeight;
    for (const pane of PANES) {
      const rows = this.core.skeleton.headerRows[pane];
      for (const row of rows) row.textContent = "";
      const append = (children: (ColumnGroup<any> | Column<any>)[], level: number): void => {
        const row = rows[Math.min(level, rows.length - 1)];
        for (const child of children) {
          if (child instanceof ColumnGroup) {
            const count = this.leafCells.length;
            append(child.children, level + 1);
            if (this.leafCells.length === count) continue;
            const cell = this.createGroupCell(child);
            row.appendChild(cell);
            this.groupCells.push({ group: child, el: cell, pane });
          } else if (!child.hide && model.paneOf(child) === pane && (pane !== "center" || activeCenter.has(child))) {
            const cell = this.createLeafCell(child, depth - level, perRowHeight);
            row.appendChild(cell.el);
            this.leafCells.push(cell);
          }
        }
      };
      append(roots, 0);
    }

    if (!this.core.gridOptions.suppressHeaderFocus) {
      this.leafCells.forEach((cell, index) => {
        cell.el.tabIndex = index === 0 ? 0 : -1;
      });
    }

    this.applyLayout();
    this.refreshSortIndicators();
    this.refreshFilterIcons();
    this.refreshSelectAllCheckbox();
  }

  updateColumnWindow(): void {
    const previousFirst = this.centerFirst;
    const previousLast = this.centerLastExcl;
    this.updateColumnWindowState();
    if (previousFirst !== this.centerFirst || previousLast !== this.centerLastExcl) this.build();
  }

  private updateColumnWindowState(): void {
    const columns = this.core.columnModel.getPaneColumns("center");
    const viewport = this.core.skeleton.bodyViewports.center;
    this.columnViewport.update(columns);
    const range = columns.length > 20
      ? this.columnViewport.visibleRange(viewport.scrollLeft, viewport.clientWidth, 2)
      : { first: 0, lastExcl: columns.length };
    this.centerFirst = range.first;
    this.centerLastExcl = range.lastExcl;
  }

  private createLeafCell(column: Column, rowSpan: number, perRowHeight: number): HeaderCell {
    const cellEl = el("div", "mach-header-cell mach-header-cell--leaf");
    if (column.hasCheckbox) cellEl.classList.add("mach-header-cell--selection");
    cellEl.dataset.colId = column.id;
    cellEl.setAttribute("role", "columnheader");
    cellEl.style.height = `${rowSpan * perRowHeight}px`;
    this.applyLeafPresentation(cellEl, column);
    this.attachHeaderFocus(cellEl, column);

    const selectAllEl = this.appendSelectAll(cellEl, column);
    this.appendHeaderContent(cellEl, column);
    const sortEl = el("span", "mach-sort-indicator");
    cellEl.appendChild(sortEl);
    const { filterBtn, filterTagEl } = this.appendFilterControls(cellEl, column);
    this.appendColumnMenu(cellEl, column);
    this.appendResizeHandle(cellEl, column);
    this.attachLeafInteractions(cellEl, column);
    return { column, el: cellEl, sortEl, filterBtn, filterTagEl, selectAllEl };
  }

  private applyLeafPresentation(cellEl: HTMLElement, column: Column): void {
    const colDef = column.colDef;
    applyHeaderClass(cellEl, colDef.headerClass);
    if (colDef.headerTooltip) cellEl.setAttribute("title", colDef.headerTooltip);
    const headerAlign = colDef.headerAlign ?? colDef.align;
    if (headerAlign === "center") cellEl.classList.add("mach-header-cell--center");
    else if (headerAlign === "right") cellEl.classList.add("mach-header-cell--right");
  }

  private attachHeaderFocus(cellEl: HTMLElement, column: Column): void {
    if (this.core.gridOptions.suppressHeaderFocus) return;
    cellEl.tabIndex = -1;
    cellEl.addEventListener("mousedown", () => this.focusHeaderCell(column));
    cellEl.addEventListener("keydown", (event: KeyboardEvent) => this.onHeaderKeyDown(event, column));
  }

  private appendSelectAll(cellEl: HTMLElement, column: Column): HTMLInputElement | undefined {
    if (!column.hasCheckbox || this.core.gridOptions.rowSelection !== "multiple") return undefined;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "mach-select-all";
    checkbox.setAttribute("aria-label", "select all rows");
    checkbox.addEventListener("click", (event) => event.stopPropagation());
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) this.core.selectionService.selectAll(true);
      else this.core.selectionService.deselectAll();
    });
    cellEl.appendChild(checkbox);
    return checkbox;
  }

  private appendHeaderContent(cellEl: HTMLElement, column: Column): void {
    const colDef = column.colDef;
    let output: HeaderComponentOutput;
    try {
      output = colDef.headerComponent?.({ colDef, column, api: this.core.api });
    } catch (error) {
      this.core.reportError(error, "headerComponent", { colId: column.id });
      output = null;
    }
    if (output instanceof HTMLElement) output = { el: output };
    const label = el("span", "mach-header-label");
    if (output && typeof output === "object" && output.el instanceof HTMLElement) {
      label.classList.add("mach-header-label--custom");
      label.appendChild(output.el);
      setRendererDestroyer(cellEl, output.destroy);
    } else label.textContent = typeof output === "string" ? output : colDef.headerName ?? colDef.field ?? column.id;
    cellEl.appendChild(label);
  }

  private appendFilterControls(
    cellEl: HTMLElement,
    column: Column
  ): Pick<HeaderCell, "filterBtn" | "filterTagEl"> {
    if (!column.filterable) return {};
    const filterBtn = document.createElement("button");
    filterBtn.type = "button";
    filterBtn.className = "mach-filter-btn";
    filterBtn.setAttribute("aria-label", `filter ${column.id}`);
    filterBtn.innerHTML = FILTER_ICON;
    filterBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      this.core.filterPopup.toggle(column, filterBtn);
    });
    cellEl.appendChild(filterBtn);
    const filterTagEl = el("span", "mach-filter-tag");
    cellEl.appendChild(filterTagEl);
    return { filterBtn, filterTagEl };
  }

  private appendColumnMenu(cellEl: HTMLElement, column: Column): void {
    if (!this.core.gridOptions.columnMenu || column.hasCheckbox || column.colDef.suppressColumnMenu) return;
    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "mach-menu-btn";
    const label = column.colDef.headerName ?? column.colDef.field ?? column.id;
    const title = `${label} · ${this.core.getLocaleText("columnSettings")}`;
    menuBtn.setAttribute("aria-label", title);
    menuBtn.title = title;
    menuBtn.innerHTML = COLUMN_TOOLS_ICON;
    menuBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      this.core.columnMenu.toggle(column, menuBtn);
    });
    cellEl.appendChild(menuBtn);
  }

  private appendResizeHandle(cellEl: HTMLElement, column: Column): void {
    if (!this.canResizeColumn(column)) return;
    const resizeEl = el("div", "mach-header-resize");
    resizeEl.setAttribute("aria-hidden", "true");
    resizeEl.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      this.core.resizeService.startResize(event, column);
    });
    resizeEl.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      this.core.api.columns.autoSize(column.id);
    });
    resizeEl.addEventListener("click", (event) => event.stopPropagation());
    cellEl.appendChild(resizeEl);
  }

  private attachLeafInteractions(cellEl: HTMLElement, column: Column): void {
    cellEl.addEventListener("click", (event) => {
      if (this.core.columnDragService.didDrag() || isHeaderControl(event.target)) return;
      if (column.sortable) this.core.cycleSort(column, event.shiftKey);
    });
    cellEl.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || isHeaderControl(event.target)) return;
      this.core.columnDragService.onPointerDown(event, column);
    });
  }

  private createGroupCell(group: ColumnGroup<any>): HTMLElement {
    const cellEl = el("div", "mach-header-cell mach-header-cell--group");
    if (group.groupId) cellEl.dataset.groupId = group.groupId;
    cellEl.setAttribute("role", "columnheader");
    applyHeaderClass(cellEl, group.def.headerClass);
    const labelEl = el("span", "mach-header-label mach-header-label--group");
    labelEl.textContent = group.headerName;
    cellEl.appendChild(labelEl);
    return cellEl;
  }

  applyLayout(): void {
    const widths: Record<PaneType, number> = { left: 0, center: 0, right: 0 };

    for (const pane of PANES) {
      const rows = this.core.skeleton.headerRows[pane];
      let x = 0;
      const leafLefts = new Map<string, number>();
      for (const column of this.core.columnModel.getPaneColumns(pane)) {
        leafLefts.set(column.id, x);
        x += column.currentWidth;
      }
      const perRowHeight = this.core.gridOptions.headerHeight;
      for (const cell of this.leafCells) {
        if (this.core.columnModel.paneOf(cell.column) !== pane) continue;
        const left = leafLefts.get(cell.column.id) ?? 0;
        cell.el.style.width = `${cell.column.currentWidth}px`;
        cell.el.style.left = `${left}px`;
        cell.el.setAttribute("aria-colindex", String(this.core.columnModel.getFlatIndex(cell.column.id) + 1));
      }

      for (const gc of this.groupCells) {
        if (gc.pane !== pane) continue;
        const leaves = gc.group.getLeafColumns().filter(column => !column.hide && this.core.columnModel.paneOf(column) === pane);
        if (leaves.length === 0) continue;
        const left = leafLefts.get(leaves[0].id) ?? 0;
        let width = 0;
        for (const leaf of leaves) width += leaf.currentWidth;
        gc.el.style.left = `${left}px`;
        gc.el.style.width = `${width}px`;
        gc.el.style.height = `${perRowHeight}px`;
        gc.el.setAttribute("aria-colspan", String(leaves.length));
      }

      for (const row of rows) row.style.width = `${x}px`;
      widths[pane] = x;
    }
    this.core.skeleton.setPaneWidths(widths.left, widths.right);
  }

  private onHeaderKeyDown(e: KeyboardEvent, column: Column): void {
    if (this.core.isDisposed()) return;
    if (this.activateHeaderFromKeyboard(e, column)) return;
    if (this.resizeColumnFromKeyboard(e, column)) return;
    if (this.moveColumnFromKeyboard(e, column)) return;
    if (this.focusAdjacentHeader(e, column)) return;
    this.focusBoundaryHeader(e);
  }

  private activateHeaderFromKeyboard(event: KeyboardEvent, column: Column): boolean {
    if (event.key !== "Enter" && event.key !== " ") return false;
    if (isHeaderControl(event.target)) return true;
    event.preventDefault();
    if (column.sortable) this.core.cycleSort(column, event.shiftKey);
    return true;
  }

  private resizeColumnFromKeyboard(event: KeyboardEvent, column: Column): boolean {
    if (!event.altKey || !isHorizontalArrow(event.key)) return false;
    if (!this.canResizeColumn(column)) return true;
    const delta = event.key === "ArrowRight" ? 24 : -24;
    this.core.columnModel.setColumnWidth(column, column.currentWidth + delta);
    this.core.relayoutColumns();
    this.core.commitColumnWidths([column]);
    event.preventDefault();
    return true;
  }

  private moveColumnFromKeyboard(event: KeyboardEvent, column: Column): boolean {
    if (!event.ctrlKey || !isHorizontalArrow(event.key)) return false;
    if (!column.movable) return true;
    event.preventDefault();
    const pane = this.core.columnModel.paneOf(column);
    const siblings = this.core.columnModel.getPaneColumns(pane);
    const from = siblings.indexOf(column);
    const offset = event.key === "ArrowRight" ? 1 : -1;
    const to = Math.max(0, Math.min(siblings.length - 1, from + offset));
    if (to !== from) this.core.moveColumn(column.id, to);
    return true;
  }

  private focusAdjacentHeader(event: KeyboardEvent, column: Column): boolean {
    if (event.altKey || event.ctrlKey || event.metaKey || !isHorizontalArrow(event.key)) {
      return false;
    }
    event.preventDefault();
    const columns = this.core.columnModel.getOrderedVisible();
    const current = columns.indexOf(column);
    if (current < 0) return true;
    const offset = event.key === "ArrowRight" ? 1 : -1;
    const next = Math.max(0, Math.min(columns.length - 1, current + offset));
    this.focusHeaderCell(columns[next]);
    return true;
  }

  private focusBoundaryHeader(event: KeyboardEvent): boolean {
    if (event.key !== "Home" && event.key !== "End") return false;
    event.preventDefault();
    const columns = this.core.columnModel.getOrderedVisible();
    if (columns.length === 0) return true;
    const index = event.key === "Home" ? 0 : columns.length - 1;
    this.focusHeaderCell(columns[index]);
    return true;
  }

  private focusHeaderCell(column: Column): void {
    let target = this.leafCells.find((cell) => cell.column.id === column.id);
    if (!target && !column.pinned) {
      this.scrollColumnIntoView(column);
      this.updateColumnWindow();
      target = this.leafCells.find((cell) => cell.column.id === column.id);
    }
    if (!target) return;
    for (const cell of this.leafCells) cell.el.tabIndex = cell === target ? 0 : -1;
    target.el.focus({ preventScroll: true });
  }

  private scrollColumnIntoView(column: Column): void {
    this.columnViewport.scrollColumnIntoView(
      this.core.skeleton.bodyViewports.center, this.core.columnModel.getPaneColumns("center"), column
    );
  }

  private canResizeColumn(column: Column): boolean {
    return this.core.gridOptions.enableColumnResize && column.resizable;
  }

  refreshSortIndicators(): void {
    const model = this.core.columnModel.getSortModel();
    const multi = model.length > 1;
    for (const hc of this.leafCells) {
      const idx = model.findIndex((s) => s.colId === hc.column.id);
      if (idx >= 0) {
        const dir = model[idx].direction;
        const badge = multi ? `<span class="mach-sort-badge">${idx + 1}</span>` : "";
        hc.sortEl.innerHTML = (dir === "asc" ? SORT_ASC_ICON : SORT_DESC_ICON) + badge;
        hc.el.setAttribute("aria-sort", dir === "asc" ? "ascending" : "descending");
        hc.el.classList.add("mach-header-cell--sorted");
      } else {
        hc.sortEl.innerHTML = "";
        hc.el.removeAttribute("aria-sort");
        hc.el.classList.remove("mach-header-cell--sorted");
      }
    }
  }

  refreshFilterIcons(): void {
    const fm = this.core.rowModel.getFilterModel();
    for (const hc of this.leafCells) {
      if (!hc.filterBtn) continue;
      const filter = fm[hc.column.id];
      const active = filter != null;
      hc.filterBtn.classList.toggle("mach-filter-btn--active", active);
      if (hc.filterTagEl) {
        const summary = active ? describeFilter(filter) : "";
        hc.filterTagEl.style.display = summary ? "" : "none";
        if (summary) hc.filterTagEl.textContent = summary;
      }
    }
  }

  refreshSelectAllCheckbox(): void {
    for (const hc of this.leafCells) {
      if (!hc.selectAllEl) continue;
      const { all, some } = this.core.selectionService.getSelectAllState();
      hc.selectAllEl.checked = all;
      hc.selectAllEl.indeterminate = some;
    }
  }

  destroy(): void {
    this.clearCells(true);
  }

  private clearCells(destroying: boolean): void {
    for (const cell of this.leafCells) {
      const destroy = takeRendererDestroyer(cell.el);
      if (!destroy) continue;
      try {
        destroy();
      } catch (error) {
        if (destroying) console.error("[mach-table] headerComponent destroy error", error);
        else this.core.reportError(error, "headerComponent.destroy", { colId: cell.column.id });
      }
    }
    this.leafCells = [];
    this.groupCells = [];
  }
}
