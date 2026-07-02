"use client";

import { useEffect, useRef, useState } from "react";
import { rollFormations } from "./data/formations";

const runtimeBase = "/match-runtime-min";

const stylesheets = [
  `${runtimeBase}/fonts/cup-round.css`,
  `${runtimeBase}/styles/match.css`,
];

const baseScripts = [
  `${runtimeBase}/shim-early.js`,
  `${runtimeBase}/vendor/pixi.min.js`,
  `${runtimeBase}/vendor/swig.min.js`,
  `${runtimeBase}/shim.js`,
];

function getGameBundleScript() {
  return `${runtimeBase}/scripts/match.rebuilt.js`;
}

function installStylesheets() {
  for (const href of stylesheets) {
    if (document.querySelector(`link[data-game-style="${href}"]`)) continue;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.gameStyle = href;
    document.head.appendChild(link);
  }
}

// Prefetch cache: filled by parallel download, consumed by loadScript
const _prefetchedScripts = {};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(
      `script[data-game-script="${src}"]`,
    );
    if (existing) {
      if (existing.dataset.loaded === "true") resolve();
      else {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
      }
      return;
    }

    const script = document.createElement("script");
    script.dataset.gameScript = src;

    // If we have prefetched text, use a blob URL (instant, no network)
    const text = _prefetchedScripts[src];
    if (text) {
      const blob = new Blob([text], { type: "application/javascript" });
      script.src = URL.createObjectURL(blob);
    } else {
      script.src = src;
    }

    script.async = false;
    script.addEventListener(
      "load",
      () => {
        script.dataset.loaded = "true";
        resolve();
      },
      { once: true },
    );
    script.addEventListener("error", reject, { once: true });
    document.body.appendChild(script);
  });
}

function installForceRefresh() {
  window.onerror = function (message, source, lineno, colno) {
    const match = String(source || "").match(
      /chrome-extension:\/\/[a-z]+\/(.*)/,
    );
    if (match) source = match[1];
    console.error(
      "[uncaught] " +
        message +
        "\n" +
        "File: " +
        source +
        "@" +
        lineno +
        "," +
        colno,
    );
  };

  window.ondrop = window.ondragover = function (event) {
    event.preventDefault();
    return false;
  };

  const leftTop = document.getElementById("forceRefreshCanvas1");
  const rightBottom = document.getElementById("forceRefreshCanvas2");
  if (!leftTop || !rightBottom || window.__gameForceRefreshInstalled) return;
  window.__gameForceRefreshInstalled = true;

  const leftTopContext = leftTop.getContext("2d");
  const rightBottomContext = rightBottom.getContext("2d");

  function forceRefresh() {
    leftTopContext.clearRect(0, 0, leftTop.width, leftTop.height);
    rightBottomContext.clearRect(0, 0, rightBottom.width, rightBottom.height);
    requestAnimationFrame(forceRefresh);
  }

  forceRefresh();
}

// post-mortem boot diagnostics: console never flushes once the main thread
// wedges, so stage marks + a heartbeat go to localStorage where a second
// same-origin tab can read them after the fact.
function markBoot(stage) {
  try {
    localStorage.setItem(
      "bootStages",
      (localStorage.getItem("bootStages") || "") + Date.now() + " " + stage + "\n",
    );
  } catch (e) {}
}

function emitStage(msg) {
  try { window.dispatchEvent(new CustomEvent("ab-load-stage", { detail: msg })); } catch (e) {}
}

