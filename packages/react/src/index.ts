import { MachTable } from "./MachTable";

export { MachTable };
export type { MachTableReactProps } from "./MachTable";
export { useMachTable } from "./useMachTable";
export type { UseMachTableReturn } from "./useMachTable";
export { MachTableProvider, useMachTableConfig } from "./defaults";
export type { MachTableProviderProps } from "./defaults";
export * from "@agile-team/mach-table";

/** Enables `React.lazy(() => import("@agile-team/mach-table-react"))`. */
export default MachTable;
