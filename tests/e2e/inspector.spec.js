// Task D3's gate: the inspector renders from shared/nodes.json, so every one
// of the 24 node types must show exactly the params it declares — no more, no
// fewer, and in declaration order. A hardcoded-per-type inspector fails this
// the moment nodes.json changes without it.
import { test, expect } from "@playwright/test";
import nodeData from "../../shared/nodes.json" with { type: "json" };
import { launchApp, openRightPanel } from "./helpers.js";

const CATEGORY_LABEL = Object.fromEntries(nodeData.categories.map(c => [c.id, c.label]));

test("every node type renders exactly the params it declares", async () => {
  const { app, page } = await launchApp();

  try {
    for (const def of nodeData.nodes) {
      // Reach the block through its category, expanding if needed. Clicking it
      // both places the node and selects it.
      const group = page.locator(".palette-group", {
        has: page.getByText(CATEGORY_LABEL[def.category], { exact: true }),
      });
      if (!(await group.locator(".palette-block-list").isVisible())) {
        await group.locator(".palette-group-trigger").click();
      }
      await group.getByText(def.label, { exact: true }).click();
      await openRightPanel(page, "NODE");

      const panel = page.locator(".right-panel");
      const declared = Object.values(def.params || {}).map(p => p.label);

      if (declared.length === 0) {
        await expect(panel.getByText("No configurable parameters")).toBeVisible();
      } else {
        // Field labels only: a boolean param's checkbox is wrapped in its own
        // <label>, and that one holds the input.
        const rendered = await panel.locator("label:not(:has(input))").allInnerTexts();
        expect(rendered.map(t => t.trim().toLowerCase()),
          `params for ${def.type}`).toEqual(
            [...declared, "ros topic", "node id"].map(t => t.toLowerCase()));
      }

      // Clear the canvas so the next type starts from an empty selection.
      await page.getByTitle("Clear canvas").click();
    }
  } finally {
    await app.close();
  }
});

// The inspector renders an editable control for these four and falls back to
// a read-only field for anything else. That fallback exists so a new type in
// nodes.json degrades visibly instead of vanishing — but a type that reaches
// it cannot be edited, so notice here rather than in the field.
test("nodes.json declares no param type the inspector cannot edit", () => {
  const editable = new Set(["number", "text", "select", "boolean"]);
  const unsupported = nodeData.nodes.flatMap(def =>
    Object.entries(def.params || {})
      .filter(([, spec]) => !editable.has(spec.type))
      .map(([key, spec]) => `${def.type}.${key} (${spec.type})`));

  expect(unsupported).toEqual([]);
});
