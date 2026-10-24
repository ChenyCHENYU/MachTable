import { build } from "esbuild";
import { fileURLToPath } from "node:url";

// Keep the editable source readable; ship and measure the same minified artifact.
await build({
  entryPoints: [fileURLToPath(new URL("../packages/core/styles/mach-table.css", import.meta.url))],
  outfile: fileURLToPath(new URL("../packages/core/dist/mach-table.css", import.meta.url)),
  minify: true,
  target: "es2020"
});
