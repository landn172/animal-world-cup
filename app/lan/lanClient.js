"use client";

// Tiny reconnecting WebSocket client for the LAN relay. Shared by the lobby
// (host), the phone controller (pad), and the in-match host bridge. Two
// backends speak the same JSON protocol: locally, script/lan-server.mjs on
// port 13001 (plain http, same LAN); once deployed, the LanRelay Durable
// Object at /api/lan-ws on the same origin (https, same public host — see
// docs/specs/2026-07-06-lan-relay-durable-object-design.md). lanWsUrl()
// picks between them by page protocol.
//
// Usage:
//   const lan = createLanClient({ onMessage, onOpen, onClose });
//   lan.send({ t: "host", room });
//   lan.close();

export const LAN_PORT = 13001;

export function lanWsUrl() {
  if (typeof window === "undefined") return null;
  if (window.location.protocol === "https:") {
    return `wss://${window.location.host}/api/lan-ws`;
  }
  const host = window.location.hostname || "127.0.0.1";
  return `ws://${host}:${LAN_PORT}`;
}

export function createLanClient({ onMessage, onOpen, onClose } = {}) {
  let ws = null;
  let closed = false;
  let retry = 0;
  let helloFn = null; // re-sent on every (re)connect so the relay re-attaches us

  function connect() {
    if (closed) return;
    const url = lanWsUrl();
    if (!url) return;
    try {
      ws = new WebSocket(url);
    } catch {
      schedule();
      return;
    }
    ws.onopen = () => {
      retry = 0;
      if (helloFn) {
        try { ws.send(JSON.stringify(helloFn())); } catch {}
      }
      onOpen && onOpen();
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      onMessage && onMessage(msg);
    };
    ws.onclose = () => {
      onClose && onClose();
      if (!closed) schedule();
    };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }

  function schedule() {
    retry = Math.min(retry + 1, 6);
    setTimeout(connect, 300 * retry); // 0.3s..1.8s backoff
  }

  connect();

  return {
    // hello: a function returning the (re)attach message — stored so reconnects
    // re-announce identity (host re-attaches to its room; pad re-joins).
    setHello(fn) { helloFn = fn; if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(fn())); } catch {} } },
    send(obj) { if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(obj)); } catch {} } },
    close() { closed = true; if (ws) try { ws.close(); } catch {} },
    get ready() { return !!ws && ws.readyState === 1; },
  };
}
