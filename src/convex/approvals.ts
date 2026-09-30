import { getAuthUserId } from "@convex-dev/auth/server";
import { Id } from "./_generated/dataModel";
import { Doc } from "./_generated/dataModel";
import { query } from "./_generated/server";

/** Minimal structural view of a Convex context, narrowed to user lookups. */
type AuthedCtx = {
  db: {
    get: (id: Id<"users">) => Promise<Doc<"users"> | null>;
  };
  auth: unknown;
};

async function requireAdmin(ctx: AuthedCtx) {
  const userId = await getAuthUserId(ctx as never);
  if (userId === null) throw new Error("Sign in to continue.");
  const user = await ctx.db.get(userId);
  if (user === null) throw new Error("Account not found.");
  if ((user.role ?? "user") !== "admin") {
    throw new Error("Only admins can review approvals.");
  }
  return { userId, role: "admin" as const };
}

/**
 * The single source for the admin approvals queue: every ledger entry still
 * sitting on "pending" plus every attendance mark that has not been reviewed.
 *
 * Attendance rows created before the review flow existed have no
 * `reviewStatus`, so they are treated as pending too — otherwise old marks
 * would never reach the queue.
 */
export const pending = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const entries = await ctx.db
      .query("entries")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();

    // Same rule as above: absent reviewStatus means it still needs a decision.
    const attendance = (await ctx.db.query("attendance").collect()).filter(
      (row) => row.reviewStatus === undefined || row.reviewStatus === "pending",
    );

    /* Resolve every referenced record in one pass so the page can render
       straight from this payload without extra round trips. */
    const userIds = Array.from(
      new Set([
        ...entries.map((entry) => entry.createdBy),
        ...attendance.map((row) => row.recordedBy),
      ]),
    ) as Id<"users">[];
    const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));

    const studentIds = Array.from(
      new Set([
        ...entries
          .map((entry) => entry.studentId)
          .filter((id): id is Id<"students"> => id !== undefined),
        ...attendance.map((row) => row.studentId),
      ]),
    ) as Id<"students">[];
    const students = await Promise.all(
      studentIds.map((id) => ctx.db.get(id)),
    );

    const userName = (id: Id<"users">) => {
      const user = users.find(
        (u): u is Doc<"users"> => u !== null && u._id === id,
      );
      return user?.name ?? user?.email ?? "Unknown";
    };

    const studentName = (id: Id<"students">) => {
      const student = students.find(
        (s): s is Doc<"students"> => s !== null && s._id === id,
      );
      return student?.name ?? "Unknown student";
    };

    const sorted = <T extends { createdAt: number }>(rows: T[]) =>
      rows.sort((a, b) => b.createdAt - a.createdAt);

    return {
      entries: sorted(entries).map((entry) => ({
        ...entry,
        authorName: userName(entry.createdBy),
        studentName: entry.studentId
          ? studentName(entry.studentId)
          : undefined,
      })),
      attendance: sorted(attendance).map((row) => ({
        ...row,
        // Older rows predate the field; the app treats them as a single session.
        sessionsConsumed: row.sessionsConsumed ?? 1,
        durationMinutes: row.durationMinutes ?? null,
        recorderName: userName(row.recordedBy),
        studentName: studentName(row.studentId),
      })),
    };
  },
});

/** Counts only, for the nav badge so the queue size is visible anywhere. */
export const counts = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const entries = await ctx.db
      .query("entries")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    const attendance = (await ctx.db.query("attendance").collect()).filter(
      (row) => row.reviewStatus === undefined || row.reviewStatus === "pending",
    );

    return {
      entries: entries.length,
      attendance: attendance.length,
      total: entries.length + attendance.length,
    };
  },
});
