import { test, expect, _electron as electron } from "@playwright/test";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const mockbotBin = path.join(repoRoot, "backend", "corelyn-mockbot");

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function waitForPort(port, deadlineAt) {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const sock = net.connect(port, "127.0.0.1");
      sock.on("connect", () => { sock.destroy(); resolve(); });
      sock.on("error", () => {
        sock.destroy();
        if (Date.now() >= deadlineAt) reject(new Error(`nothing listening on ${port}`));
        else setTimeout(attempt, 50);
      });
    };
    attempt();
  });
}

// Starts corelyn-mockbot and resolves once it is accepting connections, so the
// daemon's rosbridge client finds it on its first attempt rather than backing off.
async function startMockbot() {
  if (!fs.existsSync(mockbotBin)) {
    throw new Error(`${mockbotBin} is missing — run \`make -C backend\` first`);
  }
  const port = await freePort();
  const proc = spawn(mockbotBin, ["-port", String(port)], { stdio: "ignore" });
  await waitForPort(port, Date.now() + 10_000);
  return { proc, url: `ws://127.0.0.1:${port}` };
}

// Launches the packaged renderer (dist/) under Electron with an isolated
// userData dir, so each test starts from an empty corelyn.db.
async function launchApp(rosbridgeUrl) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "corelyn-e2e-"));
  const app = await electron.launch({
    args: [".", `--user-data-dir=${userDataDir}`],
    cwd: repoRoot,
    env: { ...process.env, CORELYN_ROSBRIDGE_URL: rosbridgeUrl ?? "" },
  });
  const page = await app.firstWindow();
  await page.getByPlaceholder("you@company.com").fill("operator@corelyn.test");
  await page.getByPlaceholder("Enter your password").fill("e2e-password");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.getByText(/system blocks/i)).toBeVisible();
  // The right panel starts collapsed; the system log lives inside it.
  await page.getByRole("button", { name: "Expand node panel" }).click();
  return { app, page, userDataDir };
}

// Adds a node to the canvas by expanding its palette category and clicking it.
async function addNode(page, category, label) {
  const group = page.locator(".palette-group", { has: page.getByText(category, { exact: true }) });
  if (!(await group.locator(".palette-block-list").isVisible())) {
    await group.locator(".palette-group-trigger").click();
  }
  await group.getByText(label, { exact: true }).click();
}

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

    await expect(page.getByText("API ONLINE")).toBeVisible();
    await addNode(page, "Flow", "Start");

    const node = page.locator("[data-node-type='start']");
    await expect(node).toHaveAttribute("data-status", "idle");

    await page.getByTitle("Run mission").click();

    // Node status comes back over WS /ws/mission/status, driven by the mockbot
    // executing the spec — not by anything in the renderer.
    await expect(node).toHaveAttribute("data-status", "done");

    // Adding a node switches the right panel to NODE, so open LOG last.
    await page.getByRole("button", { name: "LOG" }).click();
    await expect(page.getByText("Mission complete").first()).toBeVisible();
  });

  test("killing the mockbot surfaces the disconnected state", async () => {
    const mockbot = await startMockbot();
    const { app, page } = await launchApp(mockbot.url);
    running.push(() => app.close());

    await expect(page.getByText("API ONLINE")).toBeVisible();
    await page.getByRole("button", { name: "LOG" }).click();

    mockbot.proc.kill();

    await expect(page.getByText("Robot link lost — mission interrupted")).toBeVisible();
  });
});
