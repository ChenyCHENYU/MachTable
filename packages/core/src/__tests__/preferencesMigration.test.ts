import { describe, expect, it } from "vitest";
import { migrateGridState } from "../preferences";
import type { GridState } from "../types/state";

function state(): GridState {
  return { version: 2, columns: [{ colId: "old", width: 120 }, { colId: "removed" }],
    sortModel: [{ colId: "old", direction: "desc" }, { colId: "removed", direction: "asc" }],
    filterModel: { old: { type: "number", conditions: [{ match: "greaterThan", value: 1 }] } },
    advancedFilterModel: { version: 1, root: { kind: "group", operator: "and", children: [
      { kind: "condition", colId: "old", filter: { type: "text", conditions: [{ match: "contains", value: "x" }] } },
      { kind: "condition", colId: "removed", filter: { type: "set", values: ["x"] } }
    ] } }, quickFilterText: "find", pagination: { enabled: true, page: 2, pageSize: 50 },
    selectedRowIds: ["1"], expandedRowIds: [], expandedGroupIds: [] };
}

describe("explainable preference migration", () => {
  it("maps layout, sort and both filter models through one explicit column policy", () => {
    const input = state();
    const result = migrateGridState(input, { columns: ["current"], renameColumns: { old: "current" } });
    expect(result.state?.columns).toEqual([{ colId: "current", width: 120 }]);
    expect(result.state?.sortModel).toEqual([{ colId: "current", direction: "desc" }]);
    expect(result.state?.filterModel.current.type).toBe("number");
    expect(result.state?.advancedFilterModel?.root).toMatchObject({ kind: "group", children: [{ colId: "current" }] });
    expect(result.report.filter(issue => issue.code === "RENAMED_COLUMN")).toHaveLength(4);
    expect(result.report.filter(issue => issue.code === "REMOVED_COLUMN")).toHaveLength(3);
    expect(input.columns[0].colId).toBe("old");
  });

  it("migrates the actual published v1 shape and rejects partial or future payloads", () => {
    // Historical contract: bf50224 types/state.ts and c54edaa LegacyGridStateV1.
    const current: Partial<GridState> = state();
    delete current.advancedFilterModel;
    const result = migrateGridState({ ...current, version: 1 }, { columns: ["old"] });
    expect(result.state?.version).toBe(2);
    expect(result.state?.advancedFilterModel).toBeNull();
    expect(result.report).toContainEqual({ code: "VERSION_MIGRATED", path: "version", from: "1", to: "2" });
    expect(migrateGridState({ version: 1, columns: [], sortModel: [] }, { columns: [] }).state).toBeNull();
    expect(migrateGridState({ ...state(), version: 3 }, { columns: ["old"] })).toEqual({
      state: null, report: [{ code: "UNSUPPORTED_VERSION", path: "version" }]
    });
  });

  it("checks renamed filters against target types without guessing conversions", () => {
    const result = migrateGridState(state(), { columns: ["current"], renameColumns: { old: "current" }, columnTypes: { current: "text" } });
    expect(result.state?.filterModel).toEqual({});
    expect(result.state?.advancedFilterModel?.root).toMatchObject({ children: [{ colId: "current", filter: { type: "text" } }] });
    expect(result.report).toContainEqual({ code: "TYPE_CHANGED", path: "filterModel.old", from: "number", to: "text" });
    expect(state().filterModel.old.type).toBe("number");
  });

  it("removes disabled or incompatible nested filters and keeps unspecified fields unchanged", () => {
    const input = { ...state(), advancedFilterModel: { version: 1, root: { kind: "group", operator: "or", not: true, children: [
      { kind: "condition", colId: "old", filter: { type: "text", conditions: [{ match: "equals", value: "x" }] } },
      { kind: "condition", colId: "kept", filter: { type: "set", values: ["x"] } }
    ] } } };
    const result = migrateGridState(input, { columns: ["old", "kept"], columnTypes: { old: false } });
    expect(result.state?.filterModel).toEqual({});
    expect(result.state?.advancedFilterModel?.root).toMatchObject({ not: true, children: [{ colId: "kept" }] });
    expect(result.report.filter(entry => entry.code === "TYPE_CHANGED")).toEqual([
      { code: "TYPE_CHANGED", path: "filterModel.old", from: "number", to: "disabled" },
      { code: "TYPE_CHANGED", path: "advancedFilterModel.root.children[0].filter", from: "text", to: "disabled" }
    ]);
    const allRemoved = migrateGridState(state(), { columns: ["old"], columnTypes: { old: "date" } });
    expect(allRemoved.state?.advancedFilterModel).toBeNull();
  });

  it("applies optional types to real legacy filters and rejects invalid target policies", () => {
    const result = migrateGridState({ ...state(), version: 1 }, { columns: ["old"], columnTypes: { old: "number" } });
    expect(result.state?.filterModel.old.type).toBe("number");
    expect(result.report.some(entry => entry.code === "TYPE_CHANGED")).toBe(false);
    expect(() => migrateGridState(state(), { columns: ["old"], columnTypes: { missing: "text" } })).toThrow(TypeError);
    expect(() => migrateGridState(state(), { columns: ["old"], columnTypes: { old: "object" as "text" } })).toThrow(TypeError);
  });

  it("reports invalid operators, values and ID collisions instead of restoring illegal conditions", () => {
    const input = { ...state(), columns: [{ colId: "old" }, { colId: "current" }], filterModel: {
      old: { type: "number", conditions: [{ match: "inRange", value: 5, value2: 1 }] },
      current: { type: "text", operator: "xor", conditions: [{ match: "equals", value: "x" }] }
    } };
    const result = migrateGridState(input, { columns: ["current"], renameColumns: { old: "current" } });
    expect(result.state?.columns).toEqual([{ colId: "current" }]);
    expect(result.state?.filterModel).toEqual({});
    expect(result.report).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "DUPLICATE_COLUMN" }), expect.objectContaining({ code: "INVALID_FILTER" })
    ]));
  });

  it("bounds hostile lists, cyclic/deep expressions and diagnostic output", () => {
    const cyclic: any = { kind: "group", operator: "and", children: [] };
    cyclic.children.push(cyclic);
    const result = migrateGridState({ ...state(),
      columns: Array.from({ length: 10_000 }, (_, index) => ({ colId: `missing-${index}` })),
      filterModel: { old: { type: "set", values: Array(20_000).fill("x") } },
      advancedFilterModel: { version: 1, root: cyclic }
    }, { columns: ["old"] });
    expect(result.state?.columns).toEqual([]);
    expect(result.state?.filterModel.old).toMatchObject({ values: Array(2_000).fill("x") });
    expect(result.state?.advancedFilterModel).toBeNull();
    expect(result.report).toHaveLength(256);
    expect(result.report[result.report.length - 1]?.code).toBe("LIMIT_EXCEEDED");
  });

  it("rejects unsafe policies and never restores prototype names as filter keys", () => {
    expect(() => migrateGridState(state(), { columns: ["__proto__"] })).toThrow(TypeError);
    expect(() => migrateGridState(state(), { columns: ["old"], renameColumns: { old: "missing" } })).toThrow(TypeError);
    const filters = JSON.parse('{"__proto__":{"type":"set","values":[1]}}');
    const result = migrateGridState({ ...state(), filterModel: filters }, { columns: ["old"] });
    expect(Object.keys(result.state!.filterModel)).toEqual([]);
    expect(result.report).toContainEqual({ code: "REMOVED_COLUMN", path: "filterModel.__proto__" });
  });
});
