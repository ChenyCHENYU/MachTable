import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    async: "src/async.ts",
    workflows: "src/workflows.ts",
    worker: "src/worker.ts",
    ui: "src/ui.ts",
    editors: "src/editors.ts"
  },
  format: ["esm", "cjs"],
  splitting: true,
  dts: true,
  sourcemap: true,
  clean: true,
  minify: true,
  target: "es2020",
  external: ["vue", "@agile-team/mach-table", "@agile-team/mach-table/worker"],
  outExtension({ format }) {
    return { js: format === "esm" ? ".js" : ".cjs" };
  }
});
