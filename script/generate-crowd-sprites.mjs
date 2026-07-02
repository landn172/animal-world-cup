#!/usr/bin/env node
/**
 * Crowd sprite sheet: one gpt-image-2 call renders a 6x4 grid of sitting /
 * cheering animal spectators on magenta, sliced into individual transparent
 * sprites. These get composited onto the stands layer at NATIVE texture
 * resolution by script/place-crowd.mjs — painted-in crowds upscaled from the
 * 1536 edit were visibly blurrier than the player sprites (owner complaint).
 *
 *   node script/generate-crowd-sprites.mjs               # generate + slice
 *   node script/generate-crowd-sprites.mjs --slice-only  # re-slice existing
 *
 * Outputs: public/animal-cup/crowd/_sheet.png + 24 numbered sprites.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, "public/animal-cup/crowd");
const sheetPath = join(outDir, "_sheet.png");
const COLS = 6, ROWS = 4;

let apiKey = process.env.BTY_API_KEY;
if (!apiKey) {
  try {
    apiKey = (readFileSync(join(root, ".env.local"), "utf8").match(/^BTY_API_KEY=(.+)$/m) || [])[1];
  } catch {}
}

const ANIMALS = [
  "brown bear with a tiny red flag", "white rabbit clapping", "orange fox cheering with raised paws",
  "grey raccoon with a green scarf", "fluffy sheep", "panda eating a snack",
  "hedgehog with a yellow flag", "red squirrel", "spotted deer fawn",
  "round owl", "golden hamster cheering", "black cat with a blue scarf",
  "white duck quacking happily", "beaver holding a wooden sign blank", "chubby penguin",
  "koala clapping", "tiny mouse with a huge foam paw", "badger with a striped scarf",
  "otter holding a fish snack", "chipmunk cheering", "mole wearing tiny glasses",
  "lion cub waving a gold flag", "baby elephant trumpeting", "turtle with a party hat",
];

function buildPrompt() {
  const lines = ANIMALS.map((d, i) => `cell ${i + 1}: ${d}`);
  return (
    `sprite sheet, a perfect grid of ${COLS} columns x ${ROWS} rows, ${COLS * ROWS} cells, ` +
    "each cell shows ONE cute chubby cartoon animal SPECTATOR sitting on the ground watching a football match, " +
    "FULL BODY clearly visible: round belly, stubby legs and arms, seen from a high three-quarter angle " +
    "(slightly from above, like looking down into a stadium crowd), facing the viewer, " +
    lines.join(". ") + ". " +
    // match the pitch/forest backdrop EXACTLY: soft watercolor, not flat
    // cartoon — owner: crowd & field must read as one painting
    "uniform soft hand-drawn storybook WATERCOLOR style with visible watercolor brush texture and paper grain, " +
    "gentle soft painterly edges, thin sketchy brown ink linework (NOT thick bold cartoon outlines), " +
    "muted warm pastel watercolor washes, the exact same illustration style as a cozy watercolor picture book, " +
    "identical body scale and proportions across ALL cells, equal cell sizes, " +
    "every animal fully contained inside its own cell and NOT touching any neighbor, " +
    "wide empty magenta gaps between all cells, no dividing lines, no cell borders, " +
    "SOLID FLAT MAGENTA background (hex FF00FF) behind everything including between cells, " +
    "no text, no letters, no logos, no watermark"
  );
}

async function generateSheet() {
  const prompt = buildPrompt();
  console.log(`prompt: ${prompt.length} chars`);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch("https://aigw-api.betteryeah.com/openai/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-image-2", prompt, n: 1, size: "1536x1024", quality: "high" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const json = await res.json();
      const item = json.data[0];
      const buf = item.b64_json
        ? Buffer.from(item.b64_json, "base64")
        : Buffer.from(await (await fetch(item.url)).arrayBuffer());
    writeFileSync(sheetPath, buf);
      console.log("sheet saved:", sheetPath);
      return true;
    } catch (err) {
      console.error(`attempt ${attempt}: ${String(err).slice(0, 200)}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 6000));
    }
  }
  return false;
}

// --- chroma + adaptive slicing (same approach as generate-portrait-sheet) ---
function isMagenta(data, i) {
  return Math.min(data[i], data[i + 2]) - data[i + 1] > 60;
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
    for (let i = 1; i < bands.length; i++) {
      if (bands[i][1] - bands[i][0] < bands[smallest][1] - bands[smallest][0]) smallest = i;
    }
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

function largestComponent(data, w, h) {
  const seen = new Uint8Array(w * h);
  let best = null;
  const stack = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || data[start * 4 + 3] < 16) continue;
    const px = [];
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const cur = stack.pop();
      px.push(cur);
      const x = cur % w, y = (cur / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (!seen[ni] && data[ni * 4 + 3] >= 16) { seen[ni] = 1; stack.push(ni); }
      }
    }
    if (!best || px.length > best.length) best = px;
  }
  if (!best) return data;
  const keep = new Uint8Array(w * h);
  for (const i of best) keep[i] = 1;
  for (let i = 0; i < w * h; i++) if (!keep[i]) data[i * 4 + 3] = 0;
  return data;
}

// shave any edge pixel that touches transparency — kills the leftover
// magenta-mix fringe that the chroma band can't fully resolve on soft edges
function erodeAlpha(cell, w, h) {
  const drop = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = cell[(y * w + x) * 4 + 3];
      if (a === 0 || a === 255) continue;
      let touchesVoid = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || cell[(ny * w + nx) * 4 + 3] < 12) { touchesVoid = true; break; }
      }
      if (touchesVoid) drop.push((y * w + x) * 4 + 3);
    }
  }
  for (const i of drop) cell[i] = 0;
}

async function slice() {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(sheetPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;

  // chroma key in place. The old despill RAISED green on edge pixels, which
  // turned the magenta fringe into a yellow-green halo (owner's complaint).
  // Correct despill PULLS red+blue down toward green to remove the magenta
  // spill, and a tighter band keeps the soft watercolor edge clean.
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const magenta = Math.min(r, b) - g;
    if (magenta > 60) data[i + 3] = 0;
    else if (magenta > 14) {
      data[i + 3] = Math.round(255 * (1 - (magenta - 14) / 46));
      const cap = g + 6;
      if (data[i] > cap) data[i] = cap;
      if (data[i + 2] > cap) data[i + 2] = cap;
    }
  }

  const rowProfile = new Float64Array(H);
  for (let y = 0; y < H; y++) {
    let c = 0;
    for (let x = 0; x < W; x++) if (data[(y * W + x) * 4 + 3] >= 16) c++;
    rowProfile[y] = c;
  }
  let rowBands = findBands(rowProfile, ROWS, W);
  if (!rowBands) {
    console.warn("row detection failed -> even grid fallback");
    rowBands = Array.from({ length: ROWS }, (_, r) => [Math.round((r * H) / ROWS), Math.round(((r + 1) * H) / ROWS) - 1]);
  }

  let ok = 0;
  for (let r = 0; r < ROWS; r++) {
    const [y0, y1] = rowBands[r];
    const colProfile = new Float64Array(W);
    for (let x = 0; x < W; x++) {
      let c = 0;
      for (let y = y0; y <= y1; y++) if (data[(y * W + x) * 4 + 3] >= 16) c++;
      colProfile[x] = c;
    }
    let colBands = findBands(colProfile, COLS, y1 - y0 + 1);
    if (!colBands) {
      console.warn(`col detection failed row ${r} -> even fallback`);
      colBands = Array.from({ length: COLS }, (_, c) => [Math.round((c * W) / COLS), Math.round(((c + 1) * W) / COLS) - 1]);
    }
    for (let c = 0; c < COLS; c++) {
      const idx = r * COLS + c;
      const [x0, x1] = colBands[c];
      const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
      const cell = Buffer.alloc(cw * ch * 4);
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          const si = ((y0 + y) * W + (x0 + x)) * 4, di = (y * cw + x) * 4;
          cell[di] = data[si]; cell[di + 1] = data[si + 1]; cell[di + 2] = data[si + 2]; cell[di + 3] = data[si + 3];
        }
      }
      largestComponent(cell, cw, ch);
      erodeAlpha(cell, cw, ch); // shave the 1px fringe so no colored halo survives
      await sharp(cell, { raw: { width: cw, height: ch, channels: 4 } })
        .trim({ threshold: 8 })
        .png()
        .toFile(join(outDir, `${idx}.png`));
      ok++;
    }
  }
  console.log(`sliced ${ok}/${COLS * ROWS} sprites -> ${outDir}`);
}

async function main() {
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  if (!process.argv.includes("--slice-only")) {
    if (!(await generateSheet())) process.exit(1);
  }
  await slice();
}

await main();
