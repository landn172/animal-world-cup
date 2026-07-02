"use client";

// Shared loading visual: storybook grass green with the engine's drifting
// diagonal pattern + the spinning-ball card (owner 2026-06-12: the aerial
// haze view is out — match the cream/green theme instead). Rendered by BOTH
// the route-level loading boundary (loading.jsx — covers the navigation gap
// before the page chunk mounts) and MatchChrome's boot curtain.
import { useEffect, useState } from "react";
import { useLocale } from "../i18n/LocaleProvider";

export default function LoadingScreen({ card = true }) {
  const { t } = useLocale();
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    function onProgress(e) { setProgress(e.detail || 0); }
    window.addEventListener("ab-load-progress", onProgress);
    return () => window.removeEventListener("ab-load-progress", onProgress);
  }, []);

  // Inline critical styles so the card renders at final size immediately,
  // even before match.css loads. MUST stay byte-equal with .cc-card in
  // match.css: a FIXED 208x152 box (owner: 大小保持一致) — progress text,
  // locale flips and late-arriving css can never resize it. The boot-stage
  // text line is gone (owner: it ghosted white-on-white, 故障感).
  const cardStyle = {
    boxSizing: "border-box", width: 208, height: 152,
    display: "grid", alignContent: "center", justifyItems: "center", gap: 6,
    padding: 0, borderRadius: 22, background: "#fffef8",
    border: "4px solid #fffef8",
    boxShadow: "0 10px 26px rgba(70, 90, 120, 0.3)",
  };
  const loadingStyle = {
    position: "absolute", inset: 0, zIndex: 2,
    display: "grid", placeItems: "center", pointerEvents: "none",
  };

  return (
    <>
      <div className="cc-pattern" aria-hidden />
      {card ? (
        <div className="cc-loading" style={loadingStyle}>
          <span className="cc-card" style={cardStyle}>
            <svg className="cc-ball" width="46" height="46" viewBox="-23 -23 46 46" aria-hidden>
              <circle r="20.5" fill="#fffef8" stroke="#4f8a2f" strokeWidth="3" />
              <polygon points="0,-8.6 8.2,-2.7 5.1,7 -5.1,7 -8.2,-2.7" fill="#5d9038" />
              {[0, 72, 144, 216, 288].map((a) => (
                <g key={a} transform={`rotate(${a})`}>
                  <line x1="0" y1="-8.6" x2="0" y2="-15.4" stroke="#5d9038" strokeWidth="2.4" strokeLinecap="round" />
                  <path d="M -6.4 -19.4 A 20.5 20.5 0 0 1 6.4 -19.4 L 4 -14 L -4 -14 Z" fill="#5d9038" />
                </g>
              ))}
            </svg>
            <span className="cc-shadow" aria-hidden />
            <b style={{ color: "#4f8a2f", whiteSpace: "nowrap" }}>{progress > 0 ? `${progress}%` : t("match.loading")}<i className="cc-dots" /></b>
          </span>
        </div>
      ) : null}
    </>
  );
}
