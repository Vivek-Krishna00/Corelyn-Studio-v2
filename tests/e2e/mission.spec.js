import { test, expect } from "@playwright/test";
import { addNode, launchApp, openRightPanel, startMockbot } from "./helpers.js";

test.describe("mission lifecycle", () => {
  let running = [];

  test.afterEach(async () => {
    for (const item of running) await item();
    running = [];
  });

  test("app launches and the sidecar daemon reports healthy", async () => {
    const { app, page } = await launchApp();
    running.push(() => app.close());

    // The badge is driven by GET /api/health, so it only reads ONLINE once the
    // spawned daemon is actually answering.
    await expect(page.getByText("API ONLINE")).toBeVisible();
  });

  test("deploying against the mockbot advances node state on the canvas", async () => {
    const mockbot = await startMockbot();
    running.push(() => mockbot.proc.kill());
    const { app, page } = await launchApp(mockbot.url);
    running.push(() => app.close());

    await addNode(page, "Flow", "Start");

    const node = page.locator("[data-node-type='start']");
    await expect(node).toHaveAttribute("data-status", "idle");

    await page.getByTitle("Run mission").click();

    // Node status comes back over WS /ws/mission/status, driven by the mockbot
    // executing the spec — not by anything in the renderer.
    await expect(node).toHaveAttribute("data-status", "done");

    await openRightPanel(page, "LOG");
    await expect(page.getByText("Mission complete").first()).toBeVisible();
  });

  test("killing the mockbot surfaces the disconnected state", async () => {
    const mockbot = await startMockbot();
    const { app, page } = await launchApp(mockbot.url);
    running.push(() => app.close());

    await openRightPanel(page, "LOG");
    mockbot.proc.kill();

    await expect(page.getByText("Robot link lost — mission interrupted")).toBeVisible();
  });

  test("the deploy modal opens with the mission spec", async () => {
    const { app, page } = await launchApp();
    running.push(() => app.close());

    await addNode(page, "Flow", "Start");
    await page.getByTitle("Deploy mission to robot").click();

    await expect(page.getByText("Deploy Mission")).toBeVisible();
    await expect(page.getByRole("button", { name: "JSON Preview" })).toBeVisible();
  });
});
