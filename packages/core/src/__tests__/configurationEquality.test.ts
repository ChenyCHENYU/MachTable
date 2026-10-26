import { describe, expect, it } from "vitest";
import { equivalentConfigValue, equivalentGridOption } from "../lib/configurationEquality";

describe("bounded adapter config reconciliation", () => {
  it("recognizes equivalent merged column policies but preserves actual callback changes", () => {
    const parser = (value: unknown) => value;
    const previous = { amount: { valueParser: parser, editable: true } };
    expect(equivalentGridOption("columnTypes", previous, { amount: { editable: true, valueParser: parser } })).toBe(true);
    expect(equivalentGridOption("columnTypes", previous, { amount: { valueParser: () => 1, editable: true } })).toBe(false);
    expect(equivalentGridOption("defaultColDef", { editable: true }, { editable: false })).toBe(false);
  });

  it("treats row, column, datasource and feature instances as deliberate replacements", () => {
    const value = { getRows() {} };
    for (const key of ["rowData", "columnDefs", "datasource", "features", "dataProcessor"]) {
      expect(equivalentGridOption(key, value, value)).toBe(true);
      expect(equivalentGridOption(key, value, { ...value })).toBe(false);
    }
  });

  it("does not recursively traverse cyclic, large or non-plain values", () => {
    const left: Record<string, unknown> = {}, right: Record<string, unknown> = {};
    left.self = left; right.self = right;
    expect(equivalentConfigValue(left, right)).toBe(false);
    expect(equivalentConfigValue(Array.from({ length: 101 }, () => 1), Array.from({ length: 101 }, () => 1))).toBe(false);
    expect(equivalentConfigValue(new Date(0), new Date(0))).toBe(false);
    expect(equivalentConfigValue(null, {})).toBe(false);
    expect(equivalentConfigValue({ a: 1 }, { b: 1 })).toBe(false);
    expect(equivalentConfigValue([1], [])).toBe(false);
  });
});
