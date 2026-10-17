// Records a narrated walkthrough of the REAL running app (no mock data).
//   1. build the UI and start the API with fresh state on :8000
//   2. PW_PATH=<playwright module> OUT=<dir> node scripts/demo_video/record.cjs
//   3. python3 scripts/demo_video/compose.py <dir>      -> <dir>/airpower_demo.mp4
// Narration audio is generated offline with espeak-ng (MBROLA us2 voice if installed).
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { chromium } = require(process.env.PW_PATH || "playwright");

const OUT = path.resolve(process.env.OUT || "./demo-output");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8000";
const VOICE = process.env.VOICE || "mb-us2";
fs.mkdirSync(path.join(OUT, "audio"), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SCENES = [
  { id: "intro", text: "This is AIR POWER, our solution for Smart India Hackathon problem statement two six two five zero. It plans air missions for a fictional theatre called Blueland: three bases, twenty four aircraft, forty crew, and thirty missions over a twelve hour horizon. All data in this demo is synthetic.",
    act: async (p) => { await p.goto(BASE + "/"); await sleep(2600); } },
  { id: "baseline", text: "We start by generating the baseline plan. The backend runs Google O R Tools C P sat, a constraint programming solver, with an eight second limit. It decides which missions to cover, and assigns aircraft, crew, base, route corridor and load-out to each one.",
    act: async (p) => { await p.getByRole("button", { name: "Generate baseline plan" }).click(); await p.getByText("Hard-rule validation").waitFor({ timeout: 40000 }); } },
  { id: "overview", text: "Every number on this dashboard comes from the solver's real result. A mission that cannot be served safely is left uncovered, instead of breaking a rule. Then an independent validator re-checks all seventeen hard rules: aircraft roles, turnaround, crew qualification, duty and rest limits, runway and weather windows, and load-out stock.",
    act: async (p) => { await sleep(1500); await p.mouse.move(640, 300); await p.mouse.wheel(0, 260); await sleep(2500); await p.mouse.wheel(0, -260); } },
  { id: "theatre", text: "This is the three D digital theatre. Everything here is drawn from scenario and plan data: the bases, mission nodes, route corridors, and time windowed threat zones. We can orbit, zoom and pan freely.",
    act: async (p) => { await p.locator('nav a[href="/theatre"]').click(); await p.locator("canvas").first().waitFor({ timeout: 20000 }); await sleep(1800);
      await p.mouse.move(560, 420); await p.mouse.down(); await p.mouse.move(700, 380, { steps: 40 }); await p.mouse.up(); await sleep(600);
      await p.mouse.wheel(0, -300); await sleep(900); await p.mouse.wheel(0, 300); } },
  { id: "play", text: "Pressing play moves the mission clock. Each aircraft flies its assigned corridor out and back, exactly when the plan schedules it.",
    act: async (p) => { await p.getByRole("button", { name: "Play" }).click(); await sleep(6500); await p.getByRole("button", { name: "Pause" }).click(); } },
  { id: "base", text: "Selecting a base shows its runway windows, how much of its load-out stock is in use, and how many missions it supports.",
    act: async (p) => { await p.getByLabel("Focus base").selectOption({ index: 1 }); await sleep(2500); } },
  { id: "event", text: "Now something changes. In the replanning center we report an aircraft as unavailable. The system suggests the aircraft that matters most to the current plan, and asks us to confirm before anything is sent.",
    act: async (p) => { await p.locator('nav a[href="/retasking"]').click(); await p.getByRole("button", { name: "Suggest target" }).click(); await sleep(1500);
      await p.getByRole("button", { name: /Review & submit/ }).click(); await p.getByRole("dialog").waitFor(); } },
  { id: "solve", text: "The backend re-plans in about a second. Assignments launching in the next thirty minutes are frozen, and unnecessary changes are penalized, so the rest of the plan stays stable.",
    act: async (p) => { await p.getByRole("button", { name: "Run CP-SAT re-plan" }).click(); await p.getByText("Reason codes (evidence-backed)").waitFor({ timeout: 40000 }); } },
  { id: "proposal", text: "The result is a proposal, not an automatic change. It shows the solver status and time, which missions changed and which stayed the same, and a reason code for every change, backed by evidence from the event and the validator.",
    act: async (p) => { await sleep(2500); await p.mouse.move(1000, 450); await p.mouse.wheel(0, 420); await sleep(3000); await p.mouse.wheel(0, 420); } },
  { id: "changes", text: "Back in the theatre, the changed missions pulse in amber, with the old and new routes shown. Only changes that really exist in the returned plan are animated.",
    act: async (p) => { await p.locator('nav a[href="/theatre"]').click(); await p.locator("canvas").first().waitFor();
      await p.getByRole("button", { name: "Reset" }).click(); await sleep(2500);
      // focus a mission that really changed, taken from the backend's diff of the pending proposal
      const id = await p.evaluate(async () => (await (await fetch("/api/plan/current")).json()).proposed?.diff?.changed_missions?.[0]);
      if (id) await p.getByLabel("Focus mission").selectOption(id);
      await sleep(2500); } },
  { id: "timeline", text: "The timeline compares the old and new plans in fifteen minute slots, including turnaround periods and frozen assignments.",
    act: async (p) => { await p.locator('nav a[href="/timeline"]').click(); await sleep(2500); } },
  { id: "approve", text: "A human always makes the final decision. We approve, and the new plan becomes active only after the backend confirms it.",
    act: async (p) => { await p.locator('nav a[href="/retasking"]').click(); await p.getByRole("button", { name: "Approve plan" }).click(); await sleep(1200);
      await p.getByRole("dialog").getByRole("button", { name: "Approve" }).click(); await p.getByText(/approved by the backend/).waitFor({ timeout: 20000 }); } },
  { id: "fusion", text: "Data fusion scores every input record for freshness, validity and conflicts. Trust is kept separate from aircraft serviceability, which comes from a model trained and evaluated on synthetic data only.",
    act: async (p) => { await p.locator('nav a[href="/fusion"]').click(); await p.getByText("Availability model").waitFor(); await sleep(1500); await p.mouse.move(700, 450); await p.mouse.wheel(0, 500); } },
  { id: "bench", text: "Finally, the benchmark laboratory. Across one hundred generated scenarios with a four second limit, C P sat achieved higher priority weighted coverage than our greedy baseline on ninety nine, and tied on one. Every plan passed the validator. With a fifteen second limit, the median rose from thirteen eighty five to fourteen hundred.",
    act: async (p) => { await p.locator('nav a[href="/benchmarks"]').click(); await p.getByLabel("Result set").waitFor({ timeout: 15000 }); await sleep(6000);
      await p.getByLabel("Result set").selectOption("limit_15s"); await sleep(2500); } },
  { id: "outro", text: "AIR POWER. Every report verified. Every post stocked before the pass closes. Thank you.",
    act: async (p) => { await p.locator('nav a[href="/"]').click(); await sleep(1500); } },
];

function duration(f) {
  return parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());
}

