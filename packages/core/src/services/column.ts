import type { ColDef, FilterType, PinnedDirection } from "../types/colDef";
import type { ColumnGroup } from "./columnGroup";

export class Column<TData = any> {
  readonly id: string;
  readonly colDef: ColDef<TData>;
  hide: boolean;
  pinned: PinnedDirection | null;
  manualWidth: number | null = null;
  flex: number | null = null;
  currentWidth = 0;
  parentGroup: ColumnGroup<TData> | null = null;
  level = 0;
  isDetailToggle = false;

  constructor(id: string, colDef: ColDef<TData>) {
    this.id = id;
    this.colDef = colDef;
    this.hide = colDef.hide ?? false;
    const p = colDef.pinned;
    this.pinned = p === true ? "left" : p === false || p == null ? null : p;
    this.resetWidth();
  }

  get sortable(): boolean {
    return this.colDef.sortable !== false;
  }

  get resizable(): boolean {
    return this.colDef.resizable !== false;
  }

  get movable(): boolean {
    return this.colDef.movable !== false;
  }

  get filterable(): boolean {
    return this.colDef.filter != null && this.colDef.filter !== false;
  }

  get filterType(): FilterType {
    const f = this.colDef.filter;
    return f === true ? "text" : (f as FilterType) ?? "text";
  }

  get hasCheckbox(): boolean {
    return this.colDef.checkboxSelection === true;
  }

  resetWidth(): void {
    this.manualWidth = null;
    this.flex = typeof this.colDef.flex === "number" && Number.isFinite(this.colDef.flex) && this.colDef.flex > 0
      ? this.colDef.flex
      : null;
  }
}
