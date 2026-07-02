#!/usr/bin/env node
/**
 * Final stadium composition: painted grassland background + terrace steps and
 * straw mats placed at the REAL engine fan coordinates (extracted live from
 * the fans container — 1848 sprites, already in texture space). Every animal
 * sits on its own mat, terrace step strips merge per row into stair bands, so
 * crowd / mats / terrain always line up.
 *
 *   node script/fan-mats.mjs --bg <painted-bg.png> [--out file]
 */
import { readFileSync, existsSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const sharp = (await import("sharp")).default;
const home = homedir();
const ASSETS = join(home, "Downloads/球场素材");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const BG = arg("--bg", join(home, "Downloads/球场备份/过程/step10-无广告坡.png"));
const OUT = arg("--out", join(home, "Downloads/新球场.png"));
const W = 4096, H = 2048;

const fans = JSON.parse(readFileSync(join(ASSETS, "fans-raw.json"), "utf8")).pts;
console.log(`fans ${fans.length}`);

const base = await sharp(BG).resize(W, H, { fit: "fill" }).png().toBuffer();

// terrace step strip: soft translucent green band with a darker bottom lip;
// adjacent fans' strips overlap into continuous stair rows
const SW = 46, SH = 20;
const strip = Buffer.alloc(SW * SH * 4);
for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
  const i = (y * SW + x) * 4;
  const edge = Math.min(x, SW - 1 - x);
  const fade = edge < 6 ? edge / 6 : 1;                       // soften strip ends
  if (y < SH - 6) { strip[i] = 96; strip[i + 1] = 148; strip[i + 2] = 64; strip[i + 3] = Math.round(70 * fade); }
  else { const t = (y - (SH - 6)) / 6; strip[i] = 58; strip[i + 1] = 96; strip[i + 2] = 40; strip[i + 3] = Math.round((110 - 60 * t) * fade); }
}
const stripPng = await sharp(strip, { raw: { width: SW, height: SH, channels: 4 } }).png().toBuffer();

const MW = 22, MH = 15;
const matPng = await sharp(join(ASSETS, "mat.png")).resize(MW, MH, { fit: "fill" }).png().toBuffer();

const overlays = [];
for (const f of fans) {  // strips first (under everything)
  const x = Math.round(f.x), y = Math.round(f.y);
  if (x < 4 || x > W - 4 || y < 4 || y > H - 4) continue;
  overlays.push({ input: stripPng, left: Math.max(0, x - SW / 2), top: Math.max(0, y - SH + 6) });
}
for (const f of fans) {  // mats on top, centered under the animal's feet
  const x = Math.round(f.x), y = Math.round(f.y);
  if (x < 4 || x > W - 4 || y < 4 || y > H - 4) continue;
  overlays.push({ input: matPng, left: Math.max(0, x - (MW >> 1)), top: Math.max(0, y - MH + 4) });
}
// decorations: trees + bunting + bushes at the corners, flowers along edges
async function deco(name, w, x, y, flip = false) {
  const f = join(ASSETS, name + ".png");
  if (!existsSync(f)) return;
  let s = sharp(f).resize(w, null);
  if (flip) s = s.flop();
  overlays.push({ input: await s.png().toBuffer(), left: x, top: y });
}
await deco("tree", 280, 110, 30);
await deco("tree", 280, 3710, 30, true);
await deco("flags", 400, 90, 290);
await deco("flags", 400, 3610, 290, true);
await deco("bush", 90, 430, 250); await deco("bush", 76, 370, 330);
await deco("bush", 90, 3590, 250, true); await deco("bush", 76, 3660, 330, true);
await deco("bush", 84, 200, 1900); await deco("bush", 84, 3820, 1900, true);
const FLOWERS = [[480, 70], [2050, 16], [3620, 60], [700, 1985], [1500, 2000], [2400, 1992], [3200, 1988], [90, 1750], [3970, 1750]];
for (let i = 0; i < FLOWERS.length; i++) await deco("flower", 60 + (i % 3) * 10, FLOWERS[i][0], FLOWERS[i][1]);

console.log(`overlays ${overlays.length}`);
let cur = base;
for (let i = 0; i < overlays.length; i += 500) cur = await sharp(cur).composite(overlays.slice(i, i + 500)).png().toBuffer();
writeFileSync(OUT, cur);
await sharp(cur).resize(1200).png().toFile("/tmp/fm_full.png");
await sharp(cur).extract({ left: 60, top: 700, width: 600, height: 800 }).png().toFile("/tmp/fm_wing.png");
await sharp(cur).extract({ left: 1300, top: 20, width: 900, height: 460 }).png().toFile("/tmp/fm_top.png");
console.log(`✅ -> ${OUT}`);
