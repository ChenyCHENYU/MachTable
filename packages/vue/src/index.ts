import { MachTable, RobotGrid } from "./RobotGrid";
import { MachTablePlugin } from "./plugin";

export { MachTable, RobotGrid };
export type { MachTableVueProps, RobotGridVueProps } from "./RobotGrid";
export { vueCellRenderer, vueDetailRenderer } from "./adapters";
export { useMachTable } from "./useMachTable";
export type { UseMachTableReturn } from "./useMachTable";
export type { VueCellRendererProps } from "./adapters";
export { MachTablePlugin } from "./plugin";
export type { MachTablePluginOptions } from "./plugin";
export {
  MACH_TABLE_CONFIG_KEY,
  MACH_TABLE_DEFAULTS_KEY,
  provideMachTableConfig,
  provideMachTableDefaults,
  useMachTableConfig,
  useMachTableDefaults
} from "./defaults";
export type { MachTableConfigSource } from "./defaults";
export {
  defineMachTableConfig,
  mergeMachTableConfig,
  normalizeMachTableConfig,
  resolveMachTableGridOptions
} from "./configuration";
export type {
  MachTableConfigWarning,
  MachTableOptionExplanation,
  MachTablePresetSelection,
  MachTableRuntimeConfig,
  ResolvedMachTableConfig,
  ResolvedMachTableGridOptions
} from "./configuration";
export * from "@agile-team/mach-table";

export default MachTablePlugin;
