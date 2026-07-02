#!/usr/bin/env node
/**
 * 48-nation portrait SHEET: one gpt-image-2 call renders an 8x6 grid so every
 * portrait shares the same hand, palette and line weight (per-call generation
 * could never guarantee that). The sheet is then sliced into individual
 * chroma-keyed portraits.
 *
 *   node script/generate-portrait-sheet.mjs            # generate + slice
 *   node script/generate-portrait-sheet.mjs --slice-only   # re-slice existing sheet
 *
 * Outputs:
 *   public/animal-cup/portraits/_sheet.png   (raw sheet, kept for review)
 *
 * NOTE: the playable-8 animals MUST mirror the match runtime sprites
 * (portugal = iberian wolf, NOT the spec-proposal rooster). The archived
 * _sheet.png/_sample-sheet.png predate this fix — re-roll before re-slicing
 * portugal from them.
 *   public/animal-cup/portraits/<id>.png     (48 sliced, transparent, trimmed)
 *
 * Roster source: docs/2026-06-03-animal-world-cup-sim-design.md §6 (48 nations,
 * duplicates differentiated by subspecies/color/props + scarf colors).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, "public/animal-cup/portraits");
const sheetPath = join(outDir, "_sheet.png");

let apiKey = process.env.BTY_API_KEY;
if (!apiKey) {
  try {
    apiKey = (readFileSync(join(root, ".env.local"), "utf8").match(/^BTY_API_KEY=(.+)$/m) || [])[1];
  } catch {}
}

// Grid order: row-major, 8 columns x 6 rows. CONMEBOL -> UEFA -> CONCACAF -> AFC -> CAF -> OFC.
export const NATIONS = [
  { id: "argentina", desc: "tan puma, sky-blue and white scarf" },
  { id: "brazil", desc: "spotted jaguar, yellow and green scarf" },
  { id: "uruguay", desc: "calm capybara, sky-blue scarf" },
  { id: "ecuador", desc: "giant tortoise, yellow-blue-red scarf" },
  { id: "colombia", desc: "Andean condor, yellow-blue-red scarf" },
  { id: "paraguay", desc: "long-legged maned wolf, red-white-blue scarf" },
  { id: "france", desc: "round rooster with red comb, blue and white scarf" },
  { id: "spain", desc: "gentle bull with small horns, red and gold scarf" },
  { id: "england", desc: "golden-maned lion, white and red scarf" },
  { id: "portugal", desc: "keen iberian wolf with grey-brown fur, red and green scarf" },
  { id: "netherlands", desc: "bright ORANGE lion, orange scarf" },
  { id: "belgium", desc: "black-maned lion, black-yellow-red scarf" },
  { id: "germany", desc: "fluffy black eagle, black and gold scarf" },
  { id: "croatia", desc: "small pine marten, red-white checkered scarf" },
  { id: "austria", desc: "dark heraldic eagle, red and white scarf" },
  { id: "switzerland", desc: "St Bernard dog with tiny neck barrel, red and white scarf" },
  { id: "sweden", desc: "moose with antlers, blue and yellow scarf" },
  { id: "czechia", desc: "WHITE lion with two tails, red-white-blue scarf" },
  { id: "turkiye", desc: "fluffy grey wolf, red and white scarf" },
  { id: "norway", desc: "lion holding a tiny golden axe, red and navy scarf" },
  { id: "scotland", desc: "white unicorn with golden horn, navy and white scarf" },
  { id: "bosnia", desc: "brown bear, blue and yellow scarf" },
  { id: "mexico", desc: "golden eagle holding a small snake in beak, green-white-red scarf" },
  { id: "usa", desc: "bald eagle with white head, navy and red scarf" },
  { id: "canada", desc: "buck-toothed beaver, red and white scarf" },
  { id: "panama", desc: "harpy eagle with feather crest, red and blue scarf" },
  { id: "curacao", desc: "pink flamingo, blue and yellow scarf" },
  { id: "haiti", desc: "black and red rooster, blue and red scarf" },
  { id: "japan", desc: "black three-legged crow, navy and white scarf" },
  { id: "iran", desc: "slim asiatic cheetah, green-white-red scarf" },
  { id: "korea", desc: "round-cheeked orange striped tiger, red and blue scarf" },
  { id: "australia", desc: "kangaroo, green and gold scarf" },
  { id: "saudi", desc: "small plump falcon, green and white scarf" },
  { id: "qatar", desc: "white oryx with long straight horns, maroon and white scarf" },
  { id: "uzbekistan", desc: "WHITE wolf, blue-white-green scarf" },
  { id: "jordan", desc: "dromedary camel, red-black-white scarf" },
  { id: "iraq", desc: "bronze-maned lion, red-white-black scarf" },
  { id: "morocco", desc: "Barbary lion with huge dark mane, red and green scarf" },
  { id: "senegal", desc: "slender young lion, green-yellow-red scarf" },
  { id: "ivorycoast", desc: "elephant with tusks, orange-white-green scarf" },
  { id: "egypt", desc: "golden Saladin eagle, red-white-black scarf" },
  { id: "tunisia", desc: "carthage eagle, red and white scarf" },
  { id: "algeria", desc: "fennec fox with huge ears, green and white scarf" },
  { id: "drcongo", desc: "leopard, blue-red-yellow scarf" },
  { id: "southafrica", desc: "springbok antelope, green and gold scarf" },
  { id: "capeverde", desc: "sea turtle, blue and white scarf" },
  { id: "ghana", desc: "tawny eagle, red-gold-green scarf" },
  { id: "newzealand", desc: "round kiwi bird, black and white scarf" },
];

const COLS = 8, ROWS = 6, W = 1536, H = 1024;

function buildPrompt(list, cols, rows) {
  const lines = [];
  for (let r = 0; r < rows; r++) {
    const cells = list.slice(r * cols, (r + 1) * cols).map((n, i) => `${i + 1}) ${n.desc}`);
    lines.push(`Row ${r + 1}: ${cells.join("; ")}`);
  }
  return (
    `a perfectly aligned ${cols}x${rows} grid of ${list.length} DIFFERENT super cute chubby cartoon animal mascot portraits, ` +
    "every cell shows ONE animal: PERFECTLY FRONT-FACING symmetrical face looking straight at the viewer, " +
    "oversized round head, tiny shoulders, big round sparkling dark eyes, soft warm naive smile, " +
    "simple rounded kawaii shapes like a cozy life-sim villager, " +
    "each animal wears a simple knitted scarf in its listed colors. " +
    lines.join(". ") + ". " +
    "uniform soft hand-drawn storybook style, clean thick dark-brown outlines, flat gentle pastel colors, minimal fur detail, " +
    "identical line weight, head size and proportions across ALL cells, equal cell sizes, " +
    "every portrait fully contained inside its own cell and NOT touching any neighbor, " +
    "wide empty magenta gaps between all cells, absolutely no dividing lines, no cell borders, no frames, " +
    "SOLID FLAT MAGENTA background (hex FF00FF) behind everything including between cells, " +
    "no text, no letters, no flags, no crests, no watermark"
  );
}

async function generateSheet(list, cols, rows, w, h, outPath) {
  const prompt = buildPrompt(list, cols, rows);
  console.log(`prompt: ${prompt.length} chars`);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch("https://aigw-api.betteryeah.com/openai/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-image-2", prompt, n: 1, size: `${w}x${h}`, quality: "high" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const json = await res.json();
      const item = json.data[0];
      const buf = item.b64_json
        ? Buffer.from(item.b64_json, "base64")
        : Buffer.from(await (await fetch(item.url)).arrayBuffer());
      writeFileSync(outPath, buf);
      console.log("sheet saved:", outPath);
      return true;
    } catch (err) {
      console.error(`attempt ${attempt}: ${String(err).slice(0, 200)}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 6000));
    }
  }
  return false;
}

async function chromaKey(sharp, buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const magenta = Math.min(r, b) - g;
    if (magenta > 96) data[i + 3] = 0;
    else if (magenta > 40) {
      data[i + 3] = Math.round(255 * (1 - (magenta - 40) / 56));
      data[i + 1] = Math.max(g, Math.round(((r + b) / 2) * 0.8));
    }
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
}

// --- adaptive slicing -------------------------------------------------------
// The model sometimes drifts rows/columns off the even grid, so cutting at
// fixed fractions bleeds neighbors into cells. Instead: project the magenta
// mask onto each axis to find the real content bands, then keep only the
// largest connected component of each cell (drops any leftover slivers).

function isMagenta(data, i) {
  return Math.min(data[i], data[i + 2]) - data[i + 1] > 60;
}

// 1D projection -> bands of consecutive content (non-magenta) lines
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
  // merge slivers into neighbors until we hit the expected count
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

async function slice(list, cols, rows, srcPath) {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(srcPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;

  // row bands from horizontal projection of non-magenta pixels
  const rowProfile = new Float64Array(H);
  for (let y = 0; y < H; y++) {
    let c = 0;
    for (let x = 0; x < W; x++) if (!isMagenta(data, (y * W + x) * 4)) c++;
    rowProfile[y] = c;
  }
  let rowBands = findBands(rowProfile, rows, W);
  if (!rowBands) {
    console.warn("row detection failed -> even grid fallback");
    rowBands = Array.from({ length: rows }, (_, r) => [Math.round((r * H) / rows), Math.round(((r + 1) * H) / rows) - 1]);
  }

  let ok = 0;
  for (let r = 0; r < rows; r++) {
    const [y0, y1] = rowBands[r];
    // column bands inside this row band
    const colProfile = new Float64Array(W);
    for (let x = 0; x < W; x++) {
      let c = 0;
      for (let y = y0; y <= y1; y++) if (!isMagenta(data, (y * W + x) * 4)) c++;
      colProfile[x] = c;
    }
    let colBands = findBands(colProfile, cols, y1 - y0 + 1);
    if (!colBands) {
      console.warn(`col detection failed row ${r} -> even fallback`);
      colBands = Array.from({ length: cols }, (_, c) => [Math.round((c * W) / cols), Math.round(((c + 1) * W) / cols) - 1]);
    }
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (i >= list.length) break;
      const [x0, x1] = colBands[c];
      const pad = 3;
      const left = Math.max(0, x0 - pad), top = Math.max(0, y0 - pad);
      const width = Math.min(W, x1 + pad) - left, height = Math.min(H, y1 + pad) - top;
      const cellBuf = await sharp(srcPath).extract({ left, top, width, height }).png().toBuffer();
      const keyedSharp = await chromaKey(sharp, cellBuf);
      const { data: cd, info: ci } = await keyedSharp.raw().toBuffer({ resolveWithObject: true });
      largestComponent(cd, ci.width, ci.height);
      let out = sharp(cd, { raw: { width: ci.width, height: ci.height, channels: 4 } });
      try {
        out = sharp(await out.png().toBuffer())
          .trim({ threshold: 8 })
          .extend({ top: 4, bottom: 4, left: 4, right: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } });
      } catch {}
      writeFileSync(join(outDir, `${list[i].id}.png`), await out.png().toBuffer());
      ok++;
    }
  }
  console.log(`sliced ${ok}/${list.length}`);
}

mkdirSync(outDir, { recursive: true });
const sliceOnly = process.argv.includes("--slice-only");
const sample = process.argv.includes("--sample");

// --sample: 4x2 sheet of the 8 playable squads (style validation + hero-size renders)
const PLAYABLE = ["england", "france", "germany", "spain", "portugal", "brazil", "argentina", "usa"];
const list = sample ? PLAYABLE.map((id) => NATIONS.find((n) => n.id === id)) : NATIONS;
const cols = sample ? 4 : COLS;
const rows = sample ? 2 : ROWS;
const srcPath = sample ? join(outDir, "_sample-sheet.png") : sheetPath;

if (!sliceOnly) {
  if (!apiKey) { console.error("BTY_API_KEY missing"); process.exit(1); }
  if (!(await generateSheet(list, cols, rows, W, H, srcPath))) process.exit(1);
} else if (!existsSync(srcPath)) {
  console.error("no sheet to slice");
  process.exit(1);
}
await slice(list, cols, rows, srcPath);
