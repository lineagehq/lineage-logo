import { defineConfig, devices } from "@playwright/test";

const origin = "http://marquee-qa.localhost:43118";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["./tests/e2e/release/sanitized-reporter.ts"],
    ["./tests/e2e/failure-only-reporter.ts"],
  ],
  use: {
    baseURL: origin,
    screenshot: "off",
    trace: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox-critical",
      testMatch: /release\/critical-path\.spec\.ts/,
      use: { browserName: "firefox", viewport: { width: 1280, height: 720 } },
    },
    {
      name: "webkit-critical",
      testMatch: /release\/critical-path\.spec\.ts/,
      use: { browserName: "webkit", viewport: { width: 1280, height: 720 } },
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
