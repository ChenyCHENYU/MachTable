import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const documentationRoot = join(projectRoot, "docs");
const snapshot = JSON.parse(readFileSync(join(projectRoot, "api", "public-api.snapshot.json"), "utf8"));
const inputs = [
  join(projectRoot, "README.md"),
  join(projectRoot, "CONTRIBUTING.md"),
  join(projectRoot, "SECURITY.md"),
  ...["core", "vue", "react", "xlsx"].map((name) => join(projectRoot, "packages", name, "README.md"))
];

function collectMarkdown(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const stats = statSync(path);
    if (stats.isDirectory()) collectMarkdown(path);
    else if (extname(name) === ".md") inputs.push(path);
  }
}

collectMarkdown(documentationRoot);

const union = (...groups) => new Set(groups.flat());
const core = snapshot.coreExports;
const worker = snapshot.workerExports;
const adapters = snapshot.adapterExports;
const surfaces = new Map([
  ["@agile-team/mach-table", { names: new Set(core), hasDefault: false }],
  ["@agile-team/mach-table/adapter", { names: new Set(snapshot.coreAdapter), hasDefault: false }],
  ["@agile-team/mach-table/worker", { names: new Set(worker), hasDefault: false }],
  ["@agile-team/mach-table-vue", { names: union(core, adapters.vue), hasDefault: true }],
  ["@agile-team/mach-table-vue/async", { names: new Set(adapters.vueAsync), hasDefault: true }],
  ["@agile-team/mach-table-vue/workflows", { names: new Set(adapters.vueWorkflows), hasDefault: false }],
  ["@agile-team/mach-table-vue/adapters", { names: new Set(adapters.vueAdapters), hasDefault: false }],
  ["@agile-team/mach-table-vue/ui", { names: new Set(adapters.vueUi), hasDefault: true }],
  ["@agile-team/mach-table-vue/editors", { names: new Set(adapters.vueEditors), hasDefault: false }],
  ["@agile-team/mach-table-vue/worker", { names: new Set(worker), hasDefault: false }],
  ["@agile-team/mach-table-react", { names: union(core, adapters.react), hasDefault: true }],
  ["@agile-team/mach-table-react/workflows", { names: new Set(adapters.reactWorkflows), hasDefault: false }],
  ["@agile-team/mach-table-react/adapters", { names: new Set(adapters.reactAdapters), hasDefault: false }],
  ["@agile-team/mach-table-react/ui", { names: new Set(adapters.reactUi), hasDefault: false }],
  ["@agile-team/mach-table-react/worker", { names: new Set(worker), hasDefault: false }],
  ["@agile-team/mach-table-xlsx", { names: new Set(adapters.xlsx), hasDefault: false }]
]);

function importedNames(clause) {
  const match = clause.match(/\{([\s\S]*?)\}/);
  if (!match) return [];
  return match[1]
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(",")
    .map((name) => name.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0])
    .filter(Boolean);
}

const failures = [];
const importPattern = /\bimport\s+((?:type\s+)?(?:\{[^}]*\}|[A-Za-z_$][\w$]*(?:\s*,\s*\{[^}]*\})?|\*\s+as\s+[A-Za-z_$][\w$]*))\s+from\s+["'](@agile-team\/mach-table(?:-(?:vue|react|xlsx))?(?:\/[^"']+)*)["']/g;
for (const source of [...new Set(inputs)]) {
  const markdown = readFileSync(source, "utf8");
  for (const match of markdown.matchAll(importPattern)) {
    const [, clause, packageName] = match;
    const surface = surfaces.get(packageName);
    const label = relative(projectRoot, source);
    if (!surface) {
      failures.push(`${label}: undocumented package subpath "${packageName}"`);
      continue;
    }
    const withoutType = clause.trim().replace(/^type\s+/, "");
    const hasDefault = !withoutType.startsWith("{") && !withoutType.startsWith("*");
    if (hasDefault && !surface.hasDefault) {
      failures.push(`${label}: "${packageName}" has no default export`);
    }
    for (const name of importedNames(clause)) {
      if (!surface.names.has(name)) failures.push(`${label}: "${name}" is not exported by "${packageName}"`);
    }
  }
}

if (failures.length > 0) {
  console.error("Invalid documented package imports:\n" + failures.map((item) => `- ${item}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`OK   Documented package imports (${new Set(inputs).size} Markdown files)`);
}
