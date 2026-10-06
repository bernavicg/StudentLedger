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
links (e.g. `/docs`) are handled by the shipped `public/_redirects`
(Netlify) or the host's single-page-app fallback setting (Cloudflare Pages).

### Backend (already live)

- Convex functions are deployed to the prod deployment.
- Secrets (`GOOGLE_SERVICE_ACCOUNT_JSON`, `VLY_INTEGRATION_KEY`, …) live in the
  Convex deployment env — set with `convex env set KEY value`, never in git.

## Features

- **Task monitoring dashboard**: a shared team to-do board (todo / in
  progress / done, due dates, overdue tracking) that every signed-in member
  can add to and update
- Entries ledger with admin approval flow, on its own Entries page
- **Paper invoices** (admin-curated): upload one PDF or DOC invoice per
  student and read it in an embedded viewer — view-only for the team.
- Students, providers, and attendance tracking
- Google Sheets mirror of the whole ledger
- **Docs** (admin-curated): the school-year Google Docs (September–June)
  embedded in one live viewer — paste a doc URL per month and Google renders
  it exactly as shared, original colors and formatting included.
- **AI Attendance Assistant**: ask questions about attendance in plain
  language; answers are computed from the real ledger data through the
  FreeBuff AI gateway.
