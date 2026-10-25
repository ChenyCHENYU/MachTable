import { getByPath, isSafePath } from "../lib/path";
import { evaluateExpression, finite, FormulaFailure, parseFormula, type Expression, type FormulaErrorCode } from "./formulaParser";

export interface FormulaIssue { rowIndex: number; colId: string; code: FormulaErrorCode; message: string }
export interface FormulaResult<TData> { rows: Array<TData & Record<string, unknown>>; errors: FormulaIssue[] }

/** Per-record calculated columns use flat output IDs; input references may use safe nested paths. */
export function evaluateFormulas<TData extends object>(
  data: readonly TData[], formulas: Readonly<Record<string, string>>
): FormulaResult<TData> {
  const entries = Object.entries(formulas);
  if (entries.length > 32 || data.length > 10_000 || entries.length * data.length > 100_000) {
    throw new FormulaFailure("LIMIT", "Formulas support 32 columns, 10000 rows and 100000 result cells");
  }
  const compiled = new Map<string, Expression | FormulaFailure>();
  for (const [colId, source] of entries) {
    // Outputs are own properties; allowing paths would disagree with Pivot path
    // reads and could accidentally shadow unchanged nested source data.
    if (!isSafePath(colId) || /[.\[\]]/.test(colId)) {
      throw new FormulaFailure("SYNTAX", `Invalid formula column: ${colId}; use a single-level ID without dots or brackets`);
    }
    try { compiled.set(colId, parseFormula(source)); }
    catch (error) { compiled.set(colId, failure(error)); }
  }
  const errors: FormulaIssue[] = [];
  const rows = data.map((row, rowIndex) => {
    const output = { ...row } as TData & Record<string, unknown>;
    const values = evaluateRow(row, compiled);
    for (const [colId, value] of values) {
      if (value instanceof FormulaFailure) errors.push({ rowIndex, colId, code: value.code, message: value.message });
      Object.defineProperty(output, colId, { value: value instanceof FormulaFailure ? null : value, enumerable: true, configurable: true, writable: true });
    }
    return output;
  });
  return { rows, errors };
}

function failure(error: unknown): FormulaFailure {
  return error instanceof FormulaFailure ? error : new FormulaFailure("SYNTAX", error instanceof Error ? error.message : String(error));
}

function numericField(row: object, name: string): number {
  if (!isSafePath(name)) throw new FormulaFailure("UNKNOWN_FIELD", `Unknown field: ${name}`);
  const value: unknown = getByPath(row, name);
  if (value === undefined) throw new FormulaFailure("UNKNOWN_FIELD", `Unknown field: ${name}`);
  if (typeof value !== "number") throw new FormulaFailure("NON_NUMERIC", `Field is not numeric: ${name}`);
  return finite(value);
}

function evaluateRow(row: object, compiled: ReadonlyMap<string, Expression | FormulaFailure>): Map<string, number | FormulaFailure> {
  const values = new Map<string, number | FormulaFailure>();
  const active = new Set<string>();
  const resolve = (name: string): number => {
    if (!compiled.has(name)) return numericField(row, name);
    const existing = values.get(name);
    if (existing instanceof FormulaFailure) throw existing;
    if (existing != null) return existing;
    if (active.has(name)) throw new FormulaFailure("CYCLE", `Cyclic formula: ${[...active, name].join(" → ")}`);
    active.add(name);
    try {
      const expression = compiled.get(name)!;
      if (expression instanceof FormulaFailure) throw expression;
      const value = finite(evaluateExpression(expression, resolve));
      values.set(name, value);
      return value;
    } catch (error) { const issue = failure(error); values.set(name, issue); throw issue; }
    finally { active.delete(name); }
  };
  for (const name of compiled.keys()) { try { resolve(name); } catch { /* Every affected column retains its own error entry. */ } }
  return values;
}
