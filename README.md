# StudentLedger

Student and Provider Account Management — a ledger for tutoring sessions,
payments, and providers. Vite + React 19 + Tailwind 4 + Convex.

## Run locally

```bash
bun install
bun run dev
```

Requires `VITE_CONVEX_URL` in `.env.local` pointing at your Convex deployment.

## Deploy (online)

The site builds to static files in `dist/` and talks to the hosted Convex
backend — no server of your own is needed.

```bash
bun install
bun run build
```

`VITE_CONVEX_URL` must be set at build time (it is baked into the bundle).
On a hosting platform, set it as an environment variable in the build settings.

### Host it

Any static host works. Two good free options:

- **Cloudflare Pages** — build command `bun run build`, output dir `dist`
- **Netlify / Vercel** — same: framework "Vite", output `dist`

Connect this GitHub repo once; every push redeploys automatically. SPA deep
links (e.g. `/scrapes`) are handled by the shipped `public/_redirects`
(Netlify) or the host's single-page-app fallback setting (Cloudflare Pages).

### Backend (already live)

- Convex functions are deployed to the prod deployment.
- Secrets (`SIEVE_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`, …) live in the
  Convex deployment env — set with `convex env set KEY value`, never in git.

## Features

- Ledger of entries with admin approval flow
- Students, providers, and attendance tracking
- Google Sheets mirror of the whole ledger
- **Scrapes** (admin): web data extraction powered by the
  [sieve scrape API](https://scrape.usesieve.com) — start runs, poll to done,
  download delivered CSV/JSON files, send follow-up turns. The API key is
  server-side only (Convex env), never shipped to the browser.
