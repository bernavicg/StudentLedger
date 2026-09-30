# Deploy (online)

The site builds to static files in `dist/` (Vite) and talks to the hosted
Convex backend at `VITE_CONVEX_URL` — no server of your own is needed.

## 1. Build

```bash
bun install
bun run build
```

`VITE_CONVEX_URL` must be set at build time (it is baked into the bundle).
Locally it comes from `.env.local`; on a hosting platform, set it as an
environment variable in the build settings:

```
VITE_CONVEX_URL=https://blissful-husky-761.convex.cloud
```

## 2. Host it

Any static host works. Two good free options:

- **Cloudflare Pages** — build command `bun run build`, output dir `dist`
- **Netlify / Vercel** — same: framework "Vite", output `dist`

Connect the GitHub repo once; every push redeploys automatically.

## 3. Backend (already live)

- Convex functions are deployed to `blissful-husky-761` (prod).
- Secrets (`SIEVE_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`, …) live in the
  Convex deployment env — set with `convex env set KEY value`, never in git.

## SPA routing

Pages like `/scrapes` are client-side routes. Cloudflare Pages/Netlify need a
fallback rule so deep links serve `index.html`:

- Netlify: add `/*  /index.html  200` to `public/_redirects`
- Cloudflare Pages: create `dist/_headers`-style SPA fallback (the dashboard
  "Single-page application" toggle handles it)

This repo ships `public/_redirects` for Netlify-style hosts.
