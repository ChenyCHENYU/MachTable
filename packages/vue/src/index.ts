import { MachTable } from "./MachTable";
import { MachTablePlugin } from "./plugin";

export { MachTable };
export type { MachTableVueComponent, MachTableVueExposed, MachTableVueProps } from "./MachTable";
export { useMachTable } from "./useMachTable";
export type { UseMachTableReturn } from "./useMachTable";
export { MachTablePlugin } from "./plugin";
export type { MachTablePluginOptions } from "./plugin";
export {
  MACH_TABLE_CONFIG_KEY,
  provideMachTableConfig,
  useMachTableConfig
} from "./defaults";
export type { MachTableConfigSource } from "./defaults";
export * from "@agile-team/mach-table";

export default MachTablePlugin;
