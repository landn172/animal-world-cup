// Stamp public/sw.js's CACHE_VERSION with a content hash of every shipped game
// asset (everything the service worker caches: /match-runtime-min + /animal-cup).
// Runs before `next build` (see package.json "build"), so each deploy whose
// assets changed ships a new SW cache name → the SW purges the old cache and
// re-precaches the current build → users get the latest with NO manual refresh.
// The hash is opaque (not a date) → no version fingerprint.
//
// Defensive by design: any failure just logs and leaves sw.js unchanged — it
// must never break the build.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();
const swFile = path.join(root, "public", "sw.js");
const cachedDirs = [
  path.join(root, "public", "match-runtime-min"),
  path.join(root, "public", "animal-cup"),
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

try {
  const hash = crypto.createHash("sha256");
  let files = 0;
  for (const dir of cachedDirs) {
    for (const file of walk(dir)) {
      hash.update(path.relative(root, file));
      hash.update(fs.readFileSync(file));
      files++;
    }
  }
  const version = hash.digest("hex").slice(0, 12);

  const before = fs.readFileSync(swFile, "utf8");
  const after = before.replace(
    /const CACHE_VERSION = "[^"]*";/,
    `const CACHE_VERSION = "${version}";`,
  );
  if (after === before && !before.includes(`"${version}"`)) {
    console.warn("[stamp-sw] CACHE_VERSION line not found — sw.js unchanged");
  } else {
    fs.writeFileSync(swFile, after);
    console.log(`[stamp-sw] CACHE_VERSION = ${version} (hashed ${files} files)`);
  }
} catch (e) {
  console.warn("[stamp-sw] skipped (build continues):", e.message);
}
