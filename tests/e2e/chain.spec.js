// Two gaps no existing spec closes: a multi-node connected graph actually
// runs in the order the edges say (mission.spec.js only ever deploys a
// single Start node), and a deploy made with no rosbridge URL configured
// tells the operator the truth instead of looking identical to a real one.
import { test, expect } from "@playwright/test";
import { addNode, launchApp, openRightPanel, startMockbot } from "./helpers.js";

test.describe("connected graph execution + no-robot deploy honesty", () => {
  let running = [];

  test.afterEach(async () => {
    for (const item of running) await item();
    running = [];
  });

  test("a connected Start -> Move Forward -> Rotate Left -> End graph deploys 3 connections and executes in order", async () => {
    const mockbot = await startMockbot();
    running.push(() => mockbot.proc.kill());
    const { app, page } = await launchApp(mockbot.url);
    running.push(() => app.close());

    await addNode(page, "Flow", "Start");
    await addNode(page, "Motion", "Move Forward");
    await addNode(page, "Motion", "Rotate Left");
    await addNode(page, "Flow", "End");

    const start = page.locator("[data-node-type='start']");
    const moveForward = page.locator("[data-node-type='move_forward']");
    const rotateLeft = page.locator("[data-node-type='rotate_left']");
    const end = page.locator("[data-node-type='end']");

    // Tap-to-connect: CHAIN keeps the just-connected node selected as the
    // next source, so four taps produce three edges (helpers.js's own
    // launch/mockbot conventions; edge mechanics per the task brief).
    await page.getByTitle("Chain mode — auto-advance source after connection").click();
    await start.click();
    await moveForward.click();
    await rotateLeft.click();
    await end.click();
    await page.keyboard.press("Escape"); // drop the still-armed "select next target" state

    // The daemon's rosbridge client reconnects with backoff; wait for it to
    // actually be live before deploying, so this exercises a real publish to
    // the mockbot rather than racing the handshake into "robot link unavailable".
    await expect.poll(() => page.evaluate(async () => {
      const port = window.corelyn?.apiPort;
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      return (await res.json()).robot;
    }), { timeout: 10_000 }).toBe("connected");

    await page.getByTitle("Deploy mission to robot").click();
    await expect(page.getByText("Deploy Mission")).toBeVisible();
    await expect(page.getByText(/3 connections/)).toBeVisible();
    await page.getByRole("button", { name: "Deploy via ROS" }).click();

    // Each of these locators will eventually go running -> done regardless of
    // *when* the daemon runs them, so on their own they don't prove graph
    // order — a reversed or interleaved execution would still satisfy them.
    // Wait for the mission to finish, then read the real arrival order back
    // out of the system log below.
    await expect(end).toHaveAttribute("data-status", "done");
    await expect(start).toHaveAttribute("data-status", "done");
    await expect(moveForward).toHaveAttribute("data-status", "done");
    await expect(rotateLeft).toHaveAttribute("data-status", "done");

    await page.getByRole("button", { name: "✕" }).click();
    await openRightPanel(page, "LOG");
    await expect(page.getByText("Mission complete").first()).toBeVisible();

    // The log is reverse-chronological (newest entry first — SystemLog.jsx),
    // so reverse it back to playback order. Filtering to just the execution
    // lines and asserting the exact sequence is what actually proves the
    // mission ran Start -> Move Forward -> Rotate Left -> End, not just that
    // every node eventually reached "done" in whatever order.
    const rows = await page
      .locator("div:has(> .log-time) > span:not(.log-time)")
      .allTextContents();
    const chronological = rows.slice().reverse();
    const executionLines = chronological.filter((line) =>
      /^[▶✓] (Start|Move Forward|Rotate Left|End): (running|done)$/.test(line)
      || line === "✓ Mission complete");
    expect(executionLines).toEqual([
      "▶ Start: running", "✓ Start: done",
      "▶ Move Forward: running", "✓ Move Forward: done",
      "▶ Rotate Left: running", "✓ Rotate Left: done",
      "▶ End: running", "✓ End: done",
      "✓ Mission complete",
    ]);
  });

  test("a no-robot deploy stays honest: the button, the modal, and the log all say the mission will not run", async () => {
    // No rosbridge URL at all — the daemon's Ros client is nil, so every
    // deploy is "deployed_no_robot" regardless of timing (backend/internal/api/deploy.go).
    const { app, page } = await launchApp();
    running.push(() => app.close());

    await addNode(page, "Flow", "Start");
    const start = page.locator("[data-node-type='start']");
    await expect(start).toHaveAttribute("data-status", "idle");

    await page.getByTitle("Deploy mission to robot").click();
    const deployBtn = page.getByRole("button", { name: "Deploy (no robot)" });
    await expect(deployBtn).toBeVisible();
    await deployBtn.click();

    await expect(page.getByText(
      "Deployed, but no robot is connected — the mission will not run.",
    )).toBeVisible();
    await expect(page.getByText("Mission deployed successfully")).toHaveCount(0);

    // Redeploy in the same modal: the daemon closes the no-robot run's mission
    // run immediately instead of leaving a phantom "active" mission behind
    // (backend/internal/api/deploy.go), so this must succeed with the same
    // honest warning again — not a 409 "already running" error.
    await deployBtn.click();
    await expect(page.getByText(
      "Deployed, but no robot is connected — the mission will not run.",
    )).toBeVisible();
    await expect(page.getByText(/already running/)).toHaveCount(0);

    await page.getByRole("button", { name: "✕" }).click();
    await expect(page.getByText("Deploy Mission")).toHaveCount(0);

    await openRightPanel(page, "LOG");
    // Two matching lines now: one per deploy attempt above.
    await expect(page.getByText(
      "Deploy accepted but no robot is connected — mission will not run.",
    ).first()).toBeVisible();

    // No robot ever ran it — the node never left idle.
    await expect(start).toHaveAttribute("data-status", "idle");
  });
});
