// Single source of truth for match stats — shared by the adapter collector
// (window.__matchStats), the in-match stats panel, and the result screen.
// Only metrics the engine can actually measure (spec 2026-06-11): no cards,
// no referee calls — the engine has none.
export const METRICS = [
  { key: "possession", kind: "percent" }, // derived from owned-tick counters
  { key: "shots", kind: "count" },        // Player.onShot (exact)
  { key: "corners", kind: "count" },      // Corner.onEnter (exact)
  { key: "throwIns", kind: "count" },     // ThrowIn.onEnter (exact)
  { key: "goalKicks", kind: "count" },    // GoalKick.onEnter (exact)
  { key: "slides", kind: "count" },       // Player.onSlideHit (exact)
  { key: "passes", kind: "count" },       // Player.onPass (exact)
];

// two-sided bar widths in percent, always summing to 100; an empty stat
// splits evenly so the bar never collapses
export function barSplit(a, b) {
  const total = a + b;
  if (!total) return [50, 50];
  return [(a / total) * 100, (b / total) * 100];
}
