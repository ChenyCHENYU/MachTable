import { describe, expect, it } from "vitest";
import { defaultComparator } from "../lib/compare";
import { computeColumnWidths, fitColumnWidths } from "../lib/layout";
import { getByPath, setByPath } from "../lib/path";
import { csvEscape, buildCsv } from "../lib/csv";
import { EventBus } from "../core/eventBus";
import { evaluateTextFilter, evaluateNumberFilter, evaluateDateFilter, evaluateSetFilter } from "../services/filterService";
import { sortNodes } from "../services/sortService";
import type { RowNode } from "../types/row";

function node(id: string, data: any): RowNode {
  return { id, data, rowIndex: -1, selected: false };
}

describe("defaultComparator", () => {
  it("sorts numbers", () => {
    expect(defaultComparator(3, 10)).toBeLessThan(0);
    expect(defaultComparator(10, 3)).toBeGreaterThan(0);
    expect(defaultComparator(5, 5)).toBe(0);
  });

  it("sorts strings case-insensitively with numeric awareness", () => {
    expect(defaultComparator("a2", "a10")).toBeLessThan(0);
    expect(defaultComparator("abc", "ABC")).toBe(0);
  });

  it("pushes null and empty values last", () => {
    expect(defaultComparator(null, 1)).toBe(1);
    expect(defaultComparator(1, null)).toBe(-1);
    expect(defaultComparator(null, null)).toBe(0);
    expect(defaultComparator("", "x")).toBe(1);
  });

  it("sorts dates and booleans", () => {
    expect(defaultComparator(new Date(2020, 1, 1), new Date(2021, 1, 1))).toBeLessThan(0);
    expect(defaultComparator(false, true)).toBeLessThan(0);
  });
});

describe("computeColumnWidths", () => {
  it("returns base widths when no flex", () => {
    const widths = computeColumnWidths([{ width: 100 }, { width: 200 }], 900);
    expect(widths).toEqual([100, 200]);
  });

  it("distributes extra space by flex weight", () => {
    const widths = computeColumnWidths(
      [
        { width: 100 },
        { width: 100, flex: 1 },
        { width: 100, flex: 3 }
      ],
      500
    );
    expect(widths[0]).toBe(100);
    expect(widths[1]).toBe(150);
    expect(widths[2]).toBe(250);
  });

  it("respects min and max widths", () => {
    const widths = computeColumnWidths(
      [
        { width: 100, flex: 1, maxWidth: 120 },
        { width: 100, flex: 1, minWidth: 300 }
      ],
      1000
    );
    expect(widths[0]).toBe(120);
    expect(widths[1]).toBeGreaterThanOrEqual(300);
  });

  it("does not shrink below total when space is insufficient", () => {
    const widths = computeColumnWidths([{ width: 300 }, { width: 400 }], 200);
    expect(widths).toEqual([300, 400]);
  });
});

describe("fitColumnWidths", () => {
  it("grows and shrinks columns to the target width", () => {
    expect(fitColumnWidths([{ width: 100 }, { width: 200 }], 600)).toEqual([200, 400]);
    expect(fitColumnWidths([{ width: 100 }, { width: 200 }], 150)).toEqual([80, 80]);
  });

  it("redistributes space after min and max constraints", () => {
    const widths = fitColumnWidths(
      [{ width: 100, maxWidth: 120 }, { width: 100, minWidth: 100 }],
      320
    );
    expect(widths).toEqual([120, 200]);
  });
});

describe("path utils", () => {
  const obj = { a: { b: { c: 42 } }, list: [1, 2, 3] };
  it("reads nested paths", () => {
    expect(getByPath(obj, "a.b.c")).toBe(42);
    expect(getByPath(obj, "list.1")).toBe(2);
    expect(getByPath(obj, "a.x")).toBeUndefined();
    expect(getByPath(null, "a")).toBeUndefined();
  });
  it("writes nested paths", () => {
    const target: any = {};
    setByPath(target, "a.b.c", 1);
    expect(target.a.b.c).toBe(1);
  });
});

describe("csv", () => {
  it("escapes separators, quotes and newlines", () => {
    expect(csvEscape('a"b', ",")).toBe('"a""b"');
    expect(csvEscape("a,b", ",")).toBe('"a,b"');
    expect(csvEscape("a\nb", ",")).toBe('"a\nb"');
    expect(csvEscape("plain", ",")).toBe("plain");
  });

  it("builds header and rows", () => {
    const csv = buildCsv({
      getHeaderLabels: () => ["Name", "Age"],
      getRowValues: () => [["Tom", 31]]
    });
    expect(csv).toBe("Name,Age\r\nTom,31");
  });

  it("supports custom separator and BOM", () => {
    const csv = buildCsv(
      { getHeaderLabels: () => [], getRowValues: () => [["a", "b"]] },
      { includeHeader: false, columnSeparator: ";", prependBOM: true }
    );
    expect(csv).toBe("\uFEFFa;b");
  });
});

