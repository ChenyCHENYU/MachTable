/** Numeric text syntax is shared by value coercion and spreadsheet formula protection. */
export const NUMERIC_TEXT = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Never round identifiers or turn non-finite text into a number. */
export function coerceImportedValue(value: unknown, coerce = true): unknown {
  if (value === "") return null;
  if (!coerce || typeof value !== "string" || !NUMERIC_TEXT.test(value) || /^[+-]?0\d/.test(value)) return value;
  const number = Number(value);
  return Number.isFinite(number) && (!Number.isInteger(number) || Number.isSafeInteger(number)) ? number : value;
}
