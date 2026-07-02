// Hand-drawn-friendly line icons for the control buttons (owner: emoji look
// ugly). Single colour via `currentColor` so each button's ink tint applies;
// rounded caps/joins to sit with the paper-craft aesthetic.
function Svg({ size = 22, children, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function IconCamera(p) {
  return (
    <Svg {...p}>
      <path d="M4.5 8h2.2l1.1-1.7a1 1 0 0 1 .84-.46h6.72a1 1 0 0 1 .84.46L17.3 8h2.2A1.5 1.5 0 0 1 21 9.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-8A1.5 1.5 0 0 1 4.5 8Z" />
      <circle cx="12" cy="13" r="3.1" />
    </Svg>
  );
}

export function IconSoundOn(p) {
  return (
    <Svg {...p}>
      <path d="M11 5 6.5 9H3.5v6h3L11 19V5Z" />
      <path d="M15.5 9.2a4 4 0 0 1 0 5.6" />
      <path d="M18 6.7a7.5 7.5 0 0 1 0 10.6" />
    </Svg>
  );
}

export function IconSoundOff(p) {
  return (
    <Svg {...p}>
      <path d="M11 5 6.5 9H3.5v6h3L11 19V5Z" />
      <path d="m16 9.5 5 5" />
      <path d="m21 9.5-5 5" />
    </Svg>
  );
}

export function IconZoomIn(p) {
  return (
    <Svg {...p}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.6 15.6 4.4 4.4" />
      <path d="M10.5 7.8v5.4M7.8 10.5h5.4" />
    </Svg>
  );
}

export function IconZoomOut(p) {
  return (
    <Svg {...p}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.6 15.6 4.4 4.4" />
      <path d="M7.8 10.5h5.4" />
    </Svg>
  );
}

// circular arrow — used for zoom-reset and rematch/replay
export function IconReplay(p) {
  return (
    <Svg {...p}>
      <path d="M20 11.5a8 8 0 1 1-2.4-5.7" />
      <path d="M20 3.5v4.2h-4.2" />
    </Svg>
  );
}

export function IconCheck(p) {
  return (
    <Svg {...p}>
      <path d="M5 12.5 9.5 17 19 7" />
    </Svg>
  );
}

// home — navigate back to lobby
export function IconHome(p) {
  return (
    <Svg {...p}>
      <path d="M3 12l9-8 9 8" />
      <path d="M5 12v7a1 1 0 001 1h3v-5h6v5h3a1 1 0 001-1v-7" />
    </Svg>
  );
}

// language / globe — line style, replaces the colourful globe PNG + "en" label
export function IconGlobe(p) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.6 2.7 3.9 5.7 3.9 9s-1.3 6.3-3.9 9c-2.6-2.7-3.9-5.7-3.9-9S9.4 5.7 12 3Z" />
    </Svg>
  );
}
