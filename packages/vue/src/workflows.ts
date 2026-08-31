/**
 * Optional B-side workflow entry.
 *
 * Importing from `@agile-team/mach-table-vue/workflows` lets bundlers avoid
 * evaluating the component/plugin entry when a module only needs composables.
 * Keeping workflows on a dedicated subpath avoids loading them on simple tables.
 */
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
export { useMachTableController } from "./useMachTableController";
export type { UseMachTableControllerOptions, UseMachTableControllerReturn } from "./useMachTableController";
