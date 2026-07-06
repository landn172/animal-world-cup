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