describe("EventBus", () => {
  it("subscribes and unsubscribes", () => {
    const bus = new EventBus();
    let count = 0;
    const off = bus.on("evt", () => count++);
    bus.emit("evt");
    bus.emit("evt");
    expect(count).toBe(2);
    off();
    bus.emit("evt");
    expect(count).toBe(2);
  });

  it("supports once", () => {
    const bus = new EventBus();
    let count = 0;
    bus.once("evt", () => count++);
    bus.emit("evt");
    bus.emit("evt");
    expect(count).toBe(1);
  });

  it("isolates listener errors", () => {
    const bus = new EventBus();
    const errors: unknown[] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => errors.push(args[0]);
    bus.on("evt", () => {
      throw new Error("boom");
    });
    bus.on("evt", () => {
      throw new Error("ok");
    });
    expect(() => bus.emit("evt")).not.toThrow();
    console.error = orig;
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("filter evaluation", () => {
  it("text filters are case-insensitive", () => {
    expect(evaluateTextFilter("Hello World", [{ match: "contains", value: "wor" }], "and")).toBe(true);
    expect(evaluateTextFilter("Hello World", [{ match: "startsWith", value: "hello" }], "and")).toBe(true);
    expect(evaluateTextFilter("Hello", [{ match: "endsWith", value: "LO" }], "and")).toBe(true);
    expect(evaluateTextFilter("Hello", [{ match: "equals", value: "hellx" }], "and")).toBe(false);
    expect(evaluateTextFilter(null, [{ match: "blank" }], "and")).toBe(true);
    expect(evaluateTextFilter("x", [{ match: "notBlank" }], "and")).toBe(true);
  });

  it("number filters support ranges", () => {
    expect(evaluateNumberFilter(5, [{ match: "inRange", value: 1, value2: 10 }], "and")).toBe(true);
    expect(evaluateNumberFilter(50, [{ match: "inRange", value: 1, value2: 10 }], "and")).toBe(false);
    expect(evaluateNumberFilter("7", [{ match: "equals", value: 7 }], "and")).toBe(true);
    expect(evaluateNumberFilter(null, [{ match: "equals", value: 7 }], "and")).toBe(false);
  });

  it("date filters compare timestamps", () => {
    expect(evaluateDateFilter("2024-05-01", [{ match: "greaterThan", value: "2024-01-01" }], "and")).toBe(true);
    expect(evaluateDateFilter("2024-01-01", [{ match: "equals", value: "2024-01-01" }], "and")).toBe(true);
  });

  it("set filters include values", () => {
    expect(evaluateSetFilter("a", ["a", "b"])).toBe(true);
    expect(evaluateSetFilter(null, [null])).toBe(true);
    expect(evaluateSetFilter("c", [])).toBe(true);
  });
});

describe("sortNodes", () => {
  const valueGetter = (n: RowNode, column: { id: string }) => n.data[column.id];

  it("sorts by single column", () => {
    const columns = [{ id: "score", colDef: {} }] as any[];
    const nodes = [node("1", { score: 5 }), node("2", { score: 1 }), node("3", { score: 9 })];
    const sorted = sortNodes(nodes, [{ colId: "score", direction: "asc" }], columns, valueGetter);
    expect(sorted.map((n) => n.data.score)).toEqual([1, 5, 9]);
  });

  it("sorts by multiple columns with directions", () => {
    const columns = [{ id: "group", colDef: {} }, { id: "name", colDef: {} }] as any[];
    const nodes = [
      node("1", { group: "b", name: "z" }),
      node("2", { group: "a", name: "y" }),
      node("3", { group: "b", name: "a" })
    ];
    const sorted = sortNodes(
      nodes,
      [
        { colId: "group", direction: "asc" },
        { colId: "name", direction: "desc" }
      ],
      columns,
      valueGetter
    );
    expect(sorted.map((n) => n.id)).toEqual(["2", "1", "3"]);
  });

  it("is stable for equal keys", () => {
    const columns = [{ id: "k", colDef: {} }] as any[];
    const nodes = [node("1", { k: 1, tag: "first" }), node("2", { k: 1, tag: "second" }), node("3", { k: 0 })];
    const sorted = sortNodes(nodes, [{ colId: "k", direction: "asc" }], columns, valueGetter);
    expect(sorted.map((n) => n.data.tag)).toEqual([undefined, "first", "second"]);
  });
});
