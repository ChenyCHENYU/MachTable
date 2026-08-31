/** Internal contract consumed by the official Vue and React adapters. */
export { GRID_OPTION_KEYS, GRID_OPTION_META } from "./core/gridOptionMetadata";
export {
  mergeMachTableConfig,
  normalizeMachTableConfig,
  resolveMachTableGridOptions
} from "./lib/configuration";
export type {
  MachTableOptionExplanation,
  ResolvedMachTableConfig,
  ResolvedMachTableGridOptions
} from "./lib/configuration";
