#!/usr/bin/env node
/**
 * Grassland stadium rebuild (deterministic, layered) for Animal World Cup.
 *
 * Layers, all placed by computation — no whole-image AI, so nothing drifts:
 *   1. cute grass texture tiled over the full 4096x2048 canvas
 *   2. the pitch (trapezoid) + top band copied back pixel-exact
 *   3. original stairs/aisles recolored to dirt paths (luma kept) for depth
 *   4. one mat sprite per REAL seat: connected components of the blue seat
 *      mask, PCA per component for row angle, grid in the rotated frame,
 *      mats rotated to the row angle, placed only where seat pixels exist
 *   5. decorations: corner trees + bunting + bushes, scattered flowers,
 *      bottom picnic rows (new "spectator" area)
 *
 * Usage:  node script/grassland-build.mjs [--variant mat|cushion|blanket]
 * Input:  ~/Downloads/球场备份/过程/step0-原始.png  (blue-seat truth)
 *         ~/Downloads/球场素材/*.png                 (sprites)
 * Output: ~/Downloads/新球场.png + 球场备份/过程/step3-草原v3.png + /tmp previews
 */
import { existsSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const sharp = (await import("sharp")).default;
const home = homedir();
const SRC = join(home, "Downloads/球场备份/过程/step0-原始.png");
const ASSETS = join(home, "Downloads/球场素材");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const VARIANT = arg("--variant", "mat");
const OUTNAME = arg("--out", join(home, "Downloads/新球场.png"));
const W = 4096, H = 2048;
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

// ---------- source + masks ----------
const { data: src, info: si } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const SC = si.channels;
const pitchLR = (y) => { const t = (y - 486) / (1801 - 486); return [515 + (351 - 515) * t, 3578 + (3742 - 3578) * t]; };
const inBand = (x, y) => y >= 428 && y < 470 && x >= 562 && x < 3534;
const inPitch = (x, y) => { if (y < 480 || y > 1814) return false; const [L, R] = pitchLR(Math.min(y, 1801)); return x >= L - 2 && x <= R + 2; };
const isSeat = (p) => src[p * SC + 2] > src[p * SC] + 22 && src[p * SC + 2] > src[p * SC + 1] + 16 && src[p * SC + 2] > 85;

// ---------- canvas: painted background (--bg) OR grass + pitch + band ----------
const BG = arg("--bg", "");
let cv, C;
if (BG && existsSync(BG)) {
  const r = await sharp(BG).resize(W, H, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  cv = Buffer.from(r.data); C = r.info.channels;
  console.log("background:", BG);
} else {
  const grassTile = await sharp(join(ASSETS, "grass.png")).resize(512, 512).png().toBuffer();
  const r = await sharp({ create: { width: W, height: H, channels: 3, background: "#7cb342" } })
    .composite([{ input: grassTile, tile: true }]).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  cv = Buffer.from(r.data); C = r.info.channels;
  for (let y = 486; y <= 1814; y++) { const [L, R] = pitchLR(Math.min(y, 1801)); for (let x = Math.round(L) + 4; x <= Math.round(R) - 4; x++) { const i = y * W + x; cv[i * C] = src[i * SC]; cv[i * C + 1] = src[i * SC + 1]; cv[i * C + 2] = src[i * SC + 2]; } }
  for (let y = 428; y < 470; y++) for (let x = 562; x < 3534; x++) { const i = y * W + x; cv[i * C] = src[i * SC]; cv[i * C + 1] = src[i * SC + 1]; cv[i * C + 2] = src[i * SC + 2]; }
}

// ---------- seat components (BFS) ----------
const lbl = new Int32Array(W * H).fill(-1);
const comps = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const p = y * W + x;
  if (lbl[p] !== -1) continue;
  if (inBand(x, y) || inPitch(x, y) || !isSeat(p)) { lbl[p] = -2; continue; }
  const id = comps.length, st = [p]; lbl[p] = id;
  let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, x0 = x, x1 = x, y0 = y, y1 = y;
  while (st.length) {
    const q = st.pop(); const qx = q % W, qy = (q / W) | 0;
    n++; sx += qx; sy += qy; sxx += qx * qx; syy += qy * qy; sxy += qx * qy;
    if (qx < x0) x0 = qx; if (qx > x1) x1 = qx; if (qy < y0) y0 = qy; if (qy > y1) y1 = qy;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = qx + dx, ny = qy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const np = ny * W + nx;
      if (lbl[np] !== -1) continue;
      if (inBand(nx, ny) || inPitch(nx, ny) || !isSeat(np)) { lbl[np] = -2; continue; }
      lbl[np] = id; st.push(np);
    }
  }
  comps.push({ id, n, sx, sy, sxx, syy, sxy, x0, x1, y0, y1 });
}
const clean = comps.filter((c) => c.n >= 14 && c.x1 - c.x0 + 1 <= 46 && c.y1 - c.y0 + 1 <= 40 && c.x1 - c.x0 + 1 >= 5);
const med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
const medW = clean.length ? med(clean.map((c) => c.x1 - c.x0 + 1)) : 15;
const medH = clean.length ? med(clean.map((c) => c.y1 - c.y0 + 1)) : 11;
console.log(`comps ${comps.length}, clean ${clean.length}, seat ~${medW}x${medH}`);

