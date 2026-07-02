"use client";

// Pre-match landing (owner 2026-06-15 redesign v3). Normal football-game flow:
// pick YOUR TEAM (left), pick the OPPONENT (right), set difficulty, Kick Off.
// No "who controls which side" toggle and no Surprise button — your team is the
// one in the YOUR TEAM slot, period. Watch (AI vs AI) is a small secondary link.
// The controlled team maps to the engine's red slot, so the runtime is unchanged.
// Spec: docs/specs/2026-06-15-landing-interaction-redesign.md
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import LangSwitcher from "./i18n/LangSwitcher";
import { useLocale } from "./i18n/LocaleProvider";
import { PLAYABLE_TEAMS, portraitSrc, runtimeHeadSrc } from "./data/teams";
import { FORMATIONS } from "./data/formations";
import FormationDiagram from "./ui/FormationDiagram";
import css from "./Landing.module.css";

// Runs before paint on the client (so fit + randomize land before the page is
// shown); falls back to useEffect during SSR to avoid the React warning.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

function rand(n) { return Math.floor(Math.random() * n); }

// Shrink .wrap just enough to fit the viewport (never scale up). scrollHeight/
// scrollWidth ignore the transform, so this is safe to call repeatedly.
function fit(w) {
  const nh = w.scrollHeight, nw = w.scrollWidth;
  if (!nh || !nw) return;
  // -54 = 6px breathing room + the 48px bottom strip reserved for the watermark
  // (see .stage padding-bottom) so the CTA buttons clear the bottom-centre pill.
  const s = Math.min(1, (window.innerHeight - 54) / nh, window.innerWidth / nw);
  w.style.setProperty("--fit-scale", String(Math.max(0.5, s)));
}

function CtrlIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="7" width="20" height="10" rx="5" />
      <path d="M7 12h2.4M8.2 10.8v2.4" />
      <circle cx="15.8" cy="11.2" r="1" fill="currentColor" stroke="none" />
      <circle cx="17.8" cy="13" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}
// two phones = local-network versus
function LanIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2.5" y="4" width="8" height="16" rx="2" />
      <rect x="13.5" y="4" width="8" height="16" rx="2" />
      <path d="M6.5 17.2h0M17.5 17.2h0" />
    </svg>
  );
}

function TeamGrid({ picked, taken, onPick }) {
  const { t } = useLocale();
  return (
    <div className={css.grid}>
      {PLAYABLE_TEAMS.map((team) => {
        const on = picked === team.id;
        const off = !on && taken === team.id;
        return (
          <button key={team.id} type="button" disabled={off}
                  className={`${css.card} ${on ? css.cardOn : ""} ${off ? css.cardOff : ""}`}
                  onClick={() => onPick(team.id)}>
            {on ? <span className={css.cardCheck} aria-hidden>✓</span> : null}
            <img className={css.cardPic} src={portraitSrc(team.id)} alt=""
                 onError={(e) => { e.currentTarget.src = runtimeHeadSrc(team.id); }} />
            <b>{t(`team.${team.id}.name`)}</b>
          </button>
        );
      })}
    </div>
  );
}

function Panel({ label, mine, picked, taken, onPick, form, setForm, tone }) {
  const { t } = useLocale();
  const formation = FORMATIONS.find((f) => f.name === form);
  return (
    <section className={`${css.panel} ${mine ? css.panelYou : ""}`}>
      <div className={css.head}>
        <span className={`${css.roleLabel} ${mine ? css.roleMine : css.roleOpp}`}>{label}</span>
        <span className={css.headName}>{t(`team.${picked}.name`)} · {t(`team.${picked}.animal`)}</span>
      </div>
      <TeamGrid picked={picked} taken={taken} onPick={onPick} />
      <div className={css.formRow}>
        <span className={css.formLabel}>{t("home.formation")}</span>
        <div className={css.pills}>
          {FORMATIONS.map((f) => (
            <button key={f.name} type="button"
                    className={`${css.pill} ${form === f.name ? css.pillOn : ""}`}
                    onClick={() => setForm(f.name)}>
              {f.name}
            </button>
          ))}
        </div>
        <div className={css.preview}>
          <FormationDiagram formation={formation} tone={tone} />
        </div>
      </div>
    </section>
  );
}

// ai level 0..3 (0 = easiest). Shifted down a notch — vs one human, even the
// old "easy" (1) pressed too hard. easy=0, normal=1, hard=2.
const DIFFS = [
  { key: "easy", ai: 0 },
  { key: "normal", ai: 1 },
  { key: "hard", ai: 2 },
];

// Match length (full-match minutes). The engine splits this into two halves
// (each half = 30*time seconds), so time=6 -> two 3-min halves (~6 min total).
// The old hard-coded 2 min felt over before it started; 6 is a comfortable
// casual default.
const TIMES = [
  { key: "short", time: 4 },
  { key: "normal", time: 6 },
  { key: "long", time: 10 },
];

