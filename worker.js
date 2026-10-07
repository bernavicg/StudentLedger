/**
 * StudentLedger is a static Vite SPA — it talks straight to the hosted Convex
 * backend (VITE_CONVEX_URL is baked into the bundle at build time), so the
 * Worker only serves the built assets. SPA deep links (e.g. /docs) fall back
 * to index.html via the manifest's spa flag.
 */
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
