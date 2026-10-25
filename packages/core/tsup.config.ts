import { defineConfig } from "tsup";
import { privatePropertyPattern } from "../../scripts/private-property-mangling.mjs";

export default defineConfig({
  entry: {
    index: "src/index.ts", adapter: "src/adapter.ts", worker: "src/worker.ts",
    workbench: "src/workbench.ts", preferences: "src/preferences.ts", ordering: "src/ordering.ts",
    "server-side": "src/server-side.ts", analysis: "src/analysis.ts", "multi-range": "src/multiRange.ts"
  },
  format: ["esm", "cjs"],
  splitting: false,
  dts: process.env.MACH_TABLE_DTS !== "false",
  sourcemap: process.env.MACH_TABLE_SOURCEMAP !== "false",
  clean: true,
  minify: true,
  esbuildOptions(options) {
    options.mangleProps = privatePropertyPattern();
  },
  target: "es2020",
  outExtension({ format }) {
    return { js: format === "esm" ? ".js" : ".cjs" };
  }
});
