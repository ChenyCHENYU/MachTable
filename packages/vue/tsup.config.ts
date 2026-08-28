import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    async: "src/async.ts"
  },
  format: ["esm", "cjs"],
  splitting: true,
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2020",
  external: ["vue", "@agile-team/mach-table"],
  outExtension({ format }) {
    return { js: format === "esm" ? ".js" : ".cjs" };
  }
});
