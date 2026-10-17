// Headless-browser end-to-end check of the whole demo flow (baseline -> 3D theatre -> event -> proposal -> approve ->
// config change -> reject -> mobile layout). Fails on any console error or any non-local network request.
//   1. build the UI, then start the API (it serves web/dist) with FRESH state on port 8000
//   2. PW_PATH=<playwright module path> OUT=./e2e-output node scripts/e2e_browser.cjs
const fs = require("fs");
const { chromium } = require(process.env.PW_PATH || "playwright");
const OUT = process.env.OUT || "./e2e-output";
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://127.0.0.1:8000";
(async () => {
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("requestfailed", (r) => errors.push("requestfailed: " + r.url()));
  const external = [];
  page.on("request", (r) => { const u = new URL(r.url()); if (!["127.0.0.1", "localhost"].includes(u.hostname) && u.protocol.startsWith("http")) external.push(r.url()); });
  const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
  const step = (m) => console.log("STEP", m);

  step("overview before baseline");
  await page.goto(BASE + "/");
  await page.keyboard.press("Escape"); // skip intro
  await page.getByRole("button", { name: "Generate baseline plan" }).waitFor({ timeout: 15000 });
  await shot("01-no-plan");
  await page.getByRole("button", { name: "Generate baseline plan" }).click();
  await page.getByText(/Baseline plan plan-0001 approved/).waitFor({ timeout: 40000 });
  await page.getByText("Hard-rule validation").waitFor();
  await shot("02-overview");
  console.log("OVERVIEW", (await page.locator("main").innerText()).replace(/\n+/g, " | ").slice(0, 700));

  step("theatre");
  await page.goto(BASE + "/theatre");
  await page.locator("canvas").first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(2500);
  await shot("03-theatre");
  console.log("CANVAS", await page.locator("canvas").count(), "webgl-fallback-badge", await page.getByText("WebGL unavailable").count());

  step("select a base via dropdown");
  await page.getByLabel("Focus base").selectOption({ index: 1 });
  await page.waitForTimeout(1500);
  await shot("04-theatre-base-selected");
  console.log("INSPECTOR", (await page.getByText("Load-out stock").count()) > 0 ? "base stock shown" : "no stock");

  step("retasking event");
  await page.goto(BASE + "/retasking");
  await page.getByRole("button", { name: "Suggest target" }).click();
  await page.getByRole("button", { name: /Review & submit/ }).click();
  await page.getByRole("dialog").getByText("Confirm event").waitFor();
  await shot("05-confirm");
  await page.getByRole("button", { name: "Run CP-SAT re-plan" }).click();
  await page.getByText(/Proposal plan-0002/).first().waitFor({ timeout: 40000 });
  await page.getByText("Reason codes (evidence-backed)").waitFor();
  await shot("06-proposal");
  console.log("PROPOSAL", (await page.locator("main").innerText()).replace(/\n+/g, " | ").slice(0, 1200));

  step("theatre with proposal");
  await page.goto(BASE + "/theatre");
  await page.locator("canvas").first().waitFor();
  await page.waitForTimeout(2500);
  await shot("07-theatre-proposal");
  console.log("THEATRE BADGES", (await page.locator("main").innerText()).split("\n").slice(0, 8).join(" | "));

  step("timeline compare");
  await page.goto(BASE + "/timeline");
  await page.waitForTimeout(1200);
  await shot("08-timeline");

  step("approve");
  await page.goto(BASE + "/retasking");
  await page.getByRole("button", { name: "Approve plan" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  await page.getByText(/plan-0002 approved by the backend/).waitFor({ timeout: 20000 });
  await shot("09-approved");

  step("other pages");
  for (const [p, n, wait] of [["/missions", "10-missions", "Mission detail"], ["/fusion", "11-fusion", "Availability model"], ["/benchmarks", "12-benchmarks", "Median coverage"], ["/settings", "13-settings", "Planning configuration"], ["/diagnostics", "14-diagnostics", "Last plan"]]) {
    await page.goto(BASE + p);
    await page.getByText(wait).first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);
    await shot(n);
  }

  step("config change crew rest 10 -> 12");
  await page.goto(BASE + "/settings");
  const rest = page.getByLabel(/Crew rest/);
  await rest.fill("12");
  await page.getByRole("button", { name: "Apply & recalculate plan" }).click();
  await page.getByText(/Configuration proposal plan-0003 calculated/).waitFor({ timeout: 40000 });
  await shot("15-config-proposal");
  await page.goto(BASE + "/retasking");
  await page.getByText(/CONFIG_CHANGE/).first().waitFor();
  await page.getByRole("button", { name: "Reject plan" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Reject" }).click();
  await page.getByText(/plan-0003 rejected/).waitFor({ timeout: 20000 });

  step("mobile layout");
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(BASE + "/");
  await page.getByText("Hard-rule validation").waitFor();
  await shot("16-mobile-overview");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  console.log("MOBILE horizontal overflow:", overflow);

  console.log("EXTERNAL REQUESTS:", JSON.stringify(external));
  console.log("ERRORS:", JSON.stringify(errors, null, 1));
  await browser.close();
  if (errors.length || external.length) { console.error("E2E CHECK FAILED"); process.exit(2); }
  console.log("E2E OK");
})().catch((e) => { console.error("E2E FAILED", e); process.exit(1); });
