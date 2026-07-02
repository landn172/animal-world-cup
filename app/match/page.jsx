import GameClient from "../GameClient";
import MatchChrome from "./MatchChrome";
import MatchAudio from "./MatchAudio";
import LanHostBridge from "./LanHostBridge";
import "../ui/kit.css";
import "./match.css";

export const metadata = {
  title: "Animal Cup",
};

export default function MatchPage() {
  return (
    <>
      <GameClient />
      <MatchChrome />
      <MatchAudio />
      {/* No-op unless ?lan=<ROOM> is present: folds phone input into the engine */}
      <LanHostBridge />
    </>
  );
}
