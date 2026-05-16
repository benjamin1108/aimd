import { defineConfig, devices } from "@playwright/test";

const useManagedWebServer = process.env.AIMD_PLAYWRIGHT_EXTERNAL_SERVER !== "1";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:1420",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    locale: "zh-CN",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: useManagedWebServer
    ? {
        command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 1420",
        url: "http://127.0.0.1:1420",
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
        stdout: "pipe",
        stderr: "pipe",
      }
    : undefined,
});
