import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const packageNames = ["core", "vue", "react", "xlsx"];

/** Changesets 不处理私有根包；四包版本一致后再同步根目录的发布身份。 */
export function syncWorkspaceVersion(root) {
  const read = path => JSON.parse(readFileSync(resolve(root, path), "utf8"));
  const versions = packageNames.map(name => read(`packages/${name}/package.json`).version);
  if (new Set(versions).size !== 1 || typeof versions[0] !== "string") {
    throw new Error("The four fixed MachTable package versions must agree before updating the private root.");
  }
  const manifestPath = resolve(root, "package.json");
  const manifest = read("package.json");
  if (manifest.private !== true) throw new Error("Expected the MachTable workspace root to be private.");
  if (manifest.version === versions[0]) return false;
  manifest.version = versions[0];
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const require = createRequire(import.meta.url);
  const result = spawnSync(process.execPath, [require.resolve("@changesets/cli/bin.js"), "version", ...process.argv.slice(2)], {
    cwd: root, stdio: "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  syncWorkspaceVersion(root);
}
