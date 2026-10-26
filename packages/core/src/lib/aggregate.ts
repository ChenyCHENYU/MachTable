export type AggValues = Record<string, any>;

export type AggFunction = (values: any[]) => any;

export type NumericAggregate = "sum" | "avg" | "count" | "min" | "max";
export interface NumericAccumulator { count: number; numeric: number; sum: number; min: number; max: number }

export function createNumericAccumulator(): NumericAccumulator {
  return { count: 0, numeric: 0, sum: 0, min: Infinity, max: -Infinity };
}

/** Count records independently from finite numeric values; never coerce user data. */
export function accumulateNumeric(cell: NumericAccumulator, value: unknown): void {
  cell.count++;
  if (typeof value !== "number" || !Number.isFinite(value)) return;
  cell.numeric++;
  cell.sum += value;
  cell.min = Math.min(cell.min, value);
  cell.max = Math.max(cell.max, value);
}

export function numericResult(cell: NumericAccumulator | undefined, aggregate: NumericAggregate): number | null {
  if (aggregate === "count") return cell?.count ?? 0;
  if (!cell?.numeric) return null;
  if (aggregate === "min") return cell.min;
  if (aggregate === "max") return cell.max;
  // An overflowing sum cannot produce a trustworthy average either.
  if (!Number.isFinite(cell.sum)) return null;
  return aggregate === "avg" ? cell.sum / cell.numeric : cell.sum;
}

function numeric(values: readonly unknown[], aggregate: NumericAggregate): number | null {
  const cell = createNumericAccumulator();
  for (const value of values) accumulateNumeric(cell, value);
  return numericResult(cell, aggregate);
}

export const BUILTIN_AGG_FUNCS: Record<string, AggFunction> = {
  sum: (values) => numeric(values, "sum"),
  avg: (values) => numeric(values, "avg"),
  count: (values) => values.length,
  min: (values) => numeric(values, "min"),
  max: (values) => numeric(values, "max"),
  first: (values) => (values.length > 0 ? values[0] : null),
  last: (values) => (values.length > 0 ? values[values.length - 1] : null)
};

/** Built-ins can stream column values; custom aggregates retain their complete raw-array contract. */
export function aggregateItems<T>(items: readonly T[], fn: AggFunction, read: (item: T) => unknown): unknown {
  if (fn === BUILTIN_AGG_FUNCS.count) return items.length;
  const aggregate = (["sum", "avg", "min", "max"] as const).find((name) => fn === BUILTIN_AGG_FUNCS[name]);
  if (!aggregate) return fn(items.map(read));
  const cell = createNumericAccumulator();
  for (const item of items) accumulateNumeric(cell, read(item));
  return numericResult(cell, aggregate);
}

export function createAggResolver(custom?: Record<string, AggFunction>): (name: string) => AggFunction | undefined {
  const merged = { ...BUILTIN_AGG_FUNCS, ...(custom ?? {}) };
  return (name: string) => merged[name];
}
