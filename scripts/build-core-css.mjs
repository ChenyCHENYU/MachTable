import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { copyFile } from "node:fs/promises";

// Advanced styles are real optional artifacts, never concatenated into Core CSS.
for (const name of ["mach-table", "workbench", "server-side"]) {
  await build({
    entryPoints: [fileURLToPath(new URL(`../packages/core/styles/${name}.css`, import.meta.url))],
    outfile: fileURLToPath(new URL(`../packages/core/dist/${name}.css`, import.meta.url)),
    minify: true,
    target: "es2020"
  });
  await copyFile(new URL(`../packages/core/styles/${name}.css.d.ts`, import.meta.url), new URL(`../packages/core/dist/${name}.css.d.ts`, import.meta.url));
}
