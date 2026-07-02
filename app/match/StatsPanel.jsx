"use client";

// Match stats (self-contained): a glassless cream card with two-sided bars,
// fed by the adapter's window.__matchStats. Exports:
//   <StatsPanel />  — control-column button + overlay panel (polls while open)
//   <StatsBars />   — pure bars block, reused on the result screen
// Delete this file + its mount lines to remove the feature.
import { useEffect, useState } from "react";
import { useLocale } from "../i18n/LocaleProvider";
import { METRICS, barSplit } from "../data/statMetrics";
import css from "./StatsPanel.module.css";

export function readStats() {
  const s = typeof window !== "undefined" && window.__matchStats;
  if (!s) return null;
  const row = (m) => {
    if (m.key === "possession") {
      const t = s.red.ownTicks + s.blue.ownTicks;
      const r = t ? Math.round((s.red.ownTicks / t) * 100) : 50;
      return { red: r, blue: 100 - r };
    }
    return { red: s.red[m.key] | 0, blue: s.blue[m.key] | 0 };
  };
  return Object.fromEntries(METRICS.map((m) => [m.key, row(m)]));
}

export function StatsBars({ data }) {
  const { t } = useLocale();
  if (!data) return null;
  return (
    <div className={css.bars}>
      {METRICS.map((m) => {
        const v = data[m.key];
        if (!v) return null;
        const empty = m.kind === "count" && !(v.red + v.blue);
        const [l, r] = empty ? [0, 0] : barSplit(v.red, v.blue);
        const suffix = m.kind === "percent" ? "%" : "";
        return (
          <div key={m.key} className={css.row}>
            <i className={css.num}>{v.red}{suffix}</i>
            <span className={css.track}>
              <span className={css.left} style={{ width: `${l}%` }} />
            </span>
            <b className={css.label}>{t(`stats.${m.key}`)}</b>
            <span className={css.track}>
              <span className={css.rightFill} style={{ width: `${r}%` }} />
            </span>
            <i className={css.num}>{v.blue}{suffix}</i>
          </div>
        );
      })}
    </div>
  );
}

function IconChart({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M4 19h16" />
      <path d="M7 16v-5M12 16V7M17 16v-8" />
    </svg>
  );
}

export default function StatsPanel() {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    setData(readStats());
    const poll = setInterval(() => setData(readStats()), 600);
    return () => clearInterval(poll);
  }, [open]);

  return (
    <>
      <button type="button" className="glass-btn" aria-label={t("stats.title")}
              data-tip={t("stats.title")} onClick={() => setOpen(!open)}>
        <IconChart />
      </button>
      {open ? (
        <div className={css.overlay} onClick={() => setOpen(false)}>
          <section className={css.card} onClick={(e) => e.stopPropagation()}>
            <header className={css.head}>
              <b>{t("stats.title")}</b>
              <button type="button" className={css.close} aria-label="close"
                      onClick={() => setOpen(false)}>×</button>
            </header>
            <StatsBars data={data} />
          </section>
        </div>
      ) : null}
    </>
  );
}
