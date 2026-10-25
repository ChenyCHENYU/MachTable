import { describe, expect, it } from "vitest";
import { createPivot, evaluateFormulas } from "../analysis";

describe("independent pivot kernel", () => {
  it("builds stable typed columns, row groups and weighted total averages", () => {
    const data = [{ city: "A", year: 2025, amount: 10 }, { city: "A", year: 2025, amount: 20 }, { city: "B", year: 2026, amount: 90 }];
    const result = createPivot(data, { rowFields: ["city"], columnFields: ["year"], values: [{ field: "amount", aggregate: "avg" }] });
    expect(result.rows).toHaveLength(2);
    expect(result.columns).toHaveLength(3);
    const total = result.columns.find((column) => column.total)!;
    expect(result.totals[total.id]).toBe(40);
    expect(result.rows.find((row) => row.dimensions[0] === "A")?.values[total.id]).toBe(15);
    const reordered = createPivot([...data].reverse(), { rowFields: ["city"], columnFields: ["year"], values: [{ field: "amount", aggregate: "avg" }] });
    expect(result.columns.map((column) => column.id)).toEqual(reordered.columns.map((column) => column.id));
    expect(result.rows.map((row) => row.id)).toEqual(reordered.rows.map((row) => row.id));
  });

  it("keeps null/string/number/boolean/delimiter/prototype groups distinct", () => {
    const dimensions = [null, "null", 1, "1", false, "false", "a|b", "__proto__"];
    const result = createPivot(dimensions.map((group) => ({ group })), { rowFields: ["group"], values: [{ aggregate: "count" }] });
    expect(result.rows).toHaveLength(dimensions.length);
    expect(new Set(result.rows.map((row) => row.id)).size).toBe(dimensions.length);
    expect(Object.values(result.totals)).toEqual([dimensions.length]);
  });

  it("counts records and excludes nonnumeric values from numeric aggregates", () => {
    const result = createPivot([{ value: 2 }, { value: 8 }, { value: "100" }, { value: null }, { value: NaN }], {
      rowFields: [], values: ["sum", "avg", "min", "max", "count"].map((aggregate) => ({ field: "value", aggregate: aggregate as "sum" | "avg" | "min" | "max" | "count" }))
    });
    const values = Object.fromEntries(result.columns.map((column) => [column.measure.aggregate, result.totals[column.id]]));
    expect(values).toEqual({ sum: 10, avg: 5, min: 2, max: 8, count: 5 });
  });

  it("returns explicit null for missing numeric cells and handles empty input", () => {
    const result = createPivot([{ x: "A", y: "1", n: null }, { x: "B", y: "2", n: 4 }], { rowFields: ["x"], columnFields: ["y"], values: [{ field: "n", aggregate: "sum" }] });
    const column = result.columns.find((entry) => entry.dimensions[0] === "1")!;
    expect(result.rows[0].values[column.id]).toBeNull();
    const empty = createPivot([], { rowFields: [], values: [{ aggregate: "count" }, { field: "n", aggregate: "avg" }] });
    expect(empty.rows).toEqual([]);
    expect(Object.values(empty.totals)).toContain(0);
    expect(Object.values(empty.totals)).toContain(null);
  });

  it("supports nested safe paths without mutating records", () => {
    const row = Object.freeze({ dimensions: Object.freeze({ region: "East" }), metric: Object.freeze({ amount: 3 }) });
    const result = createPivot([row], { rowFields: ["dimensions.region"], values: [{ field: "metric.amount", aggregate: "sum" }] });
    expect(result.rows[0].dimensions).toEqual(["East"]);
    expect(Object.values(result.totals)).toEqual([3]);
    expect(() => createPivot([row], { rowFields: ["__proto__.x"], values: [{ aggregate: "count" }] })).toThrow("Invalid pivot field");
  });

  it("enforces result/input bounds rather than silently truncating", () => {
    expect(() => createPivot(Array(10001).fill({}), { rowFields: [], values: [{ aggregate: "count" }] })).toThrow("10000");
    expect(() => createPivot(Array.from({ length: 129 }, (_, group) => ({ group })), { rowFields: [], columnFields: ["group"], values: [{ aggregate: "count" }] })).toThrow("128");
    expect(() => createPivot([{ n: 1 }], { rowFields: [], values: [{ field: "n", aggregate: "sum" }, { field: "n", aggregate: "sum" }] })).toThrow("Duplicate");
  });
});

