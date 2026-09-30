import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { useAction, useQuery } from "convex/react";
import { useEffect, useRef } from "react";

/** Don't nudge Google more than once per this window, per browser. */
const THROTTLE_KEY = "ledger.sheets.lastAutoSync";
const THROTTLE_MS = 10 * 60 * 1000;

/** Server-side floor on how often an export may run. */
const SERVER_COOLDOWN_MS = 5 * 60 * 1000;

function readThrottle(): number {
  try {
    return Number(window.localStorage.getItem(THROTTLE_KEY) ?? "0");
  } catch {
    // Private browsing can block localStorage; the sync still works, just
    // without this extra layer of throttling.
    return 0;
  }
}

function writeThrottle(at: number): void {
  try {
    window.localStorage.setItem(THROTTLE_KEY, String(at));
  } catch {
    // See above.
  }
}

/**
 * Quietly keeps the Google Sheet up to date while an admin is using the app.
 *
 * This stands in for a server cron: the platform's Convex version rejects every
 * form of cron function reference, so the nudge is driven from the client
 * instead. `sheets:syncIfStale` still does the real work and returns early
 * when nothing has changed, so the common case costs one cheap read.
 *
 * Two independent guards, because either alone is leaky:
 *  - localStorage, so opening several pages in a row does not fire repeatedly.
 *  - the server checks `lastSyncAt` too, so a second browser (whose
 *    localStorage is empty) cannot trigger an export right after the first.
 */
export function useSheetsAutoSync(): void {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  // Only admins can sync, and this query is not cheap — skip it entirely for
  // everyone else rather than making every member pay for it on every page.
  const status = useQuery(api.sheets.status, isAdmin ? undefined : "skip");
  const syncIfStale = useAction(api.sheets.syncIfStale);
  // The fingerprint we last saw, so a sync is attempted only when it moves.
  // A plain boolean would latch on the first render and never fire again if
  // the app happened to open while nothing was stale.
  const lastFingerprint = useRef<string | null>(null);

  useEffect(() => {
    if (!isAdmin || status === undefined) return;
    if (!status.hasCredentials || !status.sheetId) return;
    if (!status.stale) return;

    // Nothing new since the last attempt in this session: the reactive query
    // re-runs on every change, and most of those are not ours to act on.
    const marker = status.lastSyncAt === null ? "never" : String(status.lastSyncAt);
    if (lastFingerprint.current === marker) return;
    lastFingerprint.current = marker;

    if (Date.now() - readThrottle() < THROTTLE_MS) return;
    // Server-side floor, so two browsers cannot both export at once.
    if (
      status.lastSyncAt !== null &&
      Date.now() - status.lastSyncAt < SERVER_COOLDOWN_MS
    ) {
      return;
    }

    // Stamp the throttle only once we have committed to firing, and clear it
    // again on failure so a transient Google outage is retried on the next
    // visit instead of being locked out for the full window.
    writeThrottle(Date.now());
    void syncIfStale({}).catch(() => {
      lastFingerprint.current = null;
      writeThrottle(0);
    });
  }, [isAdmin, status, syncIfStale]);
}
