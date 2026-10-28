import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createRequire } from "node:module";

// Exercise published bundles: minification and independently bundled optional
// entries must retain their shared formatter/input/lifecycle capabilities.
const { window } = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
const keys = ["window", "document", "HTMLElement", "Element", "Node", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "SVGElement", "Event", "MouseEvent", "KeyboardEvent", "MutationObserver", "requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle"];
const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
for (const key of keys) {
  const value = ["requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle"].includes(key) ? window[key].bind(window) : window[key];
  Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
}
const require = createRequire(import.meta.url);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function host() {
  const node = document.createElement("div");
  Object.defineProperties(node, { clientWidth: { value: 900 }, clientHeight: { value: 400 } });
  document.body.append(node);
  return node;
}
async function load(framework, entry, format) {
  const file = `../packages/${framework}/dist/${entry}.${format === "esm" ? "js" : "cjs"}`;
  return format === "esm" ? import(file) : require(file);
}
function displayedCount(api) {
  let count = 0;
  api.rows.forEachDisplayed(() => { count++; });
  return count;
}
function click(root, text) {
  const control = [...root.querySelectorAll("button")].find(button => button.textContent === text);
  assert.ok(control, `Missing published UI action: ${text}`);
  assert.equal(control.disabled, false, `${text} unexpectedly disabled`);
  control.click();
}
async function checkGrid(runtime) {
  const element = host();
  const api = runtime.createGrid(element, {
    rowKey: "id", pagination: false,
    columnDefs: [runtime.dragColumn(), { field: "id" }],
    rowData: [{ id: "a" }, { id: "b" }],
    rowStyleRules: [{ when: ({ data }) => data.id === "a", tone: "warning" }]
  });
  try {
    assert.ok(element.querySelector(".mach-root"));
    assert.equal(element.querySelector('.mach-row[data-id="a"]').dataset.rowTone, "warning");
    assert.equal(api.rows.reorder(0, 1), true);
    assert.equal(api.rows.getAt(1).id, "a");
    api.updateOptions({ rowStyleRules: [] });
    assert.equal(element.querySelector(".mach-row--styled"), null);
    api.sorting.setModel([{ colId: "id", direction: "asc" }]);
    assert.equal(api.rows.reorder(0, 1), false);
  } finally { api.destroy(); element.remove(); }
}
async function checkPreferences(preferences, state) {
  let expected;
  const store = preferences.createGridPreferenceStore({
    identity: () => ({ tenantId: "tenant", userId: "user", pageId: "runtime", schemaId: "v1" }),
    columns: ["id", "team", "amount"], columnTypes: { amount: "number" },
    load: () => ({ state, revision: "r0" }),
    save: request => { expected = request.expectedRevision; return { revision: "r1" }; }
  });
  try {
    assert.ok(await store.load("runtime"));
    await store.save("runtime", state);
    assert.equal(expected, "r0");
    assert.ok(preferences.migrateGridState(state, { columns: ["id", "team", "amount"] }).state);
    const migrated = preferences.migrateGridState({ ...state,
      filterModel: { amount: { type: "text", conditions: [{ match: "contains", value: "1" }] } }
    }, { columns: ["id", "team", "amount"], columnTypes: { amount: "number" } });
    assert.ok(migrated.report.some(issue => issue.code === "TYPE_CHANGED"));
    assert.equal(migrated.state.filterModel.amount, undefined);
  } finally { store.dispose(); }
}
async function checkOrdering(ordering) {
  let rows = [{ id: "a" }, { id: "b" }];
  const intent = { rowIds: ["a"], targetId: "b", position: "after" };
  assert.deepEqual(ordering.reorderRows(rows, intent, { rowKey: "id" }).after.map(row => row.id), ["b", "a"]);
  const operations = [];
  const controller = ordering.createRowOrderController({ rowKey: "id", getRows: () => rows,
    applyRows: next => { rows = next; }, save: async (_intent, context) => {
      operations.push(context.operation);
      assert.ok(context.operations.length > 0);
      return { status: "saved", revision: operations.length };
    } });
  try {
    await controller.move(intent);
    assert.deepEqual(rows.map(row => row.id), ["b", "a"]);
    assert.equal(controller.state.status, "saved");
    assert.equal(controller.state.canUndo, true);
    await controller.undo();
    assert.deepEqual(rows.map(row => row.id), ["a", "b"]);
    assert.equal(controller.state.canRedo, true);
    await controller.redo();
    assert.deepEqual(rows.map(row => row.id), ["b", "a"]);
    assert.deepEqual(operations, ["move", "undo", "redo"]);
  } finally { controller.dispose(); }
}
async function checkServer(runtime, server) {
  const element = host();
  const store = server.createServerSideStore({ retryCount: 0,
    getRows: async () => ({ rows: [{ id: "a", data: { team: "A", amount: 12 } }], rowCount: 1, revision: "1" }) });
  const api = runtime.createGrid(element, { pagination: false, rowData: [], columnDefs: [
    server.createServerSideGroupColumn(store), server.serverSideDataColumn("amount")
  ] });
  let dispose;
  try {
    await store.load();
    dispose = server.bindServerSideGrid(api, store);
    await tick();
    assert.equal(api.rows.getAt(0)?.data.data.amount, 12);
    assert.ok(element.querySelector(".mach-server-cell"));
    assert.equal(element.querySelector('.mach-cell[data-col-id="amount"]')?.textContent, "12");
  } finally { dispose?.(); api.destroy(); store.dispose(); element.remove(); }
}
async function checkImport(runtime, importing) {
  const element = host(), date = new Date("2026-10-26T00:00:00Z");
  const api = runtime.createGrid(element, {
    rowKey: "id", pagination: false, onGridError() {},
    columnDefs: [{ field: "id" }, { field: "amount", type: "amount" }, { field: "date" }],
    columnTypes: { amount: { editable: true, valueParser: ({ value }) => Number(value), validate: value => value < 0 ? "negative" : undefined } },
    rowData: [{ id: "old", amount: 1, date }]
  });
  let plan;
  try {
    plan = importing.createImportPlan(api, { kind: "matrix", rows: [["id", "amount", "date"], ["9223372036854775807", "3.5", date]] });
    const preview = await plan.preview();
    assert.equal(preview.status, "ready");
    assert.equal(preview.cells.find(cell => cell.colId === "amount").value, 3.5);
    assert.equal(api.rows.getAt(0).data.id, "old");
    assert.equal((await plan.commit()).status, "applied");
    assert.equal(api.rows.getAt(0).data.id, "9223372036854775807");
    assert.equal(api.rows.getAt(0).data.amount, 3.5);
    const matrix = api.io.exportMatrix({ target: "xlsx" });
    assert.equal(matrix[1][0], "9223372036854775807");
    assert.equal(matrix[1][1], 3.5);
    assert.equal(matrix[1][2].getTime(), date.getTime());
    plan.destroy();
    plan = importing.createImportPlan(api, { kind: "matrix", rows: [["amount"], ["4.25"]] }, { mode: "paste" });
    assert.equal((await plan.preview()).status, "ready");
    assert.equal((await plan.commit()).status, "applied");
    assert.equal(api.rows.getAt(0).data.amount, 4.25);
    assert.equal(api.editing.undo(), true);
    assert.equal(api.rows.getAt(0).data.amount, 3.5);
    plan.destroy();
    plan = importing.createImportPlan(api, { kind: "matrix", rows: [["amount"], ["-1"]] }, { mode: "paste" });
    assert.equal((await plan.preview()).status, "invalid");
    assert.equal((await plan.commit()).status, "invalid");
    assert.equal(api.rows.getAt(0).data.amount, 3.5);
  } finally { plan?.destroy(); api.destroy(); element.remove(); }
}
async function checkOptional(runtime, framework, format) {
  const [workbench, preferences, ordering, server, analysis, multi, importing, business] = await Promise.all(
    ["workbench", "preferences", "ordering", "server-side", "analysis", "multi-range", "import", "business"].map(entry => load(framework, entry, format))
  );
  assert.equal("createDictionaryColumn" in runtime, false);
  assert.equal("summarizeRows" in runtime, false);
  const policy = business.createDictionaryColumn({ get: key => key === "A" ? "Ready" : undefined });
  assert.equal(policy.valueFormatter({ value: "A" }), "Ready");
  assert.equal(policy.valueSerializer({ value: "A", target: "xlsx" }), "A");
  assert.equal(business.summarizeRows([{ amount: 1 }, { amount: 2 }], {
    scope: "page", metrics: [{ id: "amount", kind: "sum", value: row => row.amount }]
  }).groups[0].values.amount, 3);
  const ranges = multi.createMultiRangeSelection();
  const element = host();
  const panels = host();
  const api = runtime.createGrid(element, {
    rowKey: "id", pagination: false, enableRangeSelection: true, features: [ranges],
    columnDefs: [{ field: "id" }, { field: "team", filter: "text" }, { field: "amount", filter: "number", editable: true, cellEditor: "number" }],
    rowData: [{ id: "a", team: "A", amount: 10 }, { id: "b", team: "B", amount: 20 }]
  });
  const handles = [];
  try {
    await checkImport(runtime, importing);
    await checkPreferences(preferences, api.state.get());
    await checkOrdering(ordering);
    const inspection = workbench.inspectGridRow(api, "a");
    assert.equal(inspection.availability, "loaded");
    assert.equal(inspection.visibility, "displayed");
    assert.equal(inspection.execution.filtering, "client");
    assert.equal(workbench.inspectGridRow(api, "missing").availability, "missing");
    const filter = workbench.mountAdvancedFilterBuilder(panels, { api });
    handles.push(filter);
    const draft = { version: 1, root: { kind: "condition", colId: "amount", filter: { type: "number", conditions: [{ match: "greaterThan", value: 15 }] } } };
    filter.setDraft(draft);
    assert.equal(displayedCount(api), 2);
    assert.equal(filter.apply(), true);
    assert.equal(displayedCount(api), 1);
    assert.equal(workbench.inspectGridRow(api, "a").visibility, "not-displayed");
    assert.deepEqual(filter.getDraft(), draft);
    api.filtering.setAdvancedModel(null);
    const data = [];
    api.rows.forEach(node => { if (node.data) data.push(node.data); });
    const calculated = analysis.evaluateFormulas(data, { net: "[amount] * 2" });
    assert.deepEqual(calculated.errors, []);
    const pivot = analysis.createPivot(calculated.rows, { rowFields: ["team"], values: [{ field: "net", aggregate: "sum" }] });
    assert.equal(Object.values(pivot.totals)[0], 60);
    handles.push(analysis.mountAnalysis(panels, { api, formulas: { net: "[amount] * 2" }, pivot: { rowFields: ["team"], values: [{ field: "net", aggregate: "sum" }] } }));
    assert.ok(panels.querySelector("svg[role='img']"));
    assert.ok(panels.querySelector(".mach-analysis__table"));
    ranges.setRanges([{ row1: 0, row2: 0, colId1: "amount", colId2: "amount" }]);
    assert.equal(ranges.getText(), "10");
    ranges.clearValues();
    assert.equal(api.rows.getById("a").data.amount, null);
    assert.equal(api.editing.undo(), true);
    assert.equal(api.rows.getById("a").data.amount, 10);
    ranges.clearValues();
    let submitted = 0;
    handles.push(workbench.mountChangeReview(panels, { api, save: changes => { submitted = changes.length; } }));
    assert.ok(panels.querySelector(".mach-review__table"));
    click(panels, "保存全部修改");
    await tick();
    assert.equal(submitted, 1);
    assert.deepEqual(api.editing.getDirtyRowIds(), []);
    handles.push(workbench.mountDiagnostics(panels, { api }));
    assert.ok(panels.textContent.includes("配置来源"));
    await checkServer(runtime, server);
    api.destroy();
    assert.equal(panels.querySelector(".mach-workbench"), null);
    assert.equal(workbench.inspectGridRow(api, "a").availability, "destroyed");
  } finally {
    handles.reverse().forEach(handle => handle.destroy());
    api.destroy(); element.remove(); panels.remove();
  }
}
try {
  for (const format of ["esm", "cjs"]) {
    const runtime = await load("core", "index", format);
    await checkGrid(runtime);
    for (const framework of ["core", "vue", "react"]) await checkOptional(runtime, framework, format);
  }
  console.log("OK   published ESM/CJS grid and Core/Vue/React optional entry mounts, typed import/preview/validation/undo bridge, save, analysis, server binding and cleanup");
} finally {
  window.close();
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}
