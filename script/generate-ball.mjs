#!/usr/bin/env node
/**
 * Generate the match ball texture via gpt-image-2 IMAGE EDIT (img2img) of a
 * source ball map, so the equirectangular sphere wrap (and its shading) is
 * preserved while the surface is repainted in our hand-drawn style. The
 * 512x256 texture wraps around the rolling-ball mesh (data/balls/classic_1/
 * ball.json), so the LEFT and RIGHT edges must connect seamlessly.
 *
 *   node script/generate-ball.mjs            # classic cartoon soccer ball
 *   node script/generate-ball.mjs --preview-only
 *
 * Key: web/.env.local BTY_API_KEY (gitignored). Output:
 *   data/balls/classic_1/texture.png  (512x256, previous recoverable via git)
 *   preview kept at public/animal-cup/ui/gen/_ball-preview.png
 */
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
// the classic ball-map panel layout has correct panel layout + sphere
// shading; we repaint it into our style (a generic black/white football
// pattern is not protectable, and the output is freshly generated art).
// in-repo source (decoupled from the build output); env override allowed
const DEFAULT_SRC = process.env.BALL_SRC || join(root, "assets-src/original/ball-texture.png");
const OUT = join(root, "match-runtime-assets-source/data/balls/classic_1/texture.png");
const PREVIEW = join(root, "public/animal-cup/ui/gen/_ball-preview.png");

const PROMPT =
  "repaint this spherical ball texture map as a CLASSIC SOCCER BALL: a clean " +
  "pattern of white panels with a few soft charcoal-black pentagon panels, " +
  "hand-drawn storybook watercolor style with gentle dark-brown line work and " +
  "subtle paper grain, cozy and friendly (matching a cute cartoon animal " +
  "football game). Keep the same overall brightness distribution as the source " +
  "so the sphere shading still reads (lit from upper-left). CRITICAL: this is an " +
  "equirectangular wrap-around texture — the LEFT and RIGHT edges must connect " +
  "seamlessly and the panel pattern stays evenly distributed. No text, no logos, no watermark.";

async function main() {
  const args = process.argv.slice(2);
  const src = args.includes("--src") ? args[args.indexOf("--src") + 1] : DEFAULT_SRC;
  const previewOnly = args.includes("--preview-only");
  const sharp = (await import("sharp")).default;

  let apiKey = process.env.BTY_API_KEY;
  if (!apiKey) apiKey = (readFileSync(join(root, ".env.local"), "utf8").match(/^BTY_API_KEY=(.+)$/m) || [])[1];
  if (!apiKey) { console.error("missing BTY_API_KEY"); process.exit(1); }

  const meta = await sharp(src).metadata();
  const inputPng = await sharp(src).resize(1536, 1024, { fit: "fill" }).png().toBuffer();

  const form = new FormData();
  form.append("model", "gpt-image-2");
  form.append("prompt", PROMPT);
  form.append("size", "1536x1024");
  form.append("quality", "high");
  form.append("image", new Blob([inputPng], { type: "image/png" }), "ball.png");

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch("https://aigw-api.betteryeah.com/openai/v1/images/edits", {
        method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const json = await res.json();
      const buf = Buffer.from(json.data[0].b64_json, "base64");
      writeFileSync(PREVIEW, buf);
      console.log("preview:", PREVIEW);
      if (!previewOnly) {
        const out = await sharp(buf).resize(meta.width || 512, meta.height || 256, { fit: "fill", kernel: "lanczos3" }).png().toBuffer();
        writeFileSync(OUT, out);
        console.log(`ball texture written: ${OUT} (${meta.width}x${meta.height})`);
      }
      return;
    } catch (err) {
      console.error(`attempt ${attempt}: ${String(err).slice(0, 200)}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 5000));
      else process.exit(1);
    }
  }
}

await main();
