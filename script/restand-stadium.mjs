#!/usr/bin/env node
/**
 * Stand pass: pixel-edit the stadium stands for Animal Cup.
 *
 *   1. Recolor the saturated ORANGE seats -> a cool slate ramp. The animal
 *      crowd is baked over the seats at runtime in warm team colors; a cool
 *      seat backdrop makes those warm fans POP so the crowd reads clearly
 *      (owner: 清晰、热闹 / "看台调色+动物观众").
 *   2. Remove the perimeter advertising hoarding (blue | yellow+emblem |
 *      green | dark | red) and replace it with a clean dark perimeter wall.
 *      Also drops the IP-risk national crest baked into the yellow segment.
 *
 * The pitch trapezoid + grass run-off + white lines are NEVER touched
 * (锁边锁线) — orange/ad colours simply do not occur inside the field, and
 * the trapezoid is masked out as a belt-and-suspenders guard.
 *
 *   node script/restand-stadium.mjs <inJpg> <outJpg>
 */
const [inp, out] = process.argv.slice(2);
if (!inp || !out) {
  console.error("usage: node script/restand-stadium.mjs <in> <out>");
  process.exit(1);
}
const sharp = (await import("sharp")).default;

const A = await sharp(inp).raw().toBuffer({ resolveWithObject: true });
const W = A.info.width, H = A.info.height, C = A.info.channels;
const b = A.data;
const idx = (x, y) => (y * W + x) * C;

// PITCH TRAPEZOID — same geometry as line-lock-stadium.mjs (perspective texture)
const SX = W / 4096, SY = H / 2048;
const PT = { yT: 612 * SY, yB: 1668 * SY,
             xTL: 782 * SX, xTR: 3313 * SX, xBL: 649 * SX, xBR: 3446 * SX };
const leftEdge = (y) => PT.xTL + (PT.xBL - PT.xTL) * (y - PT.yT) / (PT.yB - PT.yT);
const rightEdge = (y) => PT.xTR + (PT.xBR - PT.xTR) * (y - PT.yT) / (PT.yB - PT.yT);
const inPitch = (x, y, m) =>
  y >= PT.yT - m && y <= PT.yB + m && x >= leftEdge(y) - m && x <= rightEdge(y) + m;

// separable box dilation (from line-lock-stadium.mjs)
function dilate(mask, radius) {
  const tmp = new Uint8Array(W * H), outM = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    let run = -1e9;
    for (let x = 0; x < W; x++) { if (mask[y * W + x]) run = x; tmp[y * W + x] = x - run <= radius ? 1 : 0; }
    run = 1e9;
    for (let x = W - 1; x >= 0; x--) { if (mask[y * W + x]) run = x; if (run - x <= radius) tmp[y * W + x] = 1; }
  }
  for (let x = 0; x < W; x++) {
    let run = -1e9;
    for (let y = 0; y < H; y++) { if (tmp[y * W + x]) run = y; outM[y * W + x] = y - run <= radius ? 1 : 0; }
    run = 1e9;
    for (let y = H - 1; y >= 0; y--) { if (tmp[y * W + x]) run = y; if (run - y <= radius) outM[y * W + x] = 1; }
  }
  return outM;
}

// --- ad-band seed colours: ONLY the pure hoarding segments. The real
// hoarding is fully-saturated (secondary channels near zero); seat oranges /
// dark seat-shadow rows have nonzero g+b and must NOT match. ---
const isBlue   = (r, g, bl) => bl > 140 && r < 70 && g < 70;
const isYellow = (r, g, bl) => r > 200 && g > 185 && bl < 70;
const isAdGreen= (r, g, bl) => g > 110 && r < 60 && bl < 45;
const isRed    = (r, g, bl) => r > 150 && g < 45 && bl < 45;
const isAdSeed = (r, g, bl) => isBlue(r, g, bl) || isYellow(r, g, bl) || isAdGreen(r, g, bl) || isRed(r, g, bl);

const seed = new Uint8Array(W * H);
let seeds = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (inPitch(x, y, 6)) continue;
  const i = idx(x, y);
  if (isAdSeed(b[i], b[i + 1], b[i + 2])) { seed[y * W + x] = 1; seeds++; }
}
// dilate to swallow the emblem + anti-aliased segment gaps into one wall band
const band = dilate(seed, 16);
console.log("ad seeds:", seeds);

// --- recolor warm seats (orange + cream highlight rows) to a cool slate ramp ---
// warm = r>=g>=bl with real warmth; spares neutral grey pillars & the surround
const isWarm = (r, g, bl) => r >= g && g >= bl && r > 150 && (r - bl) > 30;
const DARK = [40, 50, 66], LIGHT = [152, 164, 186]; // cool slate ramp
const Lmin = 78, Lmax = 208;
const WALL = [42, 46, 56];

// --keep-seats: only strip the ad hoarding (clean wall), leave the rest
// orange seats untouched (owner: 保留人家的座位席).
const KEEP_SEATS = process.argv.includes("--keep-seats");

let recol = 0, walled = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (inPitch(x, y, 4)) continue;          // never touch the field / its lines
  const p = y * W + x, i = idx(x, y);
  if (band[p]) { b[i] = WALL[0]; b[i + 1] = WALL[1]; b[i + 2] = WALL[2]; walled++; continue; }
  const r = b[i], g = b[i + 1], bl = b[i + 2];
  if (!KEEP_SEATS && isWarm(r, g, bl)) {
    const L = 0.299 * r + 0.587 * g + 0.114 * bl;
    let t = (L - Lmin) / (Lmax - Lmin); t = t < 0 ? 0 : t > 1 ? 1 : t;
    b[i]     = Math.round(DARK[0] + (LIGHT[0] - DARK[0]) * t);
    b[i + 1] = Math.round(DARK[1] + (LIGHT[1] - DARK[1]) * t);
    b[i + 2] = Math.round(DARK[2] + (LIGHT[2] - DARK[2]) * t);
    recol++;
  }
}

await sharp(b, { raw: { width: W, height: H, channels: C } }).jpeg({ quality: 92 }).toFile(out);
console.log(JSON.stringify({ recoloredSeatPx: recol, walledAdPx: walled, out }));