// ---------- stand region (for dirt paths) ----------
const standMask = new Uint8Array(W * H);
for (const c of comps) {
  if (c.n < 60) continue;
  const m = 38;
  for (let y = Math.max(0, c.y0 - m); y <= Math.min(H - 1, c.y1 + m); y++)
    for (let x = Math.max(0, c.x0 - m); x <= Math.min(W - 1, c.x1 + m); x++) standMask[y * W + x] = 1;
}
// dirt paths ONLY between blocks (aisles/stairs); the interior of a seat
// block stays grass so all stands read the same (grass + mats, dirt aisles)
const blockMask = new Uint8Array(W * H);
for (const c of comps) {
  if (c.n < 60) continue;
  for (let y = Math.max(0, c.y0 - 2); y <= Math.min(H - 1, c.y1 + 2); y++)
    for (let x = Math.max(0, c.x0 - 2); x <= Math.min(W - 1, c.x1 + 2); x++) blockMask[y * W + x] = 1;
}
if (!BG) {
  let dirt = 0;
  for (let p = 0; p < W * H; p++) {
    if (!standMask[p] || blockMask[p]) continue;
    const x = p % W, y = (p / W) | 0;
    if (inBand(x, y) || inPitch(x, y) || lbl[p] >= 0) continue;
    const r = src[p * SC], g = src[p * SC + 1], b = src[p * SC + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx - mn < 30 && mn > 60) {           // grey concrete / stairs -> dirt path
      const L = 0.299 * r + 0.587 * g + 0.114 * b, f = L / 165;
      cv[p * C] = clamp(192 * f); cv[p * C + 1] = clamp(158 * f); cv[p * C + 2] = clamp(110 * f); dirt++;
    }
  }
  console.log(`dirt path px ${dirt}`);
}

