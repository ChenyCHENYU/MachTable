import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { gzipBudgets } from "./bundle-budgets.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const vueEsmFiles = (await readdir(new URL("../packages/vue/dist/", import.meta.url)))
  .filter((file) => file.endsWith(".js"))
  .map((file) => `packages/vue/dist/${file}`);
const reactEsmFiles = (await readdir(new URL("../packages/react/dist/", import.meta.url)))
  .filter((file) => file.endsWith(".js"))
  .map((file) => `packages/react/dist/${file}`);

const artifactPaths = {
  core: ["packages/core/dist/index.js"], worker: ["packages/core/dist/worker.js"],
  vue: vueEsmFiles, react: reactEsmFiles, xlsx: ["packages/xlsx/dist/index.js"],
  css: ["packages/core/dist/mach-table.css"],
  ...Object.fromEntries(["workbench", "preferences", "ordering", "server-side", "analysis", "multi-range", "import"]
    .map(name => [name, [`packages/core/dist/${name}.js`]])),
  workbenchCss: ["packages/core/dist/workbench.css"], serverCss: ["packages/core/dist/server-side.css"]
};
const budgets = Object.entries(artifactPaths).map(([key, paths]) => {
  const [label, limit] = gzipBudgets[key];
  return [label, paths, limit];
});

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
    limit: gzipBudgets.coreConsumer[1]
  },
  {
    label: "Vue initial adapter",
    source: `
      import plugin, { MachTable, defineMachTableConfig } from "./packages/vue/dist/index.js";
      globalThis.__machTableConsumer = [plugin, MachTable, defineMachTableConfig];
    `,
    limit: gzipBudgets.vueConsumer[1]
  },
  {
    label: "Vue B-side workflows",
    source: `
      import { useMachTableEditing, useMachTableQuery } from "./packages/vue/dist/workflows.js";
      globalThis.__machTableWorkflows = [useMachTableEditing, useMachTableQuery];
    `,
    limit: gzipBudgets.vueWorkflows[1]
  },
  {
    label: "Vue optional editors",
    source: `
      import { vueCellEditor, createElementPlusEditors } from "./packages/vue/dist/editors.js";
      globalThis.__machTableEditors = [vueCellEditor, createElementPlusEditors];
    `,
    limit: gzipBudgets.vueEditors[1]
  },
  {
    label: "Vue optional UI",
    source: `
      import ui, { MachTableToolbar } from "./packages/vue/dist/ui.js";
      globalThis.__machTableUi = [ui, MachTableToolbar];
    `,
    limit: gzipBudgets.vueUi[1]
  },
  {
    label: "React initial adapter",
    source: `
      import MachTable, { MachTableProvider, defineMachTableConfig } from "./packages/react/dist/index.js";
      globalThis.__machTableReact = [MachTable, MachTableProvider, defineMachTableConfig];
    `,
    limit: gzipBudgets.reactConsumer[1]
  },
  {
    label: "React B-side workflows",
    source: `
      import { useMachTableEditing, useMachTableQuery } from "./packages/react/dist/workflows.js";
      globalThis.__machTableReactWorkflows = [useMachTableEditing, useMachTableQuery];
    `,
    limit: gzipBudgets.reactWorkflows[1]
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

// Published Core is a single bundle, so its consumer metafile cannot identify
// the source modules folded into that file. Check the matching source graph as
// well as measuring the real dist consumer above; do not infer isolation from
// a disabled runtime option or from the absence of an exported name.
for (const [name, entry] of [["Core", "core/src/index.ts"], ["Vue", "vue/src/index.ts"], ["React", "react/src/index.ts"]]) {
  const result = await build({
    entryPoints: [resolve(root, "packages", entry)], bundle: true, write: false,
    minify: true, treeShaking: true, metafile: true, platform: "browser", format: "esm", target: "es2020",
    external: ["vue", "react", "react-dom", "@agile-team/mach-table", "@agile-team/mach-table/adapter"]
  });
  const forbidden = Object.keys(result.metafile.inputs).filter(path =>
    /packages\/core\/src\/(?:workbench|preferences|ordering|server-side|analysis|import)(?:\/|\.ts$)|packages\/core\/src\/multiRange\.ts$|\.(?:css)$/.test(path));
  const cssOutputs = result.outputFiles.filter(file => file.path.endsWith(".css"));
  if (forbidden.length || cssOutputs.length) {
    failed = true;
    console.error(`OVER ${name} default module boundary: ${forbidden.join(", ")}`);
  } else console.log(`OK   ${name} default graph excludes all seven advanced modules and optional CSS`);
}

if (failed) {
  console.error("Bundle size budget exceeded.");
  process.exitCode = 1;
}
