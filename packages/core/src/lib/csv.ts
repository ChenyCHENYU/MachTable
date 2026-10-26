import type { CsvExportParams } from "../types/api";
import { NUMERIC_TEXT } from "./numericText";

export function csvEscape(value: any, separator: string): string {
  const s = value == null ? "" : String(value);
  if (s.includes(separator) || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function sanitizeFormulaCell(value: any): any {
  if (typeof value !== "string" || value === "") return value;
  if (NUMERIC_TEXT.test(value)) return value;
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(value)) return "'" + value;
  return value;
}

/** Headers, selection and value policies are resolved once by the matrix exporter. */
export function buildCsv(rows: readonly (readonly unknown[])[], params: CsvExportParams = {}): string {
  const separator = params.columnSeparator ?? ",";
  const protectFormulas = params.protectFormulas ?? true;
  const body = rows.map(row => row.map(value => csvEscape(protectFormulas ? sanitizeFormulaCell(value) : value, separator)).join(separator)).join("\r\n");
  return params.prependBOM ? "\uFEFF" + body : body;
}
