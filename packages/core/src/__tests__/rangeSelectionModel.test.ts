import { describe, expect, it } from "vitest";
import { RangeSelectionModel } from "../services/rangeSelectionModel";

describe("RangeSelectionModel", () => {
  it("normalizes reverse ranges and clamps them to model bounds", () => {
    const model = new RangeSelectionModel();
    model.start({ row: 8, colIdx: 4 }, false);
    model.setEnd({ row: -2, colIdx: 1 });
    expect(model.normalize(5, 3)).toEqual({ r1: 0, r2: 4, c1: 1, c2: 2 });
  });

  it("keeps the anchor while extending and resets it for a new range", () => {
    const model = new RangeSelectionModel();
    model.start({ row: 1, colIdx: 1 }, false);
    model.start({ row: 3, colIdx: 2 }, true);
    expect(model.getAnchor()).toEqual({ row: 1, colIdx: 1 });
    expect(model.getEnd()).toEqual({ row: 3, colIdx: 2 });
    model.start({ row: 4, colIdx: 0 }, false);
    expect(model.getAnchor()).toEqual({ row: 4, colIdx: 0 });
  });

  it("recomputes cached ranges when row or column counts change", () => {
    const model = new RangeSelectionModel();
    model.start({ row: 10, colIdx: 10 }, false);
    expect(model.normalize(20, 20)?.r2).toBe(10);
    expect(model.normalize(5, 5)).toEqual({ r1: 4, r2: 4, c1: 4, c2: 4 });
  });

  it("rejects invalid fallback anchors and clears all state", () => {
    const model = new RangeSelectionModel();
    expect(model.ensureAnchor({ row: 0, colIdx: -1 })).toBe(false);
    expect(model.normalize(1, 1)).toBeNull();
    model.start({ row: 0, colIdx: 0 }, false);
    model.clear();
    expect(model.hasAnchor()).toBe(false);
    expect(model.getEnd()).toBeNull();
  });
});
