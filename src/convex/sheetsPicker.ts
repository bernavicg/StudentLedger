/**
 * Student picker over the legacy sheets.
 *
 * `readCandidates` (public action) loads the roster from MONTHLY MONITORING
 * 2025-2026 plus the per-date SUNDAY SESSIONS attendance — no writes.
 * `addFromSheets` (admin mutation) creates only the students the admin
 * ticked, deduped by name, with their sheet sessions attached as approved
 * attendance. Everything runs through the same import store so re-runs stay
 * idempotent.
 */

import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { action } from "./_generated/server";
import { namesMatch } from "./lib/namesMatch";


type CandidatesResult = {
  candidates: {
    name: string;
    caseNo: string;
    remaining: number | undefined;
    monthlyHours: number;
    sundayHours: number;
    row: number;
  }[];
  sessions: { student: string; day: string; count: number }[];
  warnings: string[];
};

const candidatesRef = makeFunctionReference<"action", Record<string, never>, CandidatesResult>(
  "legacyImport:candidates",
);

type ApplyArgs = {
  students: { name: string; contact: string; sessions: number; rate?: number }[];
  sessions: { student: string; day: string | null; count?: number }[];
  entries: { student: string; amount?: number; day: string | null; note: string }[];
  providers: { name: string; contact: string }[];
};
type ApplyResult = {
  studentsCreated: number;
  studentsUpdated: number;
  sessionsCreated: number;
  sessionsSkipped: number;
  entriesCreated: number;
  entriesSkipped: number;
  providersCreated: number;
  providersUpdated: number;
  marker: string;
};
const applyRef = makeFunctionReference<"mutation", ApplyArgs, ApplyResult>(
  "legacyImportStore:apply",
);

/** Public action: read the two source tabs so the picker page can list candidates. */
export const readCandidates = action({
  args: {},
  handler: async (ctx): Promise<CandidatesResult> => {
    const caller = await ctx.runQuery(
      makeFunctionReference<
        "query",
        Record<string, never>,
        { role: "admin" | "member" | "user"; userId: string }
      >("sheetsInternal:callerRole"),
      {},
    );
    if (caller.role !== "admin") throw new Error("Only admins can do that.");
    return ctx.runAction(candidatesRef, {});
  },
});

/**
 * Admin picks candidates; only those are written. Sessions are filtered to
 * the chosen students' names (exact normalized-name match, the same rule
 * the roster preview uses). Actions can't touch the db directly, so this
 * mutates through the internal store via an admin-only wrapper mutation
 * that itself calls this action's data — Convex allows mutation→action
 * calls only from actions, so instead the whole write lives in an action
 * here and the store mutation stays internal.
 */
export const addFromSheets = action({
  args: {
    names: v.array(v.string()),
    defaultTotalSessions: v.optional(v.number()),
  },
  handler: async (ctx, { names, defaultTotalSessions }) => {
    // Actions have no ctx.db; resolve the caller's role via the shared query.
    const caller = await ctx.runQuery(
      makeFunctionReference<
        "query",
        Record<string, never>,
        { role: "admin" | "member" | "user"; userId: string }
      >("sheetsInternal:callerRole"),
      {},
    );
    if (caller.role !== "admin") throw new Error("Only admins can do that.");

    const data: CandidatesResult = await ctx.runAction(candidatesRef, {});
    const picked = new Set(names.map((n) => n.toLowerCase().trim()));

    const students = data.candidates
      .filter((c) => picked.has(c.name.toLowerCase().trim()))
      .map((c) => ({
        name: c.name,
        contact: "",
        // Monthly hours ≈ sessions when each is 60 min; fall back to the
        // picker's default when the sheet has no totals.
        sessions:
          c.monthlyHours > 0
            ? Math.round(c.monthlyHours)
            : (defaultTotalSessions ?? 0),
      }));
    if (students.length === 0) {
      return { created: 0, updated: 0, sessions: 0, warnings: data.warnings };
    }

    const chosen = students.map((s) => s.name);
    const sessions = data.sessions
      .filter((s) => chosen.some((c) => namesMatch(s.student, c)))
      .map((s) => ({ student: s.student, day: s.day, count: s.count }));

    const result: ApplyResult = await ctx.runMutation(applyRef, {
      students,
      sessions,
      entries: [],
      providers: [],
    });
    return {
      created: result.studentsCreated,
      updated: result.studentsUpdated,
      sessions: result.sessionsCreated,
      warnings: data.warnings,
    };
  },
});
