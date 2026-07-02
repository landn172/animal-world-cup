"use client";

import { portraitSrc, runtimeHeadSrc } from "../data/teams";

/**
 * Match event card (goal / half-time) shown over the match canvas, driven by
 * MatchEvents' poll of the live runtime. Render with
 * { kind, title, teamId, line }.
 */
export default function EventCard({ event, onClose }) {
  if (!event) return null;
  return (
    <div className={`event-card event-card--${event.kind || "goal"}`} role="status" aria-live="assertive" onClick={onClose}>
      <div className="event-card__frame">
        {event.teamId ? (
          <img
            className="event-card__head"
            src={portraitSrc(event.teamId)}
            alt=""
            onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = runtimeHeadSrc(event.teamId); }}
          />
        ) : null}
        <span className="event-card__text">
          <strong>{event.title}</strong>
          {event.line ? <p>{event.line}</p> : null}
        </span>
      </div>
    </div>
  );
}
