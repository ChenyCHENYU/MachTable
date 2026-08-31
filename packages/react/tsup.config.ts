import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", workflows: "src/workflows.ts", worker: "src/worker.ts" },
  splitting: true,
  format: ["esm", "cjs"],
  dts: process.env.MACH_TABLE_DTS !== "false",
  sourcemap: process.env.MACH_TABLE_SOURCEMAP !== "false",
  clean: true,
  minify: true,
  target: "es2020",
  external: ["react", "react-dom", "@agile-team/mach-table", "@agile-team/mach-table/worker"],
  outExtension({ format }) {
    return { js: format === "esm" ? ".js" : ".cjs" };
  }
});
