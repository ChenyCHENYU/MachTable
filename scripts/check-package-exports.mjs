import assert from "node:assert/strict";
import ts from "typescript";
import { access, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const snapshot = JSON.parse(await readFile(resolve(root, "api/public-api.snapshot.json"), "utf8"));
const manifests = new Map();
const modules = new Map();

function targets(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (value && typeof value === "object") Object.values(value).forEach(nested => targets(nested, output));
  return output;
}
function runtimeTarget(value, format) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") throw new Error(`Missing ${format} runtime export`);
  return runtimeTarget(value[format] ?? value.default, format);
}
function runtimeNames(entry) {
  return Object.keys(entry).filter(name => name !== "__esModule").sort();
}

for (const name of ["core", "vue", "react", "xlsx"]) {
  const directory = resolve(root, "packages", name);
  const manifest = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
  for (const target of new Set(targets(manifest.exports))) await access(resolve(directory, target));
  manifests.set(manifest.name, { directory, manifest });
  for (const [subpath, exported] of Object.entries(manifest.exports)) {
    if (!/\.(?:js|cjs)$/.test(runtimeTarget(exported, "import"))) continue;
    const specifier = `${manifest.name}${subpath === "." ? "" : subpath.slice(1)}`;
    assert.ok(snapshot.entrypoints[specifier], `${specifier} needs a governed source entrypoint`);
  }
  if (name !== "xlsx") {
    for (const style of ["workbench", "server-side"]) {
      const subpath = `./styles/${style}.css`;
      assert.ok(manifest.exports[subpath]?.types, `${manifest.name} ${subpath} needs a CSS declaration`);
      assert.ok(runtimeTarget(manifest.exports[subpath], "import").endsWith(".css"));
    }
  }
}

// Import every published JS entry with no DOM globals. Optional UIs may touch DOM
// only when mounted; their ESM/CJS imports must remain usable during SSR.
assert.equal(typeof globalThis.window, "undefined");
assert.equal(typeof globalThis.document, "undefined");
for (const [specifier, surface] of Object.entries(snapshot.entrypoints)) {
  const packageName = [...manifests.keys()].find(name => specifier === name || specifier.startsWith(`${name}/`));
  assert.ok(packageName, `No package owns ${specifier}`);
  const { directory, manifest } = manifests.get(packageName);
  const subpath = specifier === packageName ? "." : `.${specifier.slice(packageName.length)}`;
  const exported = manifest.exports[subpath];
  assert.ok(exported, `${specifier} is missing from the package export map`);
  assert.ok(exported.import?.types && exported.require?.types, `${specifier} needs ESM and CJS declarations`);
  const esm = await import(pathToFileURL(resolve(directory, runtimeTarget(exported, "import"))));
  // Resolve from the package's own scope, exercising Node's public export map.
  const require = createRequire(resolve(directory, "package.json"));
  assert.equal(require.resolve(specifier), resolve(directory, runtimeTarget(exported, "require")));
  const cjs = require(specifier);
  for (const [format, entry] of [["ESM", esm], ["CJS", cjs]]) {
    assert.deepEqual(runtimeNames(entry), surface.runtimeNames, `${specifier} ${format} differs from the source export symbols`);
  }
  modules.set(specifier, [esm, cjs]);
}

