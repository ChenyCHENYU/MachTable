import type { CsvExportParams } from "../types/api";

export function csvEscape(value: any, separator: string): string {
  const s = value == null ? "" : String(value);
  if (s.includes(separator) || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function sanitizeFormulaCell(value: any): any {
  if (typeof value !== "string" || value === "") return value;
  if (/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return value;
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(value)) return "'" + value;
  return value;
}

export interface CsvRowAccessor<T> {
  getHeaderLabels(): string[];
  getRowValues(): T[][];
}

export function buildCsv<T>(accessor: CsvRowAccessor<T>, params: CsvExportParams = {}): string {
  const separator = params.columnSeparator ?? ",";
  const includeHeader = params.includeHeader ?? true;
  const protectFormulas = params.protectFormulas ?? true;
  const lines: string[] = [];

  if (includeHeader) {
    lines.push(accessor.getHeaderLabels().map((l) => csvEscape(l, separator)).join(separator));
  }
  for (const row of accessor.getRowValues()) {
    lines.push(
      row.map((v) => csvEscape(protectFormulas ? sanitizeFormulaCell(v) : v, separator)).join(separator)
    );
  }

  const body = lines.join("\r\n");
  return params.prependBOM ? "\uFEFF" + body : body;
}
