import { MachTable, RobotGrid } from "./MachTable";

export { MachTable, RobotGrid };
export type { MachTableReactProps, RobotGridReactProps } from "./MachTable";
export { useMachGrid } from "./useMachGrid";
export type { UseMachGridReturn } from "./useMachGrid";
export { MachTableProvider, useMachTableDefaults } from "./defaults";
export type { MachTableProviderProps } from "./defaults";
export { reactCellRenderer, reactDetailRenderer } from "./adapters";
export type { ReactCellRendererProps, ReactDetailProps } from "./adapters";
export * from "@agile-team/mach-table";

/** Enables `React.lazy(() => import("@agile-team/mach-table-react"))`. */
export default MachTable;
