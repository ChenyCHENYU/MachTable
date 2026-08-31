import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
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

function indexExports(file) {
  const names = new Set();
  for (const statement of file.statements) {
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) names.add(element.name.text);
      continue;
    }
    const exported = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (
      ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) ||
      ts.isEnumDeclaration(statement)
    ) {
      if (statement.name) names.add(statement.name.text);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
      }
    }
  }
  return [...names].sort();
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
  schemaVersion: 5,
  policy: JSON.parse(fs.readFileSync(policyPath, "utf8")),
  coreExports: indexExports(source("packages/core/src/index.ts")),
  coreAdapter: indexExports(source("packages/core/src/adapter.ts")),
  workerExports: indexExports(source("packages/core/src/worker.ts")),
  adapterExports: {
    vue: indexExports(source("packages/vue/src/index.ts")),
    vueAsync: indexExports(source("packages/vue/src/async.ts")),
    vueWorkflows: indexExports(source("packages/vue/src/workflows.ts")),
    vueAdapters: indexExports(source("packages/vue/src/adapterEntry.ts")),
    vueUi: indexExports(source("packages/vue/src/ui.ts")),
    vueEditors: indexExports(source("packages/vue/src/editors.ts")),
    react: indexExports(source("packages/react/src/index.ts")),
    reactWorkflows: indexExports(source("packages/react/src/workflows.ts")),
    reactAdapters: indexExports(source("packages/react/src/adapterEntry.ts")),
    reactUi: indexExports(source("packages/react/src/ui.ts")),
    xlsx: indexExports(source("packages/xlsx/src/index.ts"))
  },
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
      "GridDatasource", "PaginationConfig", "GridFeature", "GridDataProcessor"
    ], "core."),
    ...declarationSignatures(colDefSource, ["ColDef", "ColDefGroup", "ColumnState", "SortModel"], "core."),
    ...declarationSignatures(stateSource, ["GridState", "GridStateSection", "ApplyGridStateOptions"], "core."),
    ...declarationSignatures(configurationSource, ["MachTableRuntimeConfig", "MachTableDefaults"], "core."),
    ...declarationSignatures(rendererSource, ["ActionItem", "ActionButtonsConfig", "RowActionsConfig"], "core."),
    ...declarationSignatures(vueComponentSource, ["MachTableVueProps", "MachTableVueExposed"], "vue."),
    ...declarationSignatures(vueQuerySource, ["UseMachTableQueryOptions", "UseMachTableQueryReturn"], "vue."),
    ...declarationSignatures(reactComponentSource, ["MachTableReactProps"], "react."),
    ...declarationSignatures(reactQuerySource, ["UseMachTableQueryOptions", "UseMachTableQueryReturn"], "react.")
  }
};
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
