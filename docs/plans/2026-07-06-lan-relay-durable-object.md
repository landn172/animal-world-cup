# LAN Relay over Cloudflare Durable Objects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "LAN 联机" feature (big screen + phone gamepads) work on the deployed Cloudflare Workers site by replacing the `ws://<host>:13001` relay with a same-origin `wss://` Durable Object, while leaving local development (`pnpm dev` / `pnpm dev:lan`) completely untouched.

**Architecture:** A single global Durable Object (`LanRelay`) holds an in-memory `rooms` Map and speaks the exact same JSON message protocol as `script/lan-server.mjs` today. A new `custom-worker.js` file becomes the Worker's entry point (replacing `.open-next/worker.js` directly in `wrangler.toml`): it intercepts WebSocket-upgrade requests to `/api/lan-ws` and routes them to the Durable Object, and forwards everything else, unchanged, to the OpenNext-generated Next.js handler. The client (`app/lan/lanClient.js`) picks its transport by `window.location.protocol`: `https:` → `wss://<same-host>/api/lan-ws` (the new DO path), `http:` → `ws://<host>:13001` (unchanged, talks to `script/lan-server.mjs`).

**Tech Stack:** Plain JavaScript (the whole app is `.js`/`.jsx`, no TypeScript build step exists — do not introduce `.ts` files or a `tsconfig.json`). Cloudflare Workers native `WebSocketPair` / `DurableObject` base class (from `cloudflare:workers`) — no new npm dependencies.

## Global Constraints

- Full design context lives in `docs/specs/2026-07-06-lan-relay-durable-object-design.md` — read it before starting if anything below is unclear.
- No new npm dependencies. `WebSocketPair` and `DurableObject` are Workers runtime globals/virtual-module exports, not packages to install.
- Write plain `.js`, not `.ts` — the project has zero TypeScript application files (only `open-next.config.ts`, which the OpenNext CLI itself requires) and no `tsconfig.json`. Don't add one for this feature.
- `script/lan-server.mjs` and `script/lan-dev.mjs` must not change at all — local dev's `ws://host:13001` path is explicitly out of scope (see spec Decision #2).
- No authentication/PIN beyond the existing 4-character room code — explicitly out of scope (see spec Decision #1).
- Single global Durable Object instance (`getByName("singleton")`), not one per room — explicitly chosen over Cloudflare's usual per-entity sharding advice (see spec Decision #3). Don't "fix" this into per-room sharding mid-implementation.
- This project has no test framework (no vitest/jest, no `test` script in `package.json`). Do not add one. Verification in this plan is: `node --check` for syntax sanity on new files, plus the manual end-to-end checks from the spec's "Testing / verification plan" section (Task 5 below). This mirrors the project's existing convention of manual `script/verify-*.mjs`-style checks rather than an automated suite.
- Actually deploying to production (`wrangler deploy`) is **not** part of this plan's automated steps — it's a hard-to-reverse action against the live site and needs an explicit human go-ahead. The plan ends with the code ready to deploy and instructions for the human to run it.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `workers/lan-relay.js` | Create | The `LanRelay` Durable Object class — the relay/room logic, ported from `script/lan-server.mjs`. |
| `custom-worker.js` | Create | Wrangler's new `main` entry. Routes `/api/lan-ws` WebSocket upgrades to the DO; delegates everything else to the OpenNext-generated handler. |
| `wrangler.toml` | Modify | Point `main` at `custom-worker.js`; add the `LAN_RELAY` Durable Object binding + migration. |
| `app/lan/lanClient.js` | Modify | `lanWsUrl()` branches on `location.protocol` between the new `wss://.../api/lan-ws` path and the existing `ws://host:13001` path. |
| `app/lobby/LobbyClient.jsx` | Modify | The `hosted` message handler falls back to `window.location.origin` for the QR/join URL when the relay doesn't send `ip`/`port` (i.e., when talking to the DO). |

`app/pad/PadController.jsx` and `app/match/LanHostBridge.jsx` are **not modified** — they only consume the message protocol, which is unchanged.

---

### Task 1: Create the `LanRelay` Durable Object

**Files:**
- Create: `workers/lan-relay.js`

**Interfaces:**
- Consumes: nothing from this codebase (self-contained; only Workers runtime globals `WebSocketPair`, `Response`, and `DurableObject` from `cloudflare:workers`).
- Produces: `export class LanRelay extends DurableObject` — a Durable Object class with an `async fetch(request)` method that upgrades a WebSocket connection and speaks the relay protocol. Consumed by Task 2's `custom-worker.js` (via the `LAN_RELAY` binding) and by `wrangler.toml`'s `class_name = "LanRelay"` (Task 3).

This is a near line-for-line port of `script/lan-server.mjs`'s room logic, swapping the Node `ws` library for the native Workers `WebSocketPair`/`accept()` API. Read `script/lan-server.mjs` first if you want the original for comparison — the message protocol (`host`/`join`/`input`/`start`/`assign`/`ended` in; `hosted`/`roster`/`joined`/`joinErr`/`slot`/`start`/`ended`/`closed`/`input` out) is copied verbatim. The only intentional behavior change: the `hosted` reply drops `ip`/`port` (there's no LAN IP to report once phones join over the public origin — see Task 4).

