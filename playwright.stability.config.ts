import { defineConfig, devices } from "@playwright/test";
import { soakSettings } from "./tests/stability/settings";

/** 独立低频任务，不扩大正常三浏览器回归的执行时间。 */
export default defineConfig({
  globalSetup: "./tests/stability/global-setup.ts",
  testDir: "./tests/stability",
  testMatch: "**/*.spec.ts",
  timeout: (soakSettings.seconds + 120) * 1000,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  outputDir: "test-results/stability",
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/stability-results.json" }]
  ],
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 800 },
    launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] },
    // 长时间 trace 本身会改变保留对象与资源；只保存标量测量附件。
    trace: "off",
    screenshot: "only-on-failure",
    video: "off"
  },
  projects: [{ name: "chromium" }],
  webServer: {
    command: "pnpm --filter bench-demo dev --host 127.0.0.1 --port 4177 --strictPort",
    url: "http://127.0.0.1:4177",
    reuseExistingServer: false,
    timeout: 30_000
  }
});
