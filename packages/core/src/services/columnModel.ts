import { normalizePositive } from "../lib/optionValues";
import type { GridCore } from "../core/gridCore";
import { Column } from "./column";
import { ColumnGroup } from "./columnGroup";
import type {
  ColDef,
  ColDefOrGroup,
  ColumnState,
  SortModel,
  SortModelItem,
  SortDirection,
  PinnedDirection
} from "../types/colDef";
import { isColDefGroup } from "../types/colDef";
import { mergeColDef } from "../core/resolveOptions";
import { computeColumnWidths, fitColumnWidths, clampWidth, DEFAULT_COLUMN_WIDTH } from "../lib/layout";

export type PaneType = "left" | "center" | "right";

export const DETAIL_TOGGLE_COL_ID = "__rg_detail_toggle__";
type ColumnModelContext = Pick<GridCore<any>, "gridOptions">;

function isPositiveFiniteNumber(value: unknown): value is number {
  return normalizePositive(value) !== undefined;
}

/** @internal Column objects remain public; the collection/model service does not. */
export class ColumnModel {
  private leafColumns: Column[] = [];
  private columnById = new Map<string, Column>();
  private rootChildren: (ColumnGroup<any> | Column<any>)[] = [];
  private leftPaneColumns: Column[] = [];
  private centerPaneColumns: Column[] = [];
  private rightPaneColumns: Column[] = [];
  private activeSorts: SortModelItem[] = [];
  private sourceDefinitions: ColDefOrGroup<any>[] = [];
  private headerDepth = 1;
  private flatIndexById = new Map<string, number>();
  viewportWidth = 0;

  constructor(private core: ColumnModelContext) {}

  setColumnDefs(colDefs: ColDefOrGroup<any>[] | null | undefined): void {
    this.sourceDefinitions = colDefs ? [...colDefs] : [];
    const prev = new Map(this.leafColumns.map((c) => [c.id, c]));
    const defaults = this.core.gridOptions.defaultColDef;
    const usedIds = new Set<string>(
      this.core.gridOptions.masterDetail && this.core.gridOptions.detailToggleColumn
        ? [DETAIL_TOGGLE_COL_ID]
        : []
    );

    const build = (list: ColDefOrGroup<any>[], parent: ColumnGroup<any> | null, level: number): (ColumnGroup<any> | Column<any>)[] =>
      list.map((def, i) => {
        if (isColDefGroup(def)) {
          const groupId = def.groupId ?? def.headerName ?? `group_${i}_${level}`;
          const group = new ColumnGroup(groupId, def);
          group.parent = parent;
          group.children = build(def.children, group, level + 1);
          return group;
        }
        const colDef = def as ColDef<any>;
        const id = colDef.colId ?? colDef.field ?? `col_${i}`;
        let uniqueId = id;
        let suffix = 2;
        while (usedIds.has(uniqueId)) uniqueId = `${id}_${suffix++}`;
        usedIds.add(uniqueId);
        const column = new Column(uniqueId, mergeColDef(colDef, defaults, this.core.gridOptions.columnTypes));
        column.parentGroup = parent;
        column.level = level;
        const p = prev.get(uniqueId);
        if (p) {
          column.manualWidth = p.manualWidth;
          column.contentWidth = p.contentWidth;
          column.flex = p.flex;
          column.hide = p.hide;
          column.pinned = p.pinned;
        }
        return column;
      });

    this.rootChildren = build(this.sourceDefinitions, null, 0);

    if (this.core.gridOptions.masterDetail && this.core.gridOptions.detailToggleColumn) {
      const toggleCol = new Column(DETAIL_TOGGLE_COL_ID, {
        colId: DETAIL_TOGGLE_COL_ID,
        headerName: "",
        width: 38,
        pinned: "left",
        sortable: false,
        resizable: false,
        movable: false,
        filter: false
      });
      toggleCol.isDetailToggle = true;
      this.rootChildren.unshift(toggleCol);
    }

    this.leafColumns = this.collectLeaves(this.rootChildren);
    this.columnById = new Map(this.leafColumns.map(column => [column.id, column]));
    this.headerDepth = this.leafColumns.reduce((max, c) => Math.max(max, c.level + 1), 1);

    this.activeSorts = this.activeSorts.filter((s) => this.leafColumns.some((c) => c.id === s.colId));
    if (this.activeSorts.length === 0) {
      const initial: SortModelItem[] = [];
      for (const c of this.leafColumns) {
        if (c.colDef.initialSort) initial.push({ colId: c.id, direction: c.colDef.initialSort });
      }
      this.activeSorts = initial;
    }

    this.regroup();
  }

  private collectLeaves(children: (ColumnGroup<any> | Column<any>)[], out: Column<any>[] = []): Column<any>[] {
    for (const child of children) {
      if (child instanceof ColumnGroup) this.collectLeaves(child.children, out);
      else out.push(child);
    }
    return out;
  }

