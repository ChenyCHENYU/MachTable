import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const workspace = fs.readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8");
const packageDirectories = ["core", "vue", "react", "xlsx"];
const failures = [];

if (!/^embedReadme:\s*true\s*$/m.test(workspace)) {
  failures.push("pnpm-workspace.yaml must enable embedReadme: true");
}

for (const directory of packageDirectories) {
  const packageRoot = path.join(root, "packages", directory);
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  const readme = fs.readFileSync(path.join(packageRoot, "README.md"), "utf8");
  if (readme.trim().length < 500) failures.push(`${manifest.name}: README is unexpectedly short`);
  if (!readme.includes(manifest.name)) failures.push(`${manifest.name}: README does not identify its package`);
  if (!/authorization|授权/i.test(readme)) failures.push(`${manifest.name}: README is missing the authorization boundary`);
}

if (failures.length > 0) {
  console.error(`Package README gate failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log("Package README metadata and authorization boundaries are ready for publication.");
