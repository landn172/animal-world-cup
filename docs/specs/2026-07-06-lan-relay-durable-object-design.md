# LAN relay over Cloudflare Durable Objects

Date: 2026-07-06
Status: Approved for planning

## Problem

The app is deployed to Cloudflare Workers at `https://animal-cup.yao-440.workers.dev`. Its "LAN 联机" feature (big screen hosts a match, phones join as gamepads via `/lobby` → QR code → `/pad`) talks to a relay over `ws://<host>:13001`, implemented by `app/lan/lanClient.js` and served locally by `script/lan-server.mjs` (a plain, unauthenticated `ws://` relay meant to run alongside `next dev` on the same LAN).

On the deployed HTTPS site, the browser blocks this outright:

```
Mixed Content: The page at 'https://animal-cup.yao-440.workers.dev/lobby?...' was loaded over
HTTPS, but attempted to connect to the insecure WebSocket endpoint
'ws://animal-cup.yao-440.workers.dev:13001/'. This request has been blocked; this endpoint
must be available over WSS.
```

This isn't just a `ws:` vs `wss:` naming issue — nothing listens on port 13001 on the Workers domain at all. `script/lan-server.mjs` is a separate Node process that only exists on a developer's machine; Cloudflare Workers doesn't expose arbitrary TCP ports, only the standard HTTPS origin. The LAN feature is therefore completely non-functional on the deployed site today, independent of the mixed-content error.

## Decision

Reimplement the relay's production path as a Cloudflare Durable Object, reachable over `wss://` on the same origin (no separate port). Local development keeps using `script/lan-server.mjs` unchanged. The client picks its transport based on the page's protocol.

Three scope decisions, confirmed with the project owner:

