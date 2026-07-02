#!/usr/bin/env node
/**
 * Bench-seated crowd placement (owner reference 2026-06-08: sparse, harmonious
 * — animals sit ON wooden props; a long log seats up to six, a stump one or
 * two; total ~50, not a packed wall).
 *
 * Layers, all at NATIVE 4096x2048 resolution (crowd stays as crisp as the
 * players): forest stands image -> bench/stump props -> seated animals.
 *
 *   node script/place-crowd.mjs --stands <forest4096> [--out <png>] [--seed N]
 *
 * Bench layout is hand-laid OUTSIDE the pitch seam rect (385,420)-(3695,1758)
 * of compose-stadium.mjs. Draw order: back rows first, then fronts.
 */
import { readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);

const standsSrc = arg("--stands", null);
const out = arg("--out", "/tmp/stands-with-crowd.png");
const spriteDir = arg("--sprites", join(root, "public/animal-cup/crowd"));
const seed = Number(arg("--seed", 7));
if (!standsSrc) {
  console.error("usage: node script/place-crowd.mjs --stands <img> [--out <png>] [--seed N]");
  process.exit(1);
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(seed);

const sharp = (await import("sharp")).default;
const W = 4096, H = 2048;

// bench prop types: sprite name -> seat capacity + how wide the prop renders
// seatRatio: how far down the prop's height the animal's bottom lands —
// animals must OVERLAP the prop front face (reference look), not peek behind
const PROPS = {
  "log-long":   { file: "bench-log-long.png",   seats: 6, width: 430, seatRatio: 0.62 },
  "log-medium": { file: "bench-log-medium.png", seats: 3, width: 250, seatRatio: 0.62 },
  "log-short":  { file: "bench-log-short.png",  seats: 2, width: 175, seatRatio: 0.6 },
  "stump-wide": { file: "bench-stump-wide.png", seats: 2, width: 140, seatRatio: 0.48 },
  "stump":      { file: "bench-stump.png",      seats: 1, width: 92, seatRatio: 0.45 },
  "rock":       { file: "bench-rock.png",       seats: 1, width: 100, seatRatio: 0.5 },
};

// hand-laid layout: [type, centerX, centerY, animalHeight]
// top bank (far side, smaller animals), sides (stumps), bottom (near, larger)
const LAYOUT = [
  // --- top bank: a row of logs like the reference ---
  ["log-medium", 700, 262, 76],
  ["log-long", 1310, 244, 76],
  ["stump", 1720, 276, 76],
  ["log-long", 2230, 252, 76],
  ["stump-wide", 2700, 268, 76],
  ["log-medium", 3120, 240, 76],
  ["log-short", 3480, 272, 76],
  // --- left bank: stumps + short logs down the slope ---
  ["stump", 170, 560, 80],
  ["log-short", 200, 812, 80],
  ["stump-wide", 165, 1052, 82],
  ["stump", 190, 1322, 82],
  ["log-short", 210, 1548, 84],
  // --- right bank ---
  ["stump-wide", 3920, 572, 80],
  ["stump", 3900, 790, 80],
  ["log-short", 3890, 1072, 82],
  ["stump", 3915, 1300, 82],
  ["rock", 3900, 1574, 84],
  // --- bottom bank: near side, larger ---
  ["log-medium", 800, 1862, 92],
  ["stump", 1240, 1890, 92],
  ["log-long", 1830, 1884, 92],
  ["stump-wide", 2330, 1872, 94],
  ["log-medium", 2820, 1894, 94],
  ["log-short", 3300, 1878, 94],
];

// 16 = foam-paw mouse: the giant blue paw reads as a random blob at crowd
// scale — bench crowds skip it
const animalFiles = readdirSync(spriteDir).filter((f) => /^\d+\.png$/.test(f) && f !== "16.png");
if (!animalFiles.length) {
  console.error("no crowd sprites in", spriteDir);
  process.exit(1);
}
const animals = [];
for (const f of animalFiles) {
  const img = sharp(join(spriteDir, f));
  const meta = await img.metadata();
  animals.push({ buf: await img.png().toBuffer(), w: meta.width, h: meta.height });
}

const propCache = {};
async function propSprite(type, width) {
  const p = PROPS[type];
  const key = type + width;
  if (!propCache[key]) {
    const img = sharp(join(spriteDir, p.file));
    const meta = await img.metadata();
    const h = Math.round((meta.height / meta.width) * width);
    propCache[key] = { buf: await img.resize(width, h).png().toBuffer(), w: width, h };
  }
  return propCache[key];
}

const layers = [];
let seated = 0;
for (const [type, cx, cy, animalH] of LAYOUT) {
  const p = PROPS[type];
  const prop = await propSprite(type, p.width);
  layers.push({ input: prop.buf, left: Math.round(cx - prop.w / 2), top: Math.round(cy - prop.h / 2) });

  // seat 1..capacity animals (long benches usually fairly full, some gaps)
  const n = Math.max(1, p.seats - (rnd() < 0.4 ? 1 : 0) - (p.seats > 3 && rnd() < 0.3 ? 1 : 0));
  // bottoms land seatRatio down the prop height; seats stay off the log ends
  const span = prop.w * 0.58;
  const seatY = cy - prop.h / 2 + prop.h * p.seatRatio;
  for (let s = 0; s < n; s++) {
    const a = animals[Math.floor(rnd() * animals.length)];
    const hgt = Math.round(animalH * (0.94 + rnd() * 0.12));
    const wdt = Math.max(1, Math.round((a.w / a.h) * hgt));
    let img = sharp(a.buf).resize(wdt, hgt);
    if (rnd() < 0.5) img = img.flop();
    const buf = await img.png().toBuffer();
    const sx = n === 1 ? cx : cx - span / 2 + (span * s) / (n - 1);
    layers.push({
      input: buf,
      left: Math.round(sx - wdt / 2 + (rnd() - 0.5) * 10),
      top: Math.round(seatY - hgt + (rnd() - 0.5) * 6),
    });
    seated++;
  }
}
console.log(`${LAYOUT.length} props, ${seated} animals seated`);

await sharp(standsSrc)
  .resize(W, H, { fit: "fill" })
  .composite(layers)
  .png()
  .toFile(out);
console.log("stands with crowd:", out);
