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
    const colDef = column.colDef;
    const cellEl = el("div", "mach-header-cell mach-header-cell--leaf");
    cellEl.dataset.colId = column.id;
    cellEl.setAttribute("role", "columnheader");
    cellEl.style.height = `${rowSpan * perRowHeight}px`;

    if (typeof colDef.headerClass === "string") cellEl.classList.add(colDef.headerClass);
    else if (Array.isArray(colDef.headerClass)) cellEl.classList.add(...colDef.headerClass);
    if (colDef.headerTooltip) cellEl.setAttribute("title", colDef.headerTooltip);

    const headerAlign = colDef.headerAlign ?? colDef.align;
    if (headerAlign === "center") cellEl.classList.add("mach-header-cell--center");
    else if (headerAlign === "right") cellEl.classList.add("mach-header-cell--right");

    if (!this.core.options.suppressHeaderFocus) {
      cellEl.tabIndex = -1;
      cellEl.addEventListener("mousedown", () => this.focusHeaderCell(column));
      cellEl.addEventListener("keydown", (e: KeyboardEvent) => this.onHeaderKeyDown(e, column));
    }

    let selectAllEl: HTMLInputElement | undefined;
    if (column.hasCheckbox && this.core.options.rowSelection === "multiple") {
      selectAllEl = document.createElement("input");
      selectAllEl.type = "checkbox";
      selectAllEl.className = "mach-select-all";
      selectAllEl.setAttribute("aria-label", "select all rows");
      selectAllEl.addEventListener("click", (e) => e.stopPropagation());
      selectAllEl.addEventListener("change", () => {
        if (selectAllEl!.checked) this.core.selectionService.selectAll(true);
        else this.core.selectionService.deselectAll();
      });
      cellEl.appendChild(selectAllEl);
    }

    const headerComponent = colDef.headerComponent;
    if (headerComponent) {
      let out: string | HTMLElement | { el: HTMLElement; destroy?: () => void } | null | undefined;
      try {
        out = headerComponent({ colDef, column, api: this.core.getApi() });
      } catch (err) {
        this.core.reportError(err, "headerComponent", { colId: column.id });
        out = null;
      }
      if (typeof out === "string") {
        const labelEl = el("span", "mach-header-label");
        labelEl.textContent = out;
        cellEl.appendChild(labelEl);
      } else if (out instanceof HTMLElement) {
        const wrapper = el("span", "mach-header-label mach-header-label--custom");
        wrapper.appendChild(out);
        cellEl.appendChild(wrapper);
      } else if (out && typeof out === "object" && out.el instanceof HTMLElement) {
        const wrapper = el("span", "mach-header-label mach-header-label--custom");
        wrapper.appendChild(out.el);
        cellEl.appendChild(wrapper);
        setHeaderDestroyer(cellEl, out.destroy);
      } else {
        const labelEl = el("span", "mach-header-label");
        labelEl.textContent = colDef.headerName ?? colDef.field ?? column.id;
        cellEl.appendChild(labelEl);
      }
    } else {
      const labelEl = el("span", "mach-header-label");
      labelEl.textContent = colDef.headerName ?? colDef.field ?? column.id;
      cellEl.appendChild(labelEl);
    }

    const sortEl = el("span", "mach-sort-indicator");
    cellEl.appendChild(sortEl);

    let filterBtn: HTMLButtonElement | undefined;
    let filterTagEl: HTMLElement | undefined;
    if (column.filterable) {
      filterBtn = document.createElement("button");
      filterBtn.type = "button";
      filterBtn.className = "mach-filter-btn";
      filterBtn.setAttribute("aria-label", `filter ${column.id}`);
      filterBtn.innerHTML = FILTER_ICON;
      filterBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.core.filterPopup.toggle(column, filterBtn!);
      });
      cellEl.appendChild(filterBtn);
      filterTagEl = el("span", "mach-filter-tag");
      cellEl.appendChild(filterTagEl);
    }

    if (this.core.options.columnMenu) {
      const menuBtn = document.createElement("button");
      menuBtn.type = "button";
      menuBtn.className = "mach-menu-btn";
      menuBtn.setAttribute("aria-label", "column menu");
      menuBtn.textContent = "⋯";
      menuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.core.columnMenu.toggle(column, menuBtn);
      });
      cellEl.appendChild(menuBtn);
    }

    if (this.canResizeColumn(column)) {
      const resizeEl = el("div", "mach-header-resize");
      resizeEl.setAttribute("aria-hidden", "true");
      resizeEl.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        this.core.resizeService.startResize(e, column);
      });
      resizeEl.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        this.core.getApi().autoSizeColumn(column.id);
      });
      resizeEl.addEventListener("click", (e) => e.stopPropagation());
      cellEl.appendChild(resizeEl);
    }

    cellEl.addEventListener("click", (e) => {
      if (this.core.columnDragService.didDrag()) return;
      const target = e.target as HTMLElement;
      if (target.closest(".mach-header-resize, .mach-filter-btn, .mach-select-all")) return;
      if (column.sortable) this.core.cycleSort(column, e.shiftKey);
    });

    cellEl.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest(".mach-header-resize, .mach-filter-btn, .mach-select-all")) return;
      this.core.columnDragService.onPointerDown(e, column);
    });

    return { column, el: cellEl, sortEl, filterBtn, filterTagEl, selectAllEl };
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
    const resize = (delta: number): void => {
      const next = Math.max(
        column.colDef.minWidth ?? 40,
        column.currentWidth + delta
      );
      this.core.columnModel.setColumnWidth(column, next);
      this.core.relayoutColumns();
      this.core.commitColumnWidths([column]);
      e.preventDefault();
    };

    switch (true) {
      case e.key === "Enter" || e.key === " ":
        if ((e.target as HTMLElement).closest(".mach-header-resize, .mach-filter-btn, .mach-select-all")) return;
        e.preventDefault();
        if (column.sortable) this.core.cycleSort(column, e.shiftKey);
        return;
      case e.altKey && (e.key === "ArrowRight" || e.key === "ArrowLeft"):
        if (!this.canResizeColumn(column)) return;
        resize(e.key === "ArrowRight" ? 24 : -24);
        return;
      case e.ctrlKey && (e.key === "ArrowLeft" || e.key === "ArrowRight"):
        if (!column.movable) return;
        e.preventDefault(); {
          const pane = this.core.columnModel.paneOf(column);
          const siblings = this.core.columnModel.getPaneColumns(pane);
          const from = siblings.indexOf(column);
          const to = e.key === "ArrowRight" ? Math.min(siblings.length - 1, from + 1) : Math.max(0, from - 1);
          if (to !== from) this.core.moveColumn(column.id, to);
        }
        return;
      case !e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "ArrowLeft" || e.key === "ArrowRight"):
        e.preventDefault(); {
          const columns = this.core.columnModel.getOrderedVisible();
          const current = columns.indexOf(column);
          const next = e.key === "ArrowRight"
            ? Math.min(columns.length - 1, current + 1)
            : Math.max(0, current - 1);
          if (current >= 0) this.focusHeaderCell(columns[next]);
        }
        return;
      case e.key === "Home" || e.key === "End":
        e.preventDefault();
        const columns = this.core.columnModel.getOrderedVisible();
        if (columns.length > 0) {
          this.focusHeaderCell(e.key === "Home" ? columns[0] : columns[columns.length - 1]);
        }
        return;
    }
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
