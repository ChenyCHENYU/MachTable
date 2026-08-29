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
type ColumnModelContext = Pick<GridCore<any>, "options">;

export class ColumnModel {
  private columns: Column[] = [];
  private rootChildren: (ColumnGroup<any> | Column<any>)[] = [];
  private left: Column[] = [];
  private center: Column[] = [];
  private right: Column[] = [];
  private sortModel: SortModelItem[] = [];
  private defs: ColDefOrGroup<any>[] = [];
  private headerDepth = 1;
  private flatIndexById = new Map<string, number>();
  viewportWidth = 0;

  constructor(private core: ColumnModelContext) {}

  setColumnDefs(colDefs: ColDefOrGroup<any>[] | null | undefined): void {
    this.defs = colDefs ? [...colDefs] : [];
    const prev = new Map(this.columns.map((c) => [c.id, c]));
    const defaults = this.core.options.defaultColDef;
    const usedIds = new Set<string>(
      this.core.options.masterDetail && this.core.options.detailToggleColumn
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
        const column = new Column(uniqueId, mergeColDef(colDef, defaults, this.core.options.columnTypes));
        column.parentGroup = parent;
        column.level = level;
        const p = prev.get(uniqueId);
        if (p) {
          column.manualWidth = p.manualWidth;
          column.hide = p.hide;
          column.pinned = p.pinned;
        }
        return column;
      });

    this.rootChildren = build(this.defs, null, 0);

