"use client";

import { useEffect, useState } from "react";
import { useLocale } from "../i18n/LocaleProvider";
import { portraitSrc, runtimeHeadSrc } from "../data/teams";
import MatchEvents from "./MatchEvents";
import TouchControls from "./TouchControls";
import LangSwitcher from "../i18n/LangSwitcher";
import LoadingScreen from "./LoadingScreen";
import GoalFx from "./GoalFx";
import { StatsBars, readStats } from "./StatsPanel";
import { captureMatch } from "./captureMatch";
import { sfx } from "../audio/SoundBank";
import { IconCamera, IconCheck, IconSoundOn, IconSoundOff, IconZoomIn, IconZoomOut, IconReplay, IconHome } from "../ui/Icons";

function navigateHome() {
  window.location.href = "/";
}

function Head({ id }) {
  return (
    <span className="pp pp--lg">
      <img src={portraitSrc(id)} alt="" onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = runtimeHeadSrc(id); }} />
    </span>
  );
}

// Scoreboard + match stats in ONE top element (owner pick "E", 2026-06-15):
// score + clock on the top row, a possession bar with an expand chevron beneath.
// Tap anywhere on it to open the full detailed-stats overlay. Replaces the old
// separate top-left stats card, so the HUD reads as one clean top bar.
function Scoreboard({ teams }) {
  const { t } = useLocale();
  const [score, setScore] = useState([0, 0]);
  const [minute, setMinute] = useState(0);
  const [poss, setPoss] = useState(null);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  useEffect(() => {
    const id = setInterval(() => {
      const p = window.__matchGame && window.__matchGame.pitch;
      if (p && p.redTeam) {
        setScore([p.redTeam.score | 0, p.blueTeam.score | 0]);
        setMinute(Math.min(90, Math.floor((p.matchTime || 0) / 60)));
      }
      const s = readStats();
      if (s) { setPoss(s.possession || { red: 50, blue: 50 }); if (open) setData(s); }
    }, 500);
    return () => clearInterval(id);
  }, [open]);
  const beast = (id) => (
    <span className="ms-head"><img src={portraitSrc(id)} alt="" onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = runtimeHeadSrc(id); }} /></span>
  );
  const flag = (id) => (
    <img className="ms-flag" src={`/match-runtime-min/data/teams/${id}/flag.png`} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} />
  );
  const p = poss || { red: 50, blue: 50 };
  // toggle the inline dropdown (no modal): tap the bar to drop the full stats
  // down beneath it, tap again to collapse.
  const toggle = () => { setOpen((o) => !o); setData(readStats()); };
  const onKey = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } };
  return (
    <div className={`match-score${open ? " is-open" : ""}`} role="button" tabIndex={0}
         aria-expanded={open} aria-label={t("stats.title")} onClick={toggle} onKeyDown={onKey}>
      <span className="ms-row">
        <span className="ms-side">{flag(teams.red)}{beast(teams.red)}</span>
        <span className="ms-num">{score[0]}</span>
        <span className="ms-clock">{minute}&apos;</span>
        <span className="ms-num">{score[1]}</span>
        <span className="ms-side">{beast(teams.blue)}{flag(teams.blue)}</span>
      </span>
      <span className="ms-poss">
        <i className="ms-pct ms-pct--r">{p.red}%</i>
        <span className="ms-bar"><span className="ms-barR" style={{ width: p.red + "%" }} /><span className="ms-barB" style={{ width: p.blue + "%" }} /></span>
        <i className="ms-pct ms-pct--b">{p.blue}%</i>
        <svg className="ms-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M8 10l4 4 4-4" /></svg>
      </span>
      {open ? <div className="ms-detail"><StatsBars data={data} /></div> : null}
    </div>
  );
}

