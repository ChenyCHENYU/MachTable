import { inject, provide, type InjectionKey } from "vue";
import { createMachTablePreset, type GridOptions } from "@agile-team/mach-table";

export const MACH_TABLE_DEFAULTS_KEY: InjectionKey<Partial<GridOptions<any>>> = Symbol("mach-table-defaults");

/** Provides route/layout-scoped defaults. Per-table props always take precedence. */
export function provideMachTableDefaults<TData>(defaults: Partial<GridOptions<TData>>): void {
  const parent = inject(MACH_TABLE_DEFAULTS_KEY, {});
  provide(MACH_TABLE_DEFAULTS_KEY, createMachTablePreset(parent, defaults));
}

export function useMachTableDefaults<TData>(): Partial<GridOptions<TData>> {
  return inject(MACH_TABLE_DEFAULTS_KEY, {}) as Partial<GridOptions<TData>>;
}
