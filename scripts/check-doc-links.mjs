import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const documentationRoot = join(projectRoot, "docs");
const inputs = [
  join(projectRoot, "README.md"),
  join(projectRoot, "CONTRIBUTING.md"),
  join(projectRoot, "SECURITY.md"),
  join(projectRoot, "packages", "core", "README.md"),
  join(projectRoot, "packages", "vue", "README.md"),
  join(projectRoot, "packages", "react", "README.md")
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

function resolveTarget(source, rawTarget) {
  const target = rawTarget.trim().replace(/^<|>$/g, "").split("#", 1)[0].split("?", 1)[0];
  if (!target || /^(?:[a-z]+:|#)/i.test(target)) return null;
  if (target.startsWith("/")) {
    if (target === "/") return join(documentationRoot, "README.md");
    if (extname(target)) return join(documentationRoot, target.slice(1));
    return join(documentationRoot, `${target.slice(1)}.md`);
  }
  return normalize(resolve(dirname(source), decodeURIComponent(target)));
}

const failures = [];
for (const source of [...new Set(inputs)]) {
  const markdown = readFileSync(source, "utf8");
  const targets = [
    ...[...markdown.matchAll(/!?(?:\[[^\]]*\])\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((match) => match[1]),
    ...[...markdown.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1])
  ];
  for (const rawTarget of targets) {
    const target = resolveTarget(source, rawTarget);
    if (target && !existsSync(target)) {
      failures.push(`${source.slice(projectRoot.length + 1)} -> ${rawTarget}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Broken local documentation links:\n" + failures.map((item) => `- ${item}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`OK   Documentation links (${new Set(inputs).size} Markdown files)`);
}
