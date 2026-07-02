"use client";

// Phone-as-gamepad controller (局域网联机 / 本地对战). A phone opens
// http://<lan-ip>:13000/pad?room=XXXX (typically by scanning the lobby QR),
// joins the relay room, and from then on this screen IS a wireless gamepad:
// left analog stick = movement, right diamond = Lob/Pass/Tackle/Shoot, centre =
// hold-to-Sprint. Continuous state (stick + held buttons) streams at ~30Hz;
// one-shot taps fire an immediate frame so they're never dropped.
//
// It never renders the match — the big screen does. This keeps the phone light
// and avoids syncing the non-deterministic engine across devices.
import { useEffect, useRef, useState } from "react";
import { createLanClient } from "../lan/lanClient";

const SVG = (props) => (
  <svg viewBox="0 0 24 24" width={props.s || 30} height={props.s || 30} fill="none"
       stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
       aria-hidden>{props.children}</svg>
);
const PassIcon = () => <SVG><path d="M4 12h12" /><path d="M12 7l5 5-5 5" /></SVG>;
const ShootIcon = () => (
  <SVG s={32}>
    <circle cx="12" cy="12" r="8.2" />
    <path d="M12 7.2l3.3 2.4-1.25 3.9H9.95L8.7 9.6z" />
    <path d="M12 7.2V4M15.3 9.6l2.7-1.1M14.05 13.5l1.7 2.4M9.95 13.5l-1.7 2.4M8.7 9.6L6 8.5" />
  </SVG>
);
const LobIcon = () => <SVG><path d="M4 16.5C8 7.5 16 7.5 20 14" /><path d="M20 14l.4-3.9M20 14l-3.8 1.2" /></SVG>;
const TackleIcon = () => <SVG><path d="M12 3.4l6.6 2.4v5c0 3.9-2.9 6.6-6.6 7.8C8.3 17.4 5.4 14.7 5.4 10.8v-5z" /></SVG>;
const SprintIcon = () => <SVG s={28}><path d="M6 6l6 6-6 6" /><path d="M13 6l6 6-6 6" /></SVG>;

const SIDE = { 0: { key: "P1", cls: "pad--red" }, 1: { key: "P2", cls: "pad--blue" } };

