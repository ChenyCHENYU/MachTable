import { describe, expect, it } from "vitest";
import { singleRowDragIntent } from "../services/rowDragIntent";
import type { RowNode } from "../types/row";

const node = (id: string, rowIndex: number, detail = false): RowNode => ({
  id, rowIndex, data: { id }, selected: false, ...(detail ? { isDetail: true } : {})
});

describe("single row drop neighbours", () => {
  it("uses logical indexes when a remote window contains only a sparse loaded block", () => {
    const source = node("source", 100), target = node("target", 104), next = node("next", 105);
    const loaded = new Map([[100, source], [104, target], [105, next]]);
    const intent = singleRowDragIntent(source, index => loaded.get(index), target, "after", 7);
    expect(intent).toEqual({ rowIds: ["source"], targetId: "target", position: "after", beforeId: "target", afterId: "next", expectedRevision: 7 });
  });

  it("skips the source and its detail rows, and never emits a loading placeholder id", () => {
    const source = node("source", 1), target = node("target", 3), previous = node("previous", 0);
    const rows = [previous, source, node("detail", 2, true), target, { ...node("loading", 4), data: null, loading: true }];
    expect(singleRowDragIntent(source, index => rows[index], target, "before").beforeId).toBe("previous");
    expect(singleRowDragIntent(source, index => rows[index], target, "after").afterId).toBeNull();
  });
});