export default function Landing() {
  const { t } = useLocale();
  // mine = your team (left, always the one you control). opp = opponent (right).
  const [mine, setMine] = useState("argentina");
  const [opp, setOpp] = useState("portugal");
  const [mineForm, setMineForm] = useState(FORMATIONS[0].name);
  const [oppForm, setOppForm] = useState(FORMATIONS[1].name);
  const [diff, setDiff] = useState(0);
  const [time, setTime] = useState(6); // full-match minutes (default: normal)
  const [side, setSide] = useState("home"); // your team's kit: home / away

  const router = useRouter();
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  // The landing must show in full with NO scrolling on any screen. Measure the
  // natural size + randomize the formations BEFORE the first visible paint, then
  // reveal (.wrap stays hidden — the branded background shows — until `ready`).
  // So the first thing on screen is the final, scaled layout: no scale pop, no
  // formation flicker.
  const wrapRef = useRef(null);
  const [ready, setReady] = useState(false);
  useIsoLayoutEffect(() => {
    const w = wrapRef.current;
    if (!w) return;
    setMineForm(FORMATIONS[rand(FORMATIONS.length)].name);
    setOppForm(FORMATIONS[rand(FORMATIONS.length)].name);
    fit(w);
    setReady(true);
  }, []);
  // Re-fit on later viewport/content changes (resize, web-font reflow).
  useEffect(() => {
    const w = wrapRef.current;
    if (!w) return undefined;
    const onFit = () => fit(w);
    window.addEventListener("resize", onFit);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onFit) : null;
    if (ro) ro.observe(w);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(onFit).catch(() => {});
    return () => { window.removeEventListener("resize", onFit); if (ro) ro.disconnect(); };
  }, []);

  function go(play) {
    // your team -> engine red slot (the controlled side); opponent -> blue
    const forms = {
      red: FORMATIONS.find((f) => f.name === mineForm),
      blue: FORMATIONS.find((f) => f.name === oppForm),
    };
    try { sessionStorage.setItem("matchFormations", JSON.stringify(forms)); } catch {}
    // side = which kit YOUR team wears (home / away); the runtime picks a
    // contrasting kit for the opponent.
    let url = `/match?red=${mine}&blue=${opp}&ai=${diff}&side=${side}&time=${time}`;
    if (play) url += "&play=1";
    router.push(url);
  }

  // LAN versus (局域网联机): hand the chosen teams to the lobby, where the big
  // screen hosts a room and phones join as gamepads. Two humans, no shared
  // keyboard — each plays from their own phone over the local network.
  function goLan() {
    router.push(`/lobby?red=${mine}&blue=${opp}&ai=${diff}&side=${side}&time=${time}`);
  }

  return (
    <main className={css.stage}>
      <div className={css.pattern} aria-hidden />
      <span className={css.lang}><LangSwitcher /></span>
      <div className={`${css.wrap} ${ready ? css.ready : ""}`} ref={wrapRef}>
        <h1 className={css.title}>{t("home.title")}</h1>

        <div className={css.duel}>
          <Panel label={t("home.yourTeam")} mine tone="red"
                 picked={mine} taken={opp} onPick={setMine} form={mineForm} setForm={setMineForm} />
          <span className={css.vs}>VS</span>
          <Panel label={t("home.opponent")} mine={false} tone="blue"
                 picked={opp} taken={mine} onPick={setOpp} form={oppForm} setForm={setOppForm} />
        </div>

        <div className={css.settings}>
          <div className={css.setGroup}>
            <span className={css.formLabel}>{t("home.side")}</span>
            <div className={css.pills}>
              {["home", "away"].map((s) => (
                <button key={s} type="button"
                        className={`${css.pill} ${side === s ? css.pillOn : ""}`}
                        onClick={() => setSide(s)}>
                  {t(`home.side.${s}`)}
                </button>
              ))}
            </div>
          </div>
          <div className={css.setGroup}>
            <span className={css.formLabel}>{t("home.difficulty")}</span>
            <div className={css.pills}>
              {DIFFS.map((d) => (
                <button key={d.key} type="button"
                        className={`${css.pill} ${diff === d.ai ? css.pillOn : ""}`}
                        onClick={() => setDiff(d.ai)}>
                  {t(`home.diff.${d.key}`)}
                </button>
              ))}
            </div>
          </div>
          <div className={css.setGroup}>
            <span className={css.formLabel}>{t("home.matchTime")}</span>
            <div className={css.pills}>
              {TIMES.map((tm) => (
                <button key={tm.key} type="button"
                        className={`${css.pill} ${time === tm.time ? css.pillOn : ""}`}
                        onClick={() => setTime(tm.time)}>
                  {t(`home.time.${tm.key}`)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className={css.actions}>
          <button type="button" className={css.watch} onClick={() => go(false)}>
            <EyeIcon /> {t("home.watchAi")}
          </button>
          <button type="button" className={css.play} onClick={() => go(true)}>
            <CtrlIcon /> {t("home.kickoff")}
          </button>
        </div>
        <div className={css.actionsLan}>
          <button type="button" className={css.lan} onClick={goLan}>
            <LanIcon /> {t("home.lan")}
          </button>
        </div>
      </div>
    </main>
  );
}
