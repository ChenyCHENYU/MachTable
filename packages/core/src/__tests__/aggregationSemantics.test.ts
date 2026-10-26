import { describe, expect, it, vi } from "vitest";
import { aggregateItems, BUILTIN_AGG_FUNCS, createAggResolver } from "../lib/aggregate";
import { createPivot, type PivotAggregate } from "../analysis/pivot";

const numericAggregates = ["sum", "avg", "min", "max"] as const;

describe("shared finite aggregation semantics", () => {
  it.each(numericAggregates)("%s ignores nonfinite and nonnumeric inputs and returns null without numbers", (name) => {
    expect(BUILTIN_AGG_FUNCS[name]([null, undefined, "3", NaN, Infinity, -Infinity])).toBeNull();
    expect(BUILTIN_AGG_FUNCS[name]([2, 8, null, "3", NaN, Infinity, -Infinity])).toBe({ sum: 10, avg: 5, min: 2, max: 8 }[name]);
    expect(BUILTIN_AGG_FUNCS[name]([])).toBeNull();
  });

  it("handles large groups without argument spreading or changing record-count semantics", () => {
    const values = Array.from({ length: 300_000 }, (_, index) => index - 150_000);
    expect(BUILTIN_AGG_FUNCS.min(values)).toBe(-150_000);
    expect(BUILTIN_AGG_FUNCS.max(values)).toBe(149_999);
    expect(BUILTIN_AGG_FUNCS.sum(values)).toBe(-150_000);
    expect(BUILTIN_AGG_FUNCS.count([null, undefined, NaN, Infinity])).toBe(4);
  });

  it.each([[], [null, "4", NaN, Infinity], [2, 4, Infinity], [Number.MAX_VALUE, Number.MAX_VALUE]].map((values) => ({ values })))("matches pivot totals for $values", ({ values }) => {
    const aggregates: PivotAggregate[] = [...numericAggregates, "count"];
    const pivot = createPivot(values.map((value) => ({ value })), {
      rowFields: [], values: aggregates.map((aggregate) => ({ field: "value", aggregate }))
    });
    for (const column of pivot.columns) expect(pivot.totals[column.id]).toBe(BUILTIN_AGG_FUNCS[column.measure.aggregate](values));
  });

  it("retains custom overrides and first/last raw values", () => {
    const custom = (values: unknown[]) => values;
    const values = [undefined, Infinity];
    expect(createAggResolver({ sum: custom })("sum")?.(values)).toBe(values);
    expect(BUILTIN_AGG_FUNCS.first(values)).toBeUndefined();
    expect(BUILTIN_AGG_FUNCS.last(values)).toBe(Infinity);
    expect(aggregateItems(values, custom, (value) => value)).toEqual(values);
    expect(aggregateItems(values, createAggResolver({ sum: () => 42 })("sum")!, (value) => value)).toBe(42);
  });

  it("counts built-in records without reading values while preserving custom count arrays", () => {
    const read = vi.fn((value: unknown) => value);
    const rows = [null, NaN, Infinity, "3"];
    expect(aggregateItems(rows, BUILTIN_AGG_FUNCS.count, read)).toBe(4);
    expect(read).not.toHaveBeenCalled();
    const count = vi.fn((values: unknown[]) => values.length);
    expect(aggregateItems(rows, count, read)).toBe(4);
    expect(count).toHaveBeenCalledWith(rows);
    expect(read).toHaveBeenCalledTimes(4);
  });

  it("agrees with an independent seeded finite oracle", () => {
    let seed = 0x64a19;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000);
    for (let trial = 0; trial < 80; trial++) {
      const values = Array.from({ length: Math.floor(random() * 150) }, () => [null, NaN, Infinity, "4", Math.floor(random() * 200) - 100][Math.floor(random() * 5)]);
      const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      const sum = finite.reduce((total, value) => total + value, 0);
      const expected = { sum: finite.length ? sum : null, avg: finite.length ? sum / finite.length : null, min: finite.length ? Math.min(...finite) : null, max: finite.length ? Math.max(...finite) : null };
      for (const name of numericAggregates) expect(BUILTIN_AGG_FUNCS[name](values)).toBe(expected[name]);
    }
  });
});
