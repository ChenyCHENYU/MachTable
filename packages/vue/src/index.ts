import { MachTable, RobotGrid } from "./RobotGrid";
import { MachTablePlugin } from "./plugin";

export { MachTable, RobotGrid };
export type { MachTableVueProps, RobotGridVueProps } from "./RobotGrid";
export {
  vueCellEditorSlot,
  vueCellRenderer,
  vueCellSlotRenderer,
  vueDetailRenderer,
  vueDetailSlotRenderer,
  vueHeaderSlotRenderer,
  vueOverlaySlot
} from "./adapters";
export { useMachTable } from "./useMachTable";
export type { UseMachTableReturn } from "./useMachTable";
export { useMachTableEditing } from "./useMachTableEditing";
export type {
  UseMachTableEditingOptions,
  UseMachTableEditingReturn
} from "./useMachTableEditing";
export { useMachTableQuery } from "./useMachTableQuery";
export type {
  MachTablePageRequest,
  MachTablePageResult,
  MachTableQuerySource,
  MachTableRemoteSelectionState,
  UseMachTableQueryOptions,
  UseMachTableQueryReturn
} from "./useMachTableQuery";
export type { VueCellRendererProps } from "./adapters";
export type { VueCellEditorSlotProps } from "./adapters";
export { applyVueSlots, createVueSlotEnhancer } from "./slots";
export type { MachTableVueSlots } from "./slots";
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
