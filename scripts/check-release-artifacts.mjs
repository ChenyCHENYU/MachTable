import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const packages = ["core", "vue", "react", "xlsx"];
const limits = { core: 1_050_000, vue: 450_000, react: 350_000, xlsx: 80_000 };
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

for (const name of packages) {
  const dist = path.resolve("packages", name, "dist");
  const files = await walk(dist);
  const sourceMaps = files.filter((file) => file.endsWith(".map"));
  const bytes = (await Promise.all(files.map((file) => stat(file)))).reduce((sum, item) => sum + item.size, 0);
  const ok = sourceMaps.length === 0 && bytes <= limits[name];
  console.log(`${ok ? "OK  " : "OVER"} ${name.padEnd(8)} ${bytes} / ${limits[name]} bytes; maps=${sourceMaps.length}`);
  failed ||= !ok;
}

if (failed) {
  console.error("Release artifact budget exceeded or source maps leaked into publishable dist.");
  process.exitCode = 1;
}
