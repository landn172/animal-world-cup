/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  devIndicators: false,
  // Game assets ship from /public with Next's default max-age=0,
  // must-revalidate — on the deployed host every request costs ~1s TTFB, so
  // each visit re-validated dozens of boot files and loads crawled (owner:
  // happyseeds 部署加载好慢). One hour fresh + serve-stale-while-refreshing
  // makes repeat visits instant and still picks up redeploys within an hour.
  async headers() {
    // Aggressive caching is a PRODUCTION optimisation for the slow deployed host.
    // In dev (localhost) use no-store so local edits always show on a normal
    // reload — caching the dev server was hiding fresh changes (the hard-refresh
    // pain). Pairs with sw.js, which is also a no-op on localhost.
    const CACHE =
      process.env.NODE_ENV === "production"
        ? "public, max-age=3600, stale-while-revalidate=86400"
        : "no-store";
    return [
      { source: "/:path*", headers: [{ key: "X-Frame-Options", value: "ALLOWALL" }, { key: "Content-Security-Policy", value: "" }] },
      // sw.js must NEVER be HTTP-cached, or browsers keep an old service worker
      // that serves stale game assets (e.g. mismatched player foot-circle
      // sprites between phone and desktop). Always re-fetched → its bumped
      // CACHE_VERSION takes effect and purges the old asset cache.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
      { source: "/match-runtime-min/:path*", headers: [{ key: "Cache-Control", value: CACHE }] },
      { source: "/animal-cup/:path*", headers: [{ key: "Cache-Control", value: CACHE }] },
    ];
  },
};

export default nextConfig;
