// Web app manifest: lets the game install / "Add to Home Screen" and launch
// fullscreen (no browser chrome) on Android and iOS. display:"fullscreen" gives
// the most immersive view for a landscape game.
export default function manifest() {
  return {
    name: "Animal Cup",
    short_name: "Animal Cup",
    description: "Pick your animal team and play a full football match.",
    start_url: "/",
    display: "fullscreen",
    orientation: "landscape",
    background_color: "#5d9038",
    theme_color: "#5d9038",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
