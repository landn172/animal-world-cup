// Build a referee kit (black-and-white striped shirt/sleeves, black shorts/
// socks/shoes) from the shared kit part shapes — keeping each part's exact
// alpha so it maps onto the same Spine slots. Output: a ref-only kit folder so
// the team kits are untouched. Runtime assigns these textures to ONLY the ref.
import fs from "fs";
import sharp from "sharp";

const SRC = "match-runtime-assets-source/data/player/kit";
const DST = "public/animal-cup/kit-ref";
fs.mkdirSync(DST, { recursive: true });

const BAND = 5;            // stripe band width (px) in texture space
const WHITE = 244, BLACK = 28;

async function part(name, mode) {
  const src = `${SRC}/${name}.png`;
  if (!fs.existsSync(src)) return;
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const out = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const x = p % width;
    let v;
    if (mode === "stripe") v = Math.floor(x / BAND) % 2 ? WHITE : BLACK;
    else v = BLACK; // solid black
    out[p * 4] = v; out[p * 4 + 1] = v; out[p * 4 + 2] = v;
    out[p * 4 + 3] = data[p * 4 + 3]; // keep the part's alpha shape
  }
  await sharp(out, { raw: { width, height, channels: 4 } }).png().toFile(`${DST}/${name}.png`);
  console.log("  " + name + " (" + mode + ") " + width + "x" + height);
}

console.log("referee kit ->", DST);
await part("shirt_front", "stripe");
await part("shirt_back", "stripe");
await part("sleeve_left", "stripe");
await part("sleeve_right", "stripe");
await part("shorts", "black");
await part("shorts_leg", "black");
await part("socks", "black");
await part("shoes", "black");
console.log("done");
