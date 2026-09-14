export { defineMachTableConfig } from "@agile-team/mach-table";
import type { MachTableVueProps } from "./MachTable";

/** Defines stable per-table Vue props without exposing type assertions to pages. */
export function defineVueTableConfig<TData = object>(
  config: MachTableVueProps<TData>,
): MachTableVueProps<TData> {
  return config;
}

export {
  mergeMachTableConfig,
  normalizeMachTableConfig,
  resolveMachTableGridOptions
} from "@agile-team/mach-table/adapter";
export type {
  MachTableConfigWarning,
  MachTablePresetSelection,
  MachTableRuntimeConfig,
} from "@agile-team/mach-table";
export type {
  MachTableOptionExplanation,
  ResolvedMachTableConfig,
  ResolvedMachTableGridOptions
} from "@agile-team/mach-table/adapter";
