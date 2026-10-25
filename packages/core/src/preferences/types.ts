import type { GridState } from "../types/state";
import type { GridStateStore } from "../types/options";
import type { FilterType } from "../types/colDef";

export interface GridStateMigrationOptions {
  /** Current stable column IDs; removed IDs are not restored. */
  columns: readonly string[];
  /** Explicit old ID → current ID mapping, applied to layout, sort and filters. */
  renameColumns?: Readonly<Record<string, string>>;
  /** Optional target filter types. Omitted IDs keep their existing type; false disables filtering. */
  columnTypes?: Readonly<Record<string, FilterType | false>>;
}

export interface GridStateMigrationIssue {
  code: "VERSION_MIGRATED" | "UNSUPPORTED_VERSION" | "INVALID_STATE" | "REMOVED_COLUMN" |
    "RENAMED_COLUMN" | "DUPLICATE_COLUMN" | "TYPE_CHANGED" | "INVALID_FILTER" | "NORMALIZED" | "LIMIT_EXCEEDED";
  path: string;
  from?: string;
  to?: string;
}

export interface GridStateMigrationResult {
  state: GridState | null;
  report: GridStateMigrationIssue[];
}

/** Application identity, independent from the table's existing persistence key. */
export interface GridPreferenceIdentity {
  tenantId: string;
  userId: string;
  pageId: string;
  schemaId: string;
}

export interface GridPreferenceRequest {
  identity: Readonly<GridPreferenceIdentity>;
  key: string;
  signal: AbortSignal;
}

export interface GridPreferenceRecord {
  state: unknown;
  revision: string;
}

export interface GridPreferenceSaveRequest extends GridPreferenceRequest {
  state: GridState;
  /** null means create only; the transport must compare atomically on the server. */
  expectedRevision: string | null;
}

export interface GridPreferenceStoreOptions extends GridStateMigrationOptions {
  /** Checked at start/completion. An instance binds its first valid identity; changes invalidate it. */
  identity(): GridPreferenceIdentity | null;
  load(request: GridPreferenceRequest): GridPreferenceRecord | null | Promise<GridPreferenceRecord | null>;
  save(request: GridPreferenceSaveRequest): { revision: string } | Promise<{ revision: string }>;
  /** An observer; exceptions are isolated from persistence. */
  onMigration?(result: GridStateMigrationResult, request: GridPreferenceRequest): void;
}

export interface GridPreferenceStore extends GridStateStore {
  /** Abort in-flight transport and reject queued operations; idempotent. */
  dispose(): void;
}

/** Transports can use this error for an authoritative server-side CAS conflict. */
export class GridPreferenceConflictError extends Error {
  readonly expectedRevision: string | null;
  readonly actualRevision?: string;

  constructor(expectedRevision: string | null, actualRevision?: string) {
    super("[MachTable] Grid preference revision conflict; reload and review before saving again.");
    this.name = "GridPreferenceConflictError";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}
