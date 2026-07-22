import { expect, _electron as electron } from "@playwright/test";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const mockbotBin = path.join(repoRoot, "backend", "corelyn-mockbot");

// The account every test signs in as. The password clears the daemon's
// 10-character minimum.
export const OPERATOR = { email: "operator@corelyn.test", password: "e2e-password" };

export function freePort() {
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

// Sets the Electron window's content size and waits for the renderer to
// observe it — the OS applies a resize asynchronously, and reading the DOM
// (or reloading, for the deterministic path) before it lands measures against
// the old viewport.
async function setWindowSize(app, page, { width, height }) {
  await app.evaluate(({ BrowserWindow }, size) =>
    BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height });
  await page.waitForFunction(
    (size) => innerWidth === size.width && innerHeight === size.height,
    { width, height },
  );
}

// Starts corelyn-mockbot and resolves once it is accepting connections, so the
// daemon's rosbridge client finds it on its first attempt rather than backing off.
export async function startMockbot() {
  if (!fs.existsSync(mockbotBin)) {
    throw new Error(`${mockbotBin} is missing — run \`make -C backend dev\` first`);
  }
  const port = await freePort();
  const proc = spawn(mockbotBin, ["-port", String(port)], { stdio: "ignore" });
  await waitForPort(port, Date.now() + 10_000);
  return { proc, url: `ws://127.0.0.1:${port}` };
}

// Launches the packaged renderer (dist/) under Electron with an isolated
// userData dir, so each test starts from an empty corelyn.db. Returns once the
// editor is up and the sidecar is answering — "API ONLINE" gates every caller,
// because the badge and the Run button both change label when it flips.
export async function launchApp(rosbridgeUrl, { deterministic = false, windowSize } = {}) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "corelyn-e2e-"));
  const app = await electron.launch({
    args: [".", `--user-data-dir=${userDataDir}`],
    cwd: repoRoot,
    // TZ is pinned because the system log renders a local-time clock.
    env: { ...process.env, TZ: "UTC", CORELYN_ROSBRIDGE_URL: rosbridgeUrl ?? "" },
  });
  const page = await app.firstWindow();
  if (!deterministic && windowSize) {
    // Responsive tests need a specific viewport but not a frozen clock/RNG —
    // set the size the same way the deterministic path does, minus the freeze.
    await setWindowSize(app, page, windowSize);
  }
  if (deterministic) {
    // The OS does not always hand back the size main.cjs asked for, and a
    // baseline is worthless if the viewport moves under it.
    await setWindowSize(app, page, windowSize ?? { width: 1440, height: 872 });

    // Reloading while the first navigation is still in flight cancels it, and
    // the init script then never runs — silently, leaving a live clock and a
    // real RNG behind an otherwise green run. Settle first, then verify.
    await page.waitForLoadState("domcontentloaded");
    await page.addInitScript(freezeSourcesOfNoise);
    await page.reload();
    await page.waitForFunction(() => Date.now() === Date.UTC(2026, 0, 1, 9, 30, 0));
  }
  // Each test gets a fresh userData dir, so every daemon starts with an empty
  // users table and first-run signup is open. Claim it over HTTP rather than
  // driving the four-field form on every launch — signup.spec.js covers that.
  const apiPort = await page.evaluate(() => window.corelyn?.apiPort);
  const created = await fetch(`http://127.0.0.1:${apiPort}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(OPERATOR),
  });
  if (!created.ok) throw new Error(`signup failed: ${created.status} ${await created.text()}`);

  await page.getByPlaceholder("you@company.com").fill(OPERATOR.email);
  await page.getByPlaceholder("Enter your password").fill(OPERATOR.password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.getByText(/system blocks/i)).toBeVisible();
  // Gates on the daemon's own health endpoint rather than the "API ONLINE"
  // badge text: below the compact/narrow breakpoints that text shortens to
  // "ONLINE" or disappears into the overflow menu entirely, but the
  // underlying readiness this is meant to confirm doesn't change with the
  // window size.
  await expect.poll(async () => {
    const res = await fetch(`http://127.0.0.1:${apiPort}/api/health`);
    return res.ok ? (await res.json()).status : null;
  }).toBe("ok");
  return { app, page, userDataDir };
}

// Pins the two things the UI reads that differ every run: the wall clock
// behind the system log's timestamps, and the randomness behind node ids. Both
// are rendered, and a proportional font makes even a same-length timestamp a
// different number of pixels wide — so a screenshot mask cannot paper over it.
// Math.random stays a sequence rather than a constant, or two nodes added in
// one test would collide on id.
function freezeSourcesOfNoise() {
  const fixed = Date.UTC(2026, 0, 1, 9, 30, 0);
  const RealDate = Date;
  // eslint-disable-next-line no-global-assign
  Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixed]));
    }
    static now() {
      return fixed;
    }
  };
  let seed = 1;
  Math.random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
}

// Adds a node to the canvas by expanding its palette category and clicking it.
export async function addNode(page, category, label) {
  const group = page.locator(".palette-group", { has: page.getByText(category, { exact: true }) });
  if (!(await group.locator(".palette-block-list").isVisible())) {
    await group.locator(".palette-group-trigger").click();
  }
  await group.getByText(label, { exact: true }).click();
}

// Opens the right-hand panel, which starts collapsed, and selects a tab.
export async function openRightPanel(page, tab) {
  const expand = page.getByRole("button", { name: "Expand node panel" });
  if (await expand.isVisible()) await expand.click();
  // Scoped and exact: getByRole matches accessible names by substring, so a
  // bare "NODE" also hits the collapse toggle labelled "Collapse node panel"
  // — which quietly closes the panel again.
  await page.locator(".right-panel").getByRole("button", { name: tab, exact: true }).click();
}
