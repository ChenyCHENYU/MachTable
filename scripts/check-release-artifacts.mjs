import { readdir, stat, readFile } from "node:fs/promises";
import path from "node:path";

const packages = ["core", "vue", "react", "xlsx"];
// The original distribution graph keeps its existing allowance. New optional
// artifacts are a separate, bounded addition; total npm unpacked size is always
// reported too, rather than presenting it as the default application download.
const limits = { core: 1_050_000, vue: 450_000, react: 350_000, xlsx: 80_000 };
const optionalLimit = 350_000;
const optionalEntries = ["workbench", "preferences", "ordering", "server-side", "analysis", "multi-range"];
let failed = false;

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(target));
    else files.push(target);
  }
  return files;
}

function targets(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (value && typeof value === "object") Object.values(value).forEach(item => targets(item, output));
  return output;
}

/** Follow actual runtime and declaration chunks; hashed filenames are not a scope boundary. */
async function reachable(initial, files) {
  const remaining = [...initial];
  const visited = new Set();
  while (remaining.length) {
    const file = remaining.pop();
    if (visited.has(file) || !files.has(file)) continue;
    visited.add(file);
    if (file.endsWith(".css")) continue;
    const text = await readFile(file, "utf8");
    for (const match of text.matchAll(/(?:from\s*|import\s*|require\s*\()\s*["'](\.[^"']+)["']/g)) {
      const dependency = path.resolve(path.dirname(file), match[1]);
      if (files.has(dependency)) remaining.push(dependency);
      else if (/\.d\.(?:ts|cts)$/.test(file)) {
        const extension = file.endsWith(".d.cts") ? ".d.cts" : ".d.ts";
        remaining.push(dependency.replace(/\.(?:mjs|cjs|js)$/, extension));
      }
    }
  }
  return visited;
}

for (const name of packages) {
  const directory = path.resolve("packages", name);
  const dist = path.join(directory, "dist");
  const files = await walk(dist);
  const sizes = new Map(await Promise.all(files.map(async file => [file, (await stat(file)).size])));
  const bytes = [...sizes.values()].reduce((sum, size) => sum + size, 0);
  const maps = files.filter(file => file.endsWith(".map"));
  let baseline = bytes;
  let optional = 0;
  let orphans = [];
  if (name === "core") {
    const manifest = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
    const advanced = new Set(optionalEntries.map(entry => `./${entry}`).concat(["./styles/workbench.css", "./styles/server-side.css"]));
    const baseTargets = targets(Object.fromEntries(Object.entries(manifest.exports).filter(([entry]) => !advanced.has(entry))));
    const optionalTargets = targets(Object.fromEntries(Object.entries(manifest.exports).filter(([entry]) => advanced.has(entry))));
    const baseFiles = await reachable(baseTargets.map(target => path.resolve(directory, target)), new Set(files));
    const optionalFiles = await reachable(optionalTargets.map(target => path.resolve(directory, target)), new Set(files));
    orphans = files.filter(file => !baseFiles.has(file) && !optionalFiles.has(file));
    baseline = [...baseFiles].reduce((sum, file) => sum + sizes.get(file), 0);
    optional = [...optionalFiles].filter(file => !baseFiles.has(file)).reduce((sum, file) => sum + sizes.get(file), 0);
  }
  const ok = maps.length === 0 && baseline <= limits[name] && optional <= optionalLimit && orphans.length === 0;
  console.log(`${ok ? "OK  " : "OVER"} ${name.padEnd(8)} existing export graph ${baseline} / ${limits[name]} bytes; maps=${maps.length}`);
  if (name === "core") console.log(`${optional <= optionalLimit ? "OK  " : "OVER"} Core optional additions ${optional} / ${optionalLimit} bytes; combined dist=${bytes} bytes`);
  if (orphans.length) console.error(`Unaccounted release files: ${orphans.join(", ")}`);
  failed ||= !ok;
}

if (failed) {
  console.error("Release artifact budget exceeded, orphaned chunks, or source maps leaked into publishable dist.");
  process.exitCode = 1;
}
