import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packages = ["core", "vue", "react", "xlsx"];

function targets(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (value && typeof value === "object") Object.values(value).forEach((nested) => targets(nested, output));
  return output;
}

for (const name of packages) {
  const directory = resolve(root, "packages", name);
  const manifest = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
  for (const target of new Set(targets(manifest.exports))) {
    await access(resolve(directory, target));
  }
}

const require = createRequire(import.meta.url);
const coreEsm = await import(pathToFileURL(resolve(root, "packages/core/dist/index.js")));
const coreCjs = require(resolve(root, "packages/core/dist/index.cjs"));
const vueEsm = await import(pathToFileURL(resolve(root, "packages/vue/dist/index.js")));
const vueCjs = require(resolve(root, "packages/vue/dist/index.cjs"));
const vueWorkflowsEsm = await import(pathToFileURL(resolve(root, "packages/vue/dist/workflows.js")));
const vueWorkflowsCjs = require(resolve(root, "packages/vue/dist/workflows.cjs"));
const vueEditorsEsm = await import(pathToFileURL(resolve(root, "packages/vue/dist/editors.js")));
const vueEditorsCjs = require(resolve(root, "packages/vue/dist/editors.cjs"));
const reactEsm = await import(pathToFileURL(resolve(root, "packages/react/dist/index.js")));
const reactCjs = require(resolve(root, "packages/react/dist/index.cjs"));
const xlsxEsm = await import(pathToFileURL(resolve(root, "packages/xlsx/dist/index.js")));
const xlsxCjs = require(resolve(root, "packages/xlsx/dist/index.cjs"));

for (const entry of [coreEsm, coreCjs]) {
  assert.equal(typeof entry.createGrid, "function");
  assert.equal(typeof entry.createColumnHelper, "function");
  assert.equal(typeof entry.createEnterprisePreset, "function");
}
for (const entry of [vueEsm, vueCjs]) {
  assert.equal(typeof entry.MachTable, "object");
  assert.equal(typeof entry.MachTablePlugin.install, "function");
  assert.equal(typeof entry.defineMachTableConfig, "function");
  assert.equal(typeof entry.provideMachTableDefaults, "function");
}
for (const entry of [vueWorkflowsEsm, vueWorkflowsCjs]) {
  assert.equal(typeof entry.useMachTableEditing, "function");
  assert.equal(typeof entry.useMachTableQuery, "function");
}
for (const entry of [vueEditorsEsm, vueEditorsCjs]) {
  assert.equal(typeof entry.vueCellEditor, "function");
  assert.equal(typeof entry.createElementPlusEditors, "function");
}
for (const entry of [reactEsm, reactCjs]) {
  assert.equal(typeof entry.MachTable, "function");
  assert.equal(typeof entry.MachTableProvider, "function");
}
for (const entry of [xlsxEsm, xlsxCjs]) {
  assert.equal(typeof entry.createXlsxExtension, "function");
  assert.equal(typeof entry.exportGridToXlsx, "function");
}

console.log("OK   package export maps, ESM/CJS runtime entries, and consumer declarations");
