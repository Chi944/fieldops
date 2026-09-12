import { defineConfig, devices } from "@playwright/test";

// A supplied URL reuses the caller's local server. The default server is isolated
// from personal local files and explicitly disables live model processing.
const external = process.env.FIELDOPS_TEST_BASE_URL;
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 12_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: external ?? "http://127.0.0.1:3002",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 1000 },
  },
  webServer: external ? undefined : {
    command: "npm run start -- --port 3002",
    url: "http://127.0.0.1:3002/api/status",
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      FIELDOPS_LOCAL_MODE: "true",
      FIELDOPS_DATA_DIR: ".fieldops/e2e-storage",
      GROQ_API_KEY: "",
      GROQ_FREE_TIER_CONFIRMED: "false",
      GROQ_ZDR_CONFIRMED: "false",
    },
  },
});
