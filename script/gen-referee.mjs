// Generate a referee character in the project's hand-drawn style, using the
// same gpt-image-2 + magenta color-key recipe as the portrait/crowd generators.
// Output: public/animal-cup/referee.png (transparent). Re-run to regenerate.
import fs from "fs";
import sharp from "sharp";

const apiKey =
  process.env.BTY_API_KEY ||
  (fs.readFileSync(".env.local", "utf8").match(/^BTY_API_KEY=(.+)$/m) || [])[1];
if (!apiKey) { console.error("no BTY_API_KEY in env or .env.local"); process.exit(1); }

const prompt =
  "one super cute chubby cartoon ZEBRA football referee character, full body head to toe, standing, " +
  "in a THREE-QUARTER (3/4) view: the body turned about 45 degrees and seen from slightly ABOVE, " +
  "the exact same camera angle as small cartoon soccer players shown on a top-down arcade football pitch, " +
  "head, torso, both arms and both legs all visible and slightly foreshortened, feet planted on the ground, " +
  "wearing a black-and-white vertical striped referee shirt, black shorts, black socks and small black shoes, " +
  "a little whistle on a cord around the neck, one hand slightly raised, " +
  "oversized round head, big round dark sparkling eyes, soft warm naive smile, simple rounded kawaii shapes, " +
  "uniform soft hand-drawn storybook style, clean thick dark-brown outlines, flat gentle pastel colors, minimal stripe detail, " +
  "the EXACT same illustration style as cute cartoon animal soccer players, " +
  "SOLID FLAT MAGENTA background (hex FF00FF) only behind everything, no shadow on ground, " +
  "no text, no letters, no numbers, no logos, no watermark";

const OUT = process.argv[2] || "public/animal-cup/referee_34.png";
const W = 1024, H = 1024;
console.log("requesting gpt-image-2...");
const res = await fetch("https://aigw-api.betteryeah.com/openai/v1/images/generations", {
  method: "POST",
  headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  body: JSON.stringify({ model: "gpt-image-2", prompt, n: 1, size: `${W}x${H}`, quality: "high" }),
});
if (!res.ok) { console.error("gateway error", res.status, (await res.text()).slice(0, 400)); process.exit(1); }
const json = await res.json();
const item = json.data && json.data[0];
if (!item) { console.error("no image in response", JSON.stringify(json).slice(0, 400)); process.exit(1); }
const raw = item.b64_json
  ? Buffer.from(item.b64_json, "base64")
  : Buffer.from(await (await fetch(item.url)).arrayBuffer());

// magenta chroma-key + despill (same formula as generate-portrait-sheet.mjs)
const { data, info } = await sharp(raw).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
for (let i = 0; i < data.length; i += 4) {
  const magenta = Math.min(data[i], data[i + 2]) - data[i + 1];
  if (magenta > 96) data[i + 3] = 0;
  else if (magenta > 40) {
    data[i + 3] = Math.round(255 * (1 - (magenta - 40) / 56));
    data[i + 1] = Math.max(data[i + 1], Math.round(((data[i] + data[i + 2]) / 2) * 0.8));
  }
}
await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
  .trim({ threshold: 8 })
  .extend({ top: 6, bottom: 6, left: 6, right: 6, background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile(OUT);
console.log("saved", OUT);
