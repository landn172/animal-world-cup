"use client";
/**
 * Animal Cup UI Kit — the ONE set of chrome components for every page.
 * Visuals come from /animal-cup/kit/ 9-slice assets + kit.css tokens.
 * Pages must not define their own panel/button/badge styles.
 */
import "./kit.css";
import { sfx } from "../audio/SoundBank";

const cx = (...parts) => parts.filter(Boolean).join(" ");

// UI cue on tap (no-ops while muted, i.e. until the user enables sound)
const withClick = (id, onClick) => (e) => {
  sfx.play(id);
  if (onClick) onClick(e);
};

export function WoodPanel({ className, children, ...rest }) {
  return (
    <section className={cx("ak-wood-panel", className)} {...rest}>
      {children}
    </section>
  );
}

export function CreamCard({ className, children, ...rest }) {
  return (
    <div className={cx("ak-cream-card", className)} {...rest}>
      {children}
    </div>
  );
}

export function Btn({ tone = "gold", sm = false, className, onClick, children, ...rest }) {
  return (
    <button
      className={cx("ak-btn", tone !== "gold" && `ak-btn--${tone}`, sm && "ak-btn--sm", className)}
      onClick={withClick("ui_click", onClick)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function TabPill({ active = false, className, onClick, children, ...rest }) {
  return (
    <button
      className={cx("ak-tab", active && "ak-tab--active", className)}
      aria-selected={active}
      onClick={withClick("ui_select", onClick)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Seal({ className, children, ...rest }) {
  return (
    <span className={cx("ak-seal", className)} {...rest}>
      {children}
    </span>
  );
}

export function StatBar({ value = 0, max = 100, className, ...rest }) {
  const pct = Math.max(0, Math.min(1, value / max));
  return (
    <div className={cx("ak-statbar", className)} role="meter" aria-valuenow={value} aria-valuemax={max} {...rest}>
      <i style={{ width: `calc(${(pct * 100).toFixed(1)}% + 8px)` }} />
    </div>
  );
}

export function Chip({ className, children, ...rest }) {
  return (
    <span className={cx("ak-chip", className)} {...rest}>
      {children}
    </span>
  );
}

export function Bubble({ className, children, ...rest }) {
  return (
    <div className={cx("ak-bubble", className)} {...rest}>
      {children}
    </div>
  );
}
