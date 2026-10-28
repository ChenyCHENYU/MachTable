import { describe, expect, it, vi } from "vitest";
import { summarizeRows, type SemanticSummaryMetric, type SummaryNumericStrategy } from "../business";

type Row = { amount: unknown; actual: unknown; target: unknown; currency: string; unit: string };
const metrics: SemanticSummaryMetric<Row>[] = [
  { id: "amount", kind: "sum", value: row => row.amount },
  { id: "count", kind: "count" },
  { id: "rate", kind: "ratio", numerator: row => row.actual, denominator: row => row.target },
  { id: "unitPrice", kind: "none" }
];
const row = (amount: unknown, actual: unknown = 0, target: unknown = 0, currency = "CNY", unit = "t"): Row => ({ amount, actual, target, currency, unit });

describe("semantic row summaries", () => {
  it("sums numerators and denominators before division and omits metrics with no aggregation", () => {
    const rows = [row(10, 1, 2), row(20, 9, 10)];
    const result = summarizeRows(rows, { scope: "page", metrics });
    expect(result.scope).toBe("page");
    expect(result.groups).toEqual([{ key: undefined, rowCount: 2, values: { amount: 30, count: 2, rate: 10 / 12 } }]);
    expect(result.groups[0].values).not.toHaveProperty("unitPrice");
    expect(rows[0].amount).toBe(10);
  });

  it("lets the caller group by currency and unit without silently combining incompatible amounts", () => {
    const rows = [row(10, 0, 1), row(20, 1, 1, "USD"), row(30, 2, 4, "CNY", "kg"), row(40, 1, 1)];
    const result = summarizeRows(rows, { scope: "selected", metrics, groupBy: item => JSON.stringify([item.currency, item.unit]) });
    expect(result.groups.map(group => [group.key, group.values.amount, group.rowCount])).toEqual([
      ['["CNY","t"]', 50, 2], ['["USD","t"]', 20, 1], ['["CNY","kg"]', 30, 1]
    ]);
    expect(result.scope).toBe("selected");
  });

  it("marks query scope without fetching data or treating supplied rows as a complete remote query", () => {
    const value = vi.fn((item: Row) => item.amount);
    const result = summarizeRows([row(3)], { scope: "query", metrics: [{ id: "amount", kind: "sum", value }] });
    expect(result).toEqual({ scope: "query", groups: [{ key: undefined, rowCount: 1, values: { amount: 3 } }] });
    expect(value).toHaveBeenCalledTimes(1);
  });

  it("distinguishes true zero from absent data and returns null for a zero denominator", () => {
    const result = summarizeRows([row(null), row(undefined), row(""), row(0)], { scope: "page", metrics });
    expect(result.groups[0].values).toEqual({ amount: 0, count: 4, rate: null });
    expect(summarizeRows([], { scope: "page", metrics }).groups).toEqual([{ key: undefined, rowCount: 0, values: { amount: 0, count: 0, rate: null } }]);
    expect(summarizeRows([], { scope: "page", metrics, groupBy: item => item.currency }).groups).toEqual([]);
  });

  it.each([NaN, Infinity, -Infinity, "12.50", false, Number.MAX_SAFE_INTEGER + 1])("rejects unsupported default numeric input %s instead of coercing it", value => {
    expect(() => summarizeRows([row(value)], { scope: "page", metrics })).toThrow("finite numbers within the safe range");
  });

  it("rejects overflow in accumulated sums and ratios", () => {
    expect(() => summarizeRows([row(Number.MAX_SAFE_INTEGER), row(1)], { scope: "page", metrics })).toThrow("safe range");
    expect(() => summarizeRows([row(0, 1, Number.MIN_VALUE)], { scope: "page", metrics })).toThrow("safe range");
  });

  it("uses injected exact arithmetic for decimal strings without a decimal runtime dependency", () => {
    // Demonstration of a caller-owned fixed-scale adapter; no Number conversion or rounding in the helper.
    const scaled = (value: unknown): bigint => {
      if (typeof value !== "string" || !/^-?\d+\.\d{3}$/.test(value)) throw new TypeError("Expected a three-place decimal string");
      return BigInt(value.replace(".", ""));
    };
    const numeric: SummaryNumericStrategy<bigint> = {
      zero: () => 0n,
      add: (total, value) => total + scaled(value),
      divide: (numerator, denominator) => denominator === 0n ? null : numerator * 1000n / denominator
    };
    const result = summarizeRows([row("1.005", "1.000", "2.000"), row("-0.005", "2.000", "3.000")], { scope: "page", metrics, numeric });
    expect(result.groups[0].values).toEqual({ amount: 1000n, count: 2, rate: 600n });
  });

  it("rejects duplicate metric IDs and keeps typed group keys and unsafe object keys separate", () => {
    expect(() => summarizeRows([], { scope: "page", metrics: [{ id: "x", kind: "count" }, { id: "x", kind: "none" }] })).toThrow("unique");
    const result = summarizeRows([1, "1"], { scope: "page", metrics: [{ id: "__proto__", kind: "count" }], groupBy: value => value });
    expect(result.groups.map(group => group.key)).toEqual([1, "1"]);
    expect(result.groups[0].values["__proto__"]).toBe(1);
    expect(() => summarizeRows([row(1)], { scope: "page", metrics, groupBy: () => NaN })).toThrow("group keys");
  });

  it("rejects async arithmetic before a Promise can become a summary value", () => {
    const numeric: SummaryNumericStrategy<Promise<number>> = {
      zero: () => Promise.reject(new Error("async zero failed")),
      add: total => total,
      divide: () => null
    };
    expect(() => summarizeRows([row(1)], { scope: "page", metrics, numeric })).toThrow("must return synchronous values");
  });
});
