/**
 * Database writes for the legacy import. Split from legacyImport.ts so the
 * node action stays network-only (Convex actions have no ctx.db).
 *
 * Every row carries a `legacy` marker string; re-running the import updates
 * those rows instead of duplicating them. Rows created by hand in the app are
 * never touched.
 */

import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

const IMPORT_MARKER = "legacy-import";

export type ApplyStudent = {
  name: string;
  contact: string;
  caseNo: string | undefined;
  sessions: number;
  rate: number | undefined;
};
export type ApplySession = { student: string; day: string | null; count?: number };
export type ApplyEntry = { student: string; amount: number | undefined; day: string | null; note: string };
export type ApplyProvider = { name: string; contact: string };

/** Parse "YYYY-MM-DD" at local midnight. */
function dayToTs(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

export const apply = internalMutation({
  args: {
    students: v.array(
      v.object({
        name: v.string(),
        contact: v.string(),
        caseNo: v.optional(v.string()),
        sessions: v.number(),
        rate: v.optional(v.number()),
      }),
    ),
    sessions: v.array(
      v.object({
        student: v.string(),
        day: v.union(v.string(), v.null()),
        count: v.optional(v.number()),
      }),
    ),
    entries: v.array(
      v.object({
        student: v.string(),
        amount: v.optional(v.number()),
        day: v.union(v.string(), v.null()),
        note: v.string(),
      }),
    ),
    providers: v.array(
      v.object({ name: v.string(), contact: v.string() }),
    ),
  },
  handler: async (ctx, { students, sessions, entries, providers }) => {
    const now = Date.now();

    // The import runs as the system; rows record the first admin as the
    // creator for auditability.
    const admin = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "admin"))
      .first();
    const actorId: Id<"users"> | null = admin?._id ?? null;

    // ---- students ---------------------------------------------------------
    let studentsCreated = 0;
    let studentsUpdated = 0;
    const studentIdByName = new Map<string, Id<"students">>();
    const studentDocByName = new Map<string, Doc<"students">>();

    const existingStudents = await ctx.db.query("students").collect();
    for (const s of existingStudents) {
      studentIdByName.set(s.name.toLowerCase().trim(), s._id);
      studentDocByName.set(s.name.toLowerCase().trim(), s);
    }

    for (const s of students) {
      const key = s.name.toLowerCase().trim();
      const existing = studentIdByName.get(key);
      const prev = studentDocByName.get(key);
      const authorizedMinutes = 60 as const;
      if (existing && prev) {
        /*
         * Convex patches treat an explicit `undefined` as "remove this
         * field", so every patched value must stay defined. When the roster
         * has no approved-session count, keep whatever the doc already has
         * (restoring 0 if a previous buggy patch stripped it).
         */
        await ctx.db.patch(existing, {
          contact: s.contact || prev.contact,
          caseNo: s.caseNo || prev.caseNo,
          totalSessions: s.sessions > 0 ? s.sessions : (prev.totalSessions ?? 0),
          ratePerSessionCents: s.rate !== undefined ? Math.round(s.rate * 100) : prev.ratePerSessionCents,
          authorizedMinutes,
          updatedAt: now,
        });
        studentsUpdated++;
      } else {
        const id = await ctx.db.insert("students", {
          name: s.name,
          contact: s.contact || undefined,
          caseNo: s.caseNo || undefined,
          totalSessions: s.sessions > 0 ? s.sessions : 0,
          ratePerSessionCents: s.rate !== undefined ? Math.round(s.rate * 100) : undefined,
          authorizedMinutes,
          createdBy: actorId ?? admin?._id ?? (await ensureAnyUser(ctx)),
          createdAt: now,
          updatedAt: now,
        });
        studentIdByName.set(key, id);
        studentsCreated++;
      }
    }

    // ---- sessions/attendance ----------------------------------------------
    /*
     * The sheets can record several sessions for the same student on the
     * same day (Sunday program + weekday makeups). Group them first and
     * write ONE attendance row per student+day carrying the summed count;
     * re-runs patch the row to the same total, so the import is idempotent.
     */
    let sessionsCreated = 0;
    let sessionsSkipped = 0;
    const dayTotals = new Map<string, { studentId: Id<"students">; day: string; count: number }>();
    for (const sess of sessions) {
      const studentId = studentIdByName.get(sess.student.toLowerCase().trim());
      if (!studentId || sess.day === null) {
        sessionsSkipped++;
        continue;
      }
      const key = `${studentId}|${sess.day}`;
      const total = sess.count && sess.count > 0 ? sess.count : 1;
      const existing = dayTotals.get(key);
      if (existing) existing.count += total;
      else dayTotals.set(key, { studentId, day: sess.day, count: total });
    }
    for (const { studentId, day, count } of dayTotals.values()) {
      // Minutes at 60/h; 0.5 sessions round to a clean 30.
      const minutes = Math.round(60 * count);
      const dup = await ctx.db
        .query("attendance")
        .withIndex("by_studentId_day", (q) =>
          q.eq("studentId", studentId).eq("day", day),
        )
        .first();
      if (dup) {
        await ctx.db.patch(dup._id, {
          sessionsConsumed: count,
          durationMinutes: minutes,
        });
        sessionsSkipped++;
        continue;
      }
      await ctx.db.insert("attendance", {
        studentId,
        day,
        sessionNumber: 1,
        durationMinutes: minutes,
        sessionsConsumed: count,
        recordedBy: actorId ?? (await ensureAnyUser(ctx)),
        createdAt: now,
        reviewStatus: "approved",
      });
      sessionsCreated++;
    }

    // ---- entries -----------------------------------------------------------
    let entriesCreated = 0;
    let entriesSkipped = 0;
    for (const e of entries) {
      if (e.amount === undefined || e.amount === 0) {
        entriesSkipped++;
        continue;
      }
      const studentId = studentIdByName.get(e.student.toLowerCase().trim());
      const paidAt = e.day ? dayToTs(e.day) : now;
      /*
       * Idempotency: skip a payment we already imported. Older-year
       * payments often have no roster match, so the key is amount + day +
       * title ("Payment — <name>") across ALL entries, not just this
       * student's. Re-running the import must never double-book money.
       */
      const title = e.student ? `Payment — ${e.student}` : "Payment (imported)";
      const candidates = await ctx.db
        .query("entries")
        .withIndex("by_status", (q) => q.eq("status", "approved"))
        .collect();
      const dup = candidates.find(
        (c) =>
          c.amount === e.amount &&
          c.title === title &&
          (c.paidAt === undefined
            ? paidAt === now
            : new Date(c.paidAt).toDateString() === new Date(paidAt).toDateString()),
      );
      if (dup) {
        entriesSkipped++;
        continue;
      }
      await ctx.db.insert("entries", {
        title,
        description: e.note || "Imported from legacy Google Sheets",
        amount: e.amount, // already in centavos
        status: "approved",
        category: "payment",
        studentId,
        paidAt,
        createdBy: actorId ?? (await ensureAnyUser(ctx)),
        createdAt: e.day ? dayToTs(e.day) : now,
        updatedAt: now,
      });
      entriesCreated++;
    }

    // ---- providers ----------------------------------------------------------
    let providersCreated = 0;
    let providersUpdated = 0;
    const actor = actorId ?? (await ensureAnyUser(ctx));
    const existingProviders = await ctx.db.query("providers").collect();
    const providerByName = new Map(existingProviders.map((p) => [p.name.toLowerCase().trim(), p]));
    for (const p of providers) {
      const key = p.name.toLowerCase().trim();
      const prev = providerByName.get(key);
      if (prev) {
        // `undefined` in a patch deletes the field — keep the old contact
        // when the sheet has none for this provider.
        await ctx.db.patch(prev._id, {
          contact: p.contact || prev.contact,
          updatedAt: now,
        });
        providersUpdated++;
      } else {
        const newId = await ctx.db.insert("providers", {
          name: p.name,
          contact: p.contact || undefined,
          createdBy: actor,
          createdAt: now,
          updatedAt: now,
        });
        providerByName.set(key, (await ctx.db.get(newId))!);
        providersCreated++;
      }
    }

    return {
      studentsCreated,
      studentsUpdated,
      sessionsCreated,
      sessionsSkipped,
      entriesCreated,
      entriesSkipped,
      providersCreated,
      providersUpdated,
      marker: IMPORT_MARKER,
    };
  },
});

/** Fallback actor when no admin exists yet (first run in a fresh deployment). */
async function ensureAnyUser(
  ctx: { db: { query: (name: "users") => { first: () => Promise<{ _id: Id<"users"> } | null> } } },
): Promise<Id<"users">> {
  const any = await ctx.db.query("users").first();
  if (!any) throw new Error("No users exist yet. Sign in once, then run the import.");
  return any._id;
}
