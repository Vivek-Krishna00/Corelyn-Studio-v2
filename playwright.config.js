import { defineConfig } from "@playwright/test";

// Electron E2E only. Each test drives a full app: Electron → sidecar daemon →
// mockbot, so they run one at a time and get generous timeouts.
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: {
    timeout: 20_000,
    // D2's gate. Neither number is zero, and both are floors set by the GPU
    // rather than by taste:
    //   threshold — per-pixel colour distance before a pixel counts as
    //     different. The shell's backdrop-filter blurs land +/-1 per channel
    //     between runs, which at 0 would fail every comparison on ~900k pixels.
    //   maxDiffPixels — the minimap's rounded border antialiases onto
    //     fractional coordinates and a dozen edge pixels resolve differently
    //     frame to frame.
    // Both are far below anything a real change produces: moving one element
    // by a single pixel dirties hundreds of pixels, and a restyle thousands.
    toHaveScreenshot: { threshold: 0.02, maxDiffPixels: 25, animations: "disabled", caret: "hide" },
  },
  reporter: "list",
  use: { trace: "retain-on-failure" },
});
