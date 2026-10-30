import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    setupFiles: ["src/__tests__/setup.ts"],
    environment: "node",
    // 大 DOM 和 50MB 状态边界样本限制并发，保持用例原有时间与覆盖率预算。
    maxWorkers: 2,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/__tests__/**", "src/types/**"],
      thresholds: { statements: 75, branches: 64, functions: 83, lines: 79 }
    }
  }
});
