#!/usr/bin/env node
/**
 * Per-player head variants via ONE sprite-sheet call per team (owner's
 * design: 每队一张图集, 第一格 = 参考锚点(头部), 其余格子 = 变体).
 *
 *   races/{team}/head.png --4x--> gpt-image-2 img2img:
 *     "4x2 grid on magenta; top-left = the input head unchanged;
 *      the other 7 = same character, different hair/expression"
 *   -> slice the 7 variant cells -> chroma-key + despill -> bbox-fit onto
 *      the engine head canvas -> races/{team}_v1..v6 (cell 8 is spare)
 *   -> team.json: players[1..] cycle v1..v6 (player 0 = GK keeps base head)
 *
 *   node script/regen-head-variants.mjs            # all teams except england
 *   node script/regen-head-variants.mjs brazil     # one team (re-roll)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sharp = (await import("sharp")).default;
let KEY = process.env.BTY_API_KEY;
if (!KEY && existsSync(join(root, ".env.local"))) KEY = (readFileSync(join(root, ".env.local"), "utf8").match(/^BTY_API_KEY=(.+)$/m) || [])[1];
if (!KEY) { console.error("no BTY_API_KEY"); process.exit(1); }

const DATA = join(root, "match-runtime-assets-source/data");
const RACES = join(DATA, "player/races");

const HAIR = {
  france: "comb shapes and neck-feather styles",
  germany: "head-feather crests",
  spain: "horn shapes and forelocks",
  portugal: "fur ruff styles",
  brazil: "fur tufts and rosette densities",
  argentina: "fur tufts and cheek fur",
  usa: "white feather crests and ruffs",
  england: "mane styles",
};

async function gi2Sheet(png, id) {
  const prompt =
    "Create a character sprite sheet: a 4x2 grid (4 columns, 2 rows) of 8 cartoon animal heads " +
    "on a solid flat pure magenta (#FF00FF) background, equal-size cells, generous spacing, no grid lines, no text. " +
    "The TOP-LEFT head must be EXACTLY the input head, unchanged. " +
    "The other 7 heads are the SAME character — same species, same art style, same colors, same outline thickness, " +
    "same game-sprite angle — each with a clearly DIFFERENT " + (HAIR[id] || "hair style") + " and a different facial " +
    "expression (calm, excited, determined, cheeky, cool, winking, surprised). Only hair/feather/fur style and " +
    "expression vary; proportions stay identical.";
  for (let a = 1; a <= 4; a += 1) {
    try {
      const form = new FormData();
      form.append("model", "gpt-image-2");
      form.append("prompt", prompt);
      form.append("size", "1536x1024");
      form.append("quality", "high");
      form.append("image", new Blob([png], { type: "image/png" }), "in.png");
      const ac = new AbortController();
      const tm = setTimeout(() => ac.abort(), 300000);
      const r = await fetch("https://aigw-api.betteryeah.com/openai/v1/images/edits", {
        method: "POST", headers: { Authorization: `Bearer ${KEY}` }, body: form, signal: ac.signal,
      });
      clearTimeout(tm);
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 100)}`);
      return Buffer.from((await r.json()).data[0].b64_json, "base64");
    } catch (e) {
      console.log(`  ${id} attempt ${a}: ${String(e).slice(0, 90)}`);
      if (a === 4) throw e;
      await new Promise((res) => setTimeout(res, a * 5000));
    }
  }
}

function keyInPlace(data, C) {
  for (let i = 0; i < data.length; i += C) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (r > 150 && b > 150 && g < 110 && Math.abs(r - b) < 90) { data[i + 3] = 0; continue; }
    const sp = Math.min(r, b) - g;
    if (sp > 18) { const k = g + 18; data[i] = Math.min(r, k + (r - Math.min(r, b))); data[i + 2] = Math.min(b, k + (b - Math.min(r, b))); }
  }
}

// slice cell (col,row) from the keyed sheet, bbox it, fit onto WxH
async function cellToHead(sheet, info, col, row, W, H) {
  const C = info.channels, cw = Math.floor(info.width / 4), ch = Math.floor(info.height / 2);
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = row * ch; y < (row + 1) * ch; y += 1) {
    for (let x = col * cw; x < (col + 1) * cw; x += 1) {
      if (sheet[(y * info.width + x) * C + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  if (x1 <= x0 || y1 <= y0) throw new Error(`cell ${col},${row} empty`);
  const cut = sharp(sheet, { raw: { width: info.width, height: info.height, channels: C } })
    .extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 });
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const sc = Math.min(W / w, H / h);
  const nw = Math.max(1, Math.round(w * sc)), nh = Math.max(1, Math.round(h * sc));
  const resized = await cut.resize(nw, nh).png().toBuffer();
  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: resized, left: (W - nw) >> 1, top: (H - nh) >> 1 }]).png().toBuffer();
}

async function team(id) {
  const base = join(RACES, id);
  const meta = await sharp(join(base, "head.png")).metadata();
  const up = await sharp(join(base, "head.png")).resize(meta.width * 4, meta.height * 4, { kernel: "lanczos3" }).png().toBuffer();
  const sheetPng = await gi2Sheet(up, id);
  writeFileSync(`/tmp/headsheet_${id}.png`, sheetPng);
  const { data, info } = await sharp(sheetPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  keyInPlace(data, info.channels);
  // cells 1..6 (skip top-left reference; cell 7 spare) -> v1..v6
  const cells = [[1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1]];
  for (let i = 0; i < cells.length; i += 1) {
    const head = await cellToHead(data, info, cells[i][0], cells[i][1], meta.width, meta.height);
    const dir = join(RACES, `${id}_v${i + 1}`);
    rmSync(dir, { recursive: true, force: true });
    // only the head lives in the variant dir; every other part points back
    // at the base race so the browser fetches it once (boot perf)
    const rj = JSON.parse(readFileSync(join(base, "race.json"), "utf8"));
    for (const [part, spec] of Object.entries(rj)) {
      if (spec && typeof spec === "object" && spec.name && part !== "head_front") {
        spec.name = `../${id}/${spec.name}`;
      }
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "race.json"), JSON.stringify(rj, null, 4));
    writeFileSync(join(dir, "head.png"), head);
  }
  const tj = join(DATA, "teams", id, "team.json");
  const d = JSON.parse(readFileSync(tj, "utf8"));
  for (let i = 1; i < d.players.length; i += 1) d.players[i].race = `${id}_v${(i - 1) % 6 + 1}`;
  writeFileSync(tj, JSON.stringify(d));
  console.log(`${id}: sheet -> v1..v6 + team.json ok`);
}

const only = process.argv[2];
if (only && !Object.prototype.hasOwnProperty.call(HAIR, only)) {
  console.error(`unknown team: ${only}`); process.exit(1);
}
const list = only ? [only] : Object.keys(HAIR).filter((t) => t !== "england");
const rs = await Promise.allSettled(list.map(team));
rs.forEach((r, i) => { if (r.status === "rejected") console.error(`${list[i]} FAILED: ${r.reason}`); });
console.log("done");
