import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const snapshotPath = path.join(root, "api", "public-api.snapshot.json");
const policyPath = path.join(root, "api", "public-api-policy.json");

function source(relative) {
  const file = path.join(root, relative);
  return ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function memberSignature(member, file) {
  if (!member.name) return null;
  return member.getText(file).replace(/\s+/g, " ").trim();
}

function interfaceMembers(file, names) {
  const result = {};
  for (const statement of file.statements) {
    if (!ts.isInterfaceDeclaration(statement) || !names.includes(statement.name.text)) continue;
    result[statement.name.text] = statement.members
      .map((member) => memberSignature(member, file))
      .filter(Boolean)
      .sort();
  }
  return result;
}

const printer = ts.createPrinter({ removeComments: true });
function declarationSignatures(file, names, prefix = "") {
  const result = {};
  const found = new Set();
  for (const statement of file.statements) {
    if (
      (!ts.isInterfaceDeclaration(statement) && !ts.isTypeAliasDeclaration(statement)) ||
      !names.includes(statement.name.text)
    ) continue;
    found.add(statement.name.text);
    result[`${prefix}${statement.name.text}`] = printer
      .printNode(ts.EmitHint.Unspecified, statement, file)
      .replace(/\s+/g, " ")
      .trim();
  }
  const missing = names.filter((name) => !found.has(name));
  if (missing.length > 0) throw new Error(`Missing governed declaration(s): ${missing.join(", ")}`);
  return result;
}

// Resolve module symbols rather than spelling: adapter `export *` wrappers are part
// of the same reviewed surface, even when a source barrel contains no named exports.
const optionalEntries = ["workbench", "preferences", "ordering", "server-side", "analysis", "multi-range", "import", "business"];
const entryFiles = {
  "@agile-team/mach-table": "packages/core/src/index.ts",
  "@agile-team/mach-table/adapter": "packages/core/src/adapter.ts",
  "@agile-team/mach-table/worker": "packages/core/src/worker.ts",
  "@agile-team/mach-table-vue": "packages/vue/src/index.ts",
  "@agile-team/mach-table-vue/async": "packages/vue/src/async.ts",
  "@agile-team/mach-table-vue/workflows": "packages/vue/src/workflows.ts",
  "@agile-team/mach-table-vue/adapters": "packages/vue/src/adapterEntry.ts",
  "@agile-team/mach-table-vue/ui": "packages/vue/src/ui.ts",
  "@agile-team/mach-table-vue/editors": "packages/vue/src/editors.ts",
  "@agile-team/mach-table-vue/worker": "packages/vue/src/worker.ts",
  "@agile-team/mach-table-react": "packages/react/src/index.ts",
  "@agile-team/mach-table-react/workflows": "packages/react/src/workflows.ts",
  "@agile-team/mach-table-react/adapters": "packages/react/src/adapterEntry.ts",
  "@agile-team/mach-table-react/ui": "packages/react/src/ui.ts",
  "@agile-team/mach-table-react/worker": "packages/react/src/worker.ts",
  "@agile-team/mach-table-xlsx": "packages/xlsx/src/index.ts"
};
for (const entry of optionalEntries) {
  for (const framework of ["core", "vue", "react"]) {
    const packageName = `@agile-team/mach-table${framework === "core" ? "" : `-${framework}`}`;
    const filename = framework === "core" && entry === "multi-range" ? "multiRange" : entry;
    entryFiles[`${packageName}/${entry}`] = `packages/${framework}/src/${filename}.ts`;
  }
}
const config = ts.readConfigFile(path.join(root, "tsconfig.base.json"), ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const program = ts.createProgram(Object.values(entryFiles).map(file => path.join(root, file)), {
  ...parsed.options, jsx: ts.JsxEmit.ReactJSX
});
const checker = program.getTypeChecker();
const format = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;
const clean = value => value.replace(/\s+/g, " ").trim();
function resolvedSymbol(symbol) {
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}
function isRuntimeExport(symbol) {
  return Boolean(resolvedSymbol(symbol).flags & ts.SymbolFlags.Value) &&
    !symbol.declarations?.some(node => ts.isExportSpecifier(node) && ts.isTypeOnlyExportDeclaration(node));
}
function moduleExports(relative) {
  const file = program.getSourceFile(path.join(root, relative));
  if (!file) throw new Error(`Missing entrypoint source: ${relative}`);
  const module = checker.getSymbolAtLocation(file);
  if (!module) throw new Error(`Entrypoint is not a module: ${relative}`);
  return checker.getExportsOfModule(module).sort((a, b) => a.name.localeCompare(b.name, "en"));
}

function print(node) {
  return clean(printer.printNode(ts.EmitHint.Unspecified, node, node.getSourceFile()));
}
function callable(node) {
  const signature = checker.getSignatureFromDeclaration(node);
  if (!signature) throw new Error(`Cannot resolve public signature: ${node.getText()}`);
  return clean(checker.signatureToString(signature, node, format));
}
function isPrivate(node) {
  return Boolean(ts.getCombinedModifierFlags(node) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) ||
    Boolean(node.name && ts.isPrivateIdentifier(node.name));
}
function classSignature(node) {
  const members = [];
  for (const member of node.members) {
    if (isPrivate(member)) continue;
    if (ts.isConstructorDeclaration(member)) {
      members.push(`constructor${callable(member)}`);
      for (const parameter of member.parameters) {
        if (isPrivate(parameter) || !ts.isParameterPropertyDeclaration(parameter, member)) continue;
        members.push(print(ts.factory.createPropertySignature(parameter.modifiers, parameter.name, parameter.questionToken, parameter.type)));
      }
    } else if (ts.isPropertyDeclaration(member)) {
      const type = checker.typeToString(checker.getTypeAtLocation(member), member, format);
      const flags = ts.getCombinedModifierFlags(member);
      members.push(`${flags & ts.ModifierFlags.Static ? "static " : ""}${flags & ts.ModifierFlags.Readonly ? "readonly " : ""}${print(member.name)}${member.questionToken ? "?" : ""}: ${type};`);
    } else if (ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
      members.push(`${ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static ? "static " : ""}${print(member.name)}${callable(member)}`);
    }
  }
  return `class ${node.name.text}${node.typeParameters ? `<${node.typeParameters.map(print).join(", ")}>` : ""} ${node.heritageClauses?.map(print).join(" ") ?? ""} { ${members.sort().join(" ")} }`;
}
function publicSignature(symbol) {
  const resolved = resolvedSymbol(symbol);
  const declarations = resolved.declarations ?? [];
  if (!declarations.length) throw new Error(`Unresolved public export: ${symbol.name}`);
  return declarations.map(node => {
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) return print(node);
    if (ts.isFunctionDeclaration(node)) return `function ${symbol.name}${callable(node)}`;
    if (ts.isClassDeclaration(node)) return classSignature(node);
    return `${symbol.name}: ${clean(checker.typeToString(checker.getTypeOfSymbolAtLocation(resolved, node), node, format))}`;
  }).sort();
}
// Non-exported aliases used by a public signature are still observable contracts.
// Follow only signature syntax, never implementation bodies or private members.
function signatureNodes(node) {
  if (ts.isFunctionDeclaration(node)) return [...(node.typeParameters ?? []), ...node.parameters, ...(node.type ? [node.type] : [])];
  if (ts.isClassDeclaration(node)) return [...(node.typeParameters ?? []), ...(node.heritageClauses ?? []), ...node.members.filter(member => !isPrivate(member)).flatMap(member => {
    if (ts.isConstructorDeclaration(member) || ts.isMethodDeclaration(member) || ts.isAccessor(member)) return [...(member.typeParameters ?? []), ...member.parameters, ...(member.type ? [member.type] : [])];
    return member.type ? [member.type] : [];
  })];
  return [node];
}
const optionalDependencies = {};
const publicOptionalSymbols = new Set(optionalEntries.flatMap(entry =>
  moduleExports(entryFiles[`@agile-team/mach-table/${entry}`]).map(resolvedSymbol)
));
const visitedDependencies = new Set();
function captureDependencies(symbol) {
  const resolved = resolvedSymbol(symbol);
  if (visitedDependencies.has(resolved)) return;
  visitedDependencies.add(resolved);
  for (const declaration of resolved.declarations ?? []) {
    const visit = node => {
      if (ts.isIdentifier(node)) {
        const referenced = checker.getSymbolAtLocation(node);
        if (referenced) {
          const dependency = resolvedSymbol(referenced);
          const declared = dependency.declarations?.find(item => ts.isTypeAliasDeclaration(item) || ts.isInterfaceDeclaration(item) || ts.isClassDeclaration(item) || ts.isEnumDeclaration(item));
          const relative = declared && path.relative(root, declared.getSourceFile().fileName).replaceAll(path.sep, "/");
          if (relative && /^packages\/core\/src\/(workbench|analysis|ordering|preferences|server-side|import)\//.test(relative)) {
            if (!publicOptionalSymbols.has(dependency)) optionalDependencies[`${relative}#${dependency.name}`] = publicSignature(dependency);
            captureDependencies(dependency);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    for (const node of signatureNodes(declaration)) visit(node);
  }
}
const entrypoints = {};
for (const [name, file] of Object.entries(entryFiles)) {
  const symbols = moduleExports(file);
  const optional = optionalEntries.find(entry => name.endsWith(`/${entry}`));
  const signatures = optional ? Object.fromEntries(symbols.map(symbol => {
    captureDependencies(symbol);
    return [symbol.name, publicSignature(symbol)];
  })) : undefined;
  const runtimeNames = symbols.filter(isRuntimeExport).map(symbol => symbol.name).sort();
  const canonicalName = optional && `@agile-team/mach-table/${optional}`;
  const canonical = canonicalName && name !== canonicalName ? entrypoints[canonicalName] : null;
  if (canonical && (JSON.stringify(signatures) !== JSON.stringify(canonical.signatures) ||
      JSON.stringify(runtimeNames) !== JSON.stringify(canonical.runtimeNames))) {
    throw new Error(`${name} must expose the same reviewed contracts as ${canonicalName}`);
  }
  entrypoints[name] = {
    names: symbols.map(symbol => symbol.name).filter(name => name !== "default").sort(),
    runtimeNames,
    hasDefault: symbols.some(symbol => symbol.name === "default"),
    ...(canonical ? { reexports: canonicalName } : signatures ? { signatures } : {})
  };
}

const apiSource = source("packages/core/src/types/api.ts");
const optionSource = source("packages/core/src/types/options.ts");
const eventSource = source("packages/core/src/types/events.ts");
const colDefSource = source("packages/core/src/types/colDef.ts");
const stateSource = source("packages/core/src/types/state.ts");
const configurationSource = source("packages/core/src/lib/configuration.ts");
const rendererSource = source("packages/core/src/lib/presetRenderers.ts");
const vueComponentSource = source("packages/vue/src/MachTable.ts");
const vueQuerySource = source("packages/vue/src/useMachTableQuery.ts");
const reactComponentSource = source("packages/react/src/MachTable.tsx");
const reactQuerySource = source("packages/react/src/useMachTableQuery.ts");
const current = {
  schemaVersion: 6,
  policy: JSON.parse(fs.readFileSync(policyPath, "utf8")),
  entrypoints,
  rootCapabilities: Object.fromEntries(moduleExports("packages/core/src/index.ts")
    .filter(symbol => symbol.name === "resolveSaveConflict")
    .map(symbol => [symbol.name, publicSignature(symbol)])),
  adapterCapabilities: Object.fromEntries(moduleExports("packages/core/src/adapter.ts")
    .filter(symbol => ["suspendGrid", "resumeGrid", "readGridCell", "writeGridInput", "canReplaceGridData", "beginGridInput", "equivalentConfigValue", "equivalentGridOption", "GridInputCell"].includes(symbol.name))
    .map(symbol => [symbol.name, publicSignature(symbol)])),
  optionalDependencies: Object.fromEntries(Object.entries(optionalDependencies).sort(([a], [b]) => a.localeCompare(b, "en"))),
  interfaces: {
    ...interfaceMembers(apiSource, [
      "GridApi", "GridRowsApi", "GridColumnsApi", "GridSelectionApi",
      "GridEditingApi", "GridStateApi", "GridDiagnosticsApi"
      , "GridFilteringApi", "GridSortingApi", "GridPaginationApi",
      "GridHierarchyApi", "GridViewApi", "GridIoApi"
    ]),
    ...interfaceMembers(optionSource, ["GridOptions", "GridFeature", "GridDataProcessor"]),
    ...interfaceMembers(eventSource, ["GridEventMap"])
  },
  contracts: {
    ...declarationSignatures(optionSource, [
      "GridOptions", "GridPersistenceOptions", "GridStateStore", "GridComponents",
      "GridDatasource", "PaginationConfig", "GridFeature", "GridDataProcessor", "RowDragPolicy"
    ], "core."),
    ...declarationSignatures(eventSource, ["RowDragIntent", "RowDragEndEvent"], "core."),
    ...declarationSignatures(colDefSource, [
      "ColDef", "ColDefGroup", "ColumnState", "SortModel", "SelectEditorOption", "SelectEditorParams"
    ], "core."),
    ...declarationSignatures(stateSource, ["GridState", "GridStateSection", "ApplyGridStateOptions"], "core."),
    ...declarationSignatures(configurationSource, ["MachTableRuntimeConfig", "MachTableDefaults"], "core."),
    ...declarationSignatures(rendererSource, ["ActionItem", "ActionButtonsConfig", "RowActionsConfig"], "core."),
    ...declarationSignatures(vueComponentSource, ["MachTableVueProps", "MachTableVueExposed"], "vue."),
    ...declarationSignatures(vueQuerySource, ["UseMachTableQueryOptions", "UseMachTableQueryReturn"], "vue."),
    ...declarationSignatures(reactComponentSource, ["MachTableReactProps"], "react."),
    ...declarationSignatures(reactQuerySource, ["UseMachTableQueryOptions", "UseMachTableQueryReturn"], "react.")
  }
};
const rootMembers = current.interfaces.GridApi;
const domains = current.policy.preferredDomains;
const lifecycle = ["batch", "whenReady", "getOption", "updateOptions", "on", "destroy", "isDestroyed"];
const gridApi = apiSource.statements.find(node => ts.isInterfaceDeclaration(node) && node.name.text === "GridApi");
const rootNames = gridApi.members.map(member => member.name && ts.isIdentifier(member.name) ? member.name.text : null);
if (rootMembers.length > current.policy.flatApi.rootMemberLimit ||
    rootNames.some(name => ![...domains, ...lifecycle].includes(name)) ||
    domains.some(name => !rootNames.includes(name))) {
  throw new Error("GridApi root must keep the reviewed domain/lifecycle structure and member budget.");
}
const serialized = `${JSON.stringify(current, null, 2)}\n`;

if (process.argv.includes("--update")) {
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, serialized);
  console.log(`Updated ${path.relative(root, snapshotPath)}`);
  process.exit(0);
}

if (!fs.existsSync(snapshotPath)) {
  console.error("Public API snapshot is missing. Run: pnpm check:api:update");
  process.exit(1);
}
const expected = fs.readFileSync(snapshotPath, "utf8");
if (expected !== serialized) {
  console.error("Public API surface changed. Review compatibility, add migration notes, then run: pnpm check:api:update");
  process.exit(1);
}
console.log("Public API snapshot is current.");