(async () => {
  // 1. narration first, so every scene lasts at least as long as its voice-over
  for (const s of SCENES) {
    s.audio = path.join(OUT, "audio", `${s.id}.wav`);
    execFileSync("espeak-ng", ["-v", VOICE, "-s", "148", "-g", "4", "-w", s.audio, s.text]);
    s.dur = duration(s.audio);
  }
  // 2. record the live app
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: OUT, size: { width: 1280, height: 720 } } });
  const t0 = Date.now();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const timeline = [];
  for (const s of SCENES) {
    const start = (Date.now() - t0) / 1000;
    await Promise.all([s.act(page), sleep(s.dur * 1000 + 700)]);
    timeline.push({ id: s.id, start, voice: s.dur, end: (Date.now() - t0) / 1000, text: s.text, audio: s.audio });
    console.log(`scene ${s.id.padEnd(9)} start ${start.toFixed(1)}s voice ${s.dur.toFixed(1)}s`);
  }
  await sleep(1200);
  const video = await page.video().path();
  await ctx.close();
  await browser.close();
  fs.writeFileSync(path.join(OUT, "timeline.json"), JSON.stringify({ video, timeline, errors }, null, 2));
  console.log("video:", video, "errors:", JSON.stringify(errors));
})().catch((e) => { console.error("RECORDING FAILED", e); process.exit(1); });
