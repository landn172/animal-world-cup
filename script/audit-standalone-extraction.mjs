import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();

const productRoots = [
  "app",
  "script",
  "match-runtime-source",
  "match-runtime-assets-source",
  "public/match-runtime-min",
];

function rx(parts, flags = "i") {
  return new RegExp(parts.join(""), flags);
}

const disallowedText = [
  rx(["ko", "pan", "ito"]),
  rx(["ka", "pan", "ito"]),
  rx(["me", "rix"]),
  rx(["me", "rix", "games"]),
  rx(["personal", " local ", "research"]),
  rx(["not for ", "redistribution"]),
  /window\.nw/i,
  /nw\.gui/i,
  rx(["green", "works"]),
  rx(["st", "eam"]),
  rx(["x", "box"]),
  rx(["play", "station"]),
  rx(["nin", "tendo"]),
];

const disallowedOutputPaths = [
  /(^|\/)gui(\/|$)/i,
  /(^|\/)scripts\/all/i,
  /main_menu/i,
  /leaderboard/i,
  /achievement/i,
  /tournament/i,
  /multiplayer/i,
  /lobby/i,
  /podium/i,
  /news/i,
  /store/i,
  /logo/i,
  rx(["me", "rix"]),
  rx(["ko", "pan", "ito"]),
  rx(["ka", "pan", "ito"]),
  rx(["st", "eam"]),
  rx(["x", "box"]),
  rx(["play", "station"]),
  rx(["nin", "tendo"]),
];

const ignoredTextPaths = [
  /^script\/audit-standalone-extraction\.mjs$/,
  /^public\/match-runtime-min\/vendor\//,
  /^match-runtime-assets-source\/vendor\//,
  /^public\/match-runtime-min\/fonts\//,
  /^match-runtime-assets-source\/fonts\//,
  /^docs\//,
];

const textExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".txt",
]);

const failures = [];

function fail(message) {
  failures.push(message);
}

function walk(relativeRoot, out = []) {
  const fullRoot = path.join(rootDir, relativeRoot);
  if (!fs.existsSync(fullRoot)) return out;
  for (const entry of fs.readdirSync(fullRoot, { withFileTypes: true })) {
    const relative = path.join(relativeRoot, entry.name).replaceAll(path.sep, "/");
    if (entry.isDirectory()) walk(relative, out);
    else out.push(relative);
  }
  return out;
}

function isIgnoredForText(relativePath) {
  return ignoredTextPaths.some((pattern) => pattern.test(relativePath));
}

function auditText() {
  for (const root of productRoots) {
    for (const relativePath of walk(root)) {
      if (isIgnoredForText(relativePath)) continue;
      if (!textExtensions.has(path.extname(relativePath))) continue;
      const text = fs.readFileSync(path.join(rootDir, relativePath), "utf8");
      for (const pattern of disallowedText) {
        if (pattern.test(text)) {
          fail(`Disallowed text ${pattern} in ${relativePath}`);
        }
      }
    }
  }
}

function auditOutputPaths() {
  for (const relativePath of walk("public/match-runtime-min")) {
    const outputRelative = relativePath.replace(/^public\/match-runtime-min\//, "");
    for (const pattern of disallowedOutputPaths) {
      if (pattern.test(outputRelative)) {
        fail(`Disallowed output path ${outputRelative}`);
      }
    }
  }
}

function auditOldPublicRoots() {
  for (const relativePath of [
    "public/gui",
    "public/images",
    "public/scripts",
    "public/styles",
    "public/vendor",
    "public/shim.js",
    "public/shim-early.js",
  ]) {
    if (fs.existsSync(path.join(rootDir, relativePath))) {
      fail(`Old public runtime artifact still exists: ${relativePath}`);
    }
  }
}

function auditPlayerAssets() {
  const expected = new Set([
    ".",
    "kit",
    "races",
    "races/argentina",
    "races/brazil",
    "races/england",
    "races/france",
    "races/germany",
    "races/portugal",
    "races/spain",
    "races/skeleton",
    "races/usa",
  ]);

  for (const playerRoot of [
    path.join(rootDir, "match-runtime-assets-source/data/player"),
    path.join(rootDir, "public/match-runtime-min/data/player"),
  ]) {
    const actual = [];
    function collectDirs(directory) {
      const relative = path.relative(playerRoot, directory).replaceAll(path.sep, "/");
      actual.push(relative || ".");
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) collectDirs(path.join(directory, entry.name));
      }
    }
    collectDirs(playerRoot);
    const rootLabel = path.relative(rootDir, playerRoot);
    for (const dir of actual) {
      if (!expected.has(dir)) fail(`Unexpected player asset directory in ${rootLabel}: ${dir}`);
    }
    for (const dir of expected) {
      if (!actual.includes(dir)) fail(`Missing player asset directory in ${rootLabel}: ${dir}`);
    }
  }
}

function auditSourceOutputAssetParity() {
  const sourceFiles = walk("match-runtime-assets-source").map((file) =>
    file.replace(/^match-runtime-assets-source\//, ""),
  );
  const outputFiles = walk("public/match-runtime-min").map((file) =>
    file.replace(/^public\/match-runtime-min\//, ""),
  );
  const output = new Set(outputFiles);
  const source = new Set(sourceFiles);
  const generatedOutputOnly = new Set(["__dirlist.json", "scripts/match.rebuilt.js"]);

  for (const file of sourceFiles) {
    if (!output.has(file)) fail(`Source asset is not emitted by standalone build: ${file}`);
  }

  for (const file of outputFiles) {
    if (!source.has(file) && !generatedOutputOnly.has(file)) {
      fail(`Output asset has no source asset or known generator: ${file}`);
    }
  }
}

function auditGamepadAssets() {
  const gamepadRoot = path.join(
    rootDir,
    "public/match-runtime-min/images/interface/gamepad",
  );
  const files = fs.readdirSync(gamepadRoot).sort();
  for (const file of files) {
    if (!/^pad_.*\.png$/.test(file)) {
      fail(`Non-generic gamepad asset emitted: ${file}`);
    }
  }
  if (files.length !== 24) {
    fail(`Expected 24 generic gamepad assets, found ${files.length}`);
  }
}

function auditTeams() {
  const teamsRoot = path.join(rootDir, "public/match-runtime-min/data/teams");
  const teams = fs
    .readdirSync(teamsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const expected = [
    "argentina",
    "brazil",
    "england",
    "france",
    "germany",
    "portugal",
    "spain",
    "usa",
  ];
  if (JSON.stringify(teams) !== JSON.stringify(expected)) {
    fail(`Unexpected team set: ${teams.join(", ")}`);
  }
}

auditText();
auditOutputPaths();
auditOldPublicRoots();
auditPlayerAssets();
auditSourceOutputAssetParity();
auditGamepadAssets();
auditTeams();

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      productRoots,
      checks: [
        "disallowed text",
        "disallowed output paths",
        "old public runtime roots absent",
        "normalized source/output player assets",
        "source/output asset parity",
        "generic gamepad assets",
        "8-team output set",
      ],
    },
    null,
    2,
  ),
);
