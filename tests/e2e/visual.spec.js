// Pixel baseline for Task D2, which splits App.jsx into modules without
// changing a single pixel. Any diff here means the "pure move" moved
// something it should not have — find it, do not re-baseline.
//
// Snapshots are per-platform (Playwright suffixes the filename), and the ones
// committed were taken on darwin. A first run on another OS writes its own set
// rather than failing.
//
// Desktop layouts only: main.cjs pins the window to minWidth 1024, so the
// sub-1024 drawer layout in App.css is unreachable under Electron and cannot
// be baselined from here.
import { test, expect } from "@playwright/test";
import { addNode, launchApp, openRightPanel } from "./helpers.js";

test.describe("visual baseline", () => {
  let app;

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function open() {
    const launched = await launchApp(undefined, { deterministic: true });
    app = launched.app;
    return launched.page;
  }

  // Toasts self-dismiss after 2.8s. Waiting them out beats masking the corner
  // they occupy, which is also canvas.
  async function shot(page, name) {
    // Playwright leaves the pointer wherever it last clicked, and the palette
    // and buttons all have hover styles — park it off every control first.
    await page.mouse.move(0, 0);
    await expect(page.locator(".toast-stack > div")).toHaveCount(0);
    // The inspector's node id still moves run to run: something in startup
    // draws from Math.random a variable number of times before the node is
    // created, so seeding the generator fixes the sequence but not the
    // position in it. Masking is safe here and only here — the id sits in a
    // full-width box, so covering it shifts nothing, where masking the log's
    // inline timestamp would have moved every message beside it.
    await expect(page).toHaveScreenshot(name, { mask: [page.locator(".inspector-node-id")] });
  }

  test("editor shell, empty canvas", async () => {
    const page = await open();
    await shot(page, "editor-empty.png");
  });

  test("palette with a category expanded", async () => {
    const page = await open();
    await page.locator(".palette-group", { has: page.getByText("Flow", { exact: true }) })
      .locator(".palette-group-trigger").click();
    await shot(page, "palette-expanded.png");
  });

  test("canvas with nodes placed", async () => {
    const page = await open();
    await addNode(page, "Flow", "Start");
    await addNode(page, "Motion", "Move Forward");
    await shot(page, "canvas-nodes.png");
  });

  test("right panel — node inspector", async () => {
    const page = await open();
    // Adding a node already selects it and switches the panel to NODE —
    // clicking the card instead would arm tap-to-connect.
    await addNode(page, "Flow", "Start");
    await openRightPanel(page, "NODE");
    await shot(page, "panel-node.png");
  });

  test("right panel — mission control", async () => {
    const page = await open();
    await openRightPanel(page, "CTL");
    await shot(page, "panel-ctl.png");
  });

  test("right panel — system log", async () => {
    const page = await open();
    await openRightPanel(page, "LOG");
    await shot(page, "panel-log.png");
  });

  test("settings panel", async () => {
    const page = await open();
    await page.getByRole("button", { name: "Settings" }).click();
    await shot(page, "settings.png");
  });
});