    if (this.core.options.masterDetail && this.core.options.detailToggleColumn) {
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

    this.columns = this.collectLeaves(this.rootChildren);
    this.headerDepth = this.columns.reduce((max, c) => Math.max(max, c.level + 1), 1);

    this.sortModel = this.sortModel.filter((s) => this.columns.some((c) => c.id === s.colId));
    if (this.sortModel.length === 0) {
      const initial: SortModelItem[] = [];
      for (const c of this.columns) {
        if (c.colDef.initialSort) initial.push({ colId: c.id, direction: c.colDef.initialSort });
      }
      this.sortModel = initial;
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
    const visible = this.columns.filter((c) => !c.hide);
    this.left = visible.filter((c) => c.pinned === "left");
    this.right = visible.filter((c) => c.pinned === "right");
    this.center = visible.filter((c) => c.pinned === null);
    this.flatIndexById.clear();
    this.getOrderedVisible().forEach((c, i) => this.flatIndexById.set(c.id, i));
  }

  getFlatIndex(colId: string): number {
    return this.flatIndexById.get(colId) ?? -1;
  }

  getColumns(): Column[] {
    return this.columns;
  }

  getColumnDefs(): ColDefOrGroup<any>[] {
    return this.defs;
  }

  getRootChildren(): (ColumnGroup<any> | Column<any>)[] {
    return this.rootChildren;
  }

  getHeaderDepth(): number {
    return this.headerDepth;
  }

  getColumn(colId: string): Column | undefined {
    return this.columns.find((c) => c.id === colId);
  }

  getPaneColumns(pane: PaneType): Column[] {
    return pane === "left" ? this.left : pane === "right" ? this.right : this.center;
  }

  getOrderedVisible(): Column[] {
    return [...this.left, ...this.center, ...this.right];
  }

  getRowGroupColumns(): Column[] {
    return this.getOrderedVisible().filter((c) => c.colDef.rowGroup === true);
  }

  getAggColumns(): Column[] {
    return this.getOrderedVisible().filter((c) => c.colDef.aggFunc != null && c.colDef.rowGroup !== true);
  }

  hasColSpan(): boolean {
    return this.center.some((c) => c.colDef.colSpan != null);
  }

  getGroupLabelColumn(): Column | undefined {
    const ordered = this.getOrderedVisible();
    return (
      this.center.find((c) => !c.hasCheckbox && !c.isDetailToggle) ??
      ordered.find((c) => !c.hasCheckbox && !c.isDetailToggle) ??
      ordered[0]
    );
  }

  paneOf(column: Column): PaneType {
    return column.pinned === "left" ? "left" : column.pinned === "right" ? "right" : "center";
  }

  computeLayout(viewportWidth: number): void {
    this.viewportWidth = viewportWidth;

    let pinnedTotal = 0;
    for (const c of [...this.left, ...this.right]) {
      c.currentWidth = clampWidth(c.manualWidth ?? c.colDef.width ?? DEFAULT_COLUMN_WIDTH, this.widthInputOf(c));
      pinnedTotal += c.currentWidth;
    }

    const available = Math.max(0, viewportWidth - pinnedTotal);
    const scalable = this.center.filter((column) => !column.colDef.suppressSizeToFit);
    const fixed = this.center.filter((column) => column.colDef.suppressSizeToFit);
    let fixedTotal = 0;
    for (const column of fixed) {
      column.currentWidth = clampWidth(
        column.manualWidth ?? column.colDef.width ?? DEFAULT_COLUMN_WIDTH,
        this.widthInputOf(column)
      );
      fixedTotal += column.currentWidth;
    }
    const scalableInputs = scalable.map((column) => this.widthInputOf(column));
    const scalableWidth = Math.max(0, available - fixedTotal);
    const widths = this.core.options.columnLayout === "fit"
      ? fitColumnWidths(scalableInputs, scalableWidth)
      : computeColumnWidths(scalableInputs, scalableWidth);
    scalable.forEach((column, index) => {
      column.currentWidth = widths[index];
    });
  }

  private widthInputOf(c: Column): { width?: number; minWidth?: number; maxWidth?: number; flex?: number } {
    const def = c.colDef;
    if (c.manualWidth != null) {
      return { width: c.manualWidth, minWidth: def.minWidth, maxWidth: def.maxWidth };
    }
    return { width: def.width, minWidth: def.minWidth, maxWidth: def.maxWidth, flex: def.flex };
  }

  setColumnWidth(column: Column, width: number): void {
    column.manualWidth = clampWidth(width, this.widthInputOf(column));
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

    this.columns = this.collectLeaves(this.rootChildren);
    this.regroup();
    return true;
  }

  setColumnPinned(colId: string, pinned: PinnedDirection | null): void {
    const column = this.getColumn(colId);
    if (!column) return;
    column.pinned = pinned;
    this.regroup();
  }

  getColumnState(): ColumnState[] {
    return this.columns.map((c) => {
      const sortIndex = this.sortModel.findIndex((s) => s.colId === c.id);
      const state: ColumnState = {
        colId: c.id,
        hide: c.hide,
        width: c.manualWidth ?? c.currentWidth,
        pinned: c.pinned
      };
      if (sortIndex >= 0) {
        state.sort = this.sortModel[sortIndex].direction;
        state.sortIndex = sortIndex;
      } else {
        state.sort = null;
        state.sortIndex = null;
      }
      return state;
    });
  }

  applyColumnState(states: ColumnState[]): void {
    const stateById = new Map(states.map((s) => [s.colId, s]));
    for (const c of this.columns) {
      const s = stateById.get(c.id);
      if (!s) continue;
      if (s.hide != null) c.hide = s.hide;
      if (s.width != null) c.manualWidth = s.width;
      if (s.pinned !== undefined) c.pinned = s.pinned;
    }
    const nextSort: { colId: string; direction: SortDirection; sortIndex: number }[] = [];
    for (const s of states) {
      if (s.sort && this.columns.some((c) => c.id === s.colId)) {
        nextSort.push({ colId: s.colId, direction: s.sort, sortIndex: s.sortIndex ?? 0 });
      }
    }
    nextSort.sort((a, b) => a.sortIndex - b.sortIndex);
    this.sortModel = nextSort.map(({ colId, direction }) => ({ colId, direction }));
    this.applyStateOrder(states);
    this.regroup();
  }

  private applyStateOrder(states: ColumnState[]): void {
    const orderById = new Map<string, number>();
    states.forEach((s, i) => orderById.set(s.colId, i));
    const paneOfCol = (c: Column) => (c.pinned === "left" ? "left" : c.pinned === "right" ? "right" : "center");

    for (const pane of ["left", "center", "right"] as PaneType[]) {
      const current = this.rootChildren.filter(
        (child): child is Column<any> =>
          child instanceof Column && !child.hide && child.parentGroup === null && paneOfCol(child) === pane
      );
      if (current.length < 2) continue;
      const sorted = current
        .slice()
        .sort((a, b) => (orderById.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (orderById.get(b.id) ?? Number.MAX_SAFE_INTEGER));
      if (sorted.every((c, i) => c === current[i])) continue;

      const slots: number[] = [];
      this.rootChildren.forEach((child, idx) => {
        if (child instanceof Column && !child.hide && child.parentGroup === null && paneOfCol(child) === pane) {
          slots.push(idx);
        }
      });
      slots.forEach((slotIdx, i) => {
        this.rootChildren[slotIdx] = sorted[i];
      });
    }
    this.columns = this.collectLeaves(this.rootChildren);
  }

  resetColumnState(): void {
    for (const c of this.columns) {
      c.manualWidth = null;
      c.hide = c.colDef.hide ?? false;
      const p = c.colDef.pinned;
      c.pinned = p === true ? "left" : p === false || p == null ? null : p;
    }
    this.sortModel = [];
    this.regroup();
  }

  getSortModel(): SortModel {
    return this.sortModel.map((s) => ({ ...s }));
  }

  applySortModel(sortModel: SortModel | null): void {
    if (!sortModel || sortModel.length === 0) {
      this.sortModel = [];
      return;
    }
    this.sortModel = sortModel
      .filter((s) => this.columns.some((c) => c.id === s.colId) && (s.direction === "asc" || s.direction === "desc"))
      .map((s) => ({ colId: s.colId, direction: s.direction }));
  }

  cycleSort(column: Column, additive: boolean): void {
    const model = [...this.sortModel];
    const idx = model.findIndex((s) => s.colId === column.id);
    const current = idx >= 0 ? model[idx].direction : null;
    const next: SortDirection | null = current === null ? "asc" : current === "asc" ? "desc" : null;
    const multi = additive && this.core.options.multiSort;

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
    this.sortModel = model;
  }
}
