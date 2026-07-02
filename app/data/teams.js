// Playable squads (match engine has full assets for these 8).
// Display names/animals/traits live in the i18n dictionaries (team.<id>.*).
export const PLAYABLE_TEAMS = [
  { id: "england", shortName: "ENG", palette: ["#f7f0df", "#c54539", "#ddb24d"] },
  { id: "france", shortName: "FRA", palette: ["#2858ad", "#f2efe4", "#d84c45"] },
  { id: "germany", shortName: "GER", palette: ["#29231d", "#f0d14f", "#c63f35"] },
  { id: "spain", shortName: "ESP", palette: ["#c83f35", "#efc95a", "#4d3323"] },
  { id: "portugal", shortName: "POR", palette: ["#176d49", "#c83b35", "#8b7968"] },
  { id: "brazil", shortName: "BRA", palette: ["#edcf49", "#148e57", "#245bab"] },
  { id: "argentina", shortName: "ARG", palette: ["#8ed3f3", "#ffffff", "#c99b6b"] },
  { id: "usa", shortName: "USA", palette: ["#263f7b", "#f7f1e7", "#c83d43"] },
];

export function portraitSrc(id) {
  return `/animal-cup/portraits/${id}.png`;
}

// in-match side-view head (runtime asset) — fallback for portraits
export function runtimeHeadSrc(id) {
  return `/match-runtime-min/data/player/races/${id}/head.png`;
}
