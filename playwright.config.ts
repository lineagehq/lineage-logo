import { defineConfig, devices } from "@playwright/test";

const origin = "http://marquee-qa.localhost:43118";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["line"],
    ["./tests/e2e/failure-only-reporter.ts"],
  ],
  use: {
    baseURL: origin,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "tsx scripts/e2e-server.ts",
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    url: origin,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
