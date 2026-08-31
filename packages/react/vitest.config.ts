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
    include: ["src/__tests__/**/*.test.tsx"],
    environment: "jsdom",
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/__tests__/**"],
      thresholds: { statements: 82, branches: 78, functions: 80, lines: 85 }
    }
  }
});