async function bootRuntime() {
  if (window.__gameRuntimeBooted) return;
  window.__gameRuntimeBooted = true;

  const t0 = performance.now();
  const log = (msg) => { console.info(`[boot +${((performance.now() - t0) / 1000).toFixed(2)}s] ${msg}`); emitStage(msg); };

  try {
    localStorage.removeItem("bootStages");
    localStorage.removeItem("bootTrace");
  } catch (e) {}
  markBoot("bootRuntime:start");
  log("bootRuntime:start");
  setInterval(() => {
    try { localStorage.setItem("bootHeartbeat", String(Date.now())); } catch (e) {}
  }, 500);

  installStylesheets();
  installForceRefresh();
  log("stylesheets + forceRefresh installed");

  // Strategy: start data-bundle download in background (don't await it),
  // fetch scripts in parallel (much smaller, ~1.4MB total), execute them.
  // The shim needs the bundle when setupCollections() runs — by then the
  // 6.9MB bundle should be done (it downloads concurrently with scripts).
  // If not, the shim falls back to sync XHR (which hits SW cache if ready).
  const allScripts = [...baseScripts, getGameBundleScript(), `${runtimeBase}/standalone-match.js`];

  // Fire-and-forget: data bundle downloads in background
  const bundlePromise = fetch(`${runtimeBase}/__data-bundle.json`)
    .then(r => r.text())
    .then(text => {
      window.__dataBundleCache = text;
      log("data bundle ready (" + (text.length / 1024 | 0) + "KB)");
    })
    .catch(e => log("bundle fetch failed: " + e.message));

  // Also prefetch dirlist (small)
  fetch(`${runtimeBase}/__dirlist.json`)
    .then(r => r.text())
    .then(text => { window.__dirlistCache = text; })
    .catch(() => {});

  // Fetch scripts in parallel (total ~1.4MB, much faster than 6.9MB bundle)
  log("fetching scripts: " + allScripts.length + " files");
  const scriptResults = await Promise.allSettled(
    allScripts.map(url => fetch(url).then(r => r.text()).then(text => ({ url, text })))
  );
  for (const r of scriptResults) {
    if (r.status === "fulfilled") {
      _prefetchedScripts[r.value.url] = r.value.text;
    }
  }
  const fetchedCount = scriptResults.filter(r => r.status === "fulfilled").length;
  log("scripts fetched: " + fetchedCount + "/" + allScripts.length);

  // Now wait for the bundle — scripts are ready, we just need data before executing shim
  log("waiting for data bundle...");
  await bundlePromise;
  log("bundle ready, executing scripts");

  let formations = null;
  try {
    const stored = sessionStorage.getItem("matchFormations");
    if (stored) { formations = JSON.parse(stored); sessionStorage.removeItem("matchFormations"); }
  } catch (e) {}
  if (!formations) formations = rollFormations();
  window.__matchFormations = formations;
  try { window.dispatchEvent(new CustomEvent("ab-formations", { detail: formations })); } catch (e) {}

  // Execute scripts sequentially (order matters) — but network is already done
  log("executing scripts sequentially...");
  for (const src of allScripts) {
    await loadScript(src);
    markBoot("loaded " + src);
  }
  log("all scripts executed");

  // standalone-match.js already loaded above
  const params = new URLSearchParams(window.location.search);
  markBoot("loaded standalone-match.js");

  log("calling __startStandaloneMatch");
  window.__startStandaloneMatch({
    red: params.get("red") || "england",
    blue: params.get("blue") || "france",
    stadium: params.get("stadium") || "international",
    ball: params.get("ball") || "classic_1",
    time: params.get("time") || 2,
    // Watch mode defaults to ai 3 (tight, defensive AI-vs-AI). Play mode is a
    // human controlling one player against a whole AI team, so default to the
    // EASIEST level (0) — even 1 pressed too hard to enjoy. ?ai= still overrides.
    ai: params.get("ai") || (params.get("play") === "1" ? 0 : 3),
    // which kit YOUR team (red slot) wears: home / away (opponent gets contrast)
    side: params.get("side") || "home",
  });
  log("__startStandaloneMatch returned — waiting for ab-match-started event");
  markBoot("startStandaloneMatch returned");
}

export default function GameClient() {
  const [mounted, setMounted] = useState(false);
  const bootStarted = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || bootStarted.current) return;
    bootStarted.current = true;
    bootRuntime().catch((error) => {
      console.error("[game-runtime] failed to boot", error);
    });
  }, [mounted]);

  useEffect(() => {
    function onMatchStarted(event) {
      console.info("[ab-match] ready", event.detail || {});
    }

    window.addEventListener("ab-match-started", onMatchStarted);
    return () => window.removeEventListener("ab-match-started", onMatchStarted);
  }, []);

  if (!mounted) return null;

  return (
    <>
      <div id="gui" className="gui">
        <canvas
          id="forceRefreshCanvas1"
          width="1"
          height="1"
          style={{ position: "fixed", top: 0, left: 0 }}
        />
        <canvas
          id="forceRefreshCanvas2"
          width="1"
          height="1"
          style={{ position: "fixed", bottom: 0, right: 0 }}
        />

        <svg width="10" height="10" className="pattern">
          <defs>
            <pattern
              id="pattern-1"
              patternUnits="userSpaceOnUse"
              width="100"
              height="100"
            >
              <animate
                attributeName="x"
                from="0"
                to="100"
                dur="2s"
                repeatCount="indefinite"
              />
              <image
                xlinkHref={`${runtimeBase}/images/interface/pattern.png`}
                x="0"
                y="0"
                width="100"
                height="100"
                preserveAspectRatio="none"
              />
            </pattern>
            <pattern
              id="pattern-1-light"
              patternUnits="userSpaceOnUse"
              width="100"
              height="100"
            >
              <animate
                attributeName="x"
                from="0"
                to="100"
                dur="2s"
                repeatCount="indefinite"
              />
              <image
                xlinkHref={`${runtimeBase}/images/interface/pattern.png`}
                x="0"
                y="0"
                width="100"
                height="100"
                preserveAspectRatio="none"
              />
              <rect
                x="0"
                y="0"
                width="100"
                height="100"
                fill="rgba(255, 255, 255, 0.25)"
              />
            </pattern>
          </defs>
        </svg>
      </div>

      <dl id="debug">
        <dt>Rendering</dt>
        <dd id="fps" />
        <dt>Network</dt>
        <dd id="net" />
      </dl>

      <script
        type="application/vnd.core-settings+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            { DATA_PREFIX: "match-runtime-min/data", DEBUG: false },
            null,
            2,
          ),
        }}
      />
    </>
  );
}
