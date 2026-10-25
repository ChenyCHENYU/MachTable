import { describe, expect, it } from "vitest";
import { createRowFilter } from "../services/filterService";
import { sortNodes } from "../services/sortService";
import { Column } from "../services/column";
import type { AdvancedFilterModel, ColumnFilter, RowNode } from "../index";

interface RecordData { score: number; name: string; region?: string | null }
const columns = [new Column("score", { field: "score" }), new Column("name", { field: "name" })];
const row = (id: string, score: number, name = "alpha beta"): RowNode<RecordData> => ({
  id, data: { score, name }, rowIndex: 0, selected: false
});
const read = (node: RowNode<RecordData>, column: Column) => node.data?.[column.id as keyof RecordData];

describe("per-refresh filter plans", () => {
  it("composes column filters, nested AND/OR/NOT and case-insensitive search", () => {
    const model: AdvancedFilterModel = { version: 1, root: {
      kind: "group", operator: "and", children: [
        { kind: "condition", colId: "score", filter: { type: "number", conditions: [{ match: "greaterThan", value: 3 }] } },
        { kind: "group", operator: "or", not: true, children: [
          { kind: "condition", colId: "name", filter: { type: "text", conditions: [{ match: "equals", value: "blocked" }] } }
        ] }
      ]
    } };
    const test = createRowFilter(columns, { score: { type: "number", conditions: [{ match: "lessThan", value: 10 }] } }, model, "  ALPHA   beta ", read);
    expect([row("a", 2), row("b", 4), row("c", 15), row("d", 5, "blocked"), row("e", 5, "alpha")].filter(test).map(node => node.id)).toEqual(["b"]);
  });

  it("resolves column metadata once while keeping values and application context live", () => {
    let idReads = 0;
    let offset = 0;
    const column = { get id() { idReads++; return "score"; } } as Column;
    const test = createRowFilter([column], { score: { type: "number", conditions: [{ match: "greaterThan", value: 10 }] } }, null, null, node => node.data!.score + offset);
    const records = Array.from({ length: 1_000 }, (_, index) => row(String(index), index));
    expect(records.filter(test)).toHaveLength(989);
    expect(idReads).toBe(1);
    offset = 20;
    expect(test(records[0])).toBe(true);
    records[0].data!.score = -30;
    expect(test(records[0])).toBe(false);
  });

  it("preserves missing-column and empty condition semantics without reading removed columns", () => {
    const advanced: AdvancedFilterModel = { version: 1, root: { kind: "condition", colId: "removed", filter: { type: "set", values: ["x"] } } };
    const test = createRowFilter(columns, { removed: { type: "text", conditions: [] } }, advanced, " ", () => { throw new Error("No value should be read"); });
    expect(test(row("a", 1))).toBe(true);
    for (const type of ["text", "number", "date"] as const) {
      const filter = { type, operator: "or", conditions: [] } as ColumnFilter;
      expect(createRowFilter(columns, { score: filter }, null, null, read)(row("a", 1))).toBe(true);
    }
  });

  it("keeps set values strict and treats undefined as a blank value", () => {
    const region = new Column("region", { field: "region" });
    const test = createRowFilter([region], { region: { type: "set", values: [null, "1"] } }, null, null, read);
    expect(test(row("a", 1))).toBe(true);
    const record = row("b", 1);
    record.data!.region = "1";
    expect(test(record)).toBe(true);
    record.data!.region = "other";
    expect(test(record)).toBe(false);
  });
});

describe("resolved sort clauses", () => {
  it("ignores obsolete IDs without shifting live comparators and never mutates input order", () => {
    const records = [row("a", 2, "z"), row("b", 1, "a"), row("c", 2, "b")];
    const sorted = sortNodes(records, [{ colId: "removed", direction: "desc" }, { colId: "score", direction: "asc" }, { colId: "name", direction: "desc" }], columns, read);
    expect(sorted.map(node => node.id)).toEqual(["b", "a", "c"]);
    expect(records.map(node => node.id)).toEqual(["a", "b", "c"]);
    expect(sortNodes(records, [{ colId: "removed", direction: "asc" }], columns, read).map(node => node.id)).toEqual(["a", "b", "c"]);
  });
});
