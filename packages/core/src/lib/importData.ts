import type { ImportMatrixOptions } from "../types/api";
import type { Column } from "../services/column";
import type { InputChange } from "../services/inputService";
import type { RowNode } from "../types/row";
import { setByPath } from "./path";
import { coerceImportedValue } from "./numericText";

export interface ImportIssue {
  /** Zero-based data-row index, excluding the header. -1 denotes the complete plan. */
  rowIndex: number;
  columnIndex?: number;
  colId?: string;
  code: "MAPPING" | "PARSE" | "VALIDATION" | "STALE" | "UNSUPPORTED";
  message: string;
}
export interface PreparedImportRow { data: Record<string, any>; node: RowNode; changes: InputChange[]; rowIndex: number }
export interface PreparedImport { rows: PreparedImportRow[]; issues: ImportIssue[] }
export interface ImportValueContext {
  columns(): Column[];
  visibleColumns(): Column[];
  read(node: RowNode, column: Column): any;
  editable(node: RowNode, column: Column): boolean;
  parse(node: RowNode, column: Column, value: unknown, oldValue: unknown): any;
}
type Context = ImportValueContext;
interface Binding { column: Column; index: number }

function bindings(core: Context, header: readonly unknown[], options: ImportMatrixOptions, strict: boolean): Binding[] {
  const columns = core.columns().filter(column => column.colDef.field);
  const names = options.columns ?? header;
  const ids = new Map(columns.map(column => [column.id, column]));
  const fields = new Map<string, Column | null>(), labels = new Map<string, Column | null>();
  for (const column of columns) {
    const field = column.colDef.field!;
    fields.set(field, fields.has(field) ? null : column);
    const label = column.colDef.headerName;
    if (label) labels.set(label, labels.has(label) ? null : column);
  }
  const matched: Binding[] = [], used = new Set<string>();
  names.forEach((name, index) => {
    const key = (typeof name === "string" || typeof name === "number" ? String(name) : "").replace(/^\uFEFF/, "").trim();
    const column = ids.get(key) ?? (fields.has(key) ? fields.get(key) : labels.get(key));
    if (!column) {
      if (strict || options.columns || fields.has(key) || labels.has(key)) throw new TypeError(`Unknown or ambiguous import column: ${key}`);
      return;
    }
    if (used.has(column.colDef.field!)) throw new TypeError(`Duplicate import column: ${column.id}`);
    used.add(column.colDef.field!); matched.push({ column, index });
  });
  if (matched.length) return matched;
  return core.visibleColumns().filter(column => column.colDef.field).map((column, index) => ({ column, index }));
}

function checkMatrix(matrix: readonly (readonly unknown[])[], header: number): void {
  if (!Array.isArray(matrix) || matrix.some(row => !Array.isArray(row))) throw new TypeError("Import requires an array of rows");
  if (!Number.isInteger(header) || header < -1 || header >= matrix.length) throw new RangeError("Invalid import header row");
  if (matrix.length - header - 1 > 10_000 || matrix.reduce((count, row) => count + row.length, 0) > 100_000) throw new RangeError("Import supports 10000 data rows and 100000 cells");
}

function parseField(core: Context, row: PreparedImportRow, column: Column, columnIndex: number, raw: unknown, options: ImportMatrixOptions): void {
  const field = column.colDef.field!;
  const oldValue = core.read(row.node, column);
  const value = options.parseValue ? options.parseValue({ value: raw, field, rowIndex: row.rowIndex, columnIndex })
    : column.colDef.valueParser ? core.parse(row.node, column, raw, oldValue)
    : coerceImportedValue(raw, options.coerceNumbers !== false);
  if (value != null && typeof value.then === "function") throw new TypeError("Import parsers must return synchronous values");
  if (!setByPath(row.data, field, value)) throw new TypeError(`Unsafe import field: ${field}`);
  row.changes.push({ node: row.node, column, oldValue, newValue: value });
}

function prepareRow(core: Context, raw: readonly unknown[], rowIndex: number, fields: Binding[], options: ImportMatrixOptions, output: PreparedImport, targets?: readonly RowNode[], records?: readonly Record<string, any>[]): void {
  const data = records?.[rowIndex] ?? {};
  const node: RowNode = targets?.[rowIndex] ?? { id: `import:${rowIndex}`, rowIndex, data, selected: false };
  const row: PreparedImportRow = { data, node, changes: [], rowIndex };
  for (const { column, index: columnIndex } of fields) {
    if (raw[columnIndex] === undefined || targets && !core.editable(node, column)) continue;
    try { parseField(core, row, column, columnIndex, raw[columnIndex], options); }
    catch (error) { output.issues.push({ rowIndex, columnIndex, colId: column.id, code: "PARSE", message: error instanceof Error ? error.message : String(error) }); }
  }
  output.rows.push(row);
}

/** Shared bounded mapping for CSV, typed matrices and optional validation plans. Never writes live rows. */
export function prepareMatrixImport(core: Context, matrix: readonly (readonly unknown[])[], options: ImportMatrixOptions = {}, targets?: readonly RowNode[], strict = false, records?: readonly Record<string, any>[]): PreparedImport {
  const header = options.headerRowIndex ?? (options.columns ? -1 : 0);
  checkMatrix(matrix, header);
  const fields = bindings(core, header < 0 ? [] : matrix[header], options, strict);
  if (!fields.length) throw new TypeError("Import requires a writable field column");
  const output: PreparedImport = { rows: [], issues: [] };
  for (let index = header + 1; index < matrix.length; index++) {
    const raw = matrix[index];
    if (!raw.some(value => value !== "" && value !== undefined)) continue;
    prepareRow(core, raw, index - header - 1, fields, options, output, targets, records);
  }
  return output;
}