// ---------- per-component rotated grid of mats, pitch MEASURED per block ----------
// For each block we scan along its own axes and measure the real seat run
// lengths and start-to-start periods, so every section (straight or angled)
// reproduces its own seat grid instead of a global guess.
const seats = [];
const medOf = (a, d) => (a.length ? a.sort((x, y) => x - y)[a.length >> 1] : d);
function scanRuns(c, cx, cy, ax, ay, ox, oy, aMin, aMax, oMin, oMax) {
  const periods = [], runs = [];
  for (let k = 0; k < 7; k++) {
    const off = oMin + ((k + 0.5) / 7) * (oMax - oMin);
    let inRun = false, start = 0, lastStart = null;
    for (let t = aMin; t <= aMax; t += 1) {
      const x = Math.round(cx + t * ax + off * ox), y = Math.round(cy + t * ay + off * oy);
      const hit = x >= 0 && y >= 0 && x < W && y < H && lbl[y * W + x] === c.id;
      if (hit && !inRun) { inRun = true; start = t; if (lastStart !== null) periods.push(start - lastStart); lastStart = start; }
      else if (!hit && inRun) { inRun = false; runs.push(t - start); }
    }
    if (inRun) runs.push(aMax - start);
  }
  return { period: medOf(periods, 0), run: medOf(runs, 0) };
}
for (const c of comps) {
  if (c.n < 14) continue;
  const cx = c.sx / c.n, cy = c.sy / c.n;
  const vxx = c.sxx / c.n - cx * cx, vyy = c.syy / c.n - cy * cy, vxy = c.sxy / c.n - cx * cy;
  let th = 0.5 * Math.atan2(2 * vxy, vxx - vyy);
  if (Math.abs(th) < 0.05) th = 0;                     // straight sections stay straight
  const ux = Math.cos(th), uy = Math.sin(th), vx = -uy, vy = ux;
  let uMin = 1e9, uMax = -1e9, vMin = 1e9, vMax = -1e9;
  for (let y = c.y0; y <= c.y1; y += 1) for (let x = c.x0; x <= c.x1; x += 1) {
    if (lbl[y * W + x] !== c.id) continue;
    const du = (x - cx) * ux + (y - cy) * uy, dv = (x - cx) * vx + (y - cy) * vy;
    if (du < uMin) uMin = du; if (du > uMax) uMax = du; if (dv < vMin) vMin = dv; if (dv > vMax) vMax = dv;
  }
  const uExt = uMax - uMin, vExt = vMax - vMin;
  const u = scanRuns(c, cx, cy, ux, uy, vx, vy, uMin, uMax, vMin, vMax);   // along rows
  const v = scanRuns(c, cx, cy, vx, vy, ux, uy, vMin, vMax, uMin, uMax);   // across rows
  const pu = u.period >= 8 ? u.period : Math.max(10, u.run * 1.4 || medW * 1.4);
  const pv = v.period >= 7 ? v.period : Math.max(9, v.run * 1.4 || medH * 1.4);
  const mw = Math.min(40, Math.max(7, Math.round(u.run || medW)));
  const mh = Math.min(36, Math.max(6, Math.round(v.run || medH)));
  const nU = Math.max(1, Math.round(uExt / pu)), nV = Math.max(1, Math.round(vExt / pv));
  for (let j = 0; j < nV; j++) for (let i = 0; i < nU; i++) {
    const du = uMin + ((i + 0.5) / nU) * uExt, dv = vMin + ((j + 0.5) / nV) * vExt;
    const x = Math.round(cx + du * ux + dv * vx), y = Math.round(cy + du * uy + dv * vy);
    let hit = 0;
    for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) { const q = (y + yy) * W + (x + xx); if (q >= 0 && q < W * H && lbl[q] >= 0) hit++; }
    if (hit < 3) continue;
    seats.push({ x, y, th, w: mw, h: mh });
  }
}
console.log(`mat positions ${seats.length}`);

