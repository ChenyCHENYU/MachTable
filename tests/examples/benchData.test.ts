import { describe, expect, it } from "vitest";
import { buildDefs, makeRows } from "../../examples/bench/src/data";
import type { ValueGetterParams } from "../../packages/core/src/types/params";

describe("reproducible performance workloads", () => {
  it("generates the same typed business data for a seed and changes it for another seed", () => {
    expect(makeRows(100)).toEqual(makeRows(100));
    expect(makeRows(100, 1)).not.toEqual(makeRows(100, 2));
    expect(new Set(makeRows(100).map(row => row.id)).size).toBe(100);
  });

  it("gives every wide column a finite, row-dependent value through the real getter contract", () => {
    const columns = buildDefs(500);
    expect(columns).toHaveLength(500);
    const extended = columns.filter(column => column.valueGetter);
    expect(extended.length).toBeGreaterThan(400);
    for (const column of extended) {
      const value = (rowIndex: number) => column.valueGetter!({ node: { rowIndex } } as ValueGetterParams);
      expect(Number.isFinite(value(0))).toBe(true);
      expect(value(0)).not.toBe(value(1));
    }
  });
});
