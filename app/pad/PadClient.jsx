"use client";

// Thin client wrapper for the pad route. If the URL carried ?room=XXXX we go
// straight into the gamepad; otherwise we show a 4-char code entry so a phone
// that can't scan the QR can still join by typing the code from the big screen.
import { useState } from "react";
import PadController from "./PadController";

export default function PadClient({ room }) {
  const [code, setCode] = useState(room || "");
  const [entered, setEntered] = useState(!!room);

  if (entered && code) return <PadController room={code} />;

  return (
    <div className="pad pad--status">
      <form
        className="pad-join"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim().length === 4) setEntered(true);
        }}
      >
        <b>输入房间号 · Enter room code</b>
        <input
          className="pad-code-input"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4))}
          placeholder="ABCD"
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={4}
          aria-label="room code"
        />
        <button type="submit" className="pad-join-btn" disabled={code.trim().length !== 4}>
          加入 · Join
        </button>
      </form>
    </div>
  );
}
