import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const vueEsmFiles = (await readdir(new URL("../packages/vue/dist/", import.meta.url)))
  .filter((file) => file.endsWith(".js"))
  .map((file) => `packages/vue/dist/${file}`);
const reactEsmFiles = (await readdir(new URL("../packages/react/dist/", import.meta.url)))
  .filter((file) => file.endsWith(".js"))
  .map((file) => `packages/react/dist/${file}`);

const budgets = [
  // The full entry includes every public utility for compatibility; keep it
  // bounded while separately enforcing the smaller real createGrid consumer.
  ["Core ESM", ["packages/core/dist/index.js"], 86 * 1024],
  ["Optional Worker", ["packages/core/dist/worker.js"], 8 * 1024],
  ["Vue ESM artifacts", vueEsmFiles, 10.5 * 1024],
  ["React ESM artifacts", reactEsmFiles, 8 * 1024],
  ["Optional XLSX bridge", ["packages/xlsx/dist/index.js"], 3 * 1024],
  ["Core CSS", ["packages/core/styles/mach-table.css"], 7 * 1024]
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
    label: "Core createGrid consumer",
    source: `
      import { createGrid } from "./packages/core/dist/index.js";
      globalThis.__machTableCreateGrid = createGrid;
    `,
    limit: 79 * 1024
  },
  {
    label: "Vue initial adapter",
    source: `
      import plugin, { MachTable, defineMachTableConfig } from "./packages/vue/dist/index.js";
      globalThis.__machTableConsumer = [plugin, MachTable, defineMachTableConfig];
    `,
    // Native slots, async/global registration and configuration remain below
    // 6.75 KiB while query/editing/UI stay independently tree-shakeable.
    limit: 6.75 * 1024
  },
  {
    label: "Vue B-side workflows",
    source: `
      import { useMachTableEditing, useMachTableQuery } from "./packages/vue/dist/workflows.js";
      globalThis.__machTableWorkflows = [useMachTableEditing, useMachTableQuery];
    `,
    limit: 5 * 1024
  },
  {
    label: "Vue optional editors",
    source: `
      import { vueCellEditor, createElementPlusEditors } from "./packages/vue/dist/editors.js";
      globalThis.__machTableEditors = [vueCellEditor, createElementPlusEditors];
    `,
    limit: 3 * 1024
  },
  {
    label: "Vue optional UI",
    source: `
      import ui, { MachTableToolbar } from "./packages/vue/dist/ui.js";
      globalThis.__machTableUi = [ui, MachTableToolbar];
    `,
    limit: 3 * 1024
  },
  {
    label: "React initial adapter",
    source: `
      import MachTable, { MachTableProvider, defineMachTableConfig } from "./packages/react/dist/index.js";
      globalThis.__machTableReact = [MachTable, MachTableProvider, defineMachTableConfig];
    `,
    // React's adapter also includes the typed Provider/config resolver. Keep the
    // initial path below 6.25 KiB while the optional query/editing workflows stay
    // independently measurable through the workflows subpath.
    limit: 6.25 * 1024
  },
  {
    label: "React B-side workflows",
    source: `
      import { useMachTableEditing, useMachTableQuery } from "./packages/react/dist/workflows.js";
      globalThis.__machTableReactWorkflows = [useMachTableEditing, useMachTableQuery];
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
    external: ["vue", "react", "react-dom", "@agile-team/mach-table"]
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
