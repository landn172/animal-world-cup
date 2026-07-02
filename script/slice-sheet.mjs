#!/usr/bin/env node
/**
 * Generic magenta-sheet slicer (same adaptive band machinery as the portrait
 * and crowd sheets): chroma-key -> row/col content bands -> largest connected
 * component -> trim -> named outputs.
 *
 *   node script/slice-sheet.mjs <sheet.png> <cols> <rows> <outDir> <name1,name2,...>
 *
 * Names are row-major; use "-" to skip a cell.
 */
import { mkdirSync, existsSync } from "fs";
import { join } from "path";

const [sheetPath, colsArg, rowsArg, outDir, namesArg] = process.argv.slice(2);
if (!namesArg) {
  console.error("usage: node script/slice-sheet.mjs <sheet> <cols> <rows> <outDir> <names,csv>");
  process.exit(1);
}
const COLS = Number(colsArg), ROWS = Number(rowsArg);
const names = namesArg.split(",");
const sharp = (await import("sharp")).default;
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const { data, info } = await sharp(sheetPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;

for (let i = 0; i < data.length; i += 4) {
  const r = data[i], g = data[i + 1], b = data[i + 2];
  const m = Math.min(r, b) - g;
  if (m > 96) data[i + 3] = 0;
  else if (m > 40) {
    data[i + 3] = Math.round(255 * (1 - (m - 40) / 56));
    data[i + 1] = Math.max(g, Math.round(((r + b) / 2) * 0.8));
  }
}

function findBands(profile, expected, total) {
  const bands = [];
  let start = -1;
  const thresh = Math.max(2, total * 0.01);
  for (let i = 0; i < profile.length; i++) {
    const has = profile[i] > thresh;
    if (has && start < 0) start = i;
    if ((!has || i === profile.length - 1) && start >= 0) {
      bands.push([start, has ? i : i - 1]);
      start = -1;
    }
  }
  while (bands.length > expected) {
    let smallest = 0;
    for (let i = 1; i < bands.length; i++)
      if (bands[i][1] - bands[i][0] < bands[smallest][1] - bands[smallest][0]) smallest = i;
    const [bs, be] = bands.splice(smallest, 1)[0];
    const prev = bands[Math.max(0, smallest - 1)];
    if (smallest > 0 && (smallest === bands.length || bs - prev[1] <= bands[Math.min(smallest, bands.length - 1)][0] - be)) {
      prev[1] = Math.max(prev[1], be);
    } else {
      const next = bands[Math.min(smallest, bands.length - 1)];
      next[0] = Math.min(next[0], bs);
    }
  }
  return bands.length === expected ? bands : null;
}

function largestComponent(cell, w, h) {
  const seen = new Uint8Array(w * h);
  let best = null;
  const stack = [];
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || cell[s * 4 + 3] < 16) continue;
    const px = [];
    stack.length = 0; stack.push(s); seen[s] = 1;
    while (stack.length) {
      const cur = stack.pop();
      px.push(cur);
      const x = cur % w, y = (cur / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (!seen[ni] && cell[ni * 4 + 3] >= 16) { seen[ni] = 1; stack.push(ni); }
      }
    }
    if (!best || px.length > best.length) best = px;
  }
  if (!best) return;
  const keep = new Uint8Array(w * h);
  for (const i of best) keep[i] = 1;
  for (let i = 0; i < w * h; i++) if (!keep[i]) cell[i * 4 + 3] = 0;
}

const rowProfile = new Float64Array(H);
for (let y = 0; y < H; y++) {
  let c = 0;
  for (let x = 0; x < W; x++) if (data[(y * W + x) * 4 + 3] >= 16) c++;
  rowProfile[y] = c;
}
let rowBands = findBands(rowProfile, ROWS, W) ||
  Array.from({ length: ROWS }, (_, r) => [Math.round((r * H) / ROWS), Math.round(((r + 1) * H) / ROWS) - 1]);

let ok = 0;
for (let r = 0; r < ROWS; r++) {
  const [y0, y1] = rowBands[r];
  const colProfile = new Float64Array(W);
  for (let x = 0; x < W; x++) {
    let c = 0;
    for (let y = y0; y <= y1; y++) if (data[(y * W + x) * 4 + 3] >= 16) c++;
    colProfile[x] = c;
  }
  const colBands = findBands(colProfile, COLS, y1 - y0 + 1) ||
    Array.from({ length: COLS }, (_, c) => [Math.round((c * W) / COLS), Math.round(((c + 1) * W) / COLS) - 1]);
  for (let c = 0; c < COLS; c++) {
    const name = names[r * COLS + c];
    if (!name || name === "-") continue;
    const [x0, x1] = colBands[c];
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    const cell = Buffer.alloc(cw * ch * 4);
    for (let y = 0; y < ch; y++)
      for (let x = 0; x < cw; x++) {
        const si = ((y0 + y) * W + (x0 + x)) * 4, di = (y * cw + x) * 4;
        cell[di] = data[si]; cell[di + 1] = data[si + 1]; cell[di + 2] = data[si + 2]; cell[di + 3] = data[si + 3];
      }
    largestComponent(cell, cw, ch);
    await sharp(cell, { raw: { width: cw, height: ch, channels: 4 } })
      .trim({ threshold: 8 })
      .png()
      .toFile(join(outDir, `${name}.png`));
    ok++;
  }
}
console.log(`sliced ${ok} pieces -> ${outDir}`);
