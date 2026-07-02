#!/usr/bin/env node
/**
 * Play smoke test: drives a real Chrome against /match?...&play=1 and verifies
 * the 1:1 human-control port actually works — a local user is attached to the
 * home team, a held arrow key MOVES the controlled player, and the control
 * indicator (ring + teammate arrows) renders with no pool-overflow crash.
 *
 * Headed Chrome only (headless SwiftShader wedges the render loop).
 *
 * Usage: node script/verify-match-play.mjs [baseUrl]
 */
import { chromium } from "playwright-core";

const baseUrl = process.argv[2] || "http://localhost:13000";
const matchUrl = `${baseUrl}/match?red=argentina&blue=portugal&play=1`;
const HARD_TIMEOUT_MS = 90_000;

const hardTimer = setTimeout(() => {
  console.error(JSON.stringify({ ok: false, reason: `hard timeout ${HARD_TIMEOUT_MS}ms` }));
  process.exit(2);
}, HARD_TIMEOUT_MS);

const errors = [];
const browser = await chromium.launch({ channel: "chrome", headless: false });
try {
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

  // 1) wait for the match to construct
  const bootDeadline = Date.now() + 45_000;
  for (;;) {
    const probe = await Promise.race([
      page.evaluate(() => ({
        matchGame: !!window.__matchGame,
        stadium: !!(window.__matchGame && window.__matchGame.stadium),
        canvas: !!document.querySelector("canvas"),
      })),
      new Promise((r) => setTimeout(() => r("wedged"), 20_000)),
    ]);
    if (probe === "wedged") { console.error(JSON.stringify({ ok: false, reason: "wedged" })); process.exit(1); }
    if (probe.matchGame && probe.stadium && probe.canvas) break;
    if (Date.now() > bootDeadline) { console.error(JSON.stringify({ ok: false, reason: "boot stalled" })); process.exit(1); }
    await page.waitForTimeout(2_000);
  }

  // 2) wait for the user to attach to a player AND for kickoff to pass (the
  // intro establishing shot freezes the clock ~5s, before which the controlled
  // player is in a pre-kickoff Wait state and can't move).
  const playDeadline = Date.now() + 30_000;
  for (;;) {
    const s = await page.evaluate(() => {
      const u = window.require("users").list[0];
      const g = window.__matchGame;
      const cur = g.pitch.states.current;
      return {
        attached: !!(u && u.player),
        playerId: u && u.player ? u.player.id : -1,
        team: u && u.team ? (u.team === g.pitch.redTeam ? "red" : "blue") : null,
        pitchState: cur ? cur.name || String(cur) : null,
        live: !g.pitch.paused && !!g.pitch.matchTime,
      };
    });
    if (s.attached) {
      if (process.env.VERBOSE) console.error("[attached]", JSON.stringify(s));
      break;
    }
    if (Date.now() > playDeadline) {
      console.error(JSON.stringify({ ok: false, reason: "user never reached live play", last: s }, null, 2));
      // continue to movement test anyway to gather more signal
      break;
    }
    await page.waitForTimeout(1_500);
  }

  // focus the canvas so key events reach window listeners
  await page.mouse.click(640, 400);
  await page.waitForTimeout(300);

  // 3) movement test: snapshot controlled player, hold ArrowUp ~1.5s, re-read.
  function readState() {
    return page.evaluate(() => {
      const u = window.require("users").list[0];
      const g = window.__matchGame;
      const p = u && u.player;
      const ind = g.stadium.controlIndicator;
      let visibleIndicators = 0;
      if (ind && ind.indicators) {
        for (let i = 0; i < ind.indicators.length; i++) if (ind.indicators[i].visible) visibleIndicators++;
      }
      return {
        playerId: p ? p.id : -1,
        stateName: p && p.state ? (p.state.name || String(p.state)) : null,
        pos: p ? { x: +p.position.x.toFixed(3), y: +p.position.y.toFixed(3) } : null,
        ctrlVel: u && u.controller ? { x: +u.controller.velocity.x.toFixed(2), y: +u.controller.velocity.y.toFixed(2) } : null,
        indicatorLayerVisible: !!(g.stadium.indicatorLayer && g.stadium.indicatorLayer.visible),
        visibleIndicators,
      };
    });
  }

  const before = await readState();
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(1_500);
  const during = await readState();
  await page.keyboard.up("ArrowUp");
  await page.waitForTimeout(300);

  // also probe a sideways press to confirm both axes
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(900);
  const during2 = await readState();
  await page.keyboard.up("ArrowRight");

  await page.screenshot({ path: "/tmp/ab-match-play.png", type: "png" });

  const moved =
    before.pos && during.pos &&
    (Math.abs(during.pos.x - before.pos.x) + Math.abs(during.pos.y - before.pos.y)) > 0.3;
  const velSeen = during.ctrlVel && (Math.abs(during.ctrlVel.x) + Math.abs(during.ctrlVel.y)) > 0.1;

  const realErrors = errors.filter(
    (e) => !/favicon|React DevTools|Download the|animal-cup\/audio\//i.test(e),
  );
  const overflow = realErrors.filter((e) => /Cannot (set|read).*visible|undefined/i.test(e));

  const ok =
    before.playerId >= 0 &&
    moved &&
    velSeen &&
    before.indicatorLayerVisible &&
    during.visibleIndicators > 0 &&
    overflow.length === 0;

  console.log(JSON.stringify({
    ok,
    controlledPlayer: before.playerId,
    moved,
    velSeen,
    before, during, during2,
    indicatorLayerVisible: before.indicatorLayerVisible,
    visibleIndicators: during.visibleIndicators,
    overflowErrors: overflow.slice(0, 3),
    otherErrors: realErrors.slice(0, 5),
  }, null, 2));
  process.exit(ok ? 0 : 1);
} finally {
  clearTimeout(hardTimer);
  await browser.close();
}
