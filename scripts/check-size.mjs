import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const vueEsmFiles = (await readdir(new URL("../packages/vue/dist/", import.meta.url)))
  .filter((file) => file.endsWith(".js"))
  .map((file) => `packages/vue/dist/${file}`);

const budgets = [
  ["Core ESM", ["packages/core/dist/index.js"], 80 * 1024],
  ["Vue ESM artifacts", vueEsmFiles, 8 * 1024],
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

const consumerBudgets = [
  {
    label: "Vue initial adapter",
    source: `
      import plugin, { MachTable, defineMachTableConfig } from "./packages/vue/dist/index.js";
      globalThis.__machTableConsumer = [plugin, MachTable, defineMachTableConfig];
    `,
    limit: 6_400
  },
  {
    label: "Vue B-side workflows",
    source: `
      import { useMachTableEditing, useMachTableQuery } from "./packages/vue/dist/workflows.js";
      globalThis.__machTableWorkflows = [useMachTableEditing, useMachTableQuery];
    `,
    limit: 5 * 1024
  }
];

for (const { label, source, limit } of consumerBudgets) {
  const result = await build({
    stdin: { contents: source, resolveDir: root, sourcefile: `${label}.mjs` },
    bundle: true,
    write: false,
    minify: true,
    treeShaking: true,
    format: "esm",
    platform: "browser",
    target: "es2020",
    external: ["vue", "@agile-team/mach-table"]
  });
  const size = result.outputFiles.reduce((total, output) => total + gzipSync(output.contents).byteLength, 0);
  const status = size <= limit ? "OK" : "OVER";
  console.log(`${status.padEnd(4)} ${label.padEnd(20)} ${size} / ${limit} bytes gzip`);
  if (size > limit) failed = true;
}

if (failed) {
  console.error("Bundle size budget exceeded.");
  process.exitCode = 1;
}
