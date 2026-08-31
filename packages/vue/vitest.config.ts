import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@agile-team/mach-table/adapter": fileURLToPath(new URL("../core/src/adapter.ts", import.meta.url)),
      "@agile-team/mach-table/worker": fileURLToPath(new URL("../core/src/worker.ts", import.meta.url)),
      "@agile-team/mach-table": fileURLToPath(new URL("../core/src/index.ts", import.meta.url))
    }
  },
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    environment: "jsdom",
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/__tests__/**"],
      thresholds: { statements: 84, branches: 72, functions: 83, lines: 87 }
    }
  }
});
