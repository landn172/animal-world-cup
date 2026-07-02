// Single source of truth for 7-a-side formations (GK + 6 outfield).
// React rolls these per match and (a) shows them on the loading screen and
// (b) hands them to the engine via window.__matchFormations, so what the
// loading card promises is exactly what gets played. The match adapter
// (standalone-match.js) consumes the same shape.
//
// spot = [column, row, role] over the engine's 16x9 region grid:
//   column = depth (3 back / 5 mid / 7 forward), row = lane (center = 4).
//   role   = "D" | "M" | "A". Each formation has exactly 6 outfield spots.
export const FORMATIONS = [
  { name: "2-3-1", spots: [[3, 2, "D"], [3, 6, "D"], [5, 1, "M"], [5, 4, "M"], [5, 7, "M"], [7, 4, "A"]] },
  { name: "3-2-1", spots: [[3, 1, "D"], [3, 4, "D"], [3, 7, "D"], [5, 2, "M"], [5, 6, "M"], [7, 4, "A"]] },
  { name: "2-2-2", spots: [[3, 2, "D"], [3, 6, "D"], [5, 2, "M"], [5, 6, "M"], [7, 2, "A"], [7, 6, "A"]] },
  { name: "3-1-2", spots: [[3, 1, "D"], [3, 4, "D"], [3, 7, "D"], [5, 4, "M"], [7, 2, "A"], [7, 6, "A"]] },
  { name: "1-3-2", spots: [[3, 4, "D"], [5, 1, "M"], [5, 4, "M"], [5, 7, "M"], [7, 2, "A"], [7, 6, "A"]] },
  { name: "2-1-3", spots: [[3, 2, "D"], [3, 6, "D"], [5, 4, "M"], [7, 1, "A"], [7, 4, "A"], [7, 7, "A"]] },
];

const pick = () => FORMATIONS[Math.floor(Math.random() * FORMATIONS.length)];

// independent random formation per team
export function rollFormations() {
  return { red: pick(), blue: pick() };
}
