#!/usr/bin/env node
/**
 * Generate crowd-animal PART SHEETS from the player template, owner's spec:
 * img2img assets-src/new-template.png per species, LOCKING canvas / 4x4 grid /
 * cell sizes / borders / dark background / all text labels, and only swapping
 * the character material —
 *   - head_front_3q_right / head_back_3q_right → cute animal head, 3/4 facing right
 *   - neck, arms, hands, knee → recolor to the animal's fur/skin, KEEP the
 *     human body structure (upper arm + forearm + human-like hand). NO paws.
 *   - clothing cells → left as-is (the crowd shares the recolored kit).
 *
 * Output: assets-src/crowd-sheets/<id>.png (dark-bg sheets in the SAME format
 * as the team source sheets). Extraction into race folders is done by
 * crowd-extract.py (reuses the proven label-aware cell extractor).
 *
 *   node script/generate-crowd-from-template.mjs --limit 4   # validation
 *   node script/generate-crowd-from-template.mjs --only lion --force
 *   node script/generate-crowd-from-template.mjs             # full roster
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { SPECIES } from "./crowd-species.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const TEMPLATE = process.env.PART_TEMPLATE || join(root, "assets-src/new-template.png");
const outDir = join(root, "assets-src/crowd-sheets");
const sharp = (await import("sharp")).default;

let apiKey = process.env.BTY_API_KEY;
if (!apiKey && existsSync(join(root, ".env.local"))) apiKey = (readFileSync(join(root, ".env.local"), "utf8").match(/^BTY_API_KEY=(.+)$/m) || [])[1];

function prompt(species) {
  return [
    `Based on this 4x4 football-character part sheet, output an edited version for a cute, 呆萌, friendly cartoon ${species}-person.`,
    "STRICTLY KEEP UNCHANGED: canvas size, the 4x4 layout, every cell size and position, the cell borders, and ALL the text labels. Do NOT add/remove/move any element; no logo, crest, number, pattern, stripe, plus sign, arrow or extra text.",
    "Render the BACKGROUND behind and between every cell as SOLID FLAT MAGENTA (hex FF00FF), one uniform magenta with no gradient and no dark colour — so the parts can be cut out cleanly. Keep the magenta well away from the animal (no magenta on fur/skin/eyes).",
    `Rows 1-2 (head & body material): head_front_3q_right = a cute ${species} head, 3/4 view facing right; head_back_3q_right = the SAME ${species} head from the back, 3/4 facing right. neck, human_arm_left, human_arm_right, human_hand_left, human_hand_right, knee_no_foot = recolor ONLY to ${species} fur/skin/feather tone and texture, KEEP the exact HUMAN body structure, outline, shape and pose (an upper arm + a forearm + a human-like hand). Do NOT turn them into animal paws or claws.`,
    "Rows 3-4 (clothing & gear): leave exactly as in the template, do NOT redraw, restyle, resize or recolor.",
    "Same hand-drawn cartoon football-asset style as the template.",
  ].join(" ");
}

async function genSheet(species, outPath) {
  const input = await sharp(TEMPLATE).resize(1024, 1024, { fit: "fill" }).png().toBuffer();
  const form = new FormData();
  form.append("model", "gpt-image-2");
  form.append("prompt", prompt(species));
  form.append("size", "1024x1024");
  // crowd heads bake tiny (~1/8) — medium is plenty and ~2x faster than high
  form.append("quality", process.env.CROWD_QUALITY || "medium");
  form.append("image", new Blob([input], { type: "image/png" }), "tpl.png");
  for (let a = 1; a <= 3; a++) {
    try {
      const res = await fetch("https://aigw-api.betteryeah.com/openai/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`);
      writeFileSync(outPath, Buffer.from((await res.json()).data[0].b64_json, "base64"));
      return true;
    } catch (e) { console.log(`  attempt ${a}: ${String(e).slice(0, 140)}`); if (a < 3) await new Promise((r) => setTimeout(r, a * 5000)); }
  }
  return false;
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
  const limit = args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1], 10) : Infinity;
  const force = args.includes("--force");
  if (!apiKey) { console.error("missing BTY_API_KEY"); process.exit(1); }
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const conc = args.includes("--conc") ? parseInt(args[args.indexOf("--conc") + 1], 10) : 4;
  const todo = SPECIES.filter(([id]) => !only || id === only).slice(0, limit)
    .filter(([id]) => force || !existsSync(join(outDir, `${id}.png`)));
  console.log(`${todo.length} to generate, ${conc} at a time`);
  let made = 0, i = 0;
  async function worker() {
    while (i < todo.length) {
      const [id, species] = todo[i++];
      const ok = await genSheet(species, join(outDir, `${id}.png`));
      console.log(`${ok ? "ok  " : "FAIL"} ${id}`);
      if (ok) made++;
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  console.log(`\n${made}/${todo.length} crowd sheets -> ${outDir}\nnext: python3 script/crowd-extract.py`);
}

await main();
