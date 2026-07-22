import { test, expect } from "@playwright/test";
import { addNode, launchApp } from "./helpers.js";

// Bounding box of the deploy modal's card (the rounded 720px-wide box), found
// relative to its own "Deploy Mission" title rather than by a className —
// DeployModal.jsx has none. The title div's ancestors are, in order: the
// title's flex wrapper, the header row, then the card itself.
function deployCardLocator(page) {
  return page.getByText("Deploy Mission", { exact: true }).locator("xpath=ancestor::div[3]");
}

// .left-sidebar / .right-panel animate their open/closed transform over 0.25s
// (see App.css) — poll the box's x until it stops moving rather than racing
// the transition with a single read.
async function settledX(locator) {
  let last;
  await expect.poll(async () => {
    const box = await locator.boundingBox();
    const same = last !== undefined && box && Math.abs(box.x - last) < 0.5;
    last = box?.x;
    return same;
  }).toBe(true);
  return last;
}

test.describe("responsive shell", () => {
  let running = [];

  test.afterEach(async () => {
    for (const item of running) await item();
    running = [];
  });

  test("700×550 (smallest supported): top bar doesn't clip, overflow menu, drawers, deploy modal", async () => {
    const { app, page } = await launchApp(undefined, { windowSize: { width: 700, height: 550 } });
    running.push(() => app.close());

    // No horizontal clipping: the whole document fits the viewport, and the
    // two right-most controls (overflow menu, Settings) are still on-screen.
    await expect.poll(() => page.evaluate(() => document.body.scrollWidth <= window.innerWidth)).toBe(true);
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    for (const title of ["More actions", "Open editor settings"]) {
      const box = await page.getByTitle(title).boundingBox();
      expect(box, `${title} button should be rendered`).not.toBeNull();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    }

    // Run/Stop/Deploy stay as real buttons at every tier (only their text
    // labels drop to icon-only at the compact/narrow breakpoints).
    await expect(page.getByTitle("Run mission")).toBeVisible();
    await expect(page.getByTitle("Stop")).toBeVisible();
    await expect(page.getByTitle("Deploy mission to robot")).toBeVisible();

    // The ⋯ overflow menu holds what the toolbar dropped: Clear/Export/Import/
    // CHAIN and the telemetry pills.
    await page.getByTitle("More actions").click();
    const menu = page.locator(".topbar-overflow-menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByTitle("Clear canvas")).toBeVisible();
    await expect(menu.getByTitle("Export mission as JSON")).toBeVisible();
    await expect(menu.getByTitle("Import nodes from JSON")).toBeVisible();
    await expect(menu.getByTitle("Chain mode — auto-advance source after connection")).toBeVisible();
    await expect(menu.getByText("BATT")).toBeVisible();
    await expect(menu.getByText("VEL")).toBeVisible();
    await expect(menu.getByText("CONNS")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();

    // Palette drawer: opens over the canvas via its toggle, closes on a
    // backdrop click. left-sidebar sits at x=0 when open and is translated
    // fully off-screen (negative x) when closed.
    await page.getByTitle("Open blocks panel").click();
    await expect(page.getByTitle("Close blocks panel")).toBeVisible();
    let sidebarX = await settledX(page.locator(".left-sidebar"));
    expect(sidebarX).toBeGreaterThanOrEqual(-1);
    await expect(page.locator(".drawer-backdrop")).toBeVisible();
    await page.locator(".drawer-backdrop").click();
    await expect(page.getByTitle("Open blocks panel")).toBeVisible();
    sidebarX = await settledX(page.locator(".left-sidebar"));
    expect(sidebarX).toBeLessThan(0);

    // Right drawer: opens via the existing chevron, and opening it closes the
    // palette drawer — only one drawer open at a time.
    await page.getByTitle("Open blocks panel").click();
    await expect(page.getByTitle("Close blocks panel")).toBeVisible();
    await page.getByRole("button", { name: "Expand node panel" }).click();
    await expect(page.getByRole("button", { name: "Collapse node panel" })).toBeVisible();
    await expect(page.getByTitle("Open blocks panel")).toBeVisible(); // palette auto-closed
    sidebarX = await settledX(page.locator(".left-sidebar"));
    expect(sidebarX).toBeLessThan(0);
    const rightX = await settledX(page.locator(".right-panel"));
    const rightWidth = await page.locator(".right-panel").evaluate((el) => el.getBoundingClientRect().width);
    expect(rightX + rightWidth).toBeLessThanOrEqual(viewport.width + 1);
    expect(rightX).toBeLessThan(viewport.width);

    // Topbar row's z-index (250) sits above the drawer backdrop (200), so
    // the palette toggle stays clickable through it even with the right
    // drawer (and its backdrop) up — clicking it opens the palette and
    // closes the right drawer.
    await page.getByTitle("Open blocks panel").click();
    await expect(page.getByTitle("Close blocks panel")).toBeVisible();
    await expect(page.getByRole("button", { name: "Expand node panel" })).toBeVisible();

    await page.locator(".drawer-backdrop").click();
    await expect(page.getByRole("button", { name: "Expand node panel" })).toBeVisible();

    // Deploy modal: fully within the viewport, its footer reachable (not
    // clipped), and closable. Deploy is disabled until there's a node, and
    // the palette only reaches the canvas via its drawer at this width.
    // Placing a node auto-closes the drawer at this tier (isNarrow), so no
    // separate close step is needed before reaching the Deploy button.
    await page.getByTitle("Open blocks panel").click();
    await addNode(page, "Flow", "Start");
    await page.getByTitle("Deploy mission to robot").click();
    await expect(page.getByText("Deploy Mission")).toBeVisible();
    const cardBox = await deployCardLocator(page).boundingBox();
    expect(cardBox.x).toBeGreaterThanOrEqual(0);
    expect(cardBox.y).toBeGreaterThanOrEqual(0);
    expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(viewport.height + 1);
    await expect(page.getByRole("button", { name: "Download" })).toBeVisible();
    // Scoped to the card: the right drawer's own mobile close header (also
    // "✕") is always present in the DOM at this tier, just off-screen.
    await deployCardLocator(page).getByRole("button", { name: "✕" }).click();
    await expect(page.getByText("Deploy Mission")).toBeHidden();
  });

  test("~980×700 (narrow, above the electron floor): drawer mode still supports the core place-a-node flow", async () => {
    const { app, page } = await launchApp(undefined, { windowSize: { width: 980, height: 700 } });
    running.push(() => app.close());

    // Confirms we actually landed in drawer mode before trusting the rest.
    await expect(page.getByTitle("Open blocks panel")).toBeVisible();
    await expect(page.locator(".left-sidebar")).toHaveClass(/left-sidebar-closed/);

    await page.getByTitle("Open blocks panel").click();
    await addNode(page, "Flow", "Start");

    await expect(page.locator("[data-node-type='start']")).toBeVisible();
  });

  test("~1100×700 (compact tier): top bar doesn't clip", async () => {
    const { app, page } = await launchApp(undefined, { windowSize: { width: 1100, height: 700 } });
    running.push(() => app.close());

    // Compact, not narrow — the overflow menu shouldn't exist yet.
    await expect(page.getByTitle("More actions")).toHaveCount(0);

    await expect.poll(() => page.evaluate(() => document.body.scrollWidth <= window.innerWidth)).toBe(true);
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    const settingsBox = await page.getByTitle("Open editor settings").boundingBox();
    expect(settingsBox.x).toBeGreaterThanOrEqual(0);
    expect(settingsBox.x + settingsBox.width).toBeLessThanOrEqual(viewport.width + 1);

    // The no-clip result here is a consequence of dropping Run/Stop/Deploy's
    // text labels at this tier — confirm that mechanism is actually engaged,
    // not just that the row happens to fit today.
    await expect(page.getByTitle("Run mission")).toHaveText("▶");
    await expect(page.getByTitle("Stop")).toHaveText("■");
    await expect(page.getByTitle("Deploy mission to robot")).toHaveText("🚀");
  });

  test("1440×872: unchanged — no overflow menu, tagline and docked telemetry visible", async () => {
    const { app, page } = await launchApp(undefined, { windowSize: { width: 1440, height: 872 } });
    running.push(() => app.close());

    await expect(page.getByTitle("More actions")).toHaveCount(0);
    await expect(page.locator(".topbar-tagline")).toBeVisible();
    await expect(page.locator(".topbar-tagline")).toHaveText("PROGRAM | DEPLOY | DOMINATE");
    const telemetry = page.locator(".topbar-telemetry");
    await expect(telemetry).toBeVisible();
    await expect(telemetry.getByText("BATT")).toBeVisible();
    await expect(telemetry.getByText("VEL")).toBeVisible();
    await expect(telemetry.getByText("CONNS")).toBeVisible();
  });
});
