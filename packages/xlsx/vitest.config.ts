import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@agile-team/mach-table/adapter": fileURLToPath(new URL("../core/src/adapter.ts", import.meta.url)),
      "@agile-team/mach-table": fileURLToPath(new URL("../core/src/index.ts", import.meta.url))
    }
  },
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/__tests__/**"],
      thresholds: { statements: 85, branches: 75, functions: 85, lines: 85 }
    }
  }
});
