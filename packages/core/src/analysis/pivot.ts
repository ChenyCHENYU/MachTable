import { getByPath, isSafePath } from "../lib/path";
import { accumulateNumeric, createNumericAccumulator, numericResult, type NumericAccumulator } from "../lib/aggregate";

export type PivotAggregate = "sum" | "count" | "avg" | "min" | "max";
export type PivotDimension = string | number | boolean | null;
export interface PivotValue { field?: string; aggregate: PivotAggregate; label?: string }
export interface PivotOptions {
  rowFields: readonly string[];
  columnFields?: readonly string[];
  values: readonly PivotValue[];
}
export interface PivotColumn {
  id: string;
  label: string;
  dimensions: PivotDimension[];
  total: boolean;
  measure: PivotValue;
}
export interface PivotResultRow { id: string; dimensions: PivotDimension[]; values: Record<string, number | null> }
export interface PivotResult {
  columns: PivotColumn[];
  rows: PivotResultRow[];
  /** Grand-total row, aggregated from raw records (averages are weighted correctly). */
  totals: Record<string, number | null>;
  inputCount: number;
}

type Accumulator = NumericAccumulator;
interface Group { dimensions: PivotDimension[]; cells: Map<string, Accumulator> }
const AGGREGATES = new Set<PivotAggregate>(["sum", "count", "avg", "min", "max"]);

/** Typed tuples prevent collisions between null, "null", 1, "1", delimiters and prototype names. */
function tuple(values: readonly PivotDimension[]): string {
  return JSON.stringify(values.map((value) => [value === null ? "null" : typeof value, value]));
}

function dimension(value: unknown): PivotDimension {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  throw new TypeError("Pivot dimensions must be primitive values or valid Dates");
}

function validateOptions(rows: readonly unknown[], options: PivotOptions): void {
  if (rows.length > 10_000) throw new RangeError("Pivot supports at most 10000 input rows; aggregate remotely for larger datasets");
  const fields = [...options.rowFields, ...(options.columnFields ?? [])];
  if (fields.length > 12 || options.values.length > 16 || !options.values.length) throw new RangeError("Pivot supports 12 dimensions and 1–16 measures");
  for (const field of fields) if (!isSafePath(field)) throw new TypeError(`Invalid pivot field: ${field}`);
  const ids = new Set<string>();
  for (const value of options.values) {
    validateMeasure(value);
    const id = JSON.stringify([value.field ?? null, value.aggregate]);
    if (ids.has(id)) throw new TypeError("Duplicate pivot measure");
    ids.add(id);
  }
}

function validateMeasure(value: PivotValue): void {
  if (!AGGREGATES.has(value.aggregate)) throw new TypeError(`Unknown pivot aggregate: ${String(value.aggregate)}`);
  if (value.field != null && !isSafePath(value.field)) throw new TypeError(`Invalid pivot field: ${value.field}`);
  if (!value.field && value.aggregate !== "count") throw new TypeError("Numeric pivot measures require a field");
}

function accumulate(cells: Map<string, Accumulator>, id: string, value: unknown): void {
  let cell = cells.get(id);
  if (!cell) { cell = createNumericAccumulator(); cells.set(id, cell); }
  accumulateNumeric(cell, value);
}

function columnId(dimensions: readonly PivotDimension[] | null, measure: PivotValue): string {
  return JSON.stringify([dimensions === null ? "total" : tuple(dimensions), measure.field ?? null, measure.aggregate]);
}

/** Independent, bounded pivot kernel. It never mutates input records or GridApi state. */
export function createPivot<TData>(data: readonly TData[], options: PivotOptions): PivotResult {
  validateOptions(data, options);
  const rowGroups = new Map<string, Group>();
  const columns = new Map<string, PivotColumn>();
  const totals = new Map<string, Accumulator>();
  const columnFields = options.columnFields ?? [];
  for (const row of data) {
    const dimensions = options.rowFields.map((field) => dimension(getByPath(row, field)));
    const key = tuple(dimensions);
    let group = rowGroups.get(key);
    if (!group) { group = { dimensions, cells: new Map() }; rowGroups.set(key, group); }
    if (rowGroups.size > 2000) throw new RangeError("Pivot supports at most 2000 result row groups");
    const columnDimensions = columnFields.map((field) => dimension(getByPath(row, field)));
    for (const measure of options.values) {
      const value = measure.field ? getByPath(row, measure.field) : undefined;
      addCell(group, columns, totals, columnDimensions, measure, value);
      if (columnFields.length) addCell(group, columns, totals, null, measure, value);
    }
    if (columns.size > 128) throw new RangeError("Pivot supports at most 128 result columns");
  }
  // Empty input still exposes the requested measures when there is no column dimension.
  if (!data.length && !columnFields.length) {
    for (const measure of options.values) addColumn(columns, [], measure);
  }
  const ordered = [...columns.values()].sort((left, right) => Number(left.total) - Number(right.total) || left.id.localeCompare(right.id));
  const rows = [...rowGroups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([id, group]) => ({
    id, dimensions: group.dimensions, values: valuesFor(ordered, group.cells)
  }));
  return { columns: ordered, rows, totals: valuesFor(ordered, totals), inputCount: data.length };
}

function addColumn(columns: Map<string, PivotColumn>, dimensions: PivotDimension[] | null, measure: PivotValue): string {
  const id = columnId(dimensions, measure);
  if (!columns.has(id)) {
    const label = measure.label ?? `${measure.field ?? "记录"} · ${measure.aggregate}`;
    const prefix = dimensions === null ? "合计" : dimensions.map((value) => value == null ? "空值" : String(value)).join(" / ");
    columns.set(id, { id, label: prefix ? `${prefix} / ${label}` : label, dimensions: dimensions ?? [], total: dimensions === null, measure: { ...measure } });
  }
  return id;
}

function addCell(group: Group, columns: Map<string, PivotColumn>, totals: Map<string, Accumulator>, dimensions: PivotDimension[] | null, measure: PivotValue, value: unknown): void {
  const id = addColumn(columns, dimensions, measure);
  accumulate(group.cells, id, value);
  accumulate(totals, id, value);
}

function valuesFor(columns: readonly PivotColumn[], cells: Map<string, Accumulator>): Record<string, number | null> {
  const values: Record<string, number | null> = Object.create(null);
  for (const column of columns) values[column.id] = numericResult(cells.get(column.id), column.measure.aggregate);
  return values;
}