// One unified control cluster, glass style, grouped on the right (owner:
// 所有 icon 风格一致 + 玻璃质感 + 统一放在一侧). Owns the wheel/trackpad zoom
// and the sound-toggle state. Zoom + screenshot are play-only; sound + language
// stay on the result screen too.
function MatchControls({ result, onShot, shot }) {
  useEffect(() => {
    function onWheel(e) {
      if (!window.__matchZoom) return;
      e.preventDefault();
      window.__matchZoom.step(e.deltaY < 0 ? 1.1 : 1 / 1.1);
    }
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);
  const z = (fn, arg) => () => { if (window.__matchZoom) window.__matchZoom[fn](arg); };

  const [soundOn, setSoundOn] = useState(!sfx.muted);
  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    sfx.setMuted(!next);
    if (next) { sfx.startAmbience(); sfx.startMusic(); sfx.play("ui_select"); }
  }

  const { t } = useLocale();

  return (
    <div className="match-controls">
      {!result ? (
        <>
          <button className="glass-btn" data-tip={t("match.ctrl.zoomIn")} onClick={z("step", 1.18)}><IconZoomIn /></button>
          <button className="glass-btn" data-tip={t("match.ctrl.zoomOut")} onClick={z("step", 1 / 1.18)}><IconZoomOut /></button>

          <button type="button" className="glass-btn" data-tip={t("match.ctrl.screenshot")} onClick={onShot} disabled={shot === "busy"}>
            {shot === "done" ? <IconCheck /> : <IconCamera />}
          </button>
          <button type="button" className="glass-btn" data-tip={t("match.ctrl.newmatch")}
                  ref={(el) => {
                    if (el && !el.__newmatchWired) {
                      el.__newmatchWired = true;
                      el.addEventListener("click", () => { sfx.play("ui_click"); navigateHome(); });
                    }
                  }}>
            <IconHome size={20} />
          </button>
        </>
      ) : (
        <button type="button" className="glass-btn" data-tip={t("match.ctrl.newmatch")}
                ref={(el) => {
                  if (el && !el.__newmatchWired2) {
                    el.__newmatchWired2 = true;
                    el.addEventListener("click", () => { sfx.play("ui_click"); navigateHome(); });
                  }
                }}>
          <IconHome size={20} />
        </button>
      )}
      <button type="button" className="glass-btn" data-tip={soundOn ? t("match.ctrl.mute") : t("match.ctrl.unmute")} onClick={toggleSound}>
        {soundOn ? <IconSoundOn /> : <IconSoundOff />}
      </button>
      <LangSwitcher />
    </div>
  );
}

/**
 * Hand-drawn chrome around the Pixi match canvas: a loading curtain that
 * fades out on `ab-match-started`, a small wooden back-to-lobby button, and
 * the full-time result screen shown on `ab-match-ended` (the runtime can no
 * longer persist AI stats, so the result lives here instead).
 */
// Controls legend for play mode — a compact, dismissable storybook card.
// Keys mirror the runtime's default key layout: arrows move,
// D shoot/header, S pass/switch player, A lob/slide, Shift sprint.
function ControlsLegend({ t }) {
  // Expanded by default (owner: show the controls in the corner on entry); tap
  // the × to collapse back to the small "?" pill.
  const [open, setOpen] = useState(true);
  if (!open) {
    return (
      <button type="button" className="ctrl-legend__pill" onClick={() => setOpen(true)}
              aria-label={t("controls.title")}>?</button>
    );
  }
  const rows = [
    { keys: ["↑", "↓", "←", "→"], a: t("controls.move") },
    { keys: ["A"], a: t("controls.pass") },
    { keys: ["D"], a: t("controls.shoot") },
    { keys: ["W"], a: t("controls.lob") },
    { keys: ["S"], a: t("controls.tackle") },
    { keys: ["Q"], a: t("controls.switch") },
    { keys: ["Shift"], a: t("controls.sprint") },
  ];
  return (
    <div className="ctrl-legend">
      <div className="ctrl-legend__head">
        <b>{t("controls.title")}</b>
        <button type="button" className="ctrl-legend__x" onClick={() => setOpen(false)}
                aria-label="close">×</button>
      </div>
      {rows.map((r) => (
        <div className="ctrl-legend__row" key={r.a}>
          <span className="ctrl-legend__keys">
            {r.keys.map((k) => <kbd key={k}>{k}</kbd>)}
          </span>
          <span className="ctrl-legend__act">{r.a}</span>
        </div>
      ))}
    </div>
  );
}

