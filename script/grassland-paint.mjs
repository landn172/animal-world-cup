#!/usr/bin/env node
/**
 * Whole-stadium grassland repaint via gpt-image-2 (the same model/pipeline as
 * the character art, so the style matches). Approved look: green terraced
 * embankment + rows of small woven straw mats, dirt-path aisles, storybook
 * cel shading. Strategy per the owner's methodology:
 *   - square-ish CONTEXT tiles (stand + band + a slice of pitch) so the model
 *     keeps the composition; one shared prompt so the style stays uniform
 *   - paste back ONLY each tile's target region; pitch pixels are protected
 *     per-pixel; the ad band is restored from the source at the end
 *   - soccer balls in the corners are prompted away
 *
 *   node script/grassland-paint.mjs            # all tiles
 *   node script/grassland-paint.mjs --only 3   # single tile by index
 */
import { readFileSync, existsSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sharp = (await import("sharp")).default;
let KEY = process.env.BTY_API_KEY;
if (!KEY && existsSync(join(root, ".env.local"))) KEY = (readFileSync(join(root, ".env.local"), "utf8").match(/^BTY_API_KEY=(.+)$/m) || [])[1];
const home = homedir();
const SRC = join(home, "Downloads/球场备份/过程/step0-原始.png");
const OUT = join(home, "Downloads/新球场.png");
const W = 4096, H = 2048;

const PROMPT =
  "Repaint this section of a cartoon football stadium as a cute storybook grassland stadium: replace ALL blue seats with neat rows of small woven straw seat mats on a green grassy terraced embankment, in the same rows and positions as the seats; replace ALL grey concrete, stairs and walkways with green grass meadow and light dirt paths; if there is a decorative soccer ball on the concrete, remove it and paint plain grass meadow instead; keep the colored advertising board strip and the green football pitch EXACTLY unchanged. Warm hand-drawn cartoon style, soft cel shading, clean outlines, matching a cute animal football game. No people, no animals, no text, no letters.";

// tiles: src rect (context) + paste rect (target region inside it)
const TILES = [
  { id: "top1", sx: 0, sy: 0, sw: 1244, sh: 1024, px: 0, py: 0, pw: 1244, ph: 470 },
  { id: "top2", sx: 1244, sy: 0, sw: 741, sh: 1024, px: 1244, py: 0, pw: 741, ph: 470 },
  { id: "top3", sx: 1985, sy: 0, sw: 827, sh: 1024, px: 1985, py: 0, pw: 827, ph: 470 },
  { id: "top4", sx: 2812, sy: 0, sw: 1284, sh: 1024, px: 2812, py: 0, pw: 1284, ph: 470 },
  { id: "wingL1", sx: 0, sy: 470, sw: 700, sh: 1024, px: 0, py: 470, pw: 700, ph: 1024 },
  { id: "wingL2", sx: 0, sy: 1024, sw: 700, sh: 1024, px: 0, py: 1494, pw: 700, ph: 554 },
  { id: "wingR1", sx: 3396, sy: 470, sw: 700, sh: 1024, px: 3396, py: 470, pw: 700, ph: 1024 },
  { id: "wingR2", sx: 3396, sy: 1024, sw: 700, sh: 1024, px: 3396, py: 1494, pw: 700, ph: 554 },
  { id: "bot1", sx: 562, sy: 1024, sw: 991, sh: 1024, px: 562, py: 1801, pw: 991, ph: 247 },
  { id: "bot2", sx: 1553, sy: 1024, sw: 991, sh: 1024, px: 1553, py: 1801, pw: 991, ph: 247 },
  { id: "bot3", sx: 2544, sy: 1024, sw: 990, sh: 1024, px: 2544, py: 1801, pw: 990, ph: 247 },
];

async function gi2(tilePng) {
  for (let a = 1; a <= 4; a++) {
    try {
      const form = new FormData();
      form.append("model", "gpt-image-2");
      form.append("prompt", PROMPT);
      form.append("size", "1024x1024");
      form.append("quality", "medium");
      form.append("image", new Blob([tilePng], { type: "image/png" }), "in.png");
      const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 300000);
      const r = await fetch("https://aigw-api.betteryeah.com/openai/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${KEY}` }, body: form, signal: ac.signal });
      clearTimeout(tm);
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 140)}`);
      return Buffer.from((await r.json()).data[0].b64_json, "base64");
    } catch (e) { console.log(`  att${a} ${String(e).slice(0, 100)}`); if (a < 4) await new Promise((r) => setTimeout(r, a * 6000)); else throw e; }
  }
}

const { data: base, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const C = info.channels;
const isGreen = (i) => base[i + 1] > base[i] + 15 && base[i + 1] > base[i + 2] + 15 && base[i + 1] > 80;
// --resume: keep already-painted tiles (start from current OUT instead of the source)
let work;
if (process.argv.includes("--resume") && existsSync(OUT)) {
  const r = await sharp(OUT).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  work = Buffer.from(r.data);
  console.log("resume from", OUT);
} else work = Buffer.from(base);

const onlyIdx = process.argv.indexOf("--only") >= 0 ? parseInt(process.argv[process.argv.indexOf("--only") + 1], 10) : -1;
for (let t = 0; t < TILES.length; t++) {
  if (onlyIdx >= 0 && t !== onlyIdx) continue;
  const T = TILES[t];
  process.stdout.write(`${t}/${TILES.length} ${T.id} -> gi2 ... `);
  const ctx = await sharp(SRC).extract({ left: T.sx, top: T.sy, width: T.sw, height: T.sh }).resize(1024, 1024, { fit: "fill" }).png().toBuffer();
  let out;
  try { out = await gi2(ctx); } catch (e) { console.log("FAIL (skip)"); continue; }
  const fit = await sharp(out).resize(T.sw, T.sh, { fit: "fill" }).removeAlpha().raw().toBuffer();
  // paste only the target region, protecting pitch-green pixels
  for (let y = 0; y < T.ph; y++) for (let x = 0; x < T.pw; x++) {
    const gx = T.px + x, gy = T.py + y;
    const gi = (gy * W + gx) * C;
    if (isGreen(gi)) continue;
    const lx = gx - T.sx, ly = gy - T.sy;
    const ti = (ly * T.sw + lx) * 3;
    work[gi] = fit[ti]; work[gi + 1] = fit[ti + 1]; work[gi + 2] = fit[ti + 2];
  }
  writeFileSync(`/tmp/gi2_${T.id}.png`, out);
  console.log("ok");
}
// restore the ad band rows exactly from source
for (let y = 428; y < 470; y++) for (let x = 562; x < 3534; x++) { const i = (y * W + x) * C; work[i] = base[i]; work[i + 1] = base[i + 1]; work[i + 2] = base[i + 2]; }

const fin = sharp(work, { raw: { width: W, height: H, channels: C } });
await fin.clone().png().toFile(OUT);
await fin.clone().png().toFile(join(home, "Downloads/球场备份/过程/step4-gi2全场.png"));
await fin.clone().resize(1200).png().toFile("/tmp/gi2_full.png");
await fin.clone().extract({ left: 0, top: 0, width: 1400, height: 800 }).resize(1100).png().toFile("/tmp/gi2_tl.png");
await fin.clone().extract({ left: 2696, top: 0, width: 1400, height: 800 }).resize(1100).png().toFile("/tmp/gi2_tr.png");
await fin.clone().extract({ left: 0, top: 1300, width: 1600, height: 748 }).resize(1100).png().toFile("/tmp/gi2_bl.png");
console.log("✅ 全场重画完成 -> 新球场.png + step4-gi2全场.png");
