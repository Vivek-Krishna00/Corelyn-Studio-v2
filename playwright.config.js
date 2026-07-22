import { defineConfig } from "@playwright/test";

// Electron E2E only. Each test drives a full app: Electron → sidecar daemon →
// mockbot, so they run one at a time and get generous timeouts.
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: "list",
  use: { trace: "retain-on-failure" },
});