export default function PadController({ room }) {
  // status: "connecting" | "joining" | "ready" | "playing" | "full" | "no-room" | "closed"
  const [status, setStatus] = useState("connecting");
  const [slot, setSlot] = useState(null);
  const lanRef = useRef(null);
  const baseRef = useRef(null);
  const thumbRef = useRef(null);
  const stick = useRef({ id: null, cx: 0, cy: 0, r: 56 });
  // live continuous input (streamed); taps are sent as immediate one-offs
  const input = useRef({ vx: 0, vy: 0, shoot: false, sprint: false });

  useEffect(() => {
    if (!room) { setStatus("no-room"); return undefined; }
    const lan = createLanClient({
      onOpen() { setStatus("joining"); },
      onClose() { setStatus((s) => (s === "closed" ? s : "connecting")); },
      onMessage(msg) {
        if (msg.t === "joined") { setSlot(msg.slot); setStatus("ready"); }
        else if (msg.t === "slot") { setSlot(msg.slot); }
        else if (msg.t === "start") { setStatus("playing"); if (typeof msg.slot === "number") setSlot(msg.slot); }
        else if (msg.t === "ended") { setStatus("ready"); }
        else if (msg.t === "joinErr") { setStatus(msg.reason === "full" ? "full" : "no-room"); }
        else if (msg.t === "closed") { setStatus("closed"); }
      },
    });
    lanRef.current = lan;
    // (re)join on every connect — a dropped phone re-takes its place
    lan.setHello(() => ({ t: "join", room, name: navigator.platform || "Pad" }));

    // stream continuous state at ~30Hz (only while joined)
    const iv = setInterval(() => {
      const i = input.current;
      lan.send({ t: "input", d: { vx: i.vx, vy: i.vy, shoot: i.shoot, sprint: i.sprint } });
    }, 33);

    // lock the page from scrolling/zooming under the controls
    const prevent = (e) => e.preventDefault();
    document.addEventListener("touchmove", prevent, { passive: false });

    return () => {
      clearInterval(iv);
      document.removeEventListener("touchmove", prevent);
      lan.close();
    };
  }, [room]);

  // send an immediate frame carrying a one-shot tap (so taps never wait for the tick)
  function sendTap(key) {
    const i = input.current;
    lanRef.current && lanRef.current.send({
      t: "input",
      d: { vx: i.vx, vy: i.vy, shoot: i.shoot, sprint: i.sprint, [key]: true },
    });
  }

  function stickDown(e) {
    const rect = baseRef.current.getBoundingClientRect();
    const s = stick.current;
    s.id = e.pointerId; s.cx = rect.left + rect.width / 2; s.cy = rect.top + rect.height / 2; s.r = rect.width / 2;
    baseRef.current.setPointerCapture(e.pointerId);
    stickMove(e);
  }
  function stickMove(e) {
    const s = stick.current;
    if (s.id !== e.pointerId) return;
    e.preventDefault();
    const dx = e.clientX - s.cx, dy = e.clientY - s.cy;
    const dd = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, s.r / dd);
    if (thumbRef.current) thumbRef.current.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    let vx = dx / s.r, vy = dy / s.r;
    const m = Math.hypot(vx, vy);
    if (m > 1) { vx /= m; vy /= m; }
    const i = input.current;
    if (m < 0.18) { i.vx = 0; i.vy = 0; } else { i.vx = vx; i.vy = vy; }
  }
  function stickUp(e) {
    const s = stick.current;
    if (s.id !== e.pointerId) return;
    s.id = null;
    if (thumbRef.current) thumbRef.current.style.transform = "translate(0px,0px)";
    input.current.vx = 0; input.current.vy = 0;
  }

  const hold = (key) => ({
    onPointerDown: (e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); input.current[key] = true; },
    onPointerUp: (e) => { e.preventDefault(); input.current[key] = false; },
    onPointerCancel: () => { input.current[key] = false; },
  });
  const tap = (key) => ({ onPointerDown: (e) => { e.preventDefault(); sendTap(key); } });

  const side = slot != null ? SIDE[slot] : null;

  if (status !== "playing" && status !== "ready") {
    return <PadStatus status={status} room={room} />;
  }

  return (
    <div className={`pad ${side ? side.cls : ""}`}>
      <div className="pad-top">
        <span className="pad-badge">{side ? side.key : "—"}</span>
        <span className="pad-room">{room}</span>
        <span className={`pad-state pad-state--${status}`}>
          {status === "playing" ? "LIVE" : "READY"}
        </span>
      </div>

      <div className="pad-stick" ref={baseRef}
           onPointerDown={stickDown} onPointerMove={stickMove}
           onPointerUp={stickUp} onPointerCancel={stickUp}>
        <span className="pad-thumb" ref={thumbRef} />
      </div>

      <div className="pad-pad">
        <button type="button" className="pad-btn pad-btn--lob" {...tap("lob")}><LobIcon /></button>
        <button type="button" className="pad-btn pad-btn--pass" {...tap("pass")}><PassIcon /></button>
        <button type="button" className="pad-btn pad-btn--tackle" {...tap("tackle")}><TackleIcon /></button>
        <button type="button" className="pad-btn pad-btn--shoot" {...hold("shoot")}><ShootIcon /></button>
        <button type="button" className="pad-btn pad-btn--sprint" {...hold("sprint")}><SprintIcon /></button>
      </div>
    </div>
  );
}

function PadStatus({ status, room }) {
  const MSG = {
    connecting: ["连接中…", "Connecting to the host…"],
    joining: ["加入房间…", "Joining room…"],
    full: ["房间已满", "This room already has 2 players."],
    "no-room": ["房间不存在", "Room not found — check the code or rescan."],
    closed: ["主机已离开", "The host left. Ask them to restart."],
  };
  const [zh, en] = MSG[status] || ["…", "…"];
  return (
    <div className="pad pad--status">
      <div className="pad-status-card">
        <div className="pad-status-spinner" data-on={status === "connecting" || status === "joining"} />
        <b>{zh}</b>
        <span>{en}</span>
        {room ? <code className="pad-room-big">{room}</code> : null}
      </div>
    </div>
  );
}
