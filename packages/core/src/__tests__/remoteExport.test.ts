// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGrid, createRemoteExportRequest } from "../index";

class ResizeObserverStub {
  observe(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
});

afterEach(() => {
  document.body.textContent = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function host(): HTMLElement {
  const element = document.createElement("div");
  Object.defineProperty(element, "clientWidth", { value: 800 });
  Object.defineProperty(element, "clientHeight", { value: 360 });
  document.body.appendChild(element);
  return element;
}

describe("remote export request", () => {
  it("captures visible columns and active criteria without exporting browser rows", () => {
    const api = createGrid(host(), {
      rowKey: "id",
      columnDefs: [{ field: "id" }, { field: "name" }, { field: "amount" }],
      rowData: [{ id: "1", name: "Alpha", amount: 3 }, { id: "2", name: "Beta", amount: 5 }]
    });
    api.columns.setVisible("id", false);
    api.sorting.setModel([{ colId: "amount", direction: "desc" }]);
    api.filtering.setModel({ name: { type: "text", conditions: [{ match: "contains", value: "a" }] } });
    api.filtering.setQuickText("alpha");

    const request = createRemoteExportRequest(api, { scope: "filtered" });
    expect(request).toEqual({
      version: 1,
      scope: "filtered",
      columnIds: ["name", "amount"],
      sortModel: [{ colId: "amount", direction: "desc" }],
      filterModel: { name: { type: "text", conditions: [{ match: "contains", value: "a" }] } },
      advancedFilterModel: null,
      quickFilterText: "alpha"
    });
    expect(JSON.stringify(request)).not.toContain("Alpha");

    api.filtering.setQuickText("beta");
    api.columns.setVisible("id", true);
    expect(request.quickFilterText).toBe("alpha");
    expect(request.columnIds).toEqual(["name", "amount"]);
    api.destroy();
  });

  it("preserves cross-page all-matching selection as a detached rule", () => {
    const api = createGrid(host(), {
      rowKey: "id",
      columnDefs: [{ field: "id" }],
      rowData: [{ id: "1" }]
    });
    const selection = { mode: "allMatching" as const, excludedKeys: ["id-7"] };
    const request = createRemoteExportRequest(api, { scope: "selected", selection });
    selection.excludedKeys.push("id-9");
    expect(request.selection).toEqual({ mode: "allMatching", excludedKeys: ["id-7"] });
    api.destroy();
  });
});
