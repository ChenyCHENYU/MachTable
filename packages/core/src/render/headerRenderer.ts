import type { GridCore } from "../core/gridCore";
import type { Column } from "../services/column";
import { ColumnGroup } from "../services/columnGroup";
import type { PaneType } from "../services/columnModel";
import { el, FILTER_ICON, SORT_ASC_ICON, SORT_DESC_ICON } from "../lib/dom";
import { describeFilter } from "../lib/filterSummary";
import { setHeaderDestroyer, takeHeaderDestroyer } from "./runtimeState";
import { ColumnViewportIndex } from "../services/columnViewportIndex";

type HeaderContext = Pick<
  GridCore<any>,
  | "columnDragService"
  | "columnMenu"
  | "columnModel"
  | "commitColumnWidths"
  | "cycleSort"
  | "emit"
  | "filterPopup"
  | "getApi"
  | "isDestroyed"
  | "moveColumn"
  | "options"
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
}

interface PaneTree {
  column?: Column;
  group?: ColumnGroup<any>;
  level: number;
  children: PaneTree[];
}

type HeaderComponentOutput = string | HTMLElement | { el: HTMLElement; destroy?: () => void } | null | undefined;

const HEADER_CONTROL_SELECTOR = ".mach-header-resize, .mach-filter-btn, .mach-menu-btn, .mach-select-all";

function isHeaderControl(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest(HEADER_CONTROL_SELECTOR) != null;
}

function isHorizontalArrow(key: string): boolean {
  return key === "ArrowLeft" || key === "ArrowRight";
}

export class HeaderRenderer {
  private leafCells: HeaderCell[] = [];
  private groupCells: GroupCell[] = [];
  private paneTrees: Record<PaneType, PaneTree[]> = { left: [], center: [], right: [] };
  private columnViewport = new ColumnViewportIndex();
  private centerFirst = 0;
  private centerLastExcl = Number.MAX_SAFE_INTEGER;

  constructor(private core: HeaderContext) {}