function assertFunctions(specifier, names) {
  for (const entry of modules.get(specifier)) {
    for (const name of names) assert.equal(typeof entry[name], "function", `${specifier} ${name}`);
  }
}
assertFunctions("@agile-team/mach-table", ["createGrid", "createColumnHelper", "createEnterprisePreset"]);
assertFunctions("@agile-team/mach-table/adapter", ["normalizeMachTableConfig", "resolveMachTableGridOptions", "suspendGrid", "resumeGrid", "readGridCell", "writeGridInput", "canReplaceGridData", "beginGridInput", "equivalentConfigValue", "equivalentGridOption"]);
assertFunctions("@agile-team/mach-table-xlsx", ["createXlsxExtension", "exportGridToXlsx"]);
for (const suffix of ["", "-vue", "-react"]) {
  const packageName = `@agile-team/mach-table${suffix}`;
  assertFunctions(`${packageName}/worker`, ["createWorkerDataProcessor", "installGridDataWorker"]);
  for (const [entry, names] of Object.entries({
    workbench: ["mountAdvancedFilterBuilder", "mountChangeReview", "mountDiagnostics", "inspectGridRow"],
    preferences: ["createGridPreferenceStore", "migrateGridState", "GridPreferenceConflictError"],
    ordering: ["reorderRows", "moveTreeNodes", "createRowOrderController", "RowOrderConflictError"],
    "server-side": ["createServerSideStore", "bindServerSideGrid", "createServerSideGroupColumn", "serverSideDataColumn", "ServerSideVersionConflictError"],
    analysis: ["createPivot", "evaluateFormulas", "mountAnalysis"],
    "multi-range": ["createMultiRangeSelection"],
    import: ["createImportPlan"],
    business: ["createDictionaryColumn", "summarizeRows"]
  })) assertFunctions(`${packageName}/${entry}`, names);
}
for (const packageName of ["@agile-team/mach-table-vue", "@agile-team/mach-table-react"]) {
  assertFunctions(`${packageName}/workflows`, ["useMachTableEditing", "useMachTableQuery", "useMachTableController"]);
}
for (const entry of modules.get("@agile-team/mach-table-vue")) {
  assert.equal(typeof entry.MachTable, "object");
  assert.equal(typeof entry.MachTablePlugin.install, "function");
  assert.equal(entry.default, entry.MachTablePlugin);
  assert.equal("provideMachTableDefaults" in entry, false);
}
for (const entry of modules.get("@agile-team/mach-table-react")) {
  assert.equal(typeof entry.MachTable, "function");
  assert.equal(entry.default, entry.MachTable);
}
assertFunctions("@agile-team/mach-table-vue/editors", ["vueCellEditor", "createElementPlusEditors"]);
assertFunctions("@agile-team/mach-table-vue/adapters", ["vueCellRenderer"]);
assertFunctions("@agile-team/mach-table-react/adapters", ["reactCellRenderer"]);
for (const entry of modules.get("@agile-team/mach-table-vue/ui")) assert.equal(typeof entry.MachTableToolbar, "object");
assertFunctions("@agile-team/mach-table-react/ui", ["MachTableToolbar"]);

const consumerConfigPath = resolve(root, "tests/consumer/cjs/tsconfig.json");
const configFile = ts.readConfigFile(consumerConfigPath, ts.sys.readFile);
assert.equal(configFile.error, undefined, "CJS consumer config must be readable");
const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, dirname(consumerConfigPath));
// Emit fixture declarations in memory as well: valid calls alone do not prove a
// consumer can publish its own portable CJS declarations through these wrappers.
const consumer = ts.createProgram(config.fileNames, {
  ...config.options, noEmit: false, declaration: true, emitDeclarationOnly: true
});
const diagnostics = [...config.errors, ...ts.getPreEmitDiagnostics(consumer)];
if (diagnostics.length) {
  throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: name => name, getCurrentDirectory: () => root, getNewLine: () => "\n"
  }));
}
const declarations = new Map();
const emitted = consumer.emit(undefined, (filename, content) => declarations.set(filename, content), undefined, true);
assert.equal(emitted.emitSkipped, false, "CJS consumer declaration emission must succeed");
assert.equal(emitted.diagnostics.length, 0, "CJS consumer declarations must emit without diagnostics");
assert.ok(declarations.size > 0, "CJS consumer must produce declarations");
for (const [filename, content] of declarations) {
  const file = ts.createSourceFile(filename, content, ts.ScriptTarget.Latest, true);
  const check = node => {
    let specifier;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
    else if (ts.isExternalModuleReference(node)) specifier = node.expression;
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) specifier = node.argument.literal;
    if (specifier && ts.isStringLiteral(specifier)) {
      assert.ok(snapshot.entrypoints[specifier.text], `Consumer declaration leaked a non-public module: ${specifier.text}`);
    }
    ts.forEachChild(node, check);
  };
  check(file);
}
console.log(`OK   package export maps, ${modules.size} SSR-safe ESM/CJS entries, optional styles and portable ESM/CJS declaration consumers`);
