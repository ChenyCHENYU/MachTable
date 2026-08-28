import { RobotGrid } from "./RobotGrid";

export { RobotGrid };
export { RobotGrid as MachTable };
export type { RobotGridReactProps } from "./RobotGrid";
export { useMachGrid } from "./useMachGrid";
export type { UseMachGridReturn } from "./useMachGrid";
export { reactCellRenderer, reactDetailRenderer } from "./adapters";
export type { ReactCellRendererProps, ReactDetailProps } from "./adapters";
export * from "@agile-team/mach-table";

/** Enables `React.lazy(() => import("@agile-team/mach-table-react"))`. */
export default RobotGrid;
