#!/usr/bin/env node
/**
 * Regenerate the 8 team animal portraits with uniform framing/style.
 * Per team: existing portrait -> gpt-image-2 img2img (same character, bust
 * portrait, magenta backdrop) -> chroma-key + despill -> alpha-bbox height
 * normalization onto a 512x512 canvas. Originals are backed up next to the
 * output as <id>.orig.png the first time.
 *
 *   node script/regen-portraits.mjs            # all teams
 *   node script/regen-portraits.mjs england    # one team (re-roll)
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sharp = (await import("sharp")).default;
let KEY = process.env.BTY_API_KEY;
if (!KEY && existsSync(join(root, ".env.local"))) KEY = (readFileSync(join(root, ".env.local"), "utf8").match(/^BTY_API_KEY=(.+)$/m) || [])[1];
if (!KEY) { console.error("no BTY_API_KEY"); process.exit(1); }

const DIR = join(root, "public/animal-cup/portraits");
const SRC = join(root, "script/portrait-src");
const TEAMS = ["england", "france", "germany", "spain", "portugal", "brazil", "argentina", "usa"];
const only = process.argv[2];
if (only && !TEAMS.includes(only)) { console.error(`unknown team: ${only}`); process.exit(1); }

const PROMPT =
  "Redraw this exact cartoon animal character as a clean chest-up bust portrait. " +
  "Keep the SAME species, same face, same fur colors, same scarf and accessories — it must read as the same character. " +
  "Composition rules: character perfectly centered, facing the viewer, head occupying the upper half, " +
  "neck, shoulders and upper chest fully visible, nothing cropped at the neck. " +
  "Warm hand-drawn storybook style, soft cel shading, clean outlines, gentle proportions. " +
  "Background: solid flat pure magenta (#FF00FF) only, no gradients, no props, no text.";

async function gi2(png) {
  for (let a = 1; a <= 4; a += 1) {
    try {
      const form = new FormData();
      form.append("model", "gpt-image-2");
      form.append("prompt", PROMPT);
      form.append("size", "1024x1024");
      form.append("quality", "high");
      form.append("image", new Blob([png], { type: "image/png" }), "in.png");
      const ac = new AbortController();
      const tm = setTimeout(() => ac.abort(), 300000);
      const r = await fetch("https://aigw-api.betteryeah.com/openai/v1/images/edits", {
        method: "POST", headers: { Authorization: `Bearer ${KEY}` }, body: form, signal: ac.signal,
      });
      clearTimeout(tm);
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 120)}`);
      return Buffer.from((await r.json()).data[0].b64_json, "base64");
    } catch (e) {
      console.log(`  attempt ${a}: ${String(e).slice(0, 100)}`);
      if (a === 4) throw e;
      await new Promise((res) => setTimeout(res, a * 5000));
    }
  }
}

// magenta chroma-key with despill, then height-normalize onto 512x512
async function keyAndNormalize(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  for (let i = 0; i < data.length; i += C) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (r > 150 && b > 150 && g < 110 && Math.abs(r - b) < 90) { data[i + 3] = 0; continue; }
    // despill: magenta fringe -> pull r/b down toward g
    const spill = Math.min(r, b) - g;
    if (spill > 18) { const k = g + 18; data[i] = Math.min(r, k + (r - Math.min(r, b))); data[i + 2] = Math.min(b, k + (b - Math.min(r, b))); }
  }
  // alpha bbox
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    if (data[(y * W + x) * C + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 <= x0 || y1 <= y0) throw new Error("empty alpha after keying");
  const cut = await sharp(data, { raw: { width: W, height: H, channels: C } })
    .extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }).png().toBuffer();
  // uniform: bbox height -> 460px, centered on 512x512, bottom-anchored
  const TARGET_H = 460, CANVAS = 512;
  const meta = await sharp(cut).metadata();
  const scale = TARGET_H / meta.height;
  const w = Math.min(CANVAS, Math.round(meta.width * scale));
  const resized = await sharp(cut).resize({ height: TARGET_H, width: w, fit: "inside" }).png().toBuffer();
  const rMeta = await sharp(resized).metadata();
  return sharp({ create: { width: CANVAS, height: CANVAS, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: resized, left: Math.round((CANVAS - rMeta.width) / 2), top: CANVAS - 26 - rMeta.height }])
    .png().toBuffer();
}

async function one(id) {
  const file = join(DIR, `${id}.png`);
  const bak = join(SRC, `${id}.orig.png`);
  if (!existsSync(bak)) copyFileSync(file, bak);
  process.stdout.write(`${id}: gi2 ... `);
  const out = await gi2(readFileSync(bak));
  writeFileSync(`/tmp/portrait_raw_${id}.png`, out);
  const fin = await keyAndNormalize(out);
  writeFileSync(file, fin);
  console.log(`ok -> ${file}`);
}

const list = only ? [only] : TEAMS;
const results = await Promise.allSettled(list.map(one));
results.forEach((r, i) => { if (r.status === "rejected") console.error(`${list[i]} FAILED: ${r.reason}`); });
process.exit(results.some((r) => r.status === "rejected") ? 1 : 0);
