"use client";

// Goal celebration effects (self-contained; one mount line in MatchChrome):
// on `ab-goal` -> team-colored confetti burst + radial flash + scoreboard
// pop (body class styled in match.css). Delete this file + the mount line
// to remove the feature.
import { useEffect, useState } from "react";
import { PLAYABLE_TEAMS } from "../data/teams";
import css from "./GoalFx.module.css";

const FALLBACK = ["#ffd24d", "#ffffff", "#ff7a59"];

export default function GoalFx() {
  const [burst, setBurst] = useState(null); // { key, pieces }

  useEffect(() => {
    let timer = null, lastScore = [0, 0];
    function onGoal(e) {
      const d = (e && e.detail) || {};
      const score = d.score || [0, 0];
      const scorer = score[0] > lastScore[0] ? d.red : d.blue;
      lastScore = score;
      const team = PLAYABLE_TEAMS.find((t) => t.id === scorer);
      const palette = (team && team.palette) || FALLBACK;
      const pieces = Array.from({ length: 64 }, (_, i) => ({
        id: i,
        color: palette[i % palette.length],
        left: 6 + Math.random() * 88,            // vw
        delay: Math.random() * 260,              // ms
        drift: (Math.random() * 2 - 1) * 220,    // px sideways
        spin: 360 + Math.random() * 720,
        size: 7 + Math.random() * 8,
        fall: 78 + Math.random() * 22,           // vh
      }));
      setBurst({ key: Date.now(), pieces });
      document.body.classList.add("ab-goal-pop");
      clearTimeout(timer);
      timer = setTimeout(() => {
        setBurst(null);
        document.body.classList.remove("ab-goal-pop");
      }, 2000);
    }
    window.addEventListener("ab-goal", onGoal);
    return () => {
      document.body.classList.remove("ab-goal-pop"); window.removeEventListener("ab-goal", onGoal); clearTimeout(timer); };
  }, []);

  if (!burst) return null;
  return (
    <div className={css.layer} key={burst.key} aria-hidden>
      <span className={css.flash} />
      {burst.pieces.map((p) => (
        <i key={p.id} className={css.piece}
           style={{
             left: `${p.left}vw`,
             width: p.size, height: p.size * 0.62,
             background: p.color,
             animationDelay: `${p.delay}ms`,
             "--drift": `${p.drift}px`,
             "--spin": `${p.spin}deg`,
             "--fall": `${p.fall}vh`,
           }} />
      ))}
    </div>
  );
}
