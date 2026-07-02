// Mini grass pitch with the formation laid out as player dots. Used on the
// landing page; dots are keyed by squad index so switching formations
// TRANSITIONS each dot to its new spot (cx/cy transition in Landing.module.css).
// Spots come from app/data/formations.js: [column, row, role] over the engine's
// region grid — column = depth (3 back / 5 mid / 7 forward), row = lane
// (1..7, centre = 4). The team attacks UP: own goal (GK) at the bottom.
export default function FormationDiagram({ formation, tone = "red" }) {
  if (!formation || !formation.spots) return null;

  const W = 150, H = 192;
  const SIDE = 16, TOP = 16, GK_ZONE = 32;
  const innerW = W - SIDE * 2;
  const fieldBottom = H - GK_ZONE;
  const fill = tone === "blue" ? "#3f7fb1" : "#d8443a";

  const px = (row) => SIDE + ((row - 1) / 6) * innerW;
  const py = (col) => TOP + (1 - (col - 3) / 4) * (fieldBottom - TOP);

  const dots = formation.spots.map(([col, row], i) => ({ x: px(row), y: py(col), key: i }));
  const gk = { x: W / 2, y: H - GK_ZONE / 2 - 2 };
  const line = "rgba(255,255,255,0.85)";

  return (
    <svg className="form-diagram" viewBox={`0 0 ${W} ${H}`} width={W} height={H}
         role="img" aria-label={`formation ${formation.name}`}>
      {/* grass: rounded pitch card with mown stripes */}
      <defs>
        <clipPath id="fd-clip"><rect x="0" y="0" width={W} height={H} rx="14" /></clipPath>
      </defs>
      <g clipPath="url(#fd-clip)">
        <rect x="0" y="0" width={W} height={H} fill="#6aa843" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <rect key={i} x="0" y={(H / 6) * i} width={W} height={H / 12} fill="rgba(255,255,255,0.07)" />
        ))}
        {/* markings: border, halfway line, centre circle, both boxes */}
        <rect x="5" y="5" width={W - 10} height={H - 10} rx="6"
              fill="none" stroke={line} strokeWidth="2.5" />
        <line x1="5" y1={H / 2} x2={W - 5} y2={H / 2} stroke={line} strokeWidth="2.5" />
        <circle cx={W / 2} cy={H / 2} r="17" fill="none" stroke={line} strokeWidth="2.5" />
        <circle cx={W / 2} cy={H / 2} r="2.6" fill={line} />
        <rect x={W / 2 - 30} y={H - 24} width="60" height="19" fill="none" stroke={line} strokeWidth="2.5" />
        <rect x={W / 2 - 30} y="5" width="60" height="19" fill="none" stroke={line} strokeWidth="2.5" />
        {/* outfield players — same elements across formations, so they glide */}
        {dots.map((d) => (
          <circle key={d.key} className="fd-dot" cx={d.x} cy={d.y} r="9.5"
                  fill={fill} stroke="rgba(255,255,255,0.95)" strokeWidth="2.5" />
        ))}
        {/* goalkeeper */}
        <circle className="fd-dot" cx={gk.x} cy={gk.y} r="9.5"
                fill="#efc23a" stroke="rgba(255,255,255,0.95)" strokeWidth="2.5" />
      </g>
    </svg>
  );
}
