import { readFile, readdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const vueEsmFiles = (await readdir(new URL("../packages/vue/dist/", import.meta.url)))
  .filter((file) => file.endsWith(".js"))
  .map((file) => `packages/vue/dist/${file}`);

const budgets = [
  ["Core ESM", ["packages/core/dist/index.js"], 80 * 1024],
  ["Vue adapter ESM total", vueEsmFiles, 6 * 1024],
  ["React adapter ESM", ["packages/react/dist/index.js"], 5 * 1024],
  ["Core CSS", ["packages/core/styles/mach-table.css"], 6 * 1024]
];

let failed = false;
for (const [label, paths, limit] of budgets) {
  const contents = await Promise.all(paths.map((path) => readFile(new URL(`../${path}`, import.meta.url))));
  // Summing each output's gzip size is a conservative upper bound because HTTP
  // serves split chunks independently and consumers may load every public entry.
  const size = contents.reduce((total, content) => total + gzipSync(content).byteLength, 0);
  const status = size <= limit ? "OK" : "OVER";
  console.log(`${status.padEnd(4)} ${label.padEnd(20)} ${size} / ${limit} bytes gzip`);
  if (size > limit) failed = true;
}

if (failed) {
  console.error("Bundle size budget exceeded.");
  process.exitCode = 1;
}
