export type SummaryScope = "page" | "selected" | "query";

export type SemanticSummaryMetric<TData> =
  | { id: string; kind: "sum"; value(row: TData): unknown }
  | { id: string; kind: "count" }
  | { id: string; kind: "ratio"; numerator(row: TData): unknown; denominator(row: TData): unknown }
  | { id: string; kind: "none" };

/** Inject existing decimal arithmetic here; validation and divide-by-zero policy belong to the adapter. */
export interface SummaryNumericStrategy<TValue> {
  zero(): TValue;
  add(total: TValue, value: unknown): TValue;
  divide(numerator: TValue, denominator: TValue): TValue | null;
}

export interface SemanticSummaryOptions<TData, TValue = number> {
  /** Describes rows supplied by the caller; "query" never fetches more rows. */
  scope: SummaryScope;
  metrics: readonly SemanticSummaryMetric<TData>[];
  /** Stable currency/unit composition is an application decision; typed keys stay distinct. */
  groupBy?: (row: TData) => string | number;
  numeric?: SummaryNumericStrategy<TValue>;
}

export interface SemanticSummaryResult<TValue = number> {
  scope: SummaryScope;
  groups: Array<{
    key: string | number | undefined;
    rowCount: number;
    values: Record<string, TValue | number | null>;
  }>;
}

function safeNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
    throw new TypeError("[MachTable] Summary arithmetic requires finite numbers within the safe range; provide numeric for decimal strings or exact arithmetic.");
  }
  return value;
}

function synchronous<T>(value: T): T {
  if (value != null && typeof (value as { then?: unknown }).then === "function") {
    void Promise.resolve(value).catch(() => undefined);
    throw new TypeError("[MachTable] Summary numeric callbacks must return synchronous values.");
  }
  return value;
}

const numberStrategy: SummaryNumericStrategy<number> = {
  zero: () => 0,
  add: (total, value) => safeNumber(total + safeNumber(value)),
  divide: (numerator, denominator) => denominator === 0 ? null : safeNumber(numerator / denominator)
};

interface MetricTotals<TValue> {
  value: TValue;
  denominator: TValue;
}
interface GroupTotals<TValue> {
  rowCount: number;
  totals: Map<string, MetricTotals<TValue>>;
}

function createTotals<TData, TValue>(metrics: readonly SemanticSummaryMetric<TData>[], numeric: SummaryNumericStrategy<TValue>): GroupTotals<TValue> {
  const totals = new Map<string, MetricTotals<TValue>>();
  for (const metric of metrics) {
    if (metric.kind === "sum" || metric.kind === "ratio") {
      totals.set(metric.id, { value: synchronous(numeric.zero()), denominator: synchronous(numeric.zero()) });
    }
  }
  return { rowCount: 0, totals };
}

function accumulate<TData, TValue>(row: TData, group: GroupTotals<TValue>, metrics: readonly SemanticSummaryMetric<TData>[], numeric: SummaryNumericStrategy<TValue>): void {
  group.rowCount++;
  for (const metric of metrics) {
    if (metric.kind === "count" || metric.kind === "none") continue;
    const totals = group.totals.get(metric.id)!;
    const value = metric.kind === "sum" ? metric.value(row) : metric.numerator(row);
    if (value != null && value !== "") totals.value = synchronous(numeric.add(totals.value, value));
    if (metric.kind === "ratio") {
      const denominator = metric.denominator(row);
      if (denominator != null && denominator !== "") totals.denominator = synchronous(numeric.add(totals.denominator, denominator));
    }
  }
}

function resultValues<TData, TValue>(group: GroupTotals<TValue>, metrics: readonly SemanticSummaryMetric<TData>[], numeric: SummaryNumericStrategy<TValue>): Record<string, TValue | number | null> {
  const values: Record<string, TValue | number | null> = Object.create(null);
  for (const metric of metrics) {
    if (metric.kind === "none") continue;
    if (metric.kind === "count") values[metric.id] = group.rowCount;
    else {
      const total = group.totals.get(metric.id)!;
      values[metric.id] = metric.kind === "sum" ? total.value : synchronous(numeric.divide(total.value, total.denominator));
    }
  }
  return values;
}

/** O(rows × metrics) local aggregation, with explicit scope and no implicit currency/unit mixing. */
export function summarizeRows<TData, TValue = number>(
  rows: readonly TData[],
  options: SemanticSummaryOptions<TData, TValue>
): SemanticSummaryResult<TValue> {
  const ids = new Set<string>();
  for (const metric of options.metrics) {
    if (!metric.id || ids.has(metric.id)) throw new TypeError("[MachTable] Summary metric IDs must be non-empty and unique.");
    ids.add(metric.id);
  }
  const numeric = options.numeric ?? numberStrategy as unknown as SummaryNumericStrategy<TValue>;
  const groups = new Map<string | number | undefined, GroupTotals<TValue>>();
  if (!options.groupBy) groups.set(undefined, createTotals(options.metrics, numeric));
  for (const row of rows) {
    const key = options.groupBy?.(row);
    if (options.groupBy && typeof key !== "string" && (typeof key !== "number" || !Number.isFinite(key))) {
      throw new TypeError("[MachTable] Summary group keys must be strings or finite numbers.");
    }
    let group = groups.get(key);
    if (!group) { group = createTotals(options.metrics, numeric); groups.set(key, group); }
    accumulate(row, group, options.metrics, numeric);
  }
  return {
    scope: options.scope,
    groups: [...groups].map(([key, group]) => ({ key, rowCount: group.rowCount, values: resultValues(group, options.metrics, numeric) }))
  };
}
