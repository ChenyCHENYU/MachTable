import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createRequire } from "node:module";

// Test the published bundles as well as source tests: minification must preserve native/public APIs.
const { window } = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
const keys = ["window", "document", "HTMLElement", "Element", "Node", "HTMLInputElement", "Event", "MouseEvent", "KeyboardEvent", "requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle"];
const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
for (const key of keys) {
  const value = ["requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle"].includes(key) ? window[key].bind(window) : window[key];
  Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
}
try {
  const esm = await import("../packages/core/dist/index.js");
  const cjs = createRequire(import.meta.url)("../packages/core/dist/index.cjs");
  for (const runtime of [esm, cjs]) {
    const host = document.createElement("div");
    Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 400 } });
    document.body.append(host);
    const api = runtime.createGrid(host, {
      rowKey: "id", pagination: false,
      columnDefs: [runtime.dragColumn(), { field: "id" }],
      rowData: [{ id: "a" }, { id: "b" }],
      rowStyleRules: [{ when: ({ data }) => data.id === "a", tone: "warning" }]
    });
    try {
      assert.ok(host.querySelector(".mach-root"));
      assert.equal(host.querySelector('.mach-row[data-id="a"]').dataset.rowTone, "warning");
      assert.equal(api.rows.reorder(0, 1), true);
      assert.equal(api.rows.getAt(1).id, "a");
      api.updateOptions({ rowStyleRules: [] });
      assert.equal(host.querySelector(".mach-row--styled"), null);
      api.sorting.setModel([{ colId: "id", direction: "asc" }]);
      assert.equal(api.rows.reorder(0, 1), false);
    } finally { api.destroy(); host.remove(); }
  }
  console.log("OK   ESM/CJS built grid mount, row appearance, ordering and cleanup");
} finally {
  window.close();
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}
