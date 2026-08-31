import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", adapter: "src/adapter.ts", worker: "src/worker.ts" },
  format: ["esm", "cjs"],
  splitting: false,
  dts: process.env.MACH_TABLE_DTS !== "false",
  sourcemap: process.env.MACH_TABLE_SOURCEMAP !== "false",
  clean: true,
  minify: true,
  target: "es2020",
  outExtension({ format }) {
    return { js: format === "esm" ? ".js" : ".cjs" };
  }
});
