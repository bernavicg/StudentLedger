import { api } from "@/convex/_generated/api";
import { pollDelayMs } from "@/convex/lib/sieve";
import { useAuth } from "@/hooks/use-auth";
import { useAction, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";

/**
 * Drives the sieve poll loop while an admin has the page open.
 *
 * This stands in for a server cron, the same way useSheetsAutoSync does:
 * the platform's Convex version rejects cron function references, so the
 * client nudges instead. Polling starts at 5s and backs off to 30s
 * (pollDelayMs) because a run takes minutes and there is no short timeout.
 *
 * Reopening the page resumes: the session id was persisted when the run was
 * created, so the loop picks the run back up instead of starting a new one.
 * When sieve is not configured, `runs` is empty and nothing is polled.
 */
export function useScrapesPolling(): void {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const runs = useQuery(api.sieve.runs, isAdmin ? {} : "skip");
  const poll = useAction(api.sieve.poll);
  const attempt = useRef(0);
  const [tick, setTick] = useState(0);

  // Only poll once a session id exists: a "starting" row is a POST in flight,
  // and there is nothing to poll until the 202 has been stored.
  const active = (runs ?? []).find(
    (run) =>
      (run.sessionId !== null &&
        (run.status === "queued" || run.status === "running")) ||
      (run.awaitingTurn && run.sessionId !== null),
  );
  const activeId = active?._id;

  useEffect(() => {
    if (activeId === undefined) {
      attempt.current = 0;
      return;
    }
    const delay = pollDelayMs(attempt.current + 1);
    const timer = setTimeout(async () => {
      try {
        await poll({ runId: activeId });
      } catch {
        // The failure is recorded on the run row; the next tick retries with
        // a longer delay rather than hammering a service that is down.
      }
      attempt.current += 1;
      setTick((value) => value + 1);
    }, delay);
    return () => clearTimeout(timer);
  }, [activeId, tick, poll]);
}
