"use client";

// Mobile touch controls for play mode. Left = analog joystick (movement).
// Right = action diamond (Lob/Pass/Tackle/Shoot) with a
// held Sprint button in the centre. Two-finger pinch zooms the camera. All input is
// written to the window.__touchInput contract the standalone play loop folds
// into the controller each tick. Pointer events (finger + mouse); SVG glyphs,
// no emoji, to match the HUD icon style.
import { useEffect, useRef } from "react";

function ti() {
  return (window.__touchInput =
    window.__touchInput ||
    { active: false, vx: 0, vy: 0, shoot: false, sprint: false, pass: false, lob: false, switchPlayer: false, tackle: false });
}

const SVG = (props) => (
  <svg viewBox="0 0 24 24" width={props.s || 27} height={props.s || 27} fill="none"
       stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
       aria-hidden>{props.children}</svg>
);
// Pass — straight arrow
const PassIcon = () => <SVG><path d="M4 12h12" /><path d="M12 7l5 5-5 5" /></SVG>;
// Shoot — classic soccer ball (centre pentagon + radiating seams)
const ShootIcon = () => (
  <SVG s={28}>
    <circle cx="12" cy="12" r="8.2" />
    <path d="M12 7.2l3.3 2.4-1.25 3.9H9.95L8.7 9.6z" />
    <path d="M12 7.2V4M15.3 9.6l2.7-1.1M14.05 13.5l1.7 2.4M9.95 13.5l-1.7 2.4M8.7 9.6L6 8.5" />
  </SVG>
);
// Lob / cross — lofted trajectory
const LobIcon = () => <SVG><path d="M4 16.5C8 7.5 16 7.5 20 14" /><path d="M20 14l.4-3.9M20 14l-3.8 1.2" /></SVG>;
// Tackle — defender shield
const TackleIcon = () => <SVG><path d="M12 3.4l6.6 2.4v5c0 3.9-2.9 6.6-6.6 7.8C8.3 17.4 5.4 14.7 5.4 10.8v-5z" /></SVG>;
// Sprint — double chevron (hold to run), sits in the centre of the diamond
const SprintIcon = () => <SVG s={26}><path d="M6 6l6 6-6 6" /><path d="M13 6l6 6-6 6" /></SVG>;

export default function TouchControls() {
  const baseRef = useRef(null);
  const thumbRef = useRef(null);
  const st = useRef({ id: null, cx: 0, cy: 0, r: 56 });

  useEffect(() => {
    const T = ti();
    T.active = true;
    return () => { T.active = false; T.vx = 0; T.vy = 0; T.shoot = false; T.sprint = false; };
  }, []);

  // two-finger pinch -> camera zoom (window.__matchZoom). Page zoom is locked
  // (user-scalable=no), so we own the pinch and drive the in-game camera.
  useEffect(() => {
    let startDist = 0, startMul = 1;
    const d = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onStart = (e) => {
      if (e.touches.length === 2) {
        startDist = d(e.touches);
        startMul = (window.__matchZoom && window.__matchZoom.get && window.__matchZoom.get()) || 1;
      }
    };
    const onMove = (e) => {
      if (e.touches.length === 2 && startDist > 0 && window.__matchZoom) {
        e.preventDefault();
        window.__matchZoom.set(startMul * (d(e.touches) / startDist));
      }
    };
    const onEnd = (e) => { if (e.touches.length < 2) startDist = 0; };
    document.addEventListener("touchstart", onStart, { passive: false });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  function stickDown(e) {
    const rect = baseRef.current.getBoundingClientRect();
    const s = st.current;
    s.id = e.pointerId;
    s.cx = rect.left + rect.width / 2;
    s.cy = rect.top + rect.height / 2;
    s.r = rect.width / 2;
    baseRef.current.setPointerCapture(e.pointerId);
    stickMove(e);
  }
  function stickMove(e) {
    const s = st.current;
    if (s.id !== e.pointerId) return;
    e.preventDefault();
    const dx = e.clientX - s.cx, dy = e.clientY - s.cy;
    const dd = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, s.r / dd);
    if (thumbRef.current) thumbRef.current.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    let vx = dx / s.r, vy = dy / s.r;
    const m = Math.hypot(vx, vy);
    if (m > 1) { vx /= m; vy /= m; }
    const T = ti();
    if (m < 0.18) { T.vx = 0; T.vy = 0; } // dead zone
    else { T.vx = vx; T.vy = vy; }        // sprint is the centre button now
  }
  function stickUp(e) {
    const s = st.current;
    if (s.id !== e.pointerId) return;
    s.id = null;
    if (thumbRef.current) thumbRef.current.style.transform = "translate(0px,0px)";
    const T = ti(); T.vx = 0; T.vy = 0;
  }

  const hold = (key) => ({
    onPointerDown: (e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); ti()[key] = true; },
    onPointerUp: (e) => { e.preventDefault(); ti()[key] = false; },
    onPointerCancel: () => { ti()[key] = false; },
  });
  const tap = (key) => ({
    onPointerDown: (e) => { e.preventDefault(); ti()[key] = true; },
  });

  return (
    <div className="tc" aria-hidden>
      <div className="tc-stick" ref={baseRef}
           onPointerDown={stickDown} onPointerMove={stickMove}
           onPointerUp={stickUp} onPointerCancel={stickUp}>
        <span className="tc-thumb" ref={thumbRef} />
      </div>
      <div className="tc-pad">
        <button type="button" className="tc-btn tc-btn--lob" {...tap("lob")}><LobIcon /></button>
        <button type="button" className="tc-btn tc-btn--pass" {...tap("pass")}><PassIcon /></button>
        <button type="button" className="tc-btn tc-btn--tackle" {...tap("tackle")}><TackleIcon /></button>
        <button type="button" className="tc-btn tc-btn--shoot" {...hold("shoot")}><ShootIcon /></button>
        <button type="button" className="tc-btn tc-btn--sprint" {...hold("sprint")}><SprintIcon /></button>
      </div>
    </div>
  );
}
