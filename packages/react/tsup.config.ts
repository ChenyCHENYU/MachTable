import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    workflows: "src/workflows.ts",
    adapters: "src/adapterEntry.ts",
    ui: "src/ui.ts",
    worker: "src/worker.ts",
    workbench: "src/workbench.ts", preferences: "src/preferences.ts", ordering: "src/ordering.ts",
    "server-side": "src/server-side.ts", analysis: "src/analysis.ts", business: "src/business.ts", import: "src/import.ts", "multi-range": "src/multi-range.ts"
  },
  splitting: true,
  format: ["esm", "cjs"],
  dts: process.env.MACH_TABLE_DTS !== "false",
  sourcemap: process.env.MACH_TABLE_SOURCEMAP !== "false",
  clean: true,
  minify: true,
  target: "es2020",
  external: ["react", "react-dom", "@agile-team/mach-table", "@agile-team/mach-table/adapter", "@agile-team/mach-table/worker"],
  outExtension({ format }) {
    return { js: format === "esm" ? ".js" : ".cjs" };
  }
});
