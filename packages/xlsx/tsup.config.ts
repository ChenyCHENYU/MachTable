import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: process.env.MACH_TABLE_DTS !== "false",
  sourcemap: process.env.MACH_TABLE_SOURCEMAP !== "false",
  clean: true,
  minify: true,
  target: "es2020",
  external: ["@agile-team/mach-table"],
  outExtension({ format }) {
    return { js: format === "esm" ? ".js" : ".cjs" };
  }
});
