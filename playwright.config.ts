import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:9025",
    viewport: { width: 1440, height: 1000 },
    headless: true,
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "REPORT_DESKTOP_PORT=9025 REPORT_PHONE_PORT=9026 pnpm start",
    url: "http://127.0.0.1:9025",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
