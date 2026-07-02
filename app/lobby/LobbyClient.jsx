"use client";

// LAN lobby (big screen). Reached from the Landing once both teams are chosen,
// carrying ?red=&blue=&side=&ai= . It:
//   1. connects to the relay as host -> gets a room code + the host LAN IP
//   2. shows a QR + join URL + the code so phones can open /pad?room=XXXX
//   3. shows the two player slots filling up as phones join
//   4. on Start: tells the pads to begin, then navigates the big screen into
//      /match?...&play=1&p2=1&lan=ROOM (the match page re-attaches as host).
//
// The relay room survives this lobby -> match navigation via the server's host
// grace timer, so the phones stay connected straight through kickoff.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useLocale } from "../i18n/LocaleProvider";
import LangSwitcher from "../i18n/LangSwitcher";
import { portraitSrc, runtimeHeadSrc } from "../data/teams";
import { createLanClient } from "../lan/lanClient";

function Portrait({ id }) {
  return (
    <span className="lb-pp">
      <img src={portraitSrc(id)} alt="" onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = runtimeHeadSrc(id); }} />
    </span>
  );
}

export default function LobbyClient({ red, blue, side, ai, time }) {
  const { t } = useLocale();
  const router = useRouter();
  const [room, setRoom] = useState(null);
  const [join, setJoin] = useState(null); // full http URL the phone opens
  const [qr, setQr] = useState(null); // data URL
  const [pads, setPads] = useState([]); // [{padId,name,slot,ready}]
  const lanRef = useRef(null);

  useEffect(() => {
    const lan = createLanClient({
      onMessage(msg) {
        if (msg.t === "hosted") {
          setRoom(msg.room);
          const url = `http://${msg.ip}:${msg.port}/pad?room=${msg.room}`;
          setJoin(url);
          QRCode.toDataURL(url, { margin: 1, width: 320, color: { dark: "#1d3d16", light: "#ffffff" } })
            .then(setQr)
            .catch(() => setQr(null));
        } else if (msg.t === "roster") {
          setPads(msg.pads || []);
        }
      },
    });
    lanRef.current = lan;
    // no room yet -> the relay mints one and replies `hosted`
    lan.setHello(() => ({ t: "host", room: "" }));
    return () => lan.close();
  }, []);

  const slot0 = useMemo(() => pads.find((p) => p.slot === 0), [pads]);
  const slot1 = useMemo(() => pads.find((p) => p.slot === 1), [pads]);
  const canStart = !!slot0; // P1 (red) must be a human for play mode

  function start() {
    if (!room || !canStart) return;
    // tell the pads to switch to LIVE, then drive the big screen into the match;
    // the relay's host grace timer keeps the room (and the phones) alive across
    // this navigation. Formations are left to the engine's random roll.
    lanRef.current && lanRef.current.send({ t: "start", info: { red, blue } });
    const url = `/match?red=${red}&blue=${blue}&ai=${ai}&side=${side}&time=${time}&play=1&p2=1&lan=${room}`;
    router.push(url);
  }

  return (
    <main className="lb">
      <div className="lb-pattern" aria-hidden />
      <span className="lb-lang"><LangSwitcher /></span>

      <div className="lb-wrap">
        <h1 className="lb-title">{t("lan.title")}</h1>
        <p className="lb-sub">{t("lan.sub")}</p>

        <div className="lb-cols">
          {/* left: scan-to-join */}
          <section className="lb-card lb-join">
            <h2 className="lb-h2">{t("lan.scan")}</h2>
            <div className="lb-qr">
              {qr ? <img src={qr} alt="join QR" /> : <div className="lb-qr-wait" />}
            </div>
            <div className="lb-code">
              <span className="lb-code-label">{t("lan.code")}</span>
              <b>{room || "····"}</b>
            </div>
            {join ? <code className="lb-url">{join}</code> : null}
            <p className="lb-hint">{t("lan.hint")}</p>
          </section>

          {/* right: who's in */}
          <section className="lb-card lb-slots">
            <h2 className="lb-h2">{t("lan.players")}</h2>
            <Slot n={1} teamId={red} tone="red" pad={slot0} t={t} />
            <Slot n={2} teamId={blue} tone="blue" pad={slot1} t={t} />
            <p className="lb-note">{slot1 ? t("lan.note2p") : t("lan.note1p")}</p>
          </section>
        </div>

        <div className="lb-actions">
          <button type="button" className="lb-btn lb-btn--ghost" onClick={() => router.push("/")}>
            {t("lan.back")}
          </button>
          <button type="button" className="lb-btn lb-btn--go" disabled={!canStart} onClick={start}>
            {t("lan.start")}
          </button>
        </div>
      </div>
    </main>
  );
}

function Slot({ n, teamId, tone, pad, t }) {
  const connected = !!pad;
  return (
    <div className={`lb-slot lb-slot--${tone} ${connected ? "is-on" : ""}`}>
      <span className="lb-slot-tag">{`P${n}`}</span>
      <Portrait id={teamId} />
      <div className="lb-slot-meta">
        <b>{t(`team.${teamId}.name`)}</b>
        <span className={`lb-slot-status ${connected ? "ok" : ""}`}>
          {connected ? (pad.name || t("lan.connected")) : t("lan.waiting")}
        </span>
      </div>
      <span className={`lb-dot ${connected ? "on" : ""}`} aria-hidden />
    </div>
  );
}
