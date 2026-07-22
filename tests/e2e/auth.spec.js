// The auth path the other specs skip: the signup form itself, and the fact
// that being signed in is what puts a name against a deploy in audit_log.
import { test, expect, _electron as electron } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addNode, launchApp, repoRoot } from "./helpers.js";

// launchApp claims the first-run account over HTTP, which is what we want to
// avoid here — this spec needs a daemon nobody has signed up to yet.
async function launchUnclaimed() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "corelyn-auth-"));
  const app = await electron.launch({
    args: [".", `--user-data-dir=${userDataDir}`],
    cwd: repoRoot,
    env: { ...process.env, TZ: "UTC", CORELYN_ROSBRIDGE_URL: "" },
  });
  return { app, page: await app.firstWindow() };
}

async function fillSignupForm(page, { name, email, password }) {
  await page.getByText("Sign up", { exact: true }).click();
  await page.getByPlaceholder("John Doe").fill(name);
  await page.getByPlaceholder("you@company.com").fill(email);
  await page.getByPlaceholder("Min. 10 characters").fill(password);
  await page.getByPlaceholder("Re-enter your password").fill(password);
  await page.getByRole("button", { name: "Create Account" }).click();
}

test("the signup form creates the first account and signs it in", async () => {
  const { app, page } = await launchUnclaimed();
  try {
    await fillSignupForm(page, {
      name: "First Operator",
      email: "owner@corelyn.test",
      password: "first-run-password",
    });
    await expect(page.getByText(/system blocks/i)).toBeVisible();
  } finally {
    await app.close();
  }
});

test("signup refuses a second account once the install is claimed", async () => {
  const { app, page } = await launchUnclaimed();
  try {
    await fillSignupForm(page, {
      name: "First Operator",
      email: "owner@corelyn.test",
      password: "first-run-password",
    });
    await expect(page.getByText(/system blocks/i)).toBeVisible();

    // Same daemon, same database, second attempt — the form must surface the
    // daemon's refusal rather than appearing to succeed.
    await page.reload();
    await fillSignupForm(page, {
      name: "Second Operator",
      email: "someone-else@corelyn.test",
      password: "another-password",
    });
    await expect(page.getByText(/registration is closed/i)).toBeVisible();
  } finally {
    await app.close();
  }
});

// Until the forms were wired to the daemon, handleSubmit always resolved and
// called onLogin(), so `loading` never went back to false and the failure
// branch had never once run. It renders an error and flips the submit button
// out of its spinner — both untested until now.
test("a rejected login reports the reason and leaves the page working", async () => {
  const { app, page } = await launchUnclaimed();
  const crashes = [];
  page.on("pageerror", (err) => crashes.push(err.message.split("\n")[0]));

  try {
    await page.getByPlaceholder("you@company.com").fill("nobody@corelyn.test");
    await page.getByPlaceholder("Enter your password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign In" }).click();

    await expect(page.getByText(/invalid email or password/i)).toBeVisible();
    // The button must come back, not stay stuck mid-spinner.
    await expect(page.getByRole("button", { name: "Sign In" })).toBeEnabled();
    expect(crashes, "uncaught errors in the renderer").toEqual([]);
  } finally {
    await app.close();
  }
});

test("a deploy made while signed in is attributable in the audit log", async () => {
  const { app, page, userDataDir } = await launchApp();
  try {
    await addNode(page, "Flow", "Start");
    await page.getByTitle("Run mission").click();
    // Deploy reaches the daemon even with no robot attached; what matters here
    // is the row it writes, not whether a mission then runs.
    await expect(page.getByText(/Deploying mission to robot/).first()).toBeVisible();

    // Close first: the daemon owns the database and only releases it on exit.
    await app.close();

    // Read the daemon's own database once it has shut down and flushed.
    const rows = auditRows(path.join(userDataDir, "corelyn.db"));
    expect(rows, "deploy rows in audit_log").toContainEqual(
      expect.objectContaining({ action: "deploy", attributed: true }));
  } catch (err) {
    await app.close().catch(() => {});
    throw err;
  }
});

// Reads audit_log with the sqlite3 CLI rather than pulling a Node SQLite
// driver in just for one assertion.
function auditRows(dbPath) {
  const out = execFileSync("sqlite3", [dbPath,
    "SELECT action, CASE WHEN user_id IS NULL THEN 0 ELSE 1 END FROM audit_log"],
    { encoding: "utf8" });
  return out.trim().split("\n").filter(Boolean).map(line => {
    const [action, attributed] = line.split("|");
    return { action, attributed: attributed === "1" };
  });
}
