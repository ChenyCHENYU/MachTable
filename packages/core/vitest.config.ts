import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    setupFiles: ["src/__tests__/setup.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/__tests__/**", "src/types/**"],
      thresholds: { statements: 75, branches: 64, functions: 83, lines: 79 }
    }
  }
});