  private regroup(): void {
    const visible = this.leafColumns.filter((c) => !c.hide);
    this.leftPaneColumns = visible.filter((c) => c.pinned === "left");
    this.rightPaneColumns = visible.filter((c) => c.pinned === "right");
    this.centerPaneColumns = visible.filter((c) => c.pinned === null);
    this.flatIndexById.clear();
    this.getOrderedVisible().forEach((c, i) => this.flatIndexById.set(c.id, i));
  }

  getFlatIndex(colId: string): number {
    return this.flatIndexById.get(colId) ?? -1;
  }

  getColumns(): Column[] {
    return this.leafColumns;
  }

  getColumnDefs(): ColDefOrGroup<any>[] {
    return this.sourceDefinitions;
  }

  getRootChildren(): (ColumnGroup<any> | Column<any>)[] {
    return this.rootChildren;
  }

  getHeaderDepth(): number {
    return this.headerDepth;
  }

  getColumn(colId: string): Column | undefined {
    return this.columnById.get(colId);
  }

  getPaneColumns(pane: PaneType): Column[] {
    return pane === "left" ? this.leftPaneColumns : pane === "right" ? this.rightPaneColumns : this.centerPaneColumns;
  }

  getOrderedVisible(): Column[] {
    return [...this.leftPaneColumns, ...this.centerPaneColumns, ...this.rightPaneColumns];
  }

  getRowGroupColumns(): Column[] {
    return this.getOrderedVisible().filter((c) => c.colDef.rowGroup === true);
  }

  getAggColumns(): Column[] {
    return this.getOrderedVisible().filter((c) => c.colDef.aggFunc != null && c.colDef.rowGroup !== true);
  }

  hasColSpan(): boolean {
    return this.centerPaneColumns.some((c) => c.colDef.colSpan != null);
  }

  getGroupLabelColumn(): Column | undefined {
    const ordered = this.getOrderedVisible();
    return (
      this.centerPaneColumns.find((c) => !c.hasCheckbox && !c.isDetailToggle) ??
      ordered.find((c) => !c.hasCheckbox && !c.isDetailToggle) ??
      ordered[0]
    );
  }

  paneOf(column: Column): PaneType {
    return column.pinned === "left" ? "left" : column.pinned === "right" ? "right" : "center";
  }

  computeLayout(viewportWidth: number): void {
    this.viewportWidth = viewportWidth;

    let available = viewportWidth;
    const scalable: Column[] = [];
    const inputs: ReturnType<ColumnModel["widthInputOf"]>[] = [];
    for (const column of this.getOrderedVisible()) {
      const input = this.widthInputOf(column);
      if (column.pinned != null || column.colDef.suppressSizeToFit || column.manualWidth != null) {
        column.currentWidth = clampWidth(input.width ?? DEFAULT_COLUMN_WIDTH, input);
        available -= column.currentWidth;
      } else {
        scalable.push(column);
        inputs.push(input);
      }
    }
    const widths = this.core.gridOptions.columnLayout === "fit"
      ? fitColumnWidths(inputs, Math.max(0, available))
      : computeColumnWidths(inputs, Math.max(0, available));
    scalable.forEach((column, index) => {
      column.currentWidth = widths[index];
    });
  }

  private widthInputOf(c: Column): { width?: number; minWidth?: number; maxWidth?: number; flex?: number } {
    const def = c.colDef;
    return {
      width: c.manualWidth ?? c.contentWidth ?? def.width ?? undefined,
      minWidth: c.minWidth,
      maxWidth: def.maxWidth,
      flex: c.manualWidth == null ? c.flex ?? undefined : undefined
    };
  }

  setColumnWidth(column: Column, width: number): boolean {
    if (!isPositiveFiniteNumber(width)) return false;
    column.manualWidth = clampWidth(width, this.widthInputOf(column));
    column.flex = null;
    return true;
  }

  setContentWidth(column: Column, width: number): boolean {
    if (!isPositiveFiniteNumber(width)) return false;
    column.resetWidth();
    column.contentWidth = clampWidth(width, this.widthInputOf(column));
    return true;
  }

  setColumnVisibility(colId: string, visible: boolean): void {
    const column = this.getColumn(colId);
    if (!column || column.hide === !visible) return;
    column.hide = !visible;
    this.regroup();
  }