- [ ] **Step 1: Write `workers/lan-relay.js`**

```js
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
    if (request.headers.get("Upgrade") !== "websocket") {
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
```

- [ ] **Step 2: Syntax-check the file**

Run: `node --check workers/lan-relay.js`
Expected: no output, exit code 0. (`node --check` only parses for syntax errors; it does not resolve the `cloudflare:workers` import, which only exists inside the Workers runtime — that's expected and fine.)

- [ ] **Step 3: Commit**

```bash
git add workers/lan-relay.js
git commit -m "Add LanRelay Durable Object, ported from script/lan-server.mjs"
```

---

### Task 2: Create the custom Worker entry that routes to the Durable Object

**Files:**
- Create: `custom-worker.js`

**Interfaces:**
- Consumes: `LanRelay` class from `./workers/lan-relay.js` (Task 1); the default export of `./.open-next/worker.js` (generated by `pnpm run build:worker`, not present until that build runs at least once).
- Produces: a default-exported `{ fetch(request, env, ctx) }` object — this becomes wrangler's `main` entry (wired in Task 3). Also re-exports `LanRelay`, `DOQueueHandler`, `DOShardedTagCache`, `BucketCachePurge` so wrangler can find the Durable Object classes it needs to bind.

**Before writing this file**, confirm `.open-next/worker.js` exists — if `pnpm run build:worker` hasn't been run yet in this checkout, run it now so the import path resolves:

```bash
pnpm run build:worker
```

- [ ] **Step 1: Write `custom-worker.js`**

```js
// Wrangler's "main" entry (see wrangler.toml). Wraps the Next.js worker that
// @opennextjs/cloudflare generates at build time so we can also expose the
// LanRelay Durable Object — see docs/specs/2026-07-06-lan-relay-durable-object-design.md
// for why this needs a custom worker instead of a plain Next.js route handler.
import { default as handler } from "./.open-next/worker.js";

export { LanRelay } from "./workers/lan-relay.js";

// Re-exported so DO-backed incremental cache / tag cache / bucket cache purge
// keep working if ever enabled in open-next.config.ts (unused today, but
// these are already present in the generated worker — see opennext.js.org's
// "Custom Worker" how-to).
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/lan-ws" && request.headers.get("Upgrade") === "websocket") {
      const stub = env.LAN_RELAY.getByName("singleton");
      return stub.fetch(request);
    }
    return handler.fetch(request, env, ctx);
  },
};
```

- [ ] **Step 2: Syntax-check the file**

Run: `node --check custom-worker.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Update `wrangler.toml`**

Current content:

```toml
name = "animal-cup"
main = ".open-next/worker.js"
compatibility_date = "2025-04-01"
compatibility_flags = ["nodejs_compat"]

assets = { directory = ".open-next/assets", binding = "ASSETS" }
```

New content:

```toml
name = "animal-cup"
main = "./custom-worker.js"
compatibility_date = "2025-04-01"
compatibility_flags = ["nodejs_compat"]

assets = { directory = ".open-next/assets", binding = "ASSETS" }

[[durable_objects.bindings]]
name = "LAN_RELAY"
class_name = "LanRelay"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["LanRelay"]
```

- [ ] **Step 4: Verify wrangler can resolve the new config and entry point**

Run: `pnpm exec wrangler deploy --dry-run --outdir=/tmp/wrangler-dry-run`
Expected: build/bundle succeeds and prints a summary (bindings list should include `LAN_RELAY`, no errors about missing exports or unresolved imports). This does **not** deploy anything — `--dry-run` only bundles and validates.

- [ ] **Step 5: Commit**

```bash
git add custom-worker.js wrangler.toml
git commit -m "Route /api/lan-ws to the LanRelay Durable Object"
```

---

### Task 3: Branch the client's WebSocket URL by protocol

**Files:**
- Modify: `app/lan/lanClient.js:1-20`

**Interfaces:**
- Consumes: nothing new.
- Produces: `lanWsUrl()` now returns `wss://<host>/api/lan-ws` when the page is `https:`, otherwise the existing `ws://<host>:13001`. Consumed unchanged by `createLanClient()` in the same file (already calls `lanWsUrl()`), and transitively by `LobbyClient.jsx`, `PadController.jsx`, `LanHostBridge.jsx` — none of which need to change for this.

Current file header comment (lines 3–7) claims the relay "always lives on port 13001 of whatever host served this page" — that's only true for local dev now, so it needs updating alongside the code.

- [ ] **Step 1: Update the file header comment**

Replace:

```js
// Tiny reconnecting WebSocket client for the LAN relay (script/lan-server.mjs).
// Shared by the lobby (host), the phone controller (pad), and the in-match host
// bridge. The relay always lives on port 13001 of whatever host served this
// page — so the phone that opened http://<lan-ip>:13000/pad talks to
// ws://<lan-ip>:13001 with no extra config.
```

With:

```js
// Tiny reconnecting WebSocket client for the LAN relay. Shared by the lobby
// (host), the phone controller (pad), and the in-match host bridge. Two
// backends speak the same JSON protocol: locally, script/lan-server.mjs on
// port 13001 (plain http, same LAN); once deployed, the LanRelay Durable
// Object at /api/lan-ws on the same origin (https, same public host — see
// docs/specs/2026-07-06-lan-relay-durable-object-design.md). lanWsUrl()
// picks between them by page protocol.
```

- [ ] **Step 2: Update `lanWsUrl()`**

Replace:

```js
export function lanWsUrl() {
  if (typeof window === "undefined") return null;
  const host = window.location.hostname || "127.0.0.1";
  return `ws://${host}:${LAN_PORT}`;
}
```

With:

```js
export function lanWsUrl() {
  if (typeof window === "undefined") return null;
  if (window.location.protocol === "https:") {
    return `wss://${window.location.host}/api/lan-ws`;
  }
  const host = window.location.hostname || "127.0.0.1";
  return `ws://${host}:${LAN_PORT}`;
}
```

- [ ] **Step 3: Syntax-check the file**

Run: `node --check app/lan/lanClient.js`
Expected: no output, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add app/lan/lanClient.js
git commit -m "Branch lanWsUrl() to wss://.../api/lan-ws when served over https"
```