describe("safe formula evaluation", () => {
  it("parses precedence, parentheses, right-associative powers and unary signs", () => {
    const result = evaluateFormulas([{ amount: 3 }], { a: "1+2*3", b: "(1+2)*3", c: "2^3^2", d: "-2^2", e: "2^-2", f: "=[amount] + .5e2" });
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({ amount: 3, a: 7, b: 9, c: 512, d: -4, e: .25, f: 53 });
  });

  it("resolves calculated dependencies and limited aggregation functions per record", () => {
    const original = Object.freeze({ quantity: 2, price: 3, nested: { tax: 1 } });
    const result = evaluateFormulas([original], { total: "[gross] + [nested.tax]", gross: "quantity * price", mean: "AVG([gross], 4)", low: "MIN(3,4,5)", high: "MAX(3,4,5)", sum: "SUM()" });
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({ total: 7, gross: 6, mean: 5, low: 3, high: 5, sum: 0 });
    expect(original).not.toHaveProperty("gross");
  });

  it.each([
    ["1 / 0", "DIV_ZERO"], ["2 % 0", "DIV_ZERO"], ["[unknown] + 1", "UNKNOWN_FIELD"],
    ["[name] * 2", "NON_NUMERIC"], ["1e999", "NON_FINITE"], ["2^9999", "NON_FINITE"],
    ["window.alert(1)", "SYNTAX"], ["(()=>1)()", "SYNTAX"], ["1 constructor 2", "SYNTAX"], ["AVG()", "SYNTAX"]
  ])("reports %s without executing or silently coercing values", (formula, code) => {
    const result = evaluateFormulas([{ name: "42" }], { calc: formula });
    expect(result.rows[0].calc).toBeNull();
    expect(result.errors).toEqual([expect.objectContaining({ rowIndex: 0, colId: "calc", code })]);
  });

  it.each(["tax.total", "items[0]", "tax]", "[tax]"])("rejects path-like output ID %s before evaluating records", (colId) => {
    const tax = Object.freeze({ total: 7 });
    const source = Object.freeze({ tax });
    expect(() => evaluateFormulas([source], { [colId]: "[tax.total] * 2" })).toThrow("single-level ID");
    expect(source.tax).toBe(tax);
    expect(source.tax.total).toBe(7);
    expect(Object.keys(source)).toEqual(["tax"]);
  });

  it("pivots flat Chinese formula outputs while retaining safe nested input references", () => {
    const tax = Object.freeze({ total: 7 });
    const source = Object.freeze({ region: "East", tax });
    const calculated = evaluateFormulas([source], { 税额: "[tax.total] * 2", 应付: "[税额] + 1" });
    expect(calculated.errors).toEqual([]);
    expect(calculated.rows[0]).toMatchObject({ 税额: 14, 应付: 15 });
    expect(calculated.rows[0].tax).toBe(tax);
    const pivot = createPivot(calculated.rows, { rowFields: ["region"], values: [{ field: "应付", aggregate: "sum" }] });
    expect(Object.values(pivot.totals)).toEqual([15]);
    expect(Object.values(pivot.rows[0].values)).toEqual([15]);
    expect(source).toEqual({ region: "East", tax: { total: 7 } });
  });

  it("locates cycles and propagates dependency failures to affected columns only", () => {
    const result = evaluateFormulas([{}], { a: "b+1", b: "a+1", unaffected: "42" });
    expect(result.errors.map((error) => error.colId).sort()).toEqual(["a", "b"]);
    expect(result.errors.every((error) => error.code === "CYCLE")).toBe(true);
    expect(result.rows[0].unaffected).toBe(42);
  });

  it("bounds expressions, recursion and total evaluated cells", () => {
    expect(evaluateFormulas([{}], { n: "(".repeat(40) + "1" + ")".repeat(40) }).errors[0].code).toBe("LIMIT");
    expect(evaluateFormulas([{}], { n: "1+".repeat(300) + "1" }).errors[0].code).toBe("LIMIT");
    expect(() => evaluateFormulas(Array(10001).fill({}), { n: "1" })).toThrow("10000");
    expect(() => evaluateFormulas([{}], { "__proto__.x": "1" })).toThrow("Invalid formula column");
  });
});