  moveColumn(colId: string, toIndex: number): boolean {
    const column = this.getColumn(colId);
    if (!column) return false;

    const pane = this.paneOf(column);
    const inScope = (child: Column<any>) =>
      column.parentGroup ? true : this.paneOf(child) === pane;

    const container: (ColumnGroup<any> | Column<any>)[] = column.parentGroup
      ? column.parentGroup.children
      : this.rootChildren;

    const siblings = container.filter(
      (child): child is Column<any> => child instanceof Column && !child.hide && inScope(child)
    );
    const from = siblings.indexOf(column);
    if (from < 0) return false;
    siblings.splice(from, 1);
    const target = Math.max(0, Math.min(toIndex, siblings.length));
    siblings.splice(target, 0, column);

    const leafSlots: number[] = [];
    container.forEach((child, idx) => {
      if (child instanceof Column && !child.hide && inScope(child)) leafSlots.push(idx);
    });
    if (leafSlots.length !== siblings.length) return false;
    leafSlots.forEach((slotIdx, i) => {
      container[slotIdx] = siblings[i];
    });

    this.leafColumns = this.collectLeaves(this.rootChildren);
    this.regroup();
    return true;
  }

  setColumnPinned(colId: string, pinned: PinnedDirection | null): void {
    const column = this.getColumn(colId);
    if (!column || !column.movable) return;
    column.pinned = pinned;
    this.regroup();
  }

  getColumnState(): ColumnState[] {
    return this.leafColumns.map((c) => {
      return {
        colId: c.id,
        hide: c.hide,
        width: c.manualWidth ?? c.currentWidth,
        flex: c.flex,
        widthMode: c.manualWidth == null ? "auto" : "manual",
        contentWidth: c.contentWidth ?? undefined,
        pinned: c.pinned
      };
    });
  }

  applyColumnState(states: ColumnState[]): void {
    const stateById = new Map(states.map((s) => [s.colId, s]));
    for (const c of this.leafColumns) {
      const s = stateById.get(c.id);
      if (s) this.applyColumnViewState(c, s);
    }
    this.applyStateOrder(states);
    this.regroup();
  }

  private applyColumnViewState(column: Column, state: ColumnState): void {
    if (typeof state.hide === "boolean") column.hide = state.hide;
    if (state.widthMode === "auto") {
      column.resetWidth();
      if (isPositiveFiniteNumber(state.flex)) column.flex = state.flex;
    } else if (isPositiveFiniteNumber(state.flex)) {
      column.flex = state.flex;
      column.manualWidth = null;
    } else if (isPositiveFiniteNumber(state.width)) {
      column.manualWidth = clampWidth(state.width, this.widthInputOf(column));
      column.flex = null;
    }
    if (isPositiveFiniteNumber(state.contentWidth)) {
      column.contentWidth = clampWidth(state.contentWidth, this.widthInputOf(column));
    }
    if (column.movable && (state.pinned === "left" || state.pinned === "right" || state.pinned === null)) {
      column.pinned = state.pinned;
    }
  }

  private applyStateOrder(states: ColumnState[]): void {
    const orderById = new Map<string, number>();
    states.forEach((s, i) => orderById.set(s.colId, i));
    for (const pane of ["left", "center", "right"] as PaneType[]) {
      const slots: number[] = [];
      const columns: Column[] = [];
      this.rootChildren.forEach((child, index) => {
        if (child instanceof Column && !child.hide && child.parentGroup === null && child.movable && this.paneOf(child) === pane) {
          slots.push(index);
          columns.push(child);
        }
      });
      columns.sort((a, b) => (orderById.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (orderById.get(b.id) ?? Number.MAX_SAFE_INTEGER));
      slots.forEach((index, offset) => { this.rootChildren[index] = columns[offset]; });
    }
    this.leafColumns = this.collectLeaves(this.rootChildren);
  }

  resetColumnState(): void {
    for (const c of this.leafColumns) {
      c.resetWidth();
      c.hide = c.colDef.hide ?? false;
      const p = c.colDef.pinned;
      c.pinned = p === true ? "left" : p === false || p == null ? null : p;
    }
    this.regroup();
  }

  getSortModel(): SortModel {
    return this.activeSorts.map((s) => ({ ...s }));
  }

  applySortModel(sortModel: SortModel | null): void {
    if (!sortModel || sortModel.length === 0) {
      this.activeSorts = [];
      return;
    }
    this.activeSorts = sortModel
      .filter((s) => this.leafColumns.some((c) => c.id === s.colId) && (s.direction === "asc" || s.direction === "desc"))
      .map((s) => ({ colId: s.colId, direction: s.direction }));
  }

  cycleSort(column: Column, additive: boolean): void {
    const model = [...this.activeSorts];
    const idx = model.findIndex((s) => s.colId === column.id);
    const current = idx >= 0 ? model[idx].direction : null;
    const next: SortDirection | null = current === null ? "asc" : current === "asc" ? "desc" : null;
    const multi = additive && this.core.gridOptions.multiSort;

    if (multi) {
      if (next === null) {
        if (idx >= 0) model.splice(idx, 1);
      } else if (idx >= 0) {
        model[idx] = { colId: column.id, direction: next };
      } else {
        model.push({ colId: column.id, direction: next });
      }
    } else {
      model.length = 0;
      if (next) model.push({ colId: column.id, direction: next });
    }
    this.activeSorts = model;
  }
}
