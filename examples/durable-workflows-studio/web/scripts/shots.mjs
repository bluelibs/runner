/**
 * Studio screenshot capture.
 *
 * Drives the real client (demo mode, served from the built `web/dist`) with
 * an installed Chrome and saves docs/shots/*.png. Run on any normal shell:
 *
 *   npm run shots
 *
 * Requires Google Chrome (or set SHOTS_CHROME to a Chromium binary).
 */
import { existsSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const studioRoot = join(here, "..", "..");
const shotsDir = join(studioRoot, "docs", "shots");
const webDist = join(studioRoot, "web", "dist");

const MAC_CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const LINUX_CANDIDATES = [
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

function chromePath() {
  if (process.env.SHOTS_CHROME) return process.env.SHOTS_CHROME;
  if (process.platform === "darwin") return MAC_CHROME;
  return LINUX_CANDIDATES.find((candidate) => existsSync(candidate));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const CONTENT_TYPES = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
};

function contentType(path) {
  const extension = Object.keys(CONTENT_TYPES).find((candidate) =>
    path.endsWith(candidate),
  );
  return extension ? CONTENT_TYPES[extension] : "application/octet-stream";
}

async function startServer() {
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
    try {
      const body = await readFile(join(webDist, relativePath));
      response.writeHead(200, { "content-type": contentType(relativePath) });
      response.end(body);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Screenshot server did not expose a TCP port.");
  }
  return { server, pageUrl: `http://127.0.0.1:${address.port}` };
}

const { chromium } = await import("playwright-core").catch(() => {
  console.error(
    "playwright-core is missing. Run `npm install` in web/ first.",
  );
  process.exit(1);
});

mkdirSync(shotsDir, { recursive: true });
const executablePath = chromePath();
if (!executablePath) {
  console.error("No Chrome found. Set SHOTS_CHROME to a Chromium binary.");
  process.exit(1);
}

const { server, pageUrl } = await startServer();
const browser = await chromium.launch({
  executablePath,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));

async function shot(name, suffix, waitMs = 2500) {
  await page.goto(`${pageUrl}${suffix}`, { waitUntil: "networkidle" });
  await page.locator("#root > *").waitFor();
  await sleep(waitMs);
  await page.screenshot({ path: join(shotsDir, name) });
  console.log("saved", name);
}

async function shotAfterClick(name, suffix, buttonName) {
  await page.goto(`${pageUrl}${suffix}`, { waitUntil: "networkidle" });
  await page.locator("#root > *").waitFor();
  await sleep(1800);
  await page.getByRole("button", { name: buttonName }).first().click();
  await sleep(500);
  await page.screenshot({ path: join(shotsDir, name) });
  console.log("saved", name);
}

await shot("00-login.png", "?demo=1&auth=1");
await shot("01-incident-live.png", "?demo=1&select=demo_inc_live");
await shot("02-order-completed.png", "?demo=1&select=demo_ord_completed");
await shot("03-chaos-failed.png", "?demo=1&select=demo_inc_failed");
await shot("04-schedules.png", "?demo=1&view=schedules");
await shot("05-start-modal.png", "?demo=1&modal=start");
await shot("06-signal-modal.png", "?demo=1&select=demo_inc_live&modal=signal");
await shot("08-onboarding-live.png", "?demo=1&select=demo_onb_live", 4500);
await shot("10-overview.png", "?demo=1");
assert.equal(await page.locator(".latest-identity .pill-dot").count(), 0);
assert.ok(await page.locator(".latest-identity .pill").count() > 0);
const workflowRows = page.locator(".workflow-nav-list > .side-link");
const initialWorkflowCount = await workflowRows.count();
assert.ok(initialWorkflowCount >= 20 && initialWorkflowCount < 50);
await page.locator(".workflow-nav-list").evaluate((element) => {
  element.scrollTop = element.scrollHeight;
});
await page.waitForFunction(
  (initial) => document.querySelectorAll(".workflow-nav-list > .side-link").length > initial,
  initialWorkflowCount,
);
for (let index = 0; index < 2; index += 1) {
  await page.locator(".workflow-nav-list").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await sleep(300);
}
assert.equal(await workflowRows.count(), 50);
await page.screenshot({ path: join(shotsDir, "18-workflow-scroll.png") });
console.log("saved 18-workflow-scroll.png; workflow scroll and dot-free labels verified");

await page.goto(`${pageUrl}?demo=1`, { waitUntil: "networkidle" });
await sleep(1800);
await page.getByLabel("Search workflows").fill("case escalation");
await page.getByRole("button", { name: "Case escalation risk", exact: true }).waitFor();
assert.equal(await workflowRows.count(), 1);
await page.getByLabel("Search workflows").fill("reconciliation");
await sleep(400);
await page.screenshot({ path: join(shotsDir, "16-workflow-search.png") });
console.log("saved 16-workflow-search.png");

await page.goto(`${pageUrl}?demo=1&view=executions`, {
  waitUntil: "networkidle",
});
await sleep(1800);
for (let pageIndex = 0; pageIndex < 4; pageIndex += 1) {
  await page.locator(".exec-scroll").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await sleep(800);
}
await page.screenshot({ path: join(shotsDir, "17-infinite-history.png") });
console.log("saved 17-infinite-history.png");

await shotAfterClick(
  "11-portfolio-tree.png",
  "?demo=1&select=demo_portfolio_live",
  /Tree/,
);
await shot("12-child-loop.png", "?demo=1&select=demo_rollup_apac");
await shotAfterClick(
  "13-signal-history.png",
  "?demo=1&select=demo_inc_live",
  /Signals/,
);

await page.goto(`${pageUrl}?demo=1&select=demo_portfolio_live`, {
  waitUntil: "networkidle",
});
await sleep(1800);
await page.locator(".operator-menu > summary").click();
await page.getByRole("button", { name: "Edit state" }).click();
await sleep(500);
await page.screenshot({ path: join(shotsDir, "14-edit-state.png") });
console.log("saved 14-edit-state.png");

await page.goto(`${pageUrl}?demo=1&view=schedules`, {
  waitUntil: "networkidle",
});
await sleep(1800);
await page.getByRole("button", { name: "Edit" }).first().click();
await sleep(500);
await page.screenshot({ path: join(shotsDir, "15-schedule-edit.png") });
console.log("saved 15-schedule-edit.png");

// Audit tab via a real click.
await page.goto(`${pageUrl}?demo=1&select=demo_inc_live`, {
  waitUntil: "networkidle",
});
await sleep(2000);
await page.getByRole("button", { name: /Audit/ }).click();
await sleep(800);
await page.screenshot({ path: join(shotsDir, "07-audit-tab.png") });
console.log("saved 07-audit-tab.png");

// Resolve the live incident through the real signal flow.
await page.goto(`${pageUrl}?demo=1&select=demo_inc_live&modal=signal`, {
  waitUntil: "networkidle",
});
await sleep(2000);
await page
  .getByRole("dialog")
  .getByRole("button", { name: "Send signal", exact: true })
  .click();
await sleep(8000);
await page.screenshot({ path: join(shotsDir, "09-incident-resolved.png") });
console.log("saved 09-incident-resolved.png");

await browser.close();
await new Promise((resolve, reject) => {
  server.close((error) => (error ? reject(error) : resolve()));
});
console.log("done");
