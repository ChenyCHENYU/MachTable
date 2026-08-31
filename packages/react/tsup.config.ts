import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", workflows: "src/workflows.ts", worker: "src/worker.ts" },
  splitting: true,
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: true,
  target: "es2020",
  external: ["react", "react-dom", "@agile-team/mach-table", "@agile-team/mach-table/worker"],
  outExtension({ format }) {
    return { js: format === "esm" ? ".js" : ".cjs" };
  }
});
