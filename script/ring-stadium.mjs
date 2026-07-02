#!/usr/bin/env node
/**
 * Ring stadium v2 — geometry is OURS, AI only paints.
 *
 *  1. deterministic GUIDE: real pitch pixels + 80px flat margin, three WIDE
 *     terrace treads (110px) drawn as exact color bands with 14px step edges,
 *     tan mat blocks on tread centers only (2 rows per tread, 30px+ from any
 *     edge), a brown placeholder for the ANIMAL CUP wooden sign
 *  2. ONE gpt-image-2 beautify pass (style only, geometry locked by prompt)
 *  3. ONE erase pass (remove tan blocks)
 *  4. deterministic assembly: painted bg + real pitch pixels + original white
 *     lines + crisp mat sprites at the exact guide coordinates
 *  5. stadium.json seats = the same coordinates (live fans fill the ring)
 *
 *   node script/ring-stadium.mjs            # full run
 *   node script/ring-stadium.mjs --assemble # skip AI passes, reuse /tmp pngs
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
const ASSETS = join(home, "Downloads/球场素材");
const SRC = join(home, "Downloads/球场备份/过程/step0-原始.png");
const W = 4096, H = 2048;

// ---------- geometry ----------
const SP = 34, DP = 26;                 // measured original seat / row pitch
const M0 = 80, TW = 110, SE = 14;       // flat margin, tread width, step edge
const TREADS = 3, R0 = 150, MARGIN = 14;
const Pv = [[515, 486], [3578, 486], [3742, 1801], [351, 1801]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], add = (a, b) => [a[0] + b[0], a[1] + b[1]], mul = (a, s) => [a[0] * s, a[1] * s];
const norm = (a) => { const l = Math.hypot(a[0], a[1]); return [a[0] / l, a[1] / l]; };
const edges = []; const c0 = [2046, 1143];
for (let i = 0; i < 4; i++) {
  const A = Pv[i], B = Pv[(i + 1) % 4], d = norm(sub(B, A));
  let n = [d[1], -d[0]]; const mid = mul(add(A, B), 0.5);
  if ((mid[0] + n[0] * 10 - c0[0]) ** 2 + (mid[1] + n[1] * 10 - c0[1]) ** 2 < (mid[0] - c0[0]) ** 2 + (mid[1] - c0[1]) ** 2) n = mul(n, -1);
  edges.push({ A, B, d, n });
}
function li(p1, d1, p2, d2) { const den = d1[0] * d2[1] - d1[1] * d2[0]; const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den; return add(p1, mul(d1, t)); }
const corners = [];
for (let i = 0; i < 4; i++) {
  const e1 = edges[i], e2 = edges[(i + 1) % 4];
  corners.push({ O: li(add(e1.A, mul(e1.n, -R0)), e1.d, add(e2.A, mul(e2.n, -R0)), e2.d), n1: e1.n, n2: e2.n });
}
function ringDist(x, y) {
  for (const c of corners) {
    const dx = x - c.O[0], dy = y - c.O[1];
    let a = Math.atan2(dy, dx), a1 = Math.atan2(c.n1[1], c.n1[0]), a2 = Math.atan2(c.n2[1], c.n2[0]);
    while (a2 < a1) a2 += Math.PI * 2; while (a < a1) a += Math.PI * 2;
    if (a <= a2) return Math.hypot(dx, dy) - R0;
  }
  let best = -1e9;
  for (const e of edges) {
    const t = (x - e.A[0]) * e.d[0] + (y - e.A[1]) * e.d[1];
    const proj = [e.A[0] + e.d[0] * t, e.A[1] + e.d[1] * t];
    const s = (x - proj[0]) * e.n[0] + (y - proj[1]) * e.n[1];
    if (s > best) best = s;
  }
  return best;
}
const treadIn = (g) => M0 + g * (TW + SE);
// seat rows: 2 per tread, centered (±DP/2), 30px+ from both tread edges
const rowsD = [];
for (let g = 0; g < TREADS; g++) { const c = treadIn(g) + TW / 2; rowsD.push(c - DP / 2, c + DP / 2); }
function ringPath(d, phase) {
  const pts = [];
  for (let i = 0; i < 4; i++) {
    const e = edges[i], cP = corners[(i + 3) % 4], cN = corners[i];
    const P1 = add(cP.O, mul(e.n, R0 + d)), P2 = add(cN.O, mul(e.n, R0 + d));
    const len = Math.hypot(...sub(P2, P1));
    for (let s = phase; s <= len; s += SP) pts.push(add(P1, mul(e.d, s)));
    const a1 = Math.atan2(e.n[1], e.n[0]); const e2 = edges[(i + 1) % 4];
    let a2 = Math.atan2(e2.n[1], e2.n[0]); while (a2 < a1) a2 += Math.PI * 2;
    const r = R0 + d, st = SP / r;
    for (let a = a1 + st * 0.6; a < a2; a += st) pts.push(add(cN.O, [Math.cos(a) * r, Math.sin(a) * r]));
  }
  return pts;
}
const seats = [];
rowsD.forEach((d, k) => { for (const p of ringPath(d, (k % 2) * (SP / 2))) seats.push([Math.round(p[0]), Math.round(p[1])]); });
const ring = seats.filter(([x, y]) => x >= MARGIN && x < W - MARGIN && y >= MARGIN && y < H - MARGIN - 8);
writeFileSync(join(ASSETS, "ring-seats.json"), JSON.stringify(ring));
console.log(`座位 ${ring.length} (${TREADS} 级 × 2 行, 席距 ${SP})`);

// ---------- guide (deterministic) ----------
const { data: src, info: si } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const C = si.channels;
const pitchLR = (y) => { const t = (y - 486) / (1801 - 486); return [515 + (351 - 515) * t, 3578 + (3742 - 3578) * t]; };
const inPitch = (x, y) => { if (y < 486 || y > 1801) return false; const [L, R] = pitchLR(y); return x >= L && x <= R; };
const guide = Buffer.alloc(W * H * 3);
const TREAD_COL = [[140, 190, 90], [128, 182, 84]];       // alternating treads
const EDGE_COL = [96, 142, 60];                            // step edge
const MARGIN_COL = [150, 198, 100];                        // flat run-off
const MEADOW_COL = [120, 176, 88];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * 3;
  if (inPitch(x, y)) { const k = (y * W + x) * C; guide[i] = src[k]; guide[i + 1] = src[k + 1]; guide[i + 2] = src[k + 2]; continue; }
  const d = ringDist(x, y);
  let col = MEADOW_COL;
  if (d < M0) col = MARGIN_COL;
  else { for (let g = 0; g < TREADS; g++) { const a = treadIn(g); if (d >= a && d < a + TW) { col = TREAD_COL[g % 2]; break; } if (d >= a + TW && d < a + TW + SE) { col = EDGE_COL; break; } } }
  guide[i] = col[0]; guide[i + 1] = col[1]; guide[i + 2] = col[2];
}
let gpng = await sharp(guide, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
// mat blocks + sign placeholder
const blk = await sharp({ create: { width: 24, height: 16, channels: 4, background: { r: 205, g: 162, b: 90, alpha: 1 } } }).png().toBuffer();
const signPh = await sharp({ create: { width: 360, height: 110, channels: 4, background: { r: 145, g: 96, b: 52, alpha: 1 } } }).png().toBuffer();
const gov = ring.map(([x, y]) => ({ input: blk, left: Math.max(0, x - 12), top: Math.max(0, y - 12) }));
gov.push({ input: signPh, left: 1868, top: 18 });
for (let i = 0; i < gov.length; i += 500) gpng = await sharp(gpng).composite(gov.slice(i, i + 500)).png().toBuffer();
writeFileSync("/tmp/rg_guide.png", gpng);
console.log("guide ok");

// ---------- AI passes ----------
async function gi2(input, prompt) {
  for (let a = 1; a <= 4; a++) {
    try {
      const form = new FormData();
      form.append("model", "gpt-image-2"); form.append("prompt", prompt);
      form.append("size", "1536x1024"); form.append("quality", "high");
      form.append("image", new Blob([input], { type: "image/png" }), "in.png");
      const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 420000);
      const r = await fetch("https://aigw-api.betteryeah.com/openai/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${KEY}` }, body: form, signal: ac.signal });
      clearTimeout(tm);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return Buffer.from((await r.json()).data[0].b64_json, "base64");
    } catch (e) { console.log("att", a, String(e).slice(0, 90)); if (a < 4) await new Promise((r) => setTimeout(r, a * 5000)); else throw e; }
  }
}
if (!process.argv.includes("--assemble")) {
  const g1 = await sharp("/tmp/rg_guide.png").resize(1536, 1024, { fit: "fill" }).png().toBuffer();
  process.stdout.write("pass1 美化 ... ");
  const p1 = await gi2(g1,
    "Paint this stadium layout in a warm hand-painted storybook style WITHOUT changing its geometry at all: the green color bands around the pitch are three wide flat grass terrace treads separated by thin darker step edges — paint them as soft grassy terraces keeping each band's exact position and width; the small tan blocks are woven straw seat mats — keep every block exactly in place; the flat strip right around the pitch stays smooth plain grass; the area outside the terraces becomes grass meadow with small wildflowers; the brown rectangle at the top center is a cute wooden sign on posts that reads \"ANIMAL CUP\" in playful rounded letters; keep the central football pitch with its lines exactly as it is. Soft cel shading, one consistent style. No people, no animals, no other text.");
  writeFileSync("/tmp/rg_p1.png", p1); console.log("ok");
  process.stdout.write("pass2 擦席 ... ");
  const p2 = await gi2(await sharp(p1).resize(1536, 1024, { fit: "fill" }).png().toBuffer(),
    "Remove ALL the small tan straw mats from this image and fill their places with the flat grass terrace they sit on. Keep the terraces, step edges, the wooden ANIMAL CUP sign, the meadow and the central pitch EXACTLY as they are. Change nothing else.");
  writeFileSync("/tmp/rg_p2.png", p2); console.log("ok");
}

// ---------- assembly ----------
const { data: up } = await sharp("/tmp/rg_p2.png").resize(W, H, { fit: "fill", kernel: "lanczos3" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
// real pitch pixels back (geometry insurance), then lines are already in them
for (let y = 486; y <= 1801; y++) {
  const [L, R] = pitchLR(y);
  for (let x = Math.round(L); x <= Math.round(R); x++) {
    const i = (y * W + x) * 3, k = (y * W + x) * C;
    up[i] = src[k]; up[i + 1] = src[k + 1]; up[i + 2] = src[k + 2];
  }
}
const MW = 22, MH = 15;
const matPng = await sharp(join(ASSETS, "mat.png")).resize(MW, MH, { fit: "fill" }).png().toBuffer();
let img = await sharp(up, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
const ov = ring.map(([x, y]) => ({ input: matPng, left: Math.max(0, x - (MW >> 1)), top: Math.max(0, y - MH + 4) }));
for (let i = 0; i < ov.length; i += 500) img = await sharp(img).composite(ov.slice(i, i + 500)).png().toBuffer();
writeFileSync(join(home, "Downloads/新球场.png"), img);
writeFileSync(join(home, "Downloads/球场备份/过程/step17-环形v2.png"), img);
await sharp(img).resize(1200).png().toFile("/tmp/rg_full.png");
await sharp(img).extract({ left: 1500, top: 0, width: 1100, height: 560 }).resize(900).png().toFile("/tmp/rg_sign.png");
await sharp(img).extract({ left: 0, top: 600, width: 700, height: 900 }).resize(560).png().toFile("/tmp/rg_left.png");

// ---------- engine ----------
const ST = join(root, "match-runtime-assets-source/data/stadiums/international/stadium.json");
const sj = JSON.parse(readFileSync(ST, "utf8"));
sj.fans.seats = ring.map(([x, y]) => [x, y, 0]);
sj.fans.mask = "fansmask.png";
writeFileSync(ST, JSON.stringify(sj));
await sharp(img).jpeg({ quality: 95 }).toFile(join(root, "match-runtime-assets-source/data/stadiums/international/stadium.jpg"));
console.log(`✅ 完成: 座位 ${ring.length}, 纹理+seats 已装入`);
