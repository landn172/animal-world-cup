// Route-level loading boundary: shown the instant navigation targets /match,
// before the page chunk has even arrived — the white gap between clicking
// Kick Off and MatchChrome's own curtain mounting. Same screen as the boot
// curtain, so the whole way in reads as one continuous loading view.
import LoadingScreen from "./LoadingScreen";
import "./match.css";

export default function Loading() {
  return (
    <div className="cloud-curtain">
      <LoadingScreen />
    </div>
  );
}