// ---------- overlays ----------
const SPRITE = { mat: "mat.png", cushion: "cushion.png", blanket: "blanket.png" }[VARIANT] || "mat.png";
const matSrc = join(ASSETS, SPRITE);
const MW = 16, MH = 12;          // bottom picnic rows use a typical seat size
const bucket = new Map();
async function spriteAt(w, h, deg, hue) {
  const k = `${w}x${h}r${deg}h${hue}`;
  if (!bucket.has(k)) {
    let s = sharp(matSrc).resize(Math.max(5, w), Math.max(5, h), { fit: "fill" });
    if (hue) s = s.modulate({ hue });
    if (deg) s = s.rotate(deg, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
    bucket.set(k, await s.png().toBuffer());
  }
  return bucket.get(k);
}
const overlays = [];
const HUES = VARIANT === "cushion" ? [0, 105, 215, 285] : VARIANT === "blanket" ? [0, 140] : [0];
let hi = 0;
for (const s of seats) {
  const deg = Math.abs(s.th) > 0.035 ? Math.round((s.th * 180) / Math.PI / 3) * 3 : 0;
  const hue = HUES[hi++ % HUES.length];
  const buf = await spriteAt(s.w, s.h, deg, hue);
  const m = await sharp(buf).metadata();
  overlays.push({ input: buf, left: Math.max(0, s.x - (m.width >> 1)), top: Math.max(0, s.y - (m.height >> 1)) });
}
// bottom picnic rows (optional; owner later asked for a clean bottom)
if (!process.argv.includes("--no-bottom")) {
  for (let row = 0; row < 3; row++) {
    const y = 1866 + row * Math.round(MH * 4.6);
    for (let x = 640 + (row % 2 ? Math.round(MW * 1.1) : 0); x < 3440; x += Math.round(MW * 2.2)) {
      const buf = await spriteAt(MW, MH, 0, HUES[hi++ % HUES.length]);
      overlays.push({ input: buf, left: x, top: y });
    }
  }
}
// decorations (sprites optional — skip any that failed to generate)
async function deco(name, w, x, y, opts = {}) {
  const f = join(ASSETS, name + ".png");
  if (!existsSync(f)) return;
  let s = sharp(f).resize(w, null);
  if (opts.flip) s = s.flop();
  const b = await s.png().toBuffer();
  overlays.push({ input: b, left: x, top: y });
}
if (process.argv.includes("--no-deco")) {
  // background already decorated (painted master) — skip sprite decorations
} else {
await deco("tree", 300, 100, 30);
await deco("tree", 300, 3700, 30, { flip: true });
await deco("flags", 430, 70, 300);
await deco("flags", 430, 3600, 300, { flip: true });
await deco("bush", 95, 420, 250); await deco("bush", 80, 360, 330);
await deco("bush", 95, 3580, 250, { flip: true }); await deco("bush", 80, 3650, 330, { flip: true });
const FLOWER_SPOTS = [[180, 520], [80, 760], [210, 1040], [70, 1380], [180, 1700], [3880, 540], [3990, 800], [3860, 1100], [3990, 1420], [3880, 1740], [700, 1990], [1500, 2000], [2400, 1995], [3200, 1990], [480, 70], [2050, 18], [3620, 60]];
if (process.argv.includes("--flowers-dense")) {
  for (let i = 0; i < 34; i++) {                      // deterministic scatter on outer grass
    const x = (i * 733 + 211) % 4000, y = (i * 521 + 97) % 2000;
    if (x > 470 && x < 3620 && y > 380 && y < 1880) continue;   // keep off stands/pitch middle
    FLOWER_SPOTS.push([x, y]);
  }
}
for (let i = 0; i < FLOWER_SPOTS.length; i++) await deco("flower", 64 + (i % 3) * 10, FLOWER_SPOTS[i][0], FLOWER_SPOTS[i][1]);
}

console.log(`overlays ${overlays.length}`);
let cur = sharp(cv, { raw: { width: W, height: H, channels: C } }).png();
let curBuf = await cur.toBuffer();
for (let i = 0; i < overlays.length; i += 500) curBuf = await sharp(curBuf).composite(overlays.slice(i, i + 500)).png().toBuffer();
const TONE = arg("--tone", "");
if (TONE === "warm") curBuf = await sharp(curBuf).linear([1.07, 1.0, 0.9], [6, 1, -6]).modulate({ saturation: 1.05 }).png().toBuffer();
if (TONE === "dusk") curBuf = await sharp(curBuf).linear([1.04, 0.94, 1.04], [10, -2, 14]).modulate({ saturation: 0.95 }).png().toBuffer();
writeFileSync(OUTNAME, curBuf);
writeFileSync(join(home, "Downloads/球场备份/过程", `step3-草原v3-${VARIANT}.png`), curBuf);
await sharp(curBuf).resize(1200).png().toFile("/tmp/v3_full.png");
await sharp(curBuf).extract({ left: 1100, top: 0, width: 1100, height: 560 }).resize(1300).png().toFile("/tmp/v3_top.png");
await sharp(curBuf).extract({ left: 0, top: 500, width: 760, height: 1100 }).resize(620).png().toFile("/tmp/v3_wing.png");
await sharp(SRC).extract({ left: 0, top: 500, width: 760, height: 1100 }).resize(620).png().toFile("/tmp/v3_wing_orig.png");
await sharp(curBuf).extract({ left: 0, top: 0, width: 700, height: 560 }).resize(700).png().toFile("/tmp/v3_corner.png");
await sharp(curBuf).extract({ left: 1200, top: 1760, width: 1500, height: 288 }).resize(1400).png().toFile("/tmp/v3_bottom.png");
console.log(`✅ ${VARIANT} -> ${OUTNAME}`);
