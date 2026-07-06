// Cloudflare Durable Object port of script/lan-server.mjs's relay logic.
// One global instance (see custom-worker.js) plays the same role the
// standalone Node relay process plays for local dev: a thin JSON relay
// over WebSocket that routes pad input to the host screen and start/roster
// signals back to the pads. Message protocol is identical to the local relay.
import { DurableObject } from "cloudflare:workers";

const SLOTS = 2; // slot 0 = red (P1), slot 1 = blue (P2)
const HOST_GRACE_MS = 25000; // keep room alive across lobby -> match navigation
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 ambiguity

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

export class LanRelay extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // rooms: code -> { host, pads: Map<padId,{ws,name,slot,ready}>, graceTimer }
    this.rooms = new Map();
    this.padSeq = 1;
  }

  makeCode() {
    let c = "";
    do {
      c = Array.from(
        { length: 4 },
        () => CODE_ALPHABET[(Math.random() * CODE_ALPHABET.length) | 0]
      ).join("");
    } while (this.rooms.get(c));
    return c;
  }

  pushRoster(room) {
    send(room.host, { t: "roster", pads: roster(room) });
  }

  async fetch(request) {
    if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
      return new Response("expected websocket", { status: 400 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    server.__role = null; // "host" | "pad"
    server.__room = null;
    server.__padId = null;

    server.addEventListener("message", (event) => {
      let msg;
      try { msg = JSON.parse(String(event.data)); } catch { return; }
      this.handleMessage(server, msg);
    });
    server.addEventListener("close", () => this.handleClose(server));

    return new Response(null, { status: 101, webSocket: client });
  }

  handleMessage(ws, msg) {
    // --- big screen registers / re-attaches as the room host ---
    if (msg.t === "host") {
      let code = (msg.room || "").toUpperCase();
      let room = code && this.rooms.get(code);
      if (room) {
        // re-attach (lobby -> match navigation): cancel the grace timer
        if (room.graceTimer) { clearTimeout(room.graceTimer); room.graceTimer = null; }
        const old = room.host;
        room.host = ws;
        if (old && old !== ws) try { old.close(4000, "host-replaced"); } catch {}
      } else {
        code = code || this.makeCode();
        room = { host: ws, pads: new Map(), graceTimer: null };
        this.rooms.set(code, room);
      }
      ws.__role = "host";
      ws.__room = code;
      send(ws, { t: "hosted", room: code, slots: SLOTS });
      this.pushRoster(room);
      return;
    }

    // --- phone joins a room as a gamepad ---
    if (msg.t === "join") {
      const code = (msg.room || "").toUpperCase();
      const room = this.rooms.get(code);
      if (!room) { send(ws, { t: "joinErr", reason: "no-room" }); return; }
      const slot = freeSlot(room);
      if (slot < 0) { send(ws, { t: "joinErr", reason: "full" }); return; }
      const padId = this.padSeq++;
      const name = String(msg.name || "").slice(0, 16) || (slot === 0 ? "P1" : "P2");
      room.pads.set(padId, { ws, name, slot, ready: true });
      ws.__role = "pad";
      ws.__room = code;
      ws.__padId = padId;
      send(ws, { t: "joined", padId, slot, room: code });
      this.pushRoster(room);
      return;
    }

    const room = ws.__room && this.rooms.get(ws.__room);
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
        this.pushRoster(room);
      }
      return;
    }

    // --- host signals match ended -> pads return to standby ---
    if (msg.t === "ended" && ws.__role === "host") {
      for (const p of room.pads.values()) send(p.ws, { t: "ended" });
      return;
    }
  }

  handleClose(ws) {
    const room = ws.__room && this.rooms.get(ws.__room);
    if (!room) return;
    if (ws.__role === "pad") {
      room.pads.delete(ws.__padId);
      this.pushRoster(room);
    } else if (ws.__role === "host" && room.host === ws) {
      // host vanished — hold the room briefly so a lobby->match reload re-attaches,
      // then tear it down and disconnect the pads.
      room.graceTimer = setTimeout(() => {
        for (const p of room.pads.values()) { send(p.ws, { t: "closed" }); try { p.ws.close(); } catch {} }
        this.rooms.delete(ws.__room);
      }, HOST_GRACE_MS);
    }
  }
}
