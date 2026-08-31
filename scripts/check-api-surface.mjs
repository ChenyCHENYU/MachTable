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
const current = {
  schemaVersion: 3,
  policy: JSON.parse(fs.readFileSync(policyPath, "utf8")),
  coreExports: indexExports(source("packages/core/src/index.ts")),
  workerExports: indexExports(source("packages/core/src/worker.ts")),
  adapterExports: {
    vue: indexExports(source("packages/vue/src/index.ts")),
    vueAsync: indexExports(source("packages/vue/src/async.ts")),
    vueWorkflows: indexExports(source("packages/vue/src/workflows.ts")),
    react: indexExports(source("packages/react/src/index.ts")),
    reactWorkflows: indexExports(source("packages/react/src/workflows.ts")),
    xlsx: indexExports(source("packages/xlsx/src/index.ts"))
  },
  interfaces: {
    ...interfaceMembers(apiSource, [
      "GridApi", "GridRowsApi", "GridColumnsApi", "GridSelectionApi",
      "GridEditingApi", "GridStateApi", "GridDiagnosticsApi"
      , "GridFilteringApi", "GridPaginationApi"
    ]),
    ...interfaceMembers(optionSource, ["GridOptions", "GridFeature", "GridDataProcessor"]),
    ...interfaceMembers(eventSource, ["GridEventMap"])
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
