// LAN relay server for Animal Cup local-versus / 局域网联机.
//
// Topology (owner-approved): ONE big screen runs the actual match; each phone
// is a wireless gamepad. This server is a thin JSON relay over WebSocket —
// it never touches game state, it just routes pad input to the host screen
// and start/roster signals back to the pads. Runs on the host machine's LAN
// only (plain ws://, no auth — see note below), alongside `next dev`.
//
// SECURITY: intentionally unauthenticated and bound to 0.0.0.0 so phones on
// the same Wi-Fi can reach it. It carries only gamepad input + display names —
// no secrets, no file/system access. Do NOT expose this port to the internet;
// it is a same-LAN convenience server, not a public service.
import { WebSocketServer } from "ws";
import os from "node:os";

const PORT = Number(process.env.LAN_PORT || 13001);
const SLOTS = 2; // slot 0 = red (P1), slot 1 = blue (P2)
const HOST_GRACE_MS = 25000; // keep room alive across lobby -> match navigation

// lanIP: first non-internal IPv4 — what the phone types / the QR encodes.
function lanIP() {
  const ifaces = os.networkInterfaces();
  const prefer = []; // 192.168.* / 10.* first, then anything else
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family !== "IPv4" || ni.internal) continue;
      if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ni.address)) prefer.unshift(ni.address);
      else prefer.push(ni.address);
    }
  }
  return prefer[0] || "127.0.0.1";
}

// rooms: code -> { host, pads:Map<padId,{ws,name,slot,ready}>, graceTimer }
const rooms = new Map();
let padSeq = 1;

function makeCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 ambiguity
  let c = "";
  do {
    c = Array.from({ length: 4 }, () => A[(Math.random() * A.length) | 0]).join("");
  } while (rooms.get(c));
  return c;
}

function send(ws, obj) {
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify(obj)); } catch {}
  }
}

function freeSlot(room) {
  const used = new Set([...room.pads.values()].map((p) => p.slot));
  for (let s = 0; s < SLOTS; s++) if (!used.has(s)) return s;
  return -1; // full
}

function roster(room) {
  return [...room.pads.entries()].map(([padId, p]) => ({
    padId, name: p.name, slot: p.slot, ready: p.ready,
  }));
}

function pushRoster(room) {
  send(room.host, { t: "roster", pads: roster(room) });
}

const wss = new WebSocketServer({ port: PORT, host: "0.0.0.0" });

wss.on("connection", (ws) => {
  // Connection identity is established by the first message (hello/host or
  // hello/pad). Until then the socket is anonymous.
  ws.__role = null; // "host" | "pad"
  ws.__room = null;
  ws.__padId = null;

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }

    // --- big screen registers / re-attaches as the room host ---
    if (msg.t === "host") {
      let code = (msg.room || "").toUpperCase();
      let room = code && rooms.get(code);
      if (room) {
        // re-attach (lobby -> match navigation): cancel the grace timer
        if (room.graceTimer) { clearTimeout(room.graceTimer); room.graceTimer = null; }
        const old = room.host;
        room.host = ws;
        if (old && old !== ws) try { old.close(4000, "host-replaced"); } catch {}
      } else {
        code = code || makeCode();
        room = { host: ws, pads: new Map(), graceTimer: null };
        rooms.set(code, room);
      }
      ws.__role = "host";
      ws.__room = code;
      send(ws, { t: "hosted", room: code, ip: lanIP(), port: 13000, slots: SLOTS });
      pushRoster(room);
      return;
    }

    // --- phone joins a room as a gamepad ---
    if (msg.t === "join") {
      const code = (msg.room || "").toUpperCase();
      const room = rooms.get(code);
      if (!room) { send(ws, { t: "joinErr", reason: "no-room" }); return; }
      const slot = freeSlot(room);
      if (slot < 0) { send(ws, { t: "joinErr", reason: "full" }); return; }
      const padId = padSeq++;
      const name = String(msg.name || "").slice(0, 16) || (slot === 0 ? "P1" : "P2");
      room.pads.set(padId, { ws, name, slot, ready: true });
      ws.__role = "pad";
      ws.__room = code;
      ws.__padId = padId;
      send(ws, { t: "joined", padId, slot, room: code });
      pushRoster(room);
      return;
    }

    const room = ws.__room && rooms.get(ws.__room);
    if (!room) return;

    // --- pad -> host: per-frame input state ---
    if (msg.t === "input" && ws.__role === "pad") {
      const pad = room.pads.get(ws.__padId);
      if (pad) send(room.host, { t: "input", slot: pad.slot, padId: ws.__padId, d: msg.d });
      return;
    }

    // --- host -> pads: start the match (carries match params for display) ---
    if (msg.t === "start" && ws.__role === "host") {
      for (const p of room.pads.values()) send(p.ws, { t: "start", slot: p.slot, info: msg.info || null });
      return;
    }

    // --- host reassigns a pad's slot/team ---
    if (msg.t === "assign" && ws.__role === "host") {
      const pad = room.pads.get(msg.padId);
      if (pad && msg.slot >= 0 && msg.slot < SLOTS) {
        // swap if the target slot is taken
        for (const [, other] of room.pads) if (other.slot === msg.slot) other.slot = pad.slot;
        pad.slot = msg.slot;
        send(pad.ws, { t: "slot", slot: pad.slot });
        pushRoster(room);
      }
      return;
    }

    // --- host signals match ended -> pads return to standby ---
    if (msg.t === "ended" && ws.__role === "host") {
      for (const p of room.pads.values()) send(p.ws, { t: "ended" });
      return;
    }
  });

  ws.on("close", () => {
    const room = ws.__room && rooms.get(ws.__room);
    if (!room) return;
    if (ws.__role === "pad") {
      room.pads.delete(ws.__padId);
      pushRoster(room);
    } else if (ws.__role === "host" && room.host === ws) {
      // host vanished — hold the room briefly so a lobby->match reload re-attaches,
      // then tear it down and disconnect the pads.
      room.graceTimer = setTimeout(() => {
        for (const p of room.pads.values()) { send(p.ws, { t: "closed" }); try { p.ws.close(); } catch {} }
        rooms.delete(ws.__room);
      }, HOST_GRACE_MS);
    }
  });
});

const ip = lanIP();
console.log(`[lan] relay listening on ws://${ip}:${PORT}  (phones join via http://${ip}:13000/pad)`);

