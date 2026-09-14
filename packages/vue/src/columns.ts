import type { VNodeChild } from "vue";
import type { CellRendererParams, ColDef, ColDefGroup } from "@agile-team/mach-table";

/** Vue-first cell rendering with the same compact row-first shape as UI table libraries. */
export type VueCellRender<TData = any, TValue = any> = (
  row: TData,
  index: number,
  params: CellRendererParams<TData, TValue>
) => VNodeChild;

/** Core column definition plus an optional Vue VNode renderer. */
export interface VueColDef<TData = any, TValue = any> extends ColDef<TData, TValue> {
  /** Preferred for concise, data-driven Vue cells; named slots remain available as an override. */
  render?: VueCellRender<TData, TValue>;
}

export interface VueColDefGroup<TData = any> extends Omit<ColDefGroup<TData>, "children"> {
  children: VueColumnDefinition<TData>[];
}

export type VueColumnDefinition<TData = any> = VueColDef<TData> | VueColDefGroup<TData>;

/** Compile-time helper that preserves typed row-first Vue render functions. */
export function defineVueColumns<TData>(
  columns: VueColumnDefinition<TData>[]
): VueColumnDefinition<TData>[] {
  return columns;
}
