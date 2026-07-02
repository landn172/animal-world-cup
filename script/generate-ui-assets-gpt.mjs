#!/usr/bin/env node
/**
 * Generate the hand-drawn cartoon UI asset set via gpt-image-2
 * (betteryeah gateway). Idempotent: skips assets that already exist.
 *
 *   BTY_API_KEY=... node script/generate-ui-assets-gpt.mjs [--only <id>] [--force]
 *
 * Key comes from env or web/.env.local. Output: public/animal-cup/ui/gen/<id>.png
 * Spec: docs/specs/2026-06-07-cartoon-ui-i18n-design.md
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, "public/animal-cup/ui/gen");

// ---- key ----
let apiKey = process.env.BTY_API_KEY;
if (!apiKey) {
  try {
    const env = readFileSync(join(root, ".env.local"), "utf8");
    apiKey = (env.match(/^BTY_API_KEY=(.+)$/m) || [])[1];
  } catch {}
}
if (!apiKey) {
  console.error("BTY_API_KEY missing (env or web/.env.local)");
  process.exit(1);
}

// ---- shared style lock ----
// The gateway rejects background:"transparent", so we chroma-key: generate on
// solid magenta (absent from the palette) and knock it out with sharp.
const STYLE =
  "hand-drawn cartoon game UI asset, storybook watercolor texture, " +
  "thick irregular dark-brown outline (hex 4a301e), no drop shadow, " +
  "cozy flat palette: parchment #fff2cf, warm wood #7a4426, brass gold #d9a644, grass green #70aa45, " +
  "single object centered with generous margin, isolated on a SOLID FLAT MAGENTA background (hex FF00FF), " +
  "the background must be one uniform magenta color with no gradient, " +
  "no text, no letters, no watermark, no photo realism";

// Opaque scene art skips the chroma key entirely.
const SCENE_STYLE =
  "hand-drawn storybook game illustration, soft watercolor textures with visible brush grain, " +
  "cozy pastel palette inspired by Animal Crossing and Fantasy Life, warm late-afternoon sunlight, " +
  "clean readable shapes with gentle dark-brown line work, no text, no letters, no logos, no UI elements, no watermark";

const ASSETS = [
  {
    id: "scene-lobby",
    size: "1536x1024",
    opaque: true,
    quality: "high",
    prompt:
      "wide establishing shot of a cozy village football stadium seen from a gentle high angle, " +
      "lush green pitch with soft mowing stripes in the lower half, small wooden stands draped with " +
      "colorful triangle bunting on both sides, fluffy trees and rolling hills behind, a few tiny " +
      "cartoon animal spectators far away, pastel blue sky with puffy clouds and soft sun glow, " +
      `generous calm space in the middle for overlaid menus, ${SCENE_STYLE}`,
  },
  {
    id: "scene-lobby-b",
    size: "1536x1024",
    opaque: true,
    quality: "high",
    prompt:
      "cozy football festival ground at golden hour seen slightly from above, foreground grass with " +
      "tiny daisies blurring softly, a storybook football pitch in the middle distance with striped " +
      "grass, wooden fence and flag garlands around it, distant cheering animal crowd as soft shapes, " +
      "big warm sky with peach and mint clouds, " +
      `open sky area at the top for a hanging title sign, ${SCENE_STYLE}`,
  },
  {
    // home background: must read as the GRAND ANIMAL WORLD CUP, not a picnic
    // meadow — a packed festive stadium on opening night, calm centre for the menu.
    id: "bg-stadium",
    size: "1536x1024",
    opaque: true,
    quality: "high",
    // NO trophy / cup and avoid "world cup"/"championship" wording — the model
    // renders a FIFA-lookalike trophy from those (IP). Grandeur comes from the
    // packed stands, floodlights, banners, confetti and twilight sky instead.
    prompt:
      "grand animal football festival on a big match night inside a huge storybook stadium, high wide aerial angle: " +
      "a lush green football pitch with crisp white markings and a centre circle filling the foreground, " +
      "fully ringed by tall tiered stands PACKED with thousands of tiny cheering cartoon animal fans waving little flags, " +
      "four tall glowing floodlight pylons at the corners, long strings of colourful triangular bunting and tall " +
      "decorative team-colour banners draped over the stands, celebratory confetti and paper streamers drifting through " +
      "the air, warm festive twilight sky with soft glowing clouds and a few firework sparkles, joyful spectacular " +
      "stadium atmosphere, no trophy, no cup, " +
      `generous calm open green space across the middle of the pitch for overlaid menus, ${SCENE_STYLE}`,
  },
  {
    id: "team-ticket",
    size: "1536x1024",
    prompt: `one extremely wide and thin horizontal wooden plank ticket, width about five times its height, simple rounded carved edges, flat light parchment face filling most of the plank, minimal decoration, ${STYLE}`,
  },
  {
    id: "card-match",
    size: "1536x1024",
    prompt: `one horizontal rectangular parchment notice card, 3:2 landscape orientation filling most of the frame, soft torn edges, flat cream surface, a small wooden strip along the top edge, minimal decoration, ${STYLE}`,
  },
  {
    id: "panel-fixture",
    size: "1536x1024",
    prompt: `one extremely wide and thin horizontal parchment strip, width about four times its height, soft torn edges, flat cream surface with subtle paper grain, minimal decoration, ${STYLE}`,
  },
  {
    id: "banner-book",
    size: "1536x1024",
    prompt: `small festive ribbon banner with two swallow-tail ends, warm cherry red fabric with cream inner stripe, hand-stitched border, blank center, ${STYLE}`,
  },
  {
    id: "kit-tag",
    size: "1024x1024",
    prompt: `leather luggage hang-tag with rounded corners, brass eyelet and short string at the top, stitched border, blank face, ${STYLE}`,
  },
  {
    id: "pin-brass",
    size: "1024x1024",
    prompt: `single round brass push pin tack seen from the front, small glossy dome head, ${STYLE}`,
  },
  {
    id: "rosette-medal",
    size: "1024x1024",
    prompt: `festive award rosette ribbon medal, pleated gold and cream fabric circle with two short ribbon tails, blank round center, ${STYLE}`,
  },
  {
    id: "paw-ink",
    size: "1024x1024",
    prompt: `single animal paw print made of warm brown ink, slightly textured stamped look, ${STYLE}`,
  },
  {
    id: "frame-poster",
    size: "1536x1024",
    prompt: `wide wooden picture frame with rounded corners and carved bevel, small brass leaf ornaments on the corners, completely empty transparent center opening, ${STYLE}`,
  },
  { id: "wood-sign-title", size: "1536x1024", prompt: `wide horizontal wooden sign board hanging from two short ropes, rounded plank shape with carved border and small leaf decorations on corners, blank center for a title, ${STYLE}` },
  { id: "parchment-list", size: "1024x1536", prompt: `tall vertical parchment sheet pinned with a small brass tack at the top, gently torn uneven edges, subtle paper grain, blank writable area, ${STYLE}` },
  { id: "leather-board", size: "1024x1536", prompt: `vertical leather clipboard with wooden clip at top and visible stitching around the border, warm brown leather with lighter inner panel, blank center, ${STYLE}` },
  { id: "dialogue-bubble", size: "1536x1024", prompt: `wide rounded speech bubble like in a cozy life-sim game, cream paper fill with wobbly hand-drawn border and a small tail at bottom-left, blank inside, ${STYLE}` },
  { id: "btn-gold", size: "1536x1024", prompt: `wide rounded rectangle game button, brass gold body with carved wooden rim, glossy top highlight, blank label area, ${STYLE}` },
  { id: "btn-red", size: "1536x1024", prompt: `wide rounded rectangle game button, warm cherry red body with carved wooden rim, glossy top highlight, blank label area, ${STYLE}` },
  { id: "btn-blue", size: "1536x1024", prompt: `wide rounded rectangle game button, friendly cobalt blue body with carved wooden rim, glossy top highlight, blank label area, ${STYLE}` },
  { id: "btn-kickoff", size: "1536x1024", prompt: `large festive game button shaped like a wooden plaque with a small referee whistle charm hanging at the right side and two tiny ribbon banners on top corners, brass gold face, blank label area, ${STYLE}` },
  { id: "menu-pill", size: "1536x1024", prompt: `small horizontal pill-shaped tab button, parchment face with wooden outline, like a menu tab in a cozy farming game, blank, ${STYLE}` },
  { id: "score-frame", size: "1536x1024", prompt: `extremely wide and thin horizontal scoreboard plank for a football game HUD, very elongated rounded wooden board (height about one sixth of the width), warm brown wood with a simple carved border, two round cream parchment medallions for score numbers, one centered at a quarter of the width from the LEFT edge and one centered at a quarter of the width from the RIGHT edge (both fairly close to the middle, NOT at the ends), a small semicircular notch dip at the top-center edge where a clock badge sits, flat front view, NO text, NO numbers, NO logos, ${STYLE}` },
  { id: "avatar-frame", size: "1024x1024", prompt: `circular wooden portrait frame with carved ring and a small blank nameplate at the bottom, empty transparent center hole, ${STYLE}` },
  { id: "key-cap", size: "1024x1024", prompt: `single square keyboard keycap with rounded corners, cream top and warm brown sides, slight 3/4 top-down view, blank top, ${STYLE}` },
  { id: "event-card-frame", size: "1024x1536", prompt: `vertical ornate event card frame for a sports game, parchment center, wooden border with brass corner caps and a ribbon banner across the top, blank, ${STYLE}` },
  { id: "stamp-seal", size: "1024x1024", prompt: `round red wax seal stamp with an animal paw print embossed in the center, slightly irregular dripping edge, ${STYLE}` },
  { id: "lang-globe", size: "1024x1024", prompt: `small round hand-drawn globe icon on a short wooden stand, simplified continents, cozy cartoon style, ${STYLE}` },
];

// Knock out the magenta key: alpha=0 where magenta dominates, with a soft
// edge band (partial alpha + despill) so watercolor outlines keep their shape.
async function chromaKey(buf) {
  const sharp = (await import("sharp")).default;
  const img = sharp(buf).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const magenta = Math.min(r, b) - g; // high when r&b dominate g
    if (magenta > 96) {
      data[i + 3] = 0;
    } else if (magenta > 40) {
      data[i + 3] = Math.round(255 * (1 - (magenta - 40) / 56));
      data[i + 1] = Math.max(g, Math.round((r + b) / 2 * 0.8)); // despill edge
    }
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();
}

// Trim transparent margins (plus a small uniform pad) so CSS boxes align with
// the visible art instead of with invisible generated whitespace.
async function trimEdges(buf) {
  const sharp = (await import("sharp")).default;
  try {
    return await sharp(buf)
      .trim({ threshold: 8 })
      .extend({ top: 6, bottom: 6, left: 6, right: 6, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
  } catch {
    return buf; // fully-opaque or trim failure: keep as-is
  }
}

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const force = args.includes("--force");

mkdirSync(outDir, { recursive: true });

async function generate(asset) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch("https://aigw-api.betteryeah.com/openai/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-image-2",
          prompt: asset.prompt,
          n: 1,
          size: asset.size,
          quality: asset.quality || "medium",
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const json = await res.json();
      const item = json.data && json.data[0];
      if (!item) throw new Error("no data in response: " + JSON.stringify(json).slice(0, 200));
      let buf;
      if (item.b64_json) buf = Buffer.from(item.b64_json, "base64");
      else if (item.url) buf = Buffer.from(await (await fetch(item.url)).arrayBuffer());
      else throw new Error("no b64_json/url in response item");
      if (!asset.opaque) buf = await trimEdges(await chromaKey(buf));
      writeFileSync(join(outDir, `${asset.id}.png`), buf);
      return true;
    } catch (err) {
      console.error(`  [${asset.id}] attempt ${attempt} failed: ${String(err).slice(0, 200)}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 4000));
    }
  }
  return false;
}

const targets = ASSETS.filter((a) => !only || a.id === only);
if (!targets.length) {
  console.error(`unknown --only id; valid: ${ASSETS.map((a) => a.id).join(", ")}`);
  process.exit(1);
}
let okCount = 0, failed = [];
for (const asset of targets) {
  const out = join(outDir, `${asset.id}.png`);
  if (existsSync(out) && !force) {
    console.log(`skip ${asset.id} (exists)`);
    okCount++;
    continue;
  }
  process.stdout.write(`gen  ${asset.id} (${asset.size})... `);
  const ok = await generate(asset);
  console.log(ok ? "ok" : "FAILED");
  ok ? okCount++ : failed.push(asset.id);
}
console.log(`\n${okCount}/${targets.length} ready${failed.length ? `; failed: ${failed.join(", ")}` : ""}`);
process.exit(failed.length ? 1 : 0);