---

### Task 4: Fall back to the page origin for the QR/join URL

**Files:**
- Modify: `app/lobby/LobbyClient.jsx:39-52`

**Interfaces:**
- Consumes: the `hosted` message's shape now varies by backend — local relay sends `{t:"hosted", room, ip, port, slots}`, the Durable Object sends `{t:"hosted", room, slots}` (no `ip`/`port`, per Task 1).
- Produces: no external interface change — `join`/`qr` state still end up holding a full `http(s)://.../pad?room=CODE` URL either way.

Current code (inside the `createLanClient({ onMessage(msg) { ... } })` callback):

```js
        if (msg.t === "hosted") {
          setRoom(msg.room);
          const url = `http://${msg.ip}:${msg.port}/pad?room=${msg.room}`;
          setJoin(url);
          QRCode.toDataURL(url, { margin: 1, width: 320, color: { dark: "#1d3d16", light: "#ffffff" } })
            .then(setQr)
            .catch(() => setQr(null));
        } else if (msg.t === "roster") {
```

- [ ] **Step 1: Update the `hosted` branch**

Replace the block above with:

```js
        if (msg.t === "hosted") {
          setRoom(msg.room);
          // local relay (script/lan-server.mjs) sends ip/port for the LAN join URL;
          // the deployed Durable Object omits them since phones join over the
          // same public origin the big screen is already on.
          const url = msg.ip
            ? `http://${msg.ip}:${msg.port}/pad?room=${msg.room}`
            : `${window.location.origin}/pad?room=${msg.room}`;
          setJoin(url);
          QRCode.toDataURL(url, { margin: 1, width: 320, color: { dark: "#1d3d16", light: "#ffffff" } })
            .then(setQr)
            .catch(() => setQr(null));
        } else if (msg.t === "roster") {
```

- [ ] **Step 2: Syntax-check the file**

Run: `node --check app/lobby/LobbyClient.jsx`
Expected: `node --check` can choke on JSX syntax outside this changed block — if it errors on unrelated JSX (not on the lines you touched), that's a pre-existing limitation of `node --check` on `.jsx` files, not a regression. In that case, instead run: `pnpm exec next lint app/lobby/LobbyClient.jsx` (or just eyeball the diff) to confirm no syntax mistake was introduced in the edited block.

- [ ] **Step 3: Commit**

```bash
git add app/lobby/LobbyClient.jsx
git commit -m "Fall back to window.location.origin for the LAN join URL"
```

---

### Task 5: End-to-end verification

No files change in this task — it's the manual verification called for in the spec's "Testing / verification plan" section, run after Tasks 1–4 are complete. This project has no automated test suite, so this is the actual test cycle for the feature.

**Interfaces:** none (verification only).

- [ ] **Step 1: Local regression check (unaffected path)**

```bash
pnpm dev:lan
```

Open `http://localhost:13000/lobby?red=argentina&blue=portugal&ai=0&side=home&time=6` in one browser tab (the "big screen"). Confirm a room code and QR appear. Open the printed `http://<lan-ip>:13000/pad?room=<CODE>` URL in a second tab or your phone. Confirm the lobby's player-1 slot shows connected, clicking "Start" navigates the big screen into the match, and moving the pad's stick/buttons moves the P1 character. This must behave exactly as it did before this plan's changes — it exercises `script/lan-server.mjs` and the `ws://host:13001` branch of `lanWsUrl()`, neither of which changed.

Expected: full host → join → start → input flow works, matching pre-change behavior.

- [ ] **Step 2: Local Durable Object check via `wrangler dev`**

```bash
pnpm run build:worker
pnpm exec wrangler dev --local-protocol https
```

`--local-protocol https` is required — `wrangler dev` defaults to plain `http://`, and `lanWsUrl()` only takes the `wss://`/DO branch when `location.protocol === "https:"`. Over plain `http://` this check would silently exercise the old `ws://host:13001` branch instead and prove nothing.

Wrangler will print a local `https://localhost:PORT` URL (self-signed certificate — your browser will show a trust warning; accept it to proceed, since this is your own local cert, not a live public request to accept from elsewhere). Open `.../lobby?red=argentina&blue=portugal&ai=0&side=home&time=6`.

Expected:
- No mixed-content error in the browser console.
- The lobby shows a room code and QR pointing at `https://localhost:PORT/pad?room=<CODE>` (built from `window.location.origin`, confirming Task 4's fallback fired).
- Opening that join URL in a second tab (accepting the same self-signed cert warning) joins the room; the lobby's player-1 slot shows connected.
- Clicking "Start" and driving the pad's stick/buttons in the second tab moves the P1 character on the host tab's match view.

- [ ] **Step 3: Report readiness for a real deploy**

This plan does not run `wrangler deploy` itself. Once Steps 1–2 both pass, tell the user the code is ready to deploy and that `wrangler deploy` (or their usual deploy process) needs to be run — and, per the spec's Testing plan Step 3, to repeat the host + phone-join flow once more against the live `https://animal-cup.yao-440.workers.dev` URL afterward.

---

## Self-Review Notes

- **Spec coverage:** Problem (Task 1–3 fix the mixed-content root cause), Decision #1 (no auth — nothing added, matches), Decision #2 (local dev untouched — Tasks 1–4 never touch `script/lan-server.mjs`; Task 5 Step 1 regression-checks this), Decision #3 (single global DO — Task 1's constructor holds one `rooms` Map, `custom-worker.js` always calls `getByName("singleton")`), Architecture (custom worker + DO, Tasks 1–2), Client changes (Tasks 3–4), Error handling (400 for non-WS requests — Task 1 Step 1; malformed JSON dropped — Task 1's `handleMessage` try/catch; grace timer — Task 1's `handleClose`), Testing plan (Task 5, all three steps covered, including the `--local-protocol https` caveat added during spec self-review).
- **Placeholder scan:** no TBD/TODO; every step has real code or a real command with expected output.
- **Type/name consistency:** `LanRelay` (class name) matches across `workers/lan-relay.js`, `custom-worker.js`'s re-export, and `wrangler.toml`'s `class_name`. `LAN_RELAY` (binding name) matches between `wrangler.toml` and `custom-worker.js`'s `env.LAN_RELAY`. `/api/lan-ws` (path) matches between `custom-worker.js`'s routing check and `lanClient.js`'s `lanWsUrl()`. `hosted` message shape (`room`, `slots`, optional `ip`/`port`) matches between Task 1's `handleMessage` and Task 4's `LobbyClient.jsx` fallback check.
