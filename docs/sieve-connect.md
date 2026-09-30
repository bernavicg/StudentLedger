# Connect sieve — API key (one-time, ~1 minute)

The sieve integration is fully wired into the app. The only missing piece is
**SIEVE_API_KEY**. The device-login endpoint (`/api/auth/device/code` on
scrape.usesieve.com) currently answers `401 unauthorized` for unauthenticated
callers, so the automated flow cannot start today. Sieve's own docs describe
the working path:

## Get a key in your browser (recommended, ~1 minute)

1. Open **https://scrape.usesieve.com** and sign in (Google or email).
2. Go to **Settings → API keys**.
3. Click **Create key**. It looks like `dc_sk_…` and is shown **once**.
4. Paste it into the project's **Keys** tab as **SIEVE_API_KEY**
   (same place as `GOOGLE_SERVICE_ACCOUNT_JSON`).

That's it — the Scrapes page lights up on next reload.

## Alternative: the device-login script

`bun scripts/sieve-device-login.mjs` still prints an approval link and a user
code. If sieve answers 401 to you as well, fall back to the browser path above.

## Security notes

- The key is server-side only: it is read in `src/convex/sieveNode.ts` from the
  deployment env, never sent to the browser, never logged, never committed.
- Never paste the key into this chat — anything typed here stays in the
  transcript. Put it in the Keys tab only.
- The key has full account access and no scopes; treat it like a password.

## After the key is set

1. Reload the app → **Scrapes** (admin nav). The "not connected" card is gone.
2. Try a live run: instruction "Extract the text and author of each quote",
   target `https://quotes.toscrape.com` (costs a few credits).
3. Check remaining credits with the **Credits** button on the Scrapes page.
