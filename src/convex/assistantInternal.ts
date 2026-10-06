import { getAuthUserId } from "@convex-dev/auth/server";
import { internalQuery } from "./_generated/server";

/**
 * Gather everything the AI assistant action needs in one read: the signed-in
 * user (for personalizing the answer) plus students, attendance, ledger
 * entries, tasks, and paper invoices. Internal-only, so it can never be
 * called directly by the client; the public action checks auth before
 * spending AI credits.
 */
export const gatherContext = internalQuery({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return {
        user: null,
        students: [],
        attendance: [],
        entries: [],
        entryStats: null,
        tasks: [],
        invoices: [],
      };
    }
    const user = await ctx.db.get(userId);
    const [students, attendance, entries, tasks, invoices, users] =
      await Promise.all([
        ctx.db.query("students").order("desc").collect(),
        ctx.db.query("attendance").collect(),
        ctx.db.query("entries").order("desc").collect(),
        ctx.db.query("tasks").order("desc").collect(),
        ctx.db.query("invoices").order("desc").collect(),
        ctx.db.query("users").collect(),
      ]);

    const studentNames = new Map(students.map((s) => [s._id, s.name]));
    const userNames = new Map(
      users.map((u) => [u._id, u.name ?? u.email ?? "Unknown"]),
    );

    const approved = entries.filter((e) => e.status === "approved");
    const entryStats = {
      pending: entries.filter((e) => e.status === "pending").length,
      approvedCount: approved.length,
      netApproved: approved.reduce((sum, e) => sum + e.amount, 0),
    };

    return {
      user:
        user === null
          ? null
          : { name: user.name ?? user.email ?? "Team member" },
      students: students.map((s) => ({
        _id: s._id,
        name: s.name,
        caseNo: s.caseNo ?? null,
        totalSessions: s.totalSessions,
        ratePerSessionCents: s.ratePerSessionCents ?? null,
        authorizedMinutes: s.authorizedMinutes ?? null,
      })),
      attendance: attendance.map((a) => ({
        studentId: a.studentId,
        day: a.day,
        startTime: a.startTime ?? null,
        durationMinutes: a.durationMinutes ?? null,
        sessionsConsumed: a.sessionsConsumed ?? null,
        reviewStatus: a.reviewStatus ?? null,
        reviewNote: a.reviewNote ?? null,
      })),
      entries: entries.slice(0, 40).map((e) => ({
        title: e.title,
        amount: e.amount,
        status: e.status,
        category: e.category ?? null,
        studentName:
          e.studentId !== undefined
            ? (studentNames.get(e.studentId) ?? null)
            : null,
        createdAt: e.createdAt,
      })),
      entryStats,
      tasks: tasks.slice(0, 60).map((t) => ({
        title: t.title,
        status: t.status,
        due: t.due ?? null,
        createdAt: t.createdAt,
        creatorName: userNames.get(t.createdBy) ?? "Unknown",
      })),
      invoices: invoices.slice(0, 60).map((i) => ({
        title: i.title,
        studentName: studentNames.get(i.studentId) ?? "Unknown student",
        fileName: i.fileName,
        caseNo: i.caseNo ?? null,
        createdAt: i.createdAt,
        totalSessions: i.totalSessions,
        totalHours: i.totalHours ?? null,
        totalAmountCents: i.totalAmountCents ?? null,
      })),
    };
  },
});
