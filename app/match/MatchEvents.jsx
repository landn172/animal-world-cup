"use client";

import { useEffect, useState } from "react";
import { useLocale } from "../i18n/LocaleProvider";
import EventCard from "./EventCard";

/**
 * Drives the in-match event cards (goal / half-time) by POLLING the live
 * runtime (window.__matchGame.pitch) — deliberately NOT by editing the
 * standalone-match.js adapter (another session owns it) and NOT by coupling
 * to the engine's signal API. A score bump → GOAL card; secondHalf flip →
 * HALF-TIME card. Full-time is handled by MatchChrome's result screen.
 */
export default function MatchEvents() {
  const { t } = useLocale();
  const [event, setEvent] = useState(null);

  useEffect(() => {
    // engine team objects carry numeric entity ids — the team SLUGS for
    // portraits come from the match URL (same seeding as MatchChrome)
    const params = new URLSearchParams(window.location.search);
    const slugs = { red: params.get("red") || "england", blue: params.get("blue") || "france" };
    let lastR = 0, lastB = 0, shownHalf = false, started = false, hideTimer = null;
    const show = (ev) => {
      setEvent(ev);
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => setEvent(null), 2600);
    };
    const poll = setInterval(() => {
      const game = window.__matchGame;
      const pitch = game && game.pitch;
      if (!pitch || !pitch.redTeam || !pitch.blueTeam) return;
      const r = pitch.redTeam.score | 0, b = pitch.blueTeam.score | 0;
      if (!started) { lastR = r; lastB = b; shownHalf = !!pitch.secondHalf; started = true; return; }
      if (r > lastR || b > lastB) {
        const teamId = r > lastR ? slugs.red : slugs.blue;
        show({ kind: "goal", title: t("event.goal"), teamId, line: `${r} : ${b}` });
      } else if (!shownHalf && (pitch.states.name === "HalfEnded" || pitch.secondHalf)) {
        // HalfEnded = the first-half whistle (the right moment); secondHalf
        // flip is only a late fallback in case a poll tick missed the state
        shownHalf = true;
        show({ kind: "half", title: t("event.halftime"), teamId: null, line: t("event.halftimeLine") });
      }
      lastR = r; lastB = b;
    }, 350);
    return () => { clearInterval(poll); clearTimeout(hideTimer); };
  }, [t]);

  return <EventCard event={event} onClose={() => setEvent(null)} />;
}
