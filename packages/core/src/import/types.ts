import type { ImportMatrixOptions } from "../types/api";
import type { ImportIssue } from "../lib/importData";
export type { ImportIssue };

export type ImportSource<TData = Record<string, unknown>> =
  | { kind: "matrix"; rows: readonly (readonly unknown[])[] }
  | { kind: "rows"; rows: readonly TData[] };
export type ImportPlanOptions = ImportMatrixOptions;
export interface ImportPreviewCell { rowIndex: number; colId: string; value: unknown }
export interface ImportPreview {
  status: "ready" | "invalid" | "stale" | "destroyed";
  rowCount: number;
  cells: readonly ImportPreviewCell[];
  issues: readonly ImportIssue[];
}
export interface ImportResult {
  status: "applied" | "partial" | "invalid" | "stale" | "destroyed";
  importedRowCount: number;
  issues: readonly ImportIssue[];
}
export interface ImportPlan {
  /** Re-parse and validate the bounded input snapshot; a newer preview cancels the older one. */
  preview(): Promise<ImportPreview>;
  /** Uses the last successful preview, or previews once if none exists. A plan commits at most once. */
  commit(): Promise<ImportResult>;
  destroy(): void;
}
