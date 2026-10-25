/** Optional identity-aware preference transport and explainable state migration. */
export { createGridPreferenceStore } from "./preferences/store";
export { migrateGridState } from "./preferences/migrate";
export { GridPreferenceConflictError } from "./preferences/types";
export type {
  GridPreferenceIdentity,
  GridPreferenceRecord,
  GridPreferenceRequest,
  GridPreferenceSaveRequest,
  GridPreferenceStore,
  GridPreferenceStoreOptions,
  GridStateMigrationIssue,
  GridStateMigrationOptions,
  GridStateMigrationResult
} from "./preferences/types";
