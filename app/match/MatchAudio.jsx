"use client";

import { useEffect, useRef } from "react";
import { sfx } from "../audio/SoundBank";

// Goal celebration = the scoring nation's animal call (owner spec). 8 teams →
// their animal's cheer; the two eagle nations share one screech.
const CHEER = {
  england: "cheer_lion",
  brazil: "cheer_jaguar",
  argentina: "cheer_puma",
  portugal: "cheer_wolf",
  germany: "cheer_eagle",
  spain: "cheer_bull",
  france: "cheer_rooster",
  usa: "cheer_eagle",
};

// Wires match SFX to the events the adapter broadcasts. No-ops while muted
// (default) until the player taps the sound toggle.
export default function MatchAudio() {
  const prevScore = useRef([0, 0]);
  useEffect(() => {
    const onStart = () => {
      prevScore.current = [0, 0];
      sfx.startAmbience(); // many-animals chorus
      sfx.startMusic(); // light background bed
    };
    // Whistle plays when the kickoff is actually PLAYED (after the kick), not at
    // match-load — the standalone fires ab-kickoff-played then (owner: 开球之后才响哨).
    const onKickoff = () => sfx.play("whistle_kickoff");
    const onGoal = (e) => {
      const d = (e && e.detail) || {};
      const score = d.score || [0, 0];
      const [pr, pb] = prevScore.current;
      const scorer = score[0] > pr ? d.red : score[1] > pb ? d.blue : null;
      prevScore.current = score;
      sfx.play((scorer && CHEER[scorer]) || "goal_cheer", { volume: 0.95 });
    };
    const onEnd = () => {
      sfx.play("whistle_fulltime");
      sfx.stopAmbience();
      sfx.stopMusic();
    };
    window.addEventListener("ab-match-started", onStart);
    window.addEventListener("ab-kickoff-played", onKickoff);
    window.addEventListener("ab-goal", onGoal);
    window.addEventListener("ab-match-ended", onEnd);

    // Kick sounds (owner: 射门一种音、传球一种音). The engine has no bindable
    // kick signal at the React seam, so poll the live ball speed each frame and
    // detect a kick as a sudden jump; classify by resulting speed (shots peak
    // ~8-10, passes ~3-6, dribble touches <2). sfx.play no-ops while muted.
    let raf = 0;
    let lastSpeed = 0;
    let cooldown = 0;
    const tick = () => {
      const ball = window.__matchGame && window.__matchGame.pitch && window.__matchGame.pitch.ball;
      if (ball) {
        const sp = ball.speed || 0;
        const jump = sp - lastSpeed;
        lastSpeed = sp;
        if (cooldown > 0) cooldown -= 1;
        else if (jump > 2) {
          cooldown = 8;
          if (sp >= 8) sfx.play("shot", { volume: 0.8 }); // hardest strikes
          else sfx.play("pass", { volume: 0.5 }); // ordinary passes/touches
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("ab-match-started", onStart);
      window.removeEventListener("ab-kickoff-played", onKickoff);
      window.removeEventListener("ab-goal", onGoal);
      window.removeEventListener("ab-match-ended", onEnd);
      cancelAnimationFrame(raf);
      sfx.stopAmbience();
      sfx.stopMusic();
    };
  }, []);

  return null;
}