  build(): void {
    this.updateColumnWindowState();
    this.core.resizeService.cancelResize();
    for (const cell of this.leafCells) {
      const destroy = takeHeaderDestroyer(cell.el);
      if (destroy) {
        try {
          destroy();
        } catch (error) {
          this.core.reportError(error, "headerComponent.destroy", { colId: cell.column.id });
        }
      }
    }
    this.leafCells = [];
    this.groupCells = [];
    const depth = this.core.columnModel.getHeaderDepth();
    this.core.skeleton.setHeaderRowCount(depth);

    const paneOf = (col: Column): PaneType =>
      col.pinned === "left" ? "left" : col.pinned === "right" ? "right" : "center";

    const buildTree = (
      children: (ColumnGroup<any> | Column<any>)[],
      level: number,
      pane: PaneType
    ): PaneTree[] => {
      const out: PaneTree[] = [];
      for (const child of children) {
        if (child instanceof ColumnGroup) {
          const subtree = buildTree(child.children, level + 1, pane);
          if (subtree.length > 0) out.push({ group: child, level, children: subtree });
        } else {
          if (!child.hide && paneOf(child) === pane) {
            out.push({ column: child, level, children: [] });
          }
        }
      }
      return out;
    };

    const roots = this.core.columnModel.getRootChildren();
    const centerColumns = this.core.columnModel.getPaneColumns("center");
    const activeCenter = new Set(centerColumns.slice(this.centerFirst, this.centerLastExcl));
    for (const pane of ["left", "center", "right"] as PaneType[]) {
      const trees = buildTree(roots, 0, pane);
      this.paneTrees[pane] = pane === "center"
        ? this.filterTreeColumns(trees, activeCenter)
        : trees;
    }

    const perRowHeight = this.core.options.headerHeight;
    for (const pane of ["left", "center", "right"] as PaneType[]) {
      const rows = this.core.skeleton.headerRows[pane];
      for (const row of rows) row.textContent = "";
      const appendCell = (tree: PaneTree) => {
        const row = rows[Math.min(tree.level, rows.length - 1)];
        if (tree.column) {
          const cell = this.createLeafCell(tree.column, depth - tree.level, perRowHeight);
          row.appendChild(cell.el);
          this.leafCells.push(cell);
        } else if (tree.group) {
          const cell = this.createGroupCell(tree.group);
          row.appendChild(cell);
          this.groupCells.push({ group: tree.group, el: cell });
        }
        for (const child of tree.children) appendCell(child);
      };
      for (const tree of this.paneTrees[pane]) appendCell(tree);
    }

    if (!this.core.options.suppressHeaderFocus) {
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

  private filterTreeColumns(trees: PaneTree[], active: ReadonlySet<Column>): PaneTree[] {
    const output: PaneTree[] = [];
    for (const tree of trees) {
      if (tree.column) {
        if (active.has(tree.column)) output.push(tree);
        continue;
      }
      const children = this.filterTreeColumns(tree.children, active);
      if (children.length > 0) output.push({ ...tree, children });
    }
    return output;
  }

  private createLeafCell(column: Column, rowSpan: number, perRowHeight: number): HeaderCell {
    const cellEl = el("div", "mach-header-cell mach-header-cell--leaf");
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
    if (typeof colDef.headerClass === "string") cellEl.classList.add(colDef.headerClass);
    else if (Array.isArray(colDef.headerClass)) cellEl.classList.add(...colDef.headerClass);
    if (colDef.headerTooltip) cellEl.setAttribute("title", colDef.headerTooltip);
    const headerAlign = colDef.headerAlign ?? colDef.align;
    if (headerAlign === "center") cellEl.classList.add("mach-header-cell--center");
    else if (headerAlign === "right") cellEl.classList.add("mach-header-cell--right");
  }

  private attachHeaderFocus(cellEl: HTMLElement, column: Column): void {
    if (this.core.options.suppressHeaderFocus) return;
    cellEl.tabIndex = -1;
    cellEl.addEventListener("mousedown", () => this.focusHeaderCell(column));
    cellEl.addEventListener("keydown", (event: KeyboardEvent) => this.onHeaderKeyDown(event, column));
  }

  private appendSelectAll(cellEl: HTMLElement, column: Column): HTMLInputElement | undefined {
    if (!column.hasCheckbox || this.core.options.rowSelection !== "multiple") return undefined;
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
    const headerComponent = colDef.headerComponent;
    let output: HeaderComponentOutput;
    if (!headerComponent) {
      this.appendHeaderLabel(cellEl, colDef.headerName ?? colDef.field ?? column.id);
      return;
    }
    try {
      output = headerComponent({ colDef, column, api: this.core.getApi() });
    } catch (error) {
      this.core.reportError(error, "headerComponent", { colId: column.id });
      output = null;
    }
    this.appendHeaderComponentOutput(cellEl, column, output);
  }

  private appendHeaderComponentOutput(
    cellEl: HTMLElement,
    column: Column,
    output: HeaderComponentOutput
  ): void {
    if (typeof output === "string") {
      this.appendHeaderLabel(cellEl, output);
      return;
    }
    if (output instanceof HTMLElement) {
      this.appendCustomHeader(cellEl, output);
      return;
    }
    if (output && typeof output === "object" && output.el instanceof HTMLElement) {
      this.appendCustomHeader(cellEl, output.el);
      setHeaderDestroyer(cellEl, output.destroy);
      return;
    }
    const colDef = column.colDef;
    this.appendHeaderLabel(cellEl, colDef.headerName ?? colDef.field ?? column.id);
  }

  private appendHeaderLabel(cellEl: HTMLElement, value: string): void {
    const labelEl = el("span", "mach-header-label");
    labelEl.textContent = value;
    cellEl.appendChild(labelEl);
  }

  private appendCustomHeader(cellEl: HTMLElement, content: HTMLElement): void {
    const wrapper = el("span", "mach-header-label mach-header-label--custom");
    wrapper.appendChild(content);
    cellEl.appendChild(wrapper);
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
    if (!this.core.options.columnMenu) return;
    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "mach-menu-btn";
    menuBtn.setAttribute("aria-label", "column menu");
    menuBtn.textContent = "⋯";
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
      this.core.getApi().columns.autoSize(column.id);
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
    const def = group.def;
    if (typeof def.headerClass === "string") cellEl.classList.add(def.headerClass);
    else if (Array.isArray(def.headerClass)) cellEl.classList.add(...def.headerClass);
    const labelEl = el("span", "mach-header-label mach-header-label--group");
    labelEl.textContent = group.headerName;
    cellEl.appendChild(labelEl);
    return cellEl;
  }

  applyLayout(): void {
    const widths: Record<PaneType, number> = { left: 0, center: 0, right: 0 };

    for (const pane of ["left", "center", "right"] as PaneType[]) {
      const rows = this.core.skeleton.headerRows[pane];
      let x = 0;
      const leafLefts = new Map<string, number>();
      for (const column of this.core.columnModel.getPaneColumns(pane)) {
        leafLefts.set(column.id, x);
        x += column.currentWidth;
      }
      const perRowHeight = this.core.options.headerHeight;
      for (const cell of this.leafCells) {
        if (this.core.columnModel.paneOf(cell.column) !== pane) continue;
        const left = leafLefts.get(cell.column.id) ?? 0;
        cell.el.style.width = `${cell.column.currentWidth}px`;
        cell.el.style.left = `${left}px`;
        cell.el.setAttribute("aria-colindex", String(this.core.columnModel.getFlatIndex(cell.column.id) + 1));
      }

      for (const gc of this.groupCells) {
        const leaves = this.visiblePaneLeaves(gc.group, pane);
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

  private visiblePaneLeaves(group: ColumnGroup<any>, pane: PaneType): Column[] {
    return group
      .getLeafColumns()
      .filter((c) => !c.hide && this.core.columnModel.paneOf(c) === pane);
  }

  private onHeaderKeyDown(e: KeyboardEvent, column: Column): void {
    if (this.core.isDestroyed()) return;
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
    const next = Math.max(column.colDef.minWidth ?? 40, column.currentWidth + delta);
    this.core.columnModel.setColumnWidth(column, next);
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
    const columns = this.core.columnModel.getPaneColumns("center");
    const index = columns.indexOf(column);
    if (index < 0) return;
    const viewport = this.core.skeleton.bodyViewports.center;
    this.columnViewport.update(columns);
    const left = this.columnViewport.offsetAt(index);
    const right = left + column.currentWidth;
    if (left < viewport.scrollLeft) viewport.scrollLeft = left;
    else if (right > viewport.scrollLeft + viewport.clientWidth) {
      viewport.scrollLeft = right - viewport.clientWidth;
    }
  }

  private canResizeColumn(column: Column): boolean {
    return this.core.options.enableColumnResize && column.resizable;
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
      hc.selectAllEl.checked = this.core.selectionService.isSelectAllActive();
      hc.selectAllEl.indeterminate = this.core.selectionService.isSelectAllIndeterminate();
    }
  }

  destroy(): void {
    for (const cell of this.leafCells) {
      const destroy = takeHeaderDestroyer(cell.el);
      if (!destroy) continue;
      try {
        destroy();
      } catch (error) {
        console.error("[mach-table] headerComponent destroy error", error);
      }
    }
    this.leafCells = [];
    this.groupCells = [];
  }
}
