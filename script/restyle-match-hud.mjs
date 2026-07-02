#!/usr/bin/env node
/**
 * Unify the in-match HUD atlas with the hand-drawn UI kit (visual-language
 * spec: docs/specs/2026-06-08-visual-language.md). Replaces every original
 * element that survives on the simplified top bar:
 *
 *   1. score_frame  ← generated wooden plank (public/animal-cup/ui/gen/
 *      score-frame.png, from generate-ui-assets-gpt.mjs)
 *   2. clock        ← programmatic brass/wood ring (SVG; the engine's
 *      ClockFilter shader paints the progress pie into the transparent
 *      center, so only the rim is art)
 *   3. digits 0-9 + colon ← recolored in place (white → parchment #fff2cf,
 *      shadow → outline brown #4a301e); glyph shapes are plain numerals
 *
 * Atlas: match-runtime-assets-source/images/interface/match.{png,json}
 * Sprites draw 1:1 (no 9-slice), so pixel rects are the whole contract.
 *
 *   node script/restyle-match-hud.mjs
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const GEN = join(root, "public/animal-cup/ui/gen/score-frame.png");
const ATLAS = join(root, "match-runtime-assets-source/images/interface/match.png");
const ATLAS_JSON = join(root, "match-runtime-assets-source/images/interface/match.json");
const sharp = (await import("sharp")).default;

const frames = JSON.parse(readFileSync(ATLAS_JSON, "utf8")).frames;
const atlas = await sharp(ATLAS).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = atlas.info;

function splice(rect, rgba) {
  for (let y = 0; y < rect.h; y++) {
    const src = y * rect.w * 4;
    rgba.copy(atlas.data, ((rect.y + y) * W + rect.x) * 4, src, src + rect.w * 4);
  }
}

// 1. score plank — with the painted watch-face interior wiped to clean
// parchment (the generated art draws decorative hands there; the engine's
// minute digits sit on top and need a flat face). Badge ring center measured at
// (204, 27) px in the 408x54 plank.
const plankRect = frames["interface/match/score_frame.png"].frame;
const facePatch = Buffer.from(
  `<svg width="${plankRect.w}" height="${plankRect.h}" xmlns="http://www.w3.org/2000/svg">
     <ellipse cx="204" cy="27" rx="13" ry="10.5" fill="#fff2cf" stroke="#4a301e" stroke-width="1.5"/>
   </svg>`,
);
splice(
  plankRect,
  await sharp(await sharp(GEN).trim().resize(plankRect.w, plankRect.h, { fit: "fill", kernel: "lanczos3" }).png().toBuffer())
    .composite([{ input: facePatch }])
    .ensureAlpha()
    .raw()
    .toBuffer(),
);

// 2. clock ring — brass rim + wood band + dark outlines, transparent center
const clockRect = frames["interface/match/clock.png"].frame;
const ring = `<svg width="${clockRect.w}" height="${clockRect.h}" xmlns="http://www.w3.org/2000/svg">
  <circle cx="26" cy="26" r="23.5" fill="none" stroke="#4a301e" stroke-width="3"/>
  <circle cx="26" cy="26" r="19.5" fill="none" stroke="#d9a644" stroke-width="5.5"/>
  <circle cx="26" cy="26" r="16"   fill="none" stroke="#7a4426" stroke-width="2.5"/>
  <circle cx="26" cy="26" r="14.5" fill="none" stroke="#4a301e" stroke-width="1.5"/>
  <circle cx="26" cy="4.5" r="3.2" fill="#d9a644" stroke="#4a301e" stroke-width="1.6"/>
</svg>`;
splice(clockRect, await sharp(Buffer.from(ring)).ensureAlpha().raw().toBuffer());

// 3. digits + colon — recolor in place
const BROWN = [74, 48, 30];
for (const name of ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "colon"]) {
  const r = frames[`interface/match/${name}.png`].frame;
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const i = (y * W + x) * 4;
      if (!atlas.data[i + 3]) continue;
      const lum = 0.299 * atlas.data[i] + 0.587 * atlas.data[i + 1] + 0.114 * atlas.data[i + 2];
      // digits sit on the parchment watch badge now: brown ink glyphs,
      // drop the engine's offset shadow entirely
      if (lum > 140) {
        atlas.data[i] = BROWN[0];
        atlas.data[i + 1] = BROWN[1];
        atlas.data[i + 2] = BROWN[2];
      } else {
        atlas.data[i + 3] = 0;
      }
    }
  }
}

// 4. Strip every remaining ORIGINAL HUD frame to fully transparent.
// Anti-overlap (owner directive 2026-06-08): avatars, powerup/skill
// widgets, flags, badges, skull, icon_*, challenge/vs frames are original
// engine art and are NOT used in our presentation (the engine HUD is
// hidden via ui.hide(); React draws the scoreboard). We keep our OWN
// frames (plank, clock, digits) and wipe the rest, so no recognizable
// original art ships in the atlas — while the json rects stay intact so
// the engine's Sprite.fromFrame lookups still resolve (to blank sprites).
const OURS = new Set(
  ["score_frame", "clock", "colon", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].map(
    (n) => `interface/match/${n}.png`,
  ),
);
let stripped = 0;
for (const [name, f0] of Object.entries(frames)) {
  if (OURS.has(name) || !f0.frame) continue;
  const r = f0.frame;
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const i = (y * W + x) * 4;
      atlas.data[i] = atlas.data[i + 1] = atlas.data[i + 2] = atlas.data[i + 3] = 0;
    }
  }
  stripped += 1;
}

await sharp(atlas.data, { raw: { width: W, height: H, channels: 4 } }).png().toFile(ATLAS);
console.log(`HUD restyled: plank ${plankRect.w}x${plankRect.h}, clock ring, digits recolored, ${stripped} original frames stripped → ${ATLAS}`);

// 5. Blank the built-in "VS" intro title art. vs.show() is a no-op in the
// adapter so it never animates, but the recognizable original art still
// ships. Overwrite with a same-size transparent image; the vs.json Spine
// skeleton still loads (geometry only) and renders nothing.
const VS = join(root, "match-runtime-assets-source/images/interface/vs/vs.png");
const vsMeta = await sharp(VS).metadata();
await sharp({
  create: { width: vsMeta.width, height: vsMeta.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
}).png().toFile(VS);
console.log(`VS title art blanked: ${vsMeta.width}x${vsMeta.height} → ${VS}`);
