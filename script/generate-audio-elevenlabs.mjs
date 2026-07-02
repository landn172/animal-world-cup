#!/usr/bin/env node
/**
 * Generate the match sound set with ElevenLabs Sound Effects (text-to-SFX).
 * Brand-new audio — the project ships NO original-game audio, so this is
 * purely additive (no bundled .ogg audio is ever copied). Mirrors the
 * gpt-image pipeline: idempotent, per-id, `--only <id>` / `--force` reroll.
 *
 *   ELEVENLABS_API_KEY=... node script/generate-audio-elevenlabs.mjs
 *   node script/generate-audio-elevenlabs.mjs --only whistle_kickoff --force
 *
 * Key: web/.env.local  ELEVENLABS_API_KEY=...  (gitignored, never commit).
 * Output: public/animal-cup/audio/<id>.mp3 (committed, served statically).
 *
 * Endpoint: POST https://api.elevenlabs.io/v1/sound-generation
 *   headers: { "xi-api-key": KEY, "Content-Type": "application/json" }
 *   body:    { text, duration_seconds?, prompt_influence? }  → audio/mpeg
 * (Confirm current params against ElevenLabs docs if the API has moved.)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(root, "public/animal-cup/audio");

// cartoon-football sound set. duration in seconds (ElevenLabs SFX caps ~22s);
// loop=true ones are designed to tile seamlessly as ambience/looping cues.
const SOUNDS = [
  { id: "whistle_kickoff",  text: "a single short crisp referee whistle blow to start a match, clean, no reverb",                 duration: 1.2 },
  { id: "whistle_fulltime", text: "three short referee whistle blows signalling the end of a football match, crisp",              duration: 2.0 },
  { id: "whistle_foul",     text: "one sharp referee whistle blow for a foul, short and clean",                                   duration: 1.0 },
  // gameplay kicks (owner: 射门一种音、传球一种音)
  { id: "shot",             text: "a powerful football shot, a sharp crisp leather thwack as the ball is struck hard",            duration: 0.6 },
  { id: "pass",             text: "a short soft football pass, a light leather tap of a foot nudging the ball",                   duration: 0.5 },
  { id: "ball_bounce",      text: "a soft rubbery soccer ball bouncing once on grass, gentle, cartoon",                          duration: 0.5 },
  { id: "post_hit",         text: "a soccer ball hitting a wooden goalpost, hollow knock, short",                                duration: 0.7 },
  // background layers (owner: 很多动物在叫的环境音 + 一条背景垫乐)
  { id: "crowd_ambience",   text: "a warm lively chorus of many different cartoon animals together — soft chirps, hoots, squeaks, chitters, growls and calls — gentle steady stadium ambience, no human voices", duration: 20, loop: true },
  { id: "music_bed",        text: "a gentle cheerful looping background music bed for a cute cartoon animal sports game, soft warm marimba and ukulele, light and playful, no drums, seamless loop", duration: 24, loop: true },
  // per-team goal celebration = that nation's animal call (owner spec).
  // v2 prompts (owner 2026-06-12: 不像对应的动物): species-specific,
  // documentary-style descriptions + high prompt influence so the model
  // follows the text instead of drifting into generic animal mush
  { id: "cheer_lion",    text: "one majestic adult male African lion roar, deep guttural and powerful, wildlife documentary close-up recording, no background noise",         duration: 2.2, influence: 0.75 },
  { id: "cheer_jaguar",  text: "a jaguar's deep raspy sawing roar, the coughing grunt-roar of a big jungle cat, wildlife documentary recording, close, no background noise",  duration: 2.0, influence: 0.75 },
  { id: "cheer_puma",    text: "a mountain lion cougar loud raspy scream-yowl, fierce wild cat cry, wildlife documentary recording, no background noise",                     duration: 1.8, influence: 0.75 },
  { id: "cheer_wolf",    text: "a single grey wolf howl, long clear iconic howl rising then slowly fading, wildlife documentary recording, no background noise",              duration: 2.6, influence: 0.75 },
  { id: "cheer_eagle",   text: "a piercing raptor screech, the classic sharp descending red-tailed hawk style eagle cry, two calls, wildlife recording, no background noise", duration: 1.8, influence: 0.75 },
  { id: "cheer_bull",    text: "a big fighting bull bellowing loudly with a deep chesty moo-roar followed by a strong nostril snort, close recording, no background noise",   duration: 2.0, influence: 0.75 },
  { id: "cheer_rooster", text: "a loud clear rooster crowing one full cock-a-doodle-doo at dawn, proud and bright, close farmyard recording, no background noise",            duration: 2.2, influence: 0.75 },
  { id: "ui_click",         text: "a soft woody paper-craft button click, gentle and cozy, very short",                          duration: 0.3 },
  { id: "ui_select",        text: "a soft cheerful pop confirming a menu selection, cozy cartoon, short",                        duration: 0.4 },
];

function apiKey() {
  let k = process.env.ELEVENLABS_API_KEY;
  if (!k && existsSync(join(root, ".env.local"))) {
    k = (readFileSync(join(root, ".env.local"), "utf8").match(/^ELEVENLABS_API_KEY=(.+)$/m) || [])[1];
  }
  return k && k.trim();
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
  const force = args.includes("--force");
  const KEY = apiKey();
  if (!KEY) {
    console.error("Missing ELEVENLABS_API_KEY (env or web/.env.local). Scaffold is ready; add the key and re-run.");
    process.exit(1);
  }
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

  const list = SOUNDS.filter((s) => !only || s.id === only);
  let made = 0;
  for (const s of list) {
    const out = join(OUT, `${s.id}.mp3`);
    if (existsSync(out) && !force) { console.log(`skip  ${s.id} (exists)`); continue; }
    process.stdout.write(`gen   ${s.id} (${s.duration}s)... `);
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
          method: "POST",
          headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
          // duration must be 0.5–30s; `loop` (smooth-looping) needs the default
          // eleven_text_to_sound_v2 model and is what makes ambience tile.
          body: JSON.stringify({
            text: s.text,
            duration_seconds: Math.max(0.5, Math.min(30, s.duration)),
            prompt_influence: s.influence || 0.4,
            loop: !!s.loop,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
        writeFileSync(out, Buffer.from(await res.arrayBuffer()));
        console.log("ok");
        made++;
        break;
      } catch (err) {
        console.log(`\n  attempt ${attempt}: ${String(err).slice(0, 200)}`);
        if (attempt === 3) process.exitCode = 1;
        else await new Promise((r) => setTimeout(r, attempt * 4000));
      }
    }
  }
  console.log(`\n${made}/${list.length} generated → ${OUT}`);
}

await main();
