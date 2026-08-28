import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const budgets = [
  ["Core ESM", "packages/core/dist/index.js", 80 * 1024],
  ["Vue adapter ESM", "packages/vue/dist/index.js", 5 * 1024],
  ["React adapter ESM", "packages/react/dist/index.js", 5 * 1024],
  ["Core CSS", "packages/core/styles/mach-table.css", 6 * 1024]
];

let failed = false;
for (const [label, path, limit] of budgets) {
  const content = await readFile(new URL(`../${path}`, import.meta.url));
  const size = gzipSync(content).byteLength;
  const status = size <= limit ? "OK" : "OVER";
  console.log(`${status.padEnd(4)} ${label.padEnd(20)} ${size} / ${limit} bytes gzip`);
  if (size > limit) failed = true;
}

if (failed) {
  console.error("Bundle size budget exceeded.");
  process.exitCode = 1;
}
