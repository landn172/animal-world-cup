import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

// LanRelay is one global Durable Object (see custom-worker.js), and
// WebSocket support in this test pool requires shared (non-isolated)
// storage across the whole run (see package.json's "test" script) — so
// every test below hosts its own uniquely-coded room to stay independent
// of the others, rather than relying on per-test storage resets.
let codeSeq = 0;
function freshCode() {
  codeSeq += 1;
  return `T${String(codeSeq).padStart(3, "0")}`; // T001, T002, ...
}

function stub() {
  return env.LAN_RELAY.getByName("singleton");
}

async function openSocket() {
  const response = await stub().fetch("https://example.com/api/lan-ws", {
    headers: { Upgrade: "websocket" },
  });
  const socket = response.webSocket;
  if (!socket) throw new Error("expected a websocket response");
  socket.accept();
  return socket;
}

function messageQueue(socket) {
  const pending = [];
  const waiters = [];
  socket.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (waiters.length) waiters.shift()(msg);
    else pending.push(msg);
  });
  return {
    next() {
      if (pending.length) return Promise.resolve(pending.shift());
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("timed out waiting for a message")), 2000);
        waiters.push((msg) => { clearTimeout(timeout); resolve(msg); });
      });
    },
  };
}

function send(socket, obj) {
  socket.send(JSON.stringify(obj));
}

async function hostRoom(code) {
  const socket = await openSocket();
  const queue = messageQueue(socket);
  send(socket, { t: "host", room: code || "" });
  const hosted = await queue.next();
  const roster = await queue.next();
  return { socket, queue, hosted, roster };
}

async function joinRoom(code, name) {
  const socket = await openSocket();
  const queue = messageQueue(socket);
  send(socket, { t: "join", room: code, name: name || "" });
  const joined = await queue.next();
  return { socket, queue, joined };
}

describe("LanRelay", () => {
  it("mints a 4-character room code and reports slots, no ip/port", async () => {
    const { hosted } = await hostRoom();
    expect(hosted.t).toBe("hosted");
    expect(hosted.room).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
    expect(hosted.slots).toBe(2);
    expect(hosted.ip).toBeUndefined();
    expect(hosted.port).toBeUndefined();
  });

  it("lets a pad join a hosted room and updates the host's roster", async () => {
    const code = freshCode();
    const host = await hostRoom(code);
    const pad = await joinRoom(code, "Phone");

    expect(pad.joined).toEqual({ t: "joined", padId: pad.joined.padId, slot: 0, room: code });

    const roster = await host.queue.next();
    expect(roster).toEqual({
      t: "roster",
      pads: [{ padId: pad.joined.padId, name: "Phone", slot: 0, ready: true }],
    });
  });

  it("rejects joining a room that doesn't exist", async () => {
    const pad = await joinRoom("ZZZZ", "Nobody");
    expect(pad.joined).toEqual({ t: "joinErr", reason: "no-room" });
  });

  it("rejects a third pad once both slots are taken", async () => {
    const code = freshCode();
    await hostRoom(code);
    await joinRoom(code, "P1");
    await joinRoom(code, "P2");
    const third = await joinRoom(code, "P3");
    expect(third.joined).toEqual({ t: "joinErr", reason: "full" });
  });

  it("relays pad input to the host tagged with slot and padId", async () => {
    const code = freshCode();
    const host = await hostRoom(code);
    const pad = await joinRoom(code, "Phone");
    await host.queue.next(); // roster push from the join

    send(pad.socket, { t: "input", d: { vx: 0.5, vy: 0, shoot: true, sprint: false } });
    const input = await host.queue.next();
    expect(input).toEqual({
      t: "input",
      slot: 0,
      padId: pad.joined.padId,
      d: { vx: 0.5, vy: 0, shoot: true, sprint: false },
    });
  });

  it("broadcasts host start to every joined pad", async () => {
    const code = freshCode();
    const host = await hostRoom(code);
    const pad = await joinRoom(code, "Phone");
    await host.queue.next(); // roster push from the join

    send(host.socket, { t: "start", info: { red: "argentina", blue: "portugal" } });
    const start = await pad.queue.next();
    expect(start).toEqual({ t: "start", slot: 0, info: { red: "argentina", blue: "portugal" } });
  });

  it("swaps slots when the host assigns a pad to one that's taken", async () => {
    const code = freshCode();
    const host = await hostRoom(code);
    const pad1 = await joinRoom(code, "P1"); // slot 0
    await host.queue.next(); // roster after pad1 joins
    const pad2 = await joinRoom(code, "P2"); // slot 1
    await host.queue.next(); // roster after pad2 joins

    send(host.socket, { t: "assign", padId: pad2.joined.padId, slot: 0 });

    // only the reassigned pad gets a direct "slot" push — the pad it swapped
    // with (pad1) only sees its new slot in the next roster, same as today's
    // script/lan-server.mjs (this asymmetry is existing, ported behavior,
    // not introduced by this change).
    const pad2Slot = await pad2.queue.next();
    expect(pad2Slot).toEqual({ t: "slot", slot: 0 });

    const roster = await host.queue.next();
    expect(roster.pads.find((p) => p.padId === pad2.joined.padId).slot).toBe(0);
    expect(roster.pads.find((p) => p.padId === pad1.joined.padId).slot).toBe(1);
  });

  it("drops a disconnected pad from the roster", async () => {
    const code = freshCode();
    const host = await hostRoom(code);
    const pad = await joinRoom(code, "Phone");
    await host.queue.next(); // roster after join

    pad.socket.close(1000, "done");
    const roster = await host.queue.next();
    expect(roster).toEqual({ t: "roster", pads: [] });
  });

  it("lets a reconnecting host re-attach to its room without losing the roster", async () => {
    const code = freshCode();
    const host = await hostRoom(code);
    const pad = await joinRoom(code, "Phone");
    await host.queue.next(); // roster after join

    host.socket.close(1000, "navigating");
    const host2 = await hostRoom(code); // re-attach with the same code
    expect(host2.hosted).toEqual({ t: "hosted", room: code, slots: 2 });
    expect(host2.roster).toEqual({
      t: "roster",
      pads: [{ padId: pad.joined.padId, name: "Phone", slot: 0, ready: true }],
    });
  });
});
