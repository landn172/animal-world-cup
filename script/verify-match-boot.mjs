#!/usr/bin/env node
/**
 * Boot smoke test: drives a real Chrome against /ab and verifies the match
 * runtime actually starts (canvas mounted, stadium constructed, no console
 * errors). Exists because three extraction bugs in a row were only visible
 * in a real browser — HTTP 200 proves nothing.
 *
 * Usage: node script/verify-match-boot.mjs [baseUrl]
 */
import { chromium } from "playwright-core";

const baseUrl = process.argv[2] || "http://localhost:3001";
const matchUrl = `${baseUrl}/match?red=england&blue=france`;
const HARD_TIMEOUT_MS = 60_000;
const SETTLE_MS = 4_000;

const hardTimer = setTimeout(() => {
  console.error(JSON.stringify({ ok: false, reason: `hard timeout ${HARD_TIMEOUT_MS}ms` }));
  process.exit(2);
}, HARD_TIMEOUT_MS);

const errors = [];
// headless = SwiftShader software GL: the match render loop saturates the main
// thread and evaluate() hangs. Headed Chrome uses the real GPU — boots in seconds.
const browser = await chromium.launch({ channel: "chrome", headless: false });
try {
  // one shared context: the post-mortem tab must see the match tab's localStorage
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const url = (msg.location() && msg.location().url) || "";
      errors.push(`${msg.text().slice(0, 240)} @ ${url.slice(0, 120)}`);
    }
    if (process.env.VERBOSE) console.error(`[console:${msg.type()}] ${msg.text().slice(0, 160)}`);
  });
  page.on("pageerror", (err) => errors.push(String(err).slice(0, 300)));

  await page.goto(matchUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

  // poll instead of waitForFunction so a timeout tells us WHERE boot stalled
  const deadline = Date.now() + 40_000;
  let probe = {};
  // evaluate hangs forever if the page main thread wedges — race every probe
  // against a timer, then read the localStorage boot-trace from a SECOND tab.
  async function dumpTraceAndExit(why) {
    const page2 = await context.newPage();
    await page2.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded", timeout: 15_000 });
    const dump = await page2.evaluate(() => ({
      stages: (localStorage.getItem("bootStages") || "").trim().split("\n").slice(-8),
      trace: (localStorage.getItem("bootTrace") || "").trim().split("\n").slice(-8),
      heartbeat: localStorage.getItem("bootHeartbeat"),
      now: Date.now(),
    }));
    dump.heartbeatAgeMs = dump.heartbeat ? dump.now - Number(dump.heartbeat) : null;
    console.log(JSON.stringify({ ok: false, reason: why, ...dump }, null, 2));
    process.exit(1);
  }
  for (;;) {
    probe = await Promise.race([
      page.evaluate(() => ({
        booted: !!window.__gameRuntimeBooted,
        startFn: typeof window.__startStandaloneMatch,
        matchGame: !!window.__matchGame,
        stadium: !!(window.__matchGame && window.__matchGame.stadium),
        canvas: !!document.querySelector("canvas"),
      })),
      new Promise((r) => setTimeout(() => r("wedged"), 20_000)),
    ]);
    if (probe === "wedged") await dumpTraceAndExit("main thread wedged");
    if (probe.matchGame && probe.stadium && probe.canvas) break;
    if (Date.now() > deadline) await dumpTraceAndExit("boot stalled (no wedge)");
    console.error(`[probe] ${JSON.stringify(probe)} errors=${errors.length}`);
    await page.waitForTimeout(2_500);
  }
  await page.waitForTimeout(SETTLE_MS);

  const state = await page.evaluate(() => {
    const g = window.__matchGame;
    return {
      canvas: !!document.querySelector("canvas"),
      stadium: !!g.stadium,
      players: g.stadium && g.stadium.players ? g.stadium.players.length : 0,
      ballRenderer: !!(g.stadium && g.stadium.ballRenderer),
      mode: g.states && g.states.current ? g.states.current.name || String(g.states.current) : null,
      pitchRunning: !!(g.pitch && !g.pitch.paused),
    };
  });

  await page.screenshot({ path: "/tmp/ab-match-boot.png", type: "png" });

  // dev-noise errors (favicon, React devtools hints) are not boot failures
  const realErrors = errors.filter(
    // audio files are non-critical and 404 until generated (ElevenLabs key
    // pending); the SoundBank no-ops gracefully, so don't fail boot on them
    (e) => !/favicon|React DevTools|Download the|animal-cup\/audio\//i.test(e),
  );
  const ok = state.canvas && state.stadium && state.players === 14 && realErrors.length === 0;
  console.log(JSON.stringify({ ok, state, errors: realErrors.slice(0, 5) }, null, 2));
  process.exit(ok ? 0 : 1);
} finally {
  clearTimeout(hardTimer);
  await browser.close();
}