export default function MatchChrome() {
  const { t } = useLocale();
  const [loading, setLoading] = useState("cover"); // "cover" | "parting" | false
  const [result, setResult] = useState(null); // { red, blue, score:[r,b] }
  const [teams, setTeams] = useState(null); // { red, blue } for the scoreboard
  const [forms, setForms] = useState(null); // { red:{name}, blue:{name} } chosen formations
  const [shot, setShot] = useState("idle"); // idle | busy | done — screenshot button
  const [finalStats, setFinalStats] = useState(null); // full-time stats snapshot
  // lighting system (owner 2026-06-12): morning / noon / night wash over the
  // SIMULATION only — random per match, ?light= overrides for tuning
  const [light, setLight] = useState(null);
  // play mode (?play=1): the human controls the HOME team. Desktop shows the
  // keyboard legend; touch devices get on-screen joystick + buttons instead.
  const [play, setPlay] = useState(false);
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const modes = ["morning", "noon", "night"];
    const q = params.get("light");
    setLight(modes.includes(q) ? q : modes[Math.floor(Math.random() * modes.length)]);
    setPlay(params.get("play") === "1");
    setTouch(
      params.get("touch") === "1" ||
      (typeof window !== "undefined" &&
        ("ontouchstart" in window || (navigator.maxTouchPoints || 0) > 0)),
    );
  }, []);

  // On touch, lay the glass HUD buttons in a horizontal top row (out of the
  // bottom-right thumb zone), in BOTH play and watch. Apply it even DURING
  // loading (the cluster is behind the curtain then) so it's already horizontal
  // when the curtain lifts — otherwise it paints vertical for a frame and then
  // snaps to horizontal (the flash the owner saw). Body class drives the CSS.
  useEffect(() => {
    const on = touch && !result;
    document.body.classList.toggle("ac-touch-play", on);
    return () => document.body.classList.remove("ac-touch-play");
  }, [touch, result]);

  async function onShot() {
    if (!teams || shot === "busy") return;
    setShot("busy");
    const ok = await captureMatch(teams);
    setShot(ok ? "done" : "idle");
    if (ok) setTimeout(() => setShot("idle"), 1600);
  }

  useEffect(() => {
    // kill the landing's green nav overlay the moment the (equally green)
    // curtain is up — an SPA push keeps body children alive, and a stuck
    // z-9999 overlay buried the whole game (绿屏事故 2026-06-12)
    const ov = document.getElementById("nav-green-overlay");
    if (ov) { ov.style.opacity = "0"; setTimeout(() => ov.remove(), 350); }
    // the match boots before this mounts, so seed teams from the URL now
    const params = new URLSearchParams(window.location.search);
    setTeams({ red: params.get("red") || "england", blue: params.get("blue") || "france" });
    if (window.__matchFormations) setForms(window.__matchFormations);

    function onStarted(e) {
      // 拨开云雾: part the cloud curtain, then drop it (owner 2026-06-11 —
      // the green "正在入场" screen is gone; clouds ARE the loading screen)
      setLoading("parting");
      setTimeout(() => {
        setLoading(false);
        // start the engine's dive clock NOW — the camera holds the wide shot
        // (armed = -1) until the curtain is fully gone, so the descent and its
        // cloud thin-out play out entirely on screen, never behind the fade
        if (window.__introStart === -1) window.__introStart = performance.now();
      }, 980);
      if (e && e.detail) setTeams({ red: e.detail.red, blue: e.detail.blue });
    }
    function onEnded(e) {
      setResult(e.detail);
      setFinalStats(readStats()); // freeze the stats at the whistle
    }
    function onForms(e) {
      if (e && e.detail) setForms(e.detail);
    }
    window.addEventListener("ab-match-started", onStarted);
    window.addEventListener("ab-match-ended", onEnded);
    window.addEventListener("ab-formations", onForms);
    // Dismiss ONLY on ab-match-started — that fires after the crowd is baked,
    // so the curtain covers the bake instead of exposing a 4-FPS run-in.
    // Long fallback in case the event never arrives (boot failure).
    const fallback = setTimeout(() => setLoading(false), 30000);
    return () => {
      window.removeEventListener("ab-match-started", onStarted);
      window.removeEventListener("ab-match-ended", onEnded);
      window.removeEventListener("ab-formations", onForms);
      clearTimeout(fallback);
    };
  }, []);

  const tn = (id) => t(`team.${id}.name`);
  const [rs, bs] = result ? result.score : [0, 0];
  const winner = result ? (rs > bs ? result.red : bs > rs ? result.blue : null) : null;

  return (
    <>
      {loading ? (
        <div className={`cloud-curtain ${loading === "parting" ? "is-parting" : ""}`}>
          {/* storybook green + drifting stripe pattern (owner 2026-06-12:
              the aerial haze view is out); fades into the establishing shot */}
          <LoadingScreen card={loading === "cover"} />
        </div>
      ) : null}

      {teams && !result ? <Scoreboard teams={teams} /> : null}

      {result ? (
        <div className="match-result">
          <div className="match-result__card">
            <span className="match-result__rib">{t("match.fulltime")}</span>
            <div className="match-result__score">
              <Head id={result.red} />
              <span className="match-result__nums">{rs} <i>:</i> {bs}</span>
              <Head id={result.blue} />
            </div>
            <div className="match-result__names">
              <span>{tn(result.red)}</span>
              <span>{tn(result.blue)}</span>
            </div>
            <b className="match-result__verdict">
              {winner ? t("match.win", { name: tn(winner) }) : t("match.draw")}
            </b>
            {finalStats ? <div className="match-result__stats"><StatsBars data={finalStats} /></div> : null}
            <div className="match-result__actions">
              {/* native listener, NOT React onClick: on the end screen the
                  engine shim re-dispatches pointer events (one physical click
                  arrives twice) and React's root delegation never fires —
                  direct-on-element listeners are the only path that works */}
              <button type="button" className="ak-btn"
                      ref={(el) => {
                        if (el && !el.__rematchWired) {
                          el.__rematchWired = true;
                          el.addEventListener("click", () => { sfx.play("ui_click"); window.location.reload(); });
                        }
                      }}>
                {t("match.rematch")}
              </button>
              <button type="button" className="ak-btn ak-btn--outline"
                      ref={(el) => {
                        if (el && !el.__lobbyWired) {
                          el.__lobbyWired = true;
                          el.addEventListener("click", () => { sfx.play("ui_click"); navigateHome(); });
                        }
                      }}>
                {t("match.newmatch")}
              </button>
            </div>
          </div>
        </div>
      ) : null}


      {play && !touch && !result ? <ControlsLegend t={t} /> : null}
      {play && touch && !loading && !result ? <TouchControls /> : null}

      <MatchEvents />

      <GoalFx />

      {/* time-of-day light over the engine canvas only: z55 sits below the
          vignette (z60) and every HUD layer, so chrome colors never shift */}
      {light ? <div className={`match-light match-light--${light}`} aria-hidden /> : null}
      <div className="match-vignette" aria-hidden />

      <div className="rotate-hint"
           onClick={() => {
             // web can't force landscape outright — but on Android a user
             // gesture may grant fullscreen + orientation lock; iOS has no
             // such API, the hint stays
             const el = document.documentElement;
             const fs = el.requestFullscreen || el.webkitRequestFullscreen;
             Promise.resolve(fs && fs.call(el)).then(() => {
               if (screen.orientation && screen.orientation.lock) {
                 screen.orientation.lock("landscape").catch(() => {});
               }
             }).catch(() => {});
           }}>
        <svg width="54" height="54" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="7" y="3" width="10" height="18" rx="2.5" />
          <circle cx="12" cy="18" r="0.9" fill="currentColor" />
        </svg>
        <span>{t("match.rotate")}</span>
      </div>

      <MatchControls result={result} onShot={onShot} shot={shot} />
    </>
  );
}
