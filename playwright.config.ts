import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  // Functional E2E includes cold Vite transforms and WebKit startup; performance
  // budgets are enforced separately, so allow enough time for slow CI hosts.
  timeout: 45_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // WebKit startup can starve one of the three Vite-backed framework pages when
  // all browser projects render the 8k-row demos at once. Two workers keeps the
  // run deterministic while retries remain disabled for local verification.
  workers: 2,
  reporter: process.env.CI ? "github" : "list",
  use: {
    trace: "on-first-retry"
  },
  webServer: [
    {
      command: "pnpm --filter vanilla-demo dev --host 127.0.0.1 --port 4173 --strictPort",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: !process.env.CI
    },
    {
      command: "pnpm --filter react-demo dev --host 127.0.0.1 --port 4174 --strictPort",
      url: "http://127.0.0.1:4174",
      reuseExistingServer: !process.env.CI
    },
    {
      command: "pnpm --filter vue-demo dev --host 127.0.0.1 --port 4175 --strictPort",
      url: "http://127.0.0.1:4175",
      reuseExistingServer: !process.env.CI
    }
  ],
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } }
  ]
});
