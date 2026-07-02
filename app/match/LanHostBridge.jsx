"use client";

// Host-side LAN bridge. Mounts on the match page ONLY when ?lan=<ROOM> is
// present. The big screen re-attaches to its relay room as the host, then folds
// each phone's input into the engine's input contracts:
//   slot 0 -> window.__touchInput   (red / P1)
//   slot 1 -> window.__touchInput2  (blue / P2)
// Roster presence drives the `active` flag, so a slot with no phone (or a phone
// that dropped) cleanly reverts that side to AI in the engine loop.
import { useEffect } from "react";
import { createLanClient } from "../lan/lanClient";

function ti(slot) {
  const key = slot === 1 ? "__touchInput2" : "__touchInput";
  return (window[key] =
    window[key] ||
    { active: false, vx: 0, vy: 0, shoot: false, sprint: false, pass: false, lob: false, switchPlayer: false, tackle: false });
}

export default function LanHostBridge() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = (params.get("lan") || "").toUpperCase();
    if (!room) return undefined;

    const present = new Set(); // slots that currently have a phone attached

    const lan = createLanClient({
      onMessage(msg) {
        if (msg.t === "roster") {
          // Recompute which slots are live; flip `active` accordingly.
          present.clear();
          for (const p of msg.pads || []) present.add(p.slot);
          for (const slot of [0, 1]) {
            const T = ti(slot);
            const live = present.has(slot);
            T.active = live;
            if (!live) { T.vx = 0; T.vy = 0; T.shoot = false; T.sprint = false; }
          }
          return;
        }
        if (msg.t === "input") {
          const T = ti(msg.slot);
          const d = msg.d || {};
          T.active = true;
          // continuous axes + held buttons: assign straight through
          T.vx = d.vx || 0;
          T.vy = d.vy || 0;
          T.shoot = !!d.shoot;
          T.sprint = !!d.sprint;
          // one-shot taps: OR them in so the engine consumes+clears them itself
          if (d.pass) T.pass = true;
          if (d.lob) T.lob = true;
          if (d.switchPlayer) T.switchPlayer = true;
          if (d.tackle) T.tackle = true;
          return;
        }
      },
    });

    // Re-attach to our existing room (created in the lobby) as host. setHello
    // means a dropped/reloaded socket re-attaches automatically.
    lan.setHello(() => ({ t: "host", room }));

    // Tell the pads when full-time hits so they drop back to standby.
    const onEnded = () => lan.send({ t: "ended" });
    window.addEventListener("ab-match-ended", onEnded);

    return () => {
      window.removeEventListener("ab-match-ended", onEnded);
      lan.close();
    };
  }, []);

  return null;
}
