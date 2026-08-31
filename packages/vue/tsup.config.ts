import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    async: "src/async.ts",
    workflows: "src/workflows.ts",
    adapters: "src/adapterEntry.ts",
    worker: "src/worker.ts",
    ui: "src/ui.ts",
    editors: "src/editors.ts"
  },
  format: ["esm", "cjs"],
  splitting: true,
  dts: process.env.MACH_TABLE_DTS !== "false",
  sourcemap: process.env.MACH_TABLE_SOURCEMAP !== "false",
  clean: true,
  minify: true,
  target: "es2020",
  external: ["vue", "@agile-team/mach-table", "@agile-team/mach-table/adapter", "@agile-team/mach-table/worker"],
  outExtension({ format }) {
    return { js: format === "esm" ? ".js" : ".cjs" };
  }
});