1. **Security posture stays as-is.** No auth beyond the 4-character room code — rooms live for minutes (25s host-grace timeout) and the code space is ~1,048,576 combinations, matching the current casual, unauthenticated design. Moving from LAN-only to internet-reachable does widen who could theoretically join, but this is accepted as negligible risk for a casual hobby feature.
2. **Local dev workflow is untouched.** `pnpm dev` / `pnpm dev:lan` keep using `script/lan-server.mjs` over plain `ws://`. Only the deployed build gets the Durable Object path. The client branches on `window.location.protocol`, not on any build-time flag.
3. **Single global Durable Object**, not one DO per room. Cloudflare's own best practice is to shard by coordination unit (one DO per room), but this project's realistic concurrency (a handful of friends' matches, never simultaneous at scale) doesn't need it, and a single instance lets almost all of `lan-server.mjs`'s existing, already-correct room logic carry over verbatim — same in-memory `rooms` Map, same room-code minting on the server side, zero wire-protocol changes for this part. Per-room sharding was rejected because it would require moving room-code generation to the client (with collision-retry logic) purely to satisfy a routing constraint that doesn't matter at this scale.

## Architecture

```
Browser (https://animal-cup.yao-440.workers.dev/lobby)
  │  wss://animal-cup.yao-440.workers.dev/api/lan-ws
  ▼
custom-worker.ts  (wrangler "main" entry, wraps the OpenNext-generated worker)
  │  pathname === "/api/lan-ws" && Upgrade: websocket ?
  ├─ yes → env.LAN_RELAY.getByName("singleton").fetch(request)   [Durable Object]
  └─ no  → delegate to OpenNext's generated fetch handler (Next.js, unchanged)
```

### Why a custom Worker entry, not a Next.js Route Handler

A plain `app/api/lan-ws/route.js` Route Handler was considered and rejected. OpenNext's request/response adapter translates the raw Cloudflare `Request`/`Response` into Next.js's own types for anything that goes through the Next.js handler, and there's no indication that translation preserves Cloudflare's non-standard `Response({ webSocket })` field needed to complete a WebSocket upgrade. OpenNext's own documentation's answer for "expose something other than a plain fetch handler" (e.g. Durable Objects, scheduled handlers) is exactly the custom-worker wrapper pattern used here — it bypasses Next.js entirely for this one path, which sidesteps the risk rather than depending on unconfirmed pass-through behavior.

### The `LanRelay` Durable Object

One singleton instance (`getByName("singleton")`), reached only through the custom worker's routing check above. Internally it is close to a line-for-line port of `script/lan-server.mjs`:

- Same in-memory `rooms: Map<code, { host, pads: Map<padId, {ws, name, slot, ready}>, graceTimer }>`.
- Same message protocol, unchanged: `{t:"host"}` / `{t:"join"}` / `{t:"input"}` / `{t:"start"}` / `{t:"assign"}` / `{t:"ended"}` in, `{t:"hosted"}` / `{t:"roster"}` / `{t:"joined"}` / `{t:"joinErr"}` / `{t:"slot"}` / `{t:"start"}` / `{t:"ended"}` / `{t:"closed"}` / `{t:"input"}` out.
- Same room-code minting (`makeCode()`, 4 chars, no ambiguous glyphs) and the same 25s host-grace timer on host disconnect, both server-side, both via plain `setTimeout` — a Durable Object holding open (non-hibernating) WebSockets stays resident in memory for the life of those sockets, so this behaves the same as the always-on Node process it replaces. This project deliberately does not use the Hibernation API (`ctx.acceptWebSocket`): hibernation exists to avoid paying for idle DO wall-clock time, which doesn't matter at this scale, and adopting it would require reconstructing room state from `serializeAttachment`/`getWebSockets()` on wake instead of a plain Map — real complexity with no benefit here.
- One deliberate removal: `lanIP()` (`node:os`) is dropped. It existed only so the relay could tell the host machine's LAN IP for the QR/join URL — irrelevant once phones join over the public origin (see Client changes below). The DO's `hosted` message becomes `{t: "hosted", room, slots}`, with no `ip`/`port` fields.
- WebSocket handling uses the classic (non-hibernating) API: `new WebSocketPair()`, `server.accept()`, `addEventListener("message"/"close", ...)`, custom properties (`__role`, `__padId`) attached directly to the socket object exactly as `ws.__role` is today — this requires no Cloudflare-specific API beyond `WebSocketPair` and `accept()`.

### Deployment config changes

`wrangler.toml`:
- `main` changes from `.open-next/worker.js` to `./custom-worker.ts`.
- Add a `durable_objects.bindings` entry (`LAN_RELAY` → class `LanRelay`) and a matching `migrations` entry (`new_sqlite_classes: ["LanRelay"]`).
- `assets` binding is untouched — asset-serving takes priority for files that exist in `.open-next/assets`; `/api/lan-ws` never matches a static file, so it always reaches the Worker regardless.

New files:
- `custom-worker.ts` (repo root) — imports the default export from `./.open-next/worker.js`, re-exports `DOQueueHandler` / `DOShardedTagCache` / `BucketCachePurge` (already present in the generated worker today, unused by the current config, but re-exported defensively per OpenNext's documented pattern so enabling DO-backed caching later doesn't silently break), exports the `LanRelay` class, and implements the routing check above.
- `workers/lan-relay.ts` — the `LanRelay` Durable Object class, ported from `script/lan-server.mjs`.

`script/lan-server.mjs` and `script/lan-dev.mjs` are unchanged.

## Client changes

Only two files change; `PadController.jsx` and `LanHostBridge.jsx` need no changes since they only speak the (unchanged) message protocol and never touch transport details.

**`app/lan/lanClient.js`** — `lanWsUrl()` branches on protocol:

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

Local dev is always plain `http://`, so this is a no-op change for `pnpm dev` / `pnpm dev:lan`. The deployed site is always `https://`, so it always takes the new `wss://` same-origin path.

**`app/lobby/LobbyClient.jsx`** — the `hosted` handler currently builds the QR/join URL from `msg.ip`/`msg.port` (the relay's LAN IP, meaningful only for local dev). It now falls back to the page's own origin when those fields are absent (i.e., when talking to the Durable Object, which never sends them):

```js
const url = msg.ip
  ? `http://${msg.ip}:${msg.port}/pad?room=${msg.room}`
  : `${window.location.origin}/pad?room=${msg.room}`;
```

## Error handling

- DO `fetch()` returns `400` for any request without an `Upgrade: websocket` header (matches the custom worker's routing check, but defends the DO itself if ever reached another way).
- Malformed JSON in a message is silently dropped, matching `script/lan-server.mjs` today.
- A host disconnecting starts the existing 25s grace timer before the room and its pads are torn down (covers the lobby → match navigation, which re-attaches the same room code).
- No changes to client-side reconnect/backoff logic in `createLanClient` — it already retries with backoff and re-sends the stored `hello` on every reconnect, which is transport-agnostic.

## Testing / verification plan

0. **Automated unit tests for `LanRelay`** (added during implementation planning, expanding this section beyond what was originally scoped here): the project has no test framework today, but the relay's room/message logic is exactly the kind of pure, protocol-level behavior that's worth covering with real tests rather than only manual clicking. `@cloudflare/vitest-pool-workers` runs tests inside the actual Workers runtime (via Miniflare), so it can exercise `LanRelay` through real `WebSocketPair` upgrades — host mint, join happy/error paths, input relay, start/assign broadcasts, roster updates on disconnect, and host reconnect. This is scoped strictly to `workers/` — it does not add any test tooling for the existing React/Next `app/` code, which stays on the project's existing manual-verification convention. See the implementation plan for exact versions and config.
1. **Local regression**: run `pnpm dev:lan`, host from a "big screen" browser tab, join from a phone (or a second tab) via the printed LAN URL, confirm the full host → roster → start → input flow behaves exactly as before. This confirms `script/lan-server.mjs` and the `http:` branch of `lanWsUrl()` are unaffected.
2. **Production path locally via `wrangler dev`**: `wrangler dev` runs Durable Objects locally, so the DO logic and custom-worker routing can be exercised before a real deploy. `wrangler dev` serves over plain `http://` by default, and the client's `lanWsUrl()` branches on `location.protocol` — so this must be run as `wrangler dev --local-protocol https` (self-signed cert) to actually exercise the `wss:`/DO branch; over plain `http://` the client would silently fall back to the `ws://host:13001` branch and never touch the DO. Verify: opening `/lobby` doesn't throw the mixed-content error, the WebSocket connects as `wss://`, hosting mints a room code, and a phone (or second tab) can join via the printed `origin/pad?room=...` URL and drive input through to the host.
3. **Real deploy smoke test**: after `wrangler deploy`, repeat the host + phone-join flow against the live `https://animal-cup.yao-440.workers.dev` URL, confirming no console errors and that a full match (lobby → start → match → full-time) completes with phone input working.

## Out of scope

- Any authentication/PIN beyond the 4-character room code (explicitly deferred, see Decision #1).
- Unifying local dev onto `wrangler dev` (explicitly deferred, see Decision #2).
- Per-room Durable Object sharding (explicitly deferred, see Decision #3).
- Any change to the gameplay/input protocol itself (`{t:"input", d:{vx,vy,shoot,sprint,...}}` and friends) — this work only changes how the relay is transported and hosted, not what it carries.
