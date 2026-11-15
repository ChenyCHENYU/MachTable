import assert from "node:assert/strict";
import { JSDOM, VirtualConsole } from "jsdom";

const errors = [], warnings = [], observers = new Set();
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", error => errors.push(String(error)));
const { window } = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true, virtualConsole });
for (const key of ["window", "document", "HTMLElement", "Element", "Node", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "SVGElement", "Event", "MouseEvent", "KeyboardEvent", "MutationObserver"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: window[key] });
}
for (const key of ["requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle"]) globalThis[key] = window[key].bind(window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no layout/ResizeObserver. These deterministic sizes support mounting,
// not a browser layout or actual observer implementation compatibility claim.
Object.defineProperties(window.HTMLElement.prototype, {
  clientWidth: { configurable: true, get: () => 900 },
  clientHeight: { configurable: true, get: () => 400 }
});
window.HTMLCanvasElement.prototype.getContext = () => null;
globalThis.ResizeObserver = class {
  targets = new Set();
  observe(target) { this.targets.add(target); observers.add(this); }
  unobserve(target) { this.targets.delete(target); if (!this.targets.size) observers.delete(this); }
  disconnect() { this.targets.clear(); observers.delete(this); }
};
const oldError = console.error, oldWarn = console.warn;
console.error = (...values) => errors.push(values.map(String).join(" "));
console.warn = (...values) => warnings.push(values.map(String).join(" "));
const host = document.createElement("div");
document.body.append(host);
const columns = [{ field: "id", width: 90 }, { field: "name", width: 150, editable: true }, { field: "amount", width: 120 }];
const firstRows = [{ id: "a", name: "first", amount: 1 }];
const nextRows = [{ id: "a", name: "replaced", amount: 2 }];
const readyApis = [], createdApis = new Set();
const options = { rowKey: "id", pagination: false, columnDefs: columns, rowData: firstRows,
  onGridReady: event => readyApis.push(event.api) };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

/** Exercise public commands against the mounted framework's actual GridApi. */
async function editAndUndo(api) {
  assert.ok(host.querySelector(".mach-root"));
  assert.equal(api.rows.getById("a").data.name, "first");
  api.editing.startCell({ rowIndex: 0, colId: "name" });
  const input = host.querySelector(".mach-editor-input");
  assert.ok(input, "Public editing command must create an editor");
  input.value = "edited";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  await api.editing.stop();
  assert.equal(api.rows.getById("a").data.name, "edited");
  assert.equal(api.editing.undo(), true);
  assert.equal(api.rows.getById("a").data.name, "first");
}

/** Updates must preserve the mounted instance, then dispose it on host unmount. */
function updated(api) {
  assert.equal(api.isDestroyed(), false);
  assert.equal(api.rows.getById("a").data.name, "replaced");
  assert.equal(api.rows.getById("a").data.amount, 2);
  assert.ok(host.querySelector('.mach-header-cell[data-col-id="code"]'));
}

async function checkVue() {
  const vue = await import("vue");
  const { MachTable } = await import("@agile-team/mach-table-vue");
  const { useMachTableQuery } = await import("@agile-team/mach-table-vue/workflows");
  const rows = vue.shallowRef(firstRows), defs = vue.shallowRef(columns), table = vue.shallowRef(null);
  let query;
  const app = vue.createApp({ setup() {
    query = useMachTableQuery({ immediate: false, mode: "manual", query: {}, rowKey: "id",
      request: async () => ({ rows: [{ id: "remote", name: "remote" }], total: 1 }) });
    return () => vue.h(MachTable, { ...options, ref: table, rowData: rows.value, columnDefs: defs.value });
  } });
  try {
    app.mount(host);
    const api = table.value.getApi();
    createdApis.add(api);
    await api.whenReady();
    assert.equal(readyApis.length, 1);
    await editAndUndo(api);
    await query.reload();
    assert.equal(query.rows.value[0].id, "remote");
    rows.value = nextRows;
    defs.value = [...columns, { field: "code", width: 100 }];
    await vue.nextTick();
    await vue.nextTick();
    updated(api);
    assert.equal(readyApis.length, 1, "Prop updates must not recreate the grid");
  } finally { app.unmount(); }
  return { actualVersion: vue.version, strictMode: false, checks: ["mount", "edit", "undo", "remote-workflow", "dynamic-props", "unmount"] };
}

async function checkReact() {
  const react = await import("react"), { createRoot } = await import("react-dom/client");
  const act = react.act ?? (await import("react-dom/test-utils")).act;
  const { MachTable } = await import("@agile-team/mach-table-react");
  const { useMachTableQuery } = await import("@agile-team/mach-table-react/workflows");
  const root = createRoot(host);
  let currentApi = null;
  const apiRef = { get current() { return currentApi; }, set current(value) {
    currentApi = value;
    if (value) createdApis.add(value);
  } };
  let query;
  const request = async () => ({ rows: [{ id: "remote", name: "remote" }], total: 1 });
  const criteria = {};
  function App({ rows, defs }) {
    query = useMachTableQuery({ immediate: false, mode: "manual", query: criteria, rowKey: "id", request });
    return react.createElement(MachTable, { ...options, rowData: rows, columnDefs: defs, apiRef });
  }
  const render = (rows, defs) => root.render(react.createElement(react.StrictMode, null, react.createElement(App, { rows, defs })));
  try {
    await act(async () => render(firstRows, columns));
    const api = apiRef.current;
    assert.ok(api);
    await act(async () => { await api.whenReady(); });
    const mountCount = createdApis.size;
    assert.ok(mountCount >= 2, "StrictMode must replay setup/cleanup");
    await act(async () => editAndUndo(api));
    await act(async () => { await query.reload(); });
    assert.equal(query.rows[0].id, "remote");
    await act(async () => render(nextRows, [...columns, { field: "code", width: 100 }]));
    updated(api);
    assert.equal(apiRef.current, api);
    assert.equal(createdApis.size, mountCount, "Prop updates must not recreate the grid");
  } finally { await act(async () => root.unmount()); }
  assert.equal(apiRef.current, null);
  return { actualVersion: react.version, strictMode: true, checks: ["strict-replay", "mount", "edit", "undo", "remote-workflow", "dynamic-props", "unmount"] };
}

try {
  const framework = process.argv[2];
  assert.ok(["vue", "react"].includes(framework));
  const result = await (framework === "vue" ? checkVue() : checkReact());
  await tick();
  assert.ok(readyApis.length > 0);
  assert.ok([...createdApis].every(api => api.isDestroyed()), "Unmount must destroy every created grid");
  assert.equal(host.querySelector(".mach-root"), null);
  assert.equal(observers.size, 0);
  assert.deepEqual(errors, [], "No framework or DOM errors are allowed");
  assert.deepEqual(warnings, [], "Unexpected framework warnings require investigation");
  console.log(`MACHTABLE_COMPAT_RESULT ${JSON.stringify({ ...result, createdGrids: createdApis.size, errors, warnings })}`);
} finally {
  console.error = oldError;
  console.warn = oldWarn;
  window.close();
}
