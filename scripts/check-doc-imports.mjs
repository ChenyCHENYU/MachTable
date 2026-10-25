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

// One symbol-derived map governs documentation and emitted runtime entrypoints.
// In particular, `export *` framework wrappers expose Core's optional contracts.
const surfaces = new Map(Object.entries(snapshot.entrypoints).map(([name, surface]) => [name, {
  names: new Set(surface.names), hasDefault: surface.hasDefault
}]));
const styleImports = new Set();
for (const framework of ["core", "vue", "react"]) {
  const manifest = JSON.parse(readFileSync(join(projectRoot, "packages", framework, "package.json"), "utf8"));
  for (const subpath of Object.keys(manifest.exports)) {
    if (subpath.endsWith(".css")) styleImports.add(`${manifest.name}/${subpath.slice(2)}`);
  }
}

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
  const label = relative(projectRoot, source);
  const bareImports = /\bimport\s*(?:\(\s*)?["'](@agile-team\/mach-table(?:-(?:vue|react|xlsx))?(?:\/[^"']+)*)["']/g;
  for (const match of markdown.matchAll(bareImports)) {
    if (!surfaces.has(match[1]) && !styleImports.has(match[1])) {
      failures.push(`${label}: undocumented package subpath "${match[1]}"`);
    }
  }
  for (const match of markdown.matchAll(importPattern)) {
    const [, clause, packageName] = match;
    const surface = surfaces.get(packageName);
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
