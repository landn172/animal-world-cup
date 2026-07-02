#!/usr/bin/env node
/**
 * Crowd-animal race generator (SHEET pipeline, mirrors generate-portrait-sheet).
 * The stadium crowd picks each spectator's head from a race folder via
 * stadium.json fans.races; the pool was a few human races → "too few types".
 * This fills the stands with animal variety.
 *
 * Method (cheap + style-consistent): generate a GRID sheet of 3/4 side-view
 * animal mascot heads on solid magenta, chroma-key to transparent, adaptively
 * slice each cell, keep its largest connected component, and fit it into the
 * rig head bbox (81x77). Body/limbs/hands are shared (copied from the
 * reference race) — at crowd scale only the head reads. 20 heads per sheet,
 * so 100 animals = 5 image calls (not 100).
 *
 *   node script/generate-crowd-animals.mjs --sheets 1     # validation (20)
 *   node script/generate-crowd-animals.mjs                # full 100
 *   node script/generate-crowd-animals.mjs --slice-only   # re-slice saved sheets
 *
 * Writes races under match-runtime-assets-source/data/player/races/<id>/.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const racesDir = join(root, "match-runtime-assets-source/data/player/races");
const genDir = join(root, "public/animal-cup/ui/gen");
const REF = "brazil";
const SHARED = ["neck.png", "arm_left.png", "arm_right.png", "hand_left.png", "hand_right.png", "knee.png", "head_back.png"];
const COLS = 5, ROWS = 4, W = 1536, H = 1024; // 20 heads/sheet
const sharp = (await import("sharp")).default;

export const SPECIES = [
  ["panda","giant panda"],["redpanda","red panda"],["koala","koala"],["fox","red fox"],["wolfgrey","grey wolf"],
  ["rabbit","white rabbit"],["bear","brown bear"],["polarbear","polar bear"],["tiger","orange tiger"],["snowleopard","snow leopard"],
  ["deer","deer with small antlers"],["owl","round owl"],["cat","tabby cat"],["shibadog","shiba dog"],["hedgehog","hedgehog"],
  ["raccoon","raccoon"],["sloth","sloth"],["otter","otter"],["hippo","hippo"],["elephant","elephant"],
  ["giraffe","giraffe"],["zebra","zebra"],["monkey","monkey"],["frog","green frog"],["duck","yellow duck"],
  ["chicken","chicken"],["pig","pink pig"],["cow","spotted cow"],["sheep","fluffy sheep"],["goat","goat"],
  ["horse","horse"],["kangaroo","kangaroo"],["llama","llama"],["alpaca","alpaca"],["capybara","capybara"],
  ["squirrel","squirrel"],["chipmunk","chipmunk"],["beaver","beaver"],["badger","badger"],["mole","mole"],
  ["bat","cute bat"],["seal","seal"],["walrus","walrus"],["narwhal","narwhal"],["dolphin","dolphin"],
  ["whale","blue whale"],["shark","friendly shark"],["octopus","octopus"],["crab","red crab"],["turtle","turtle"],
  ["snail","snail"],["bee","bee"],["butterfly","butterfly"],["ladybug","ladybug"],["snake","snake"],
  ["lizard","lizard"],["chameleon","chameleon"],["crocodile","crocodile"],["dino","green dinosaur"],["dragon","cute dragon"],
  ["penguin","penguin"],["flamingo","flamingo"],["peacock","peacock"],["parrot","parrot"],["toucan","toucan"],
  ["eagle","eagle"],["hawk","hawk"],["falcon","falcon"],["swan","swan"],["goose","goose"],
  ["pelican","pelican"],["pigeon","pigeon"],["sparrow","sparrow"],["robin","robin"],["crow","crow"],
  ["mouse","mouse"],["hamster","hamster"],["guineapig","guinea pig"],["ferret","ferret"],["weasel","weasel"],
  ["skunk","skunk"],["porcupine","porcupine"],["armadillo","armadillo"],["anteater","anteater"],["aardvark","aardvark"],
  ["meerkat","meerkat"],["mongoose","mongoose"],["lemur","ring-tailed lemur"],["gorilla","gorilla"],["orangutan","orangutan"],
  ["chimp","chimpanzee"],["panther","black panther"],["lynx","lynx"],["cheetah","cheetah"],["jackal","jackal"],
  ["hyena","hyena"],["bison","bison"],["rhino","rhino"],["camel","camel"],["moose","moose"],
  ["reindeer","reindeer"],["boar","wild boar"],["wombat","wombat"],["mongoose2","civet"],["okapi","okapi"],
];

let apiKey = process.env.BTY_API_KEY;
if (!apiKey && existsSync(join(root, ".env.local"))) apiKey = (readFileSync(join(root, ".env.local"), "utf8").match(/^BTY_API_KEY=(.+)$/m) || [])[1];

function buildPrompt(list, cols, rows) {
  const lines = [];
  for (let r = 0; r < rows; r++) {
    const cells = list.slice(r * cols, (r + 1) * cols).map((n, i) => `${i + 1}) ${n[1]}`);
    lines.push(`Row ${r + 1}: ${cells.join("; ")}`);
  }
  return (
    `a perfectly aligned ${cols}x${rows} grid of ${list.length} DIFFERENT super cute chubby cartoon animal mascot heads, ` +
    "every cell shows ONE animal HEAD ONLY (no body), in a 3/4 side view facing right, " +
    "oversized round head, big round dark eyes, soft naive smile, simple rounded kawaii shapes, " +
    lines.join(". ") + ". " +
    "uniform soft hand-drawn storybook watercolor style, clean thick dark-brown outlines, flat gentle pastel colors, " +
    "identical line weight, head size and proportions across ALL cells, equal cell sizes, " +
    "every head fully contained inside its own cell and NOT touching any neighbor, " +
    "wide empty magenta gaps between all cells, no dividing lines, no cell borders, no frames, " +
    "SOLID FLAT MAGENTA background (hex FF00FF) behind everything including between cells, " +
    "no text, no letters, no watermark"
  );
}

async function generateSheet(list, outPath) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch("https://aigw-api.betteryeah.com/openai/v1/images/generations", {
        method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-image-2", prompt: buildPrompt(list, COLS, ROWS), n: 1, size: `${W}x${H}`, quality: "high" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const item = (await res.json()).data[0];
      const buf = item.b64_json ? Buffer.from(item.b64_json, "base64") : Buffer.from(await (await fetch(item.url)).arrayBuffer());
      writeFileSync(outPath, buf);
      return true;
    } catch (err) {
      console.error(`  attempt ${attempt}: ${String(err).slice(0, 200)}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 6000));
    }
  }
  return false;
}

const isMagenta = (d, i) => Math.min(d[i], d[i + 2]) - d[i + 1] > 60;
async function chromaKey(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const m = Math.min(data[i], data[i + 2]) - data[i + 1];
    if (m > 96) data[i + 3] = 0;
    else if (m > 40) { data[i + 3] = Math.round(255 * (1 - (m - 40) / 56)); data[i + 1] = Math.max(data[i + 1], Math.round(((data[i] + data[i + 2]) / 2) * 0.8)); }
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
}
function findBands(profile, expected, total) {
  const bands = []; let start = -1; const thresh = Math.max(2, total * 0.01);
  for (let i = 0; i < profile.length; i++) {
    const has = profile[i] > thresh;
    if (has && start < 0) start = i;
    if ((!has || i === profile.length - 1) && start >= 0) { bands.push([start, has ? i : i - 1]); start = -1; }
  }
  while (bands.length > expected) {
    let s = 0; for (let i = 1; i < bands.length; i++) if (bands[i][1] - bands[i][0] < bands[s][1] - bands[s][0]) s = i;
    const [bs, be] = bands.splice(s, 1)[0]; const prev = bands[Math.max(0, s - 1)];
    if (s > 0 && (s === bands.length || bs - prev[1] <= bands[Math.min(s, bands.length - 1)][0] - be)) prev[1] = Math.max(prev[1], be);
    else { const next = bands[Math.min(s, bands.length - 1)]; next[0] = Math.min(next[0], bs); }
  }
  return bands.length === expected ? bands : null;
}
function largestComponent(data, w, h) {
  const seen = new Uint8Array(w * h); let best = null; const stack = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || data[start * 4 + 3] < 16) continue;
    const px = []; stack.length = 0; stack.push(start); seen[start] = 1;
    while (stack.length) {
      const cur = stack.pop(); px.push(cur); const x = cur % w, y = (cur / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx; if (!seen[ni] && data[ni * 4 + 3] >= 16) { seen[ni] = 1; stack.push(ni); }
      }
    }
    if (!best || px.length > best.length) best = px;
  }
  if (!best) return;
  const keep = new Uint8Array(w * h); for (const i of best) keep[i] = 1;
  for (let i = 0; i < w * h; i++) if (!keep[i]) data[i * 4 + 3] = 0;
}

function fitHead(buf) {
  // contain into the locked 81x77 rig head bbox, centered
  return sharp(buf).trim({ threshold: 8 }).resize(81, 77, { fit: "inside" }).toBuffer()
    .then((art) => sharp({ create: { width: 81, height: 77, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: art, gravity: "center" }]).png().toBuffer());
}

function assembleRace(id) {
  const dir = join(racesDir, id);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const refDir = join(racesDir, REF);
  copyFileSync(join(refDir, "race.json"), join(dir, "race.json"));
  for (const f of SHARED) copyFileSync(join(refDir, f), join(dir, f));
  return dir;
}

async function sliceSheet(list, srcPath) {
  const { data, info } = await sharp(srcPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const SW = info.width, SH = info.height;
  const rowProfile = new Float64Array(SH);
  for (let y = 0; y < SH; y++) { let c = 0; for (let x = 0; x < SW; x++) if (!isMagenta(data, (y * SW + x) * 4)) c++; rowProfile[y] = c; }
  let rowBands = findBands(rowProfile, ROWS, SW) || Array.from({ length: ROWS }, (_, r) => [Math.round((r * SH) / ROWS), Math.round(((r + 1) * SH) / ROWS) - 1]);
  let ok = 0;
  for (let r = 0; r < ROWS; r++) {
    const [y0, y1] = rowBands[r];
    const colProfile = new Float64Array(SW);
    for (let x = 0; x < SW; x++) { let c = 0; for (let y = y0; y <= y1; y++) if (!isMagenta(data, (y * SW + x) * 4)) c++; colProfile[x] = c; }
    let colBands = findBands(colProfile, COLS, y1 - y0 + 1) || Array.from({ length: COLS }, (_, c) => [Math.round((c * SW) / COLS), Math.round(((c + 1) * SW) / COLS) - 1]);
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c; if (i >= list.length) break;
      const [x0, x1] = colBands[c]; const pad = 3;
      const left = Math.max(0, x0 - pad), top = Math.max(0, y0 - pad);
      const width = Math.min(SW, x1 + pad) - left, height = Math.min(SH, y1 + pad) - top;
      const cellBuf = await sharp(srcPath).extract({ left, top, width, height }).png().toBuffer();
      const { data: cd, info: ci } = await (await chromaKey(cellBuf)).raw().toBuffer({ resolveWithObject: true });
      largestComponent(cd, ci.width, ci.height);
      const keyed = await sharp(cd, { raw: { width: ci.width, height: ci.height, channels: 4 } }).png().toBuffer();
      const dir = assembleRace(list[i][0]);
      writeFileSync(join(dir, "head.png"), await fitHead(keyed));
      ok++;
    }
  }
  return ok;
}

async function main() {
  const args = process.argv.slice(2);
  const sliceOnly = args.includes("--slice-only");
  const sheets = args.includes("--sheets") ? parseInt(args[args.indexOf("--sheets") + 1], 10) : Math.ceil(SPECIES.length / (COLS * ROWS));
  if (!sliceOnly && !apiKey) { console.error("missing BTY_API_KEY"); process.exit(1); }
  if (!existsSync(genDir)) mkdirSync(genDir, { recursive: true });
  const per = COLS * ROWS;
  let total = 0;
  for (let s = 0; s < sheets; s++) {
    const list = SPECIES.slice(s * per, (s + 1) * per);
    if (!list.length) break;
    const srcPath = join(genDir, `_crowd-sheet-${s}.png`);
    if (!sliceOnly) { process.stdout.write(`sheet ${s} (${list.length})... `); if (!(await generateSheet(list, srcPath))) { console.log("FAILED"); continue; } console.log("ok"); }
    if (!existsSync(srcPath)) { console.warn(`no sheet ${s} to slice`); continue; }
    total += await sliceSheet(list, srcPath);
  }
  console.log(`\n${total} crowd animals -> ${racesDir}`);
}

await main();
