import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", worker: "src/worker.ts" },
  format: ["esm", "cjs"],
  splitting: false,
  dts: true,
  sourcemap: true,
  clean: true,
  minify: true,
  target: "es2020",
  outExtension({ format }) {
    return { js: format === "esm" ? ".js" : ".cjs" };
  }
});
