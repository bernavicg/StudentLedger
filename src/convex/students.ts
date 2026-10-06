import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { Doc } from "./_generated/dataModel";
import { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";

/** Minimal structural view of a Convex context for auth lookups. */
type AuthedCtx = {
  db: {
    get: (id: Id<"users">) => Promise<Doc<"users"> | null>;
  };
  auth: unknown;
};

async function requireUser(ctx: AuthedCtx) {
  const userId = await getAuthUserId(ctx as never);
  if (userId === null) throw new Error("Sign in to continue.");
  const user = await ctx.db.get(userId);
  if (user === null) throw new Error("Account not found.");
  return { userId, role: user.role ?? "user" };
}

/** YYYY-MM-DD for a timestamp in the given user's local calendar. */
function toDayString(ts: number): string {
  const d = new Date(ts);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Today (server day) as YYYY-MM-DD. */
function todayString(): string {
  return toDayString(Date.now());
}

/** "YYYY-MM-DD" -> a local Date, for month labels. */
function fromDayString(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Sessions consumed by a mark of the given duration against the student's
 * authorized minutes. A 60-minute mark on a 30-minute authorization = 2.
 */
function sessionsConsumedFor(
  authorizedMinutes: 30 | 60 | undefined,
  durationMinutes: 30 | 60,
): number {
  const base = authorizedMinutes ?? 60;
  return Math.max(1, Math.round(durationMinutes / base));
}

/** Earliest bookable start time: 8:00am. */
const EARLIEST_START = 8 * 60; // 480 minutes past midnight
/** Latest bookable start time: 8:45pm. */
const LATEST_START = 20 * 60 + 45; // 1245

/**
 * Validates a "HH:MM" start time. Sessions can only start between 8:00am and
 * 8:45pm, and only on 15-minute steps (:00, :15, :30, :45).
 */
function normalizeStartTime(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error("Invalid start time.");
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error("Invalid start time.");
  if (minutes % 15 !== 0) {
    throw new Error("Start time must land on :00, :15, :30 or :45.");
  }
  const total = hours * 60 + minutes;
  if (total < EARLIEST_START || total > LATEST_START) {
    throw new Error("Sessions run from 8:00am to 8:45pm.");
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** "14:30" -> "2:30 PM" for display. */
function formatStartTime(value: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return value;
  const hours = Number(match[1]);
  const minutes = match[2];
  const suffix = hours >= 12 ? "PM" : "AM";
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${display}:${minutes} ${suffix}`;
}

/**
 * End time for a session: the start time plus the duration it ran, in
 * "HH:MM" 24h form. A 30-minute session at 8:30am ends at 9:00am; a 60-minute
 * one ends at 9:30am. Derived on the server so it can never disagree with the
 * stored start time or duration.
 */
function computeEndTime(startTime: string, durationMinutes: number): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(startTime);
  if (!match) return startTime;
  const total = Number(match[1]) * 60 + Number(match[2]) + durationMinutes;
  // Wrap past midnight so a late-evening session still records a real time.
  const wrapped = ((total % 1440) + 1440) % 1440;
  const hours = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Roster of students with per-student attendance and remaining-session
 * counts computed server-side. All signed-in team members can view.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);

    const students = await ctx.db.query("students").order("desc").collect();
    const attendance = await ctx.db.query("attendance").collect();

    // Group attendance by student once, then project lightweight rows.
    const byStudent = new Map<string, Doc<"attendance">[]>();
    for (const record of attendance) {
      const bucket = byStudent.get(record.studentId) ?? [];
      bucket.push(record);
      byStudent.set(record.studentId, bucket);
    }

    return students.map((student) => {
      const records = byStudent.get(student._id) ?? [];
      // Sessions consumed scale with duration (60 min on a 30-min plan = 2).
      const used = records.reduce(
        (sum, record) => sum + (record.sessionsConsumed ?? 1),
        0,
      );
      // Actual minutes attended, used to derive the remaining hours.
      const usedMinutes = records.reduce(
        (sum, record) => sum + (record.durationMinutes ?? 0),
        0,
      );
      const last = records.reduce(
      (latest, record) => (record.day > latest ? record.day : latest),
      "",
    );
    // Most recent slot (date + time) for the roster card.
    const lastStart = records.reduce(
      (latest, record) => {
        const key = `${record.day} ${record.startTime ?? ""}`;
        return key > latest ? key : latest;
      },
      "",
    );
      return {
        _id: student._id,
        name: student.name,
        contact: student.contact,
        caseNo: student.caseNo ?? null,
        notes: student.notes,
        totalSessions: student.totalSessions,
        ratePerSessionCents: student.ratePerSessionCents ?? null,
        authorizedMinutes: student.authorizedMinutes ?? null,
        // Derived cap: authorized sessions × rate per session.
        maxAuthorizedAmountCents:
          student.ratePerSessionCents !== null && student.ratePerSessionCents !== undefined
            ? student.totalSessions * student.ratePerSessionCents
            : null,
        // Derived approved hours: 30-min sessions count as half, 60-min as full.
        approvedHours:
          student.authorizedMinutes != null
            ? (student.totalSessions * student.authorizedMinutes) / 60
            : null,
        usedSessions: used,
        remainingSessions: Math.max(student.totalSessions - used, 0),
        // Hours actually attended, and what is left of the approved hours.
        usedHours: usedMinutes / 60,
        remainingHours:
          student.authorizedMinutes != null
            ? Math.max(
                (student.totalSessions - used) * student.authorizedMinutes / 60,
                0,
              )
            : null,
        // Money left of the authorized cap: remaining sessions x rate.
        remainingBalanceCents:
          student.ratePerSessionCents != null
            ? Math.max(student.totalSessions - used, 0) * student.ratePerSessionCents
            : null,
        // How many marks are still waiting on an admin.
        pendingReviewCount: records.filter(
          (record) => (record.reviewStatus ?? "pending") === "pending",
        ).length,
        rejectedCount: records.filter(
          (record) => record.reviewStatus === "rejected",
        ).length,
        attendanceDays: records.length,
        lastAttendanceDay: last === "" ? null : last,
        lastStartTime: lastStart === "" ? null : (lastStart.split(" ")[1] || null),
        firstAttendanceDay:
          records.length === 0
            ? null
            : records.reduce(
                (earliest, record) =>
                  record.day < earliest ? record.day : earliest,
                records[0].day,
              ),
      };
    });
  },
});

/**
 * Attendance review overview for the ledger: per student, which months are
 * fully approved, which are still waiting, and any rejected days with the
 * reason. Every signed-in member can see this; only admins can act on it.
 */
export const reviewSummary = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);

    const students = await ctx.db.query("students").collect();
    const attendance = await ctx.db.query("attendance").collect();

    const byStudent = new Map<string, Doc<"attendance">[]>();
    for (const record of attendance) {
      const bucket = byStudent.get(record.studentId) ?? [];
      bucket.push(record);
      byStudent.set(record.studentId, bucket);
    }

    return students
      .map((student) => {
        const records = byStudent.get(student._id) ?? [];

        // Group the student's marks into months.
        const months = new Map<
          string,
          {
            key: string;
            label: string;
            approved: number;
            pending: number;
            rejected: number;
            rejectedNotes: { day: string; note: string | null }[];
          }
        >();

        for (const record of records) {
          const key = record.day.slice(0, 7); // YYYY-MM
          const month = months.get(key) ?? {
            key,
            label: fromDayString(`${key}-01`).toLocaleDateString("en-US", {
              month: "long",
              year: "numeric",
            }),
            approved: 0,
            pending: 0,
            rejected: 0,
            rejectedNotes: [],
          };
          const status = record.reviewStatus ?? "pending";
          if (status === "approved") month.approved += 1;
          else if (status === "rejected") month.rejected += 1;
          else month.pending += 1;
          if (status === "rejected") {
            month.rejectedNotes.push({
              day: record.day,
              note: record.reviewNote ?? null,
            });
          }
          months.set(key, month);
        }

        const totals = { approved: 0, pending: 0, rejected: 0 };
        for (const month of months.values()) {
          totals.approved += month.approved;
          totals.pending += month.pending;
          totals.rejected += month.rejected;
        }

        return {
          _id: student._id,
          name: student.name,
          totals,
          months: [...months.values()].sort((a, b) =>
            a.key < b.key ? 1 : -1,
          ),
        };
      })
      // Students with nothing to review are not worth a row.
      .filter((student) => student.totals.approved + student.totals.pending + student.totals.rejected > 0);
  },
});

/** One student's profile plus the full attendance day list. */
export const get = query({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    await requireUser(ctx);

    const student = await ctx.db.get(studentId);
    if (student === null) return null;

    const records = await ctx.db
      .query("attendance")
      .withIndex("by_studentId", (q) => q.eq("studentId", studentId))
      .order("desc")
      .collect();

    const used = records.reduce(
      (sum, record) => sum + (record.sessionsConsumed ?? 1),
      0,
    );
    return {
      ...student,
      caseNo: student.caseNo ?? null,
      ratePerSessionCents: student.ratePerSessionCents ?? null,
      authorizedMinutes: student.authorizedMinutes ?? null,
      // Derived cap: authorized sessions × rate per session.
      maxAuthorizedAmountCents:
        student.ratePerSessionCents !== null && student.ratePerSessionCents !== undefined
          ? student.totalSessions * student.ratePerSessionCents
          : null,
      // Derived approved hours: 30-min sessions count as half, 60-min as full.
      approvedHours:
        student.authorizedMinutes != null
          ? (student.totalSessions * student.authorizedMinutes) / 60
          : null,
      usedSessions: used,
      remainingSessions: Math.max(student.totalSessions - used, 0),
      records: records.map((record) => ({
        _id: record._id,
        day: record.day,
        startTime: record.startTime ?? null,
        endTime: record.endTime ?? null,
        // Old rows have no review fields; treat them as pending review.
        reviewStatus: record.reviewStatus ?? "pending",
        reviewNote: record.reviewNote ?? null,
        reviewedAt: record.reviewedAt ?? null,
        sessionNumber: record.sessionNumber,
        durationMinutes: record.durationMinutes ?? null,
        sessionsConsumed: record.sessionsConsumed ?? 1,
        recordedBy: record.recordedBy,
        createdAt: record.createdAt,
      })),
    };
  },
});

/** Shared authorization arg validators for create/update. */
const authArgs = {
  ratePerSession: v.optional(v.number()), // whole dollars
  authorizedMinutes: v.optional(v.union(v.literal(30), v.literal(60))),
};

/** Normalize authorization inputs into stored cent fields. */
function normalizeAuth({
  ratePerSession,
  authorizedMinutes,
}: {
  ratePerSession?: number;
  authorizedMinutes?: 30 | 60;
}) {
  if (ratePerSession !== undefined &&
      (!Number.isFinite(ratePerSession) || ratePerSession < 0)) {
    throw new Error("Rate per session must be zero or more.");
  }
  return {
    ratePerSessionCents:
      ratePerSession === undefined
        ? undefined
        : Math.round(ratePerSession * 100),
    authorizedMinutes: authorizedMinutes ?? undefined,
  } as const;
}

/** Enroll a new student. */
export const create = mutation({
  args: {
    name: v.string(),
    contact: v.optional(v.string()),
    caseNo: v.optional(v.string()),
    totalSessions: v.number(),
    ...authArgs,
    notes: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { name, contact, caseNo, totalSessions, notes, ...auth },
  ) => {
    const { userId } = await requireUser(ctx);
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Give the student a name.");
    if (!Number.isInteger(totalSessions) || totalSessions <= 0) {
      throw new Error("Sessions must be a whole number of at least 1.");
    }
    const now = Date.now();
    return await ctx.db.insert("students", {
      name: trimmed,
      contact: contact?.trim() || undefined,
      caseNo: caseNo?.trim() || undefined,
      totalSessions,
      ...normalizeAuth(auth),
      notes: notes?.trim() || undefined,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Edit allotment or details. Admins only; works even when sessions are used. */
export const update = mutation({
  args: {
    studentId: v.id("students"),
    name: v.string(),
    contact: v.optional(v.string()),
    caseNo: v.optional(v.string()),
    totalSessions: v.number(),
    ...authArgs,
    notes: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { studentId, name, contact, caseNo, totalSessions, notes, ...auth },
  ) => {
    const { role } = await requireUser(ctx);
    if (role !== "admin") {
      throw new Error("Only admins can edit student details.");
    }
    const student = await ctx.db.get(studentId);
    if (student === null) throw new Error("Student not found.");
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Give the student a name.");
    if (!Number.isInteger(totalSessions) || totalSessions <= 0) {
      throw new Error("Sessions must be a whole number of at least 1.");
    }
    await ctx.db.patch(studentId, {
      name: trimmed,
      contact: contact?.trim() || undefined,
      caseNo: caseNo?.trim() || undefined,
      totalSessions,
      ...normalizeAuth(auth),
      notes: notes?.trim() || undefined,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Mark a student present for a chosen date and start time. The mark's duration
 * vs. the student's authorized minutes determines sessions consumed (60 min on
 * a 30-min authorization = 2 sessions). Duplicate date+time marks are rejected;
 * marking is blocked when remaining sessions are insufficient. A student may
 * have several sessions on the same day as long as the times differ.
 */
export const markAttendance = mutation({
  args: {
    studentId: v.id("students"),
    day: v.optional(v.string()),
    startTime: v.optional(v.string()),
    durationMinutes: v.optional(v.union(v.literal(30), v.literal(60))),
  },
  handler: async (ctx, { studentId, day, startTime, durationMinutes }) => {
    const { userId } = await requireUser(ctx);

    const student = await ctx.db.get(studentId);
    if (student === null) throw new Error("Student not found.");

    const targetDay = day ?? todayString();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDay)) {
      throw new Error("Invalid date.");
    }
    const targetTime = normalizeStartTime(startTime);

    const ran = durationMinutes ?? student.authorizedMinutes ?? 60;
    const consumed = sessionsConsumedFor(student.authorizedMinutes, ran);

    const used = await ctx.db
      .query("attendance")
      .withIndex("by_studentId", (q) => q.eq("studentId", studentId))
      .collect();

    const usedSessions = used.reduce(
      (sum, record) => sum + (record.sessionsConsumed ?? 1),
      0,
    );

    // Slots are keyed by date + start time, so 9:00am and 10:00am on the same
    // day are two separate sessions.
    if (
      targetTime !== undefined &&
      used.some(
        (record) => record.day === targetDay && record.startTime === targetTime,
      )
    ) {
      throw new Error(
        `${student.name} is already marked on ${targetDay} at ${formatStartTime(targetTime)}.`,
      );
    }

    const remaining = student.totalSessions - usedSessions;
    if (remaining < consumed) {
      throw new Error(
        remaining <= 0
          ? `${student.name} has no sessions remaining. Add sessions first.`
          : `This ${ran}-minute session needs ${consumed} sessions but only ${remaining} remain.`,
      );
    }

    // Session numbers run in chronological order across all marks.
    const chronological = [...used].sort((a, b) => {
      if (a.day !== b.day) return a.day < b.day ? -1 : 1;
      return (a.startTime ?? "") < (b.startTime ?? "") ? -1 : 1;
    });
    const startIndex = chronological.reduce(
      (sum, record) => sum + (record.sessionsConsumed ?? 1),
      0,
    );

    await ctx.db.insert("attendance", {
      studentId,
      day: targetDay,
      startTime: targetTime,
      endTime: targetTime !== undefined ? computeEndTime(targetTime, ran) : undefined,
      sessionNumber: startIndex + 1,
      durationMinutes: ran,
      sessionsConsumed: consumed,
      recordedBy: userId,
      createdAt: Date.now(),
      // Every new mark starts as pending until an admin reviews it.
      reviewStatus: "pending",
    });

    return {
      consumed,
      durationMinutes: ran,
      day: targetDay,
      startTime: targetTime ?? null,
      endTime:
        targetTime !== undefined ? computeEndTime(targetTime, ran) : null,
    };
  },
});

/**
 * Admin review of a marked session. Rejections must carry a reason so the
 * recorder knows what to fix. Approving clears any earlier rejection note.
 */
export const reviewAttendance = mutation({
  args: {
    attendanceId: v.id("attendance"),
    status: v.union(v.literal("approved"), v.literal("rejected")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { attendanceId, status, note }) => {
    const { userId, role } = await requireUser(ctx);
    if (role !== "admin") {
      throw new Error("Only admins can review attendance.");
    }
    const record = await ctx.db.get(attendanceId);
    if (record === null) throw new Error("Attendance record not found.");

    const trimmed = note?.trim() ?? "";
    if (status === "rejected" && trimmed === "") {
      throw new Error("Give a reason for rejecting this session.");
    }

    await ctx.db.patch(attendanceId, {
      reviewStatus: status,
      reviewNote: status === "rejected" ? trimmed : undefined,
      reviewedBy: userId,
      reviewedAt: Date.now(),
    });
  },
});

/** Undo a mark (admins only). Frees the session again. */
export const removeAttendance = mutation({
  args: { attendanceId: v.id("attendance") },
  handler: async (ctx, { attendanceId }) => {
    const { role } = await requireUser(ctx);
    if (role !== "admin") {
      throw new Error("Only admins can undo attendance.");
    }
    const record = await ctx.db.get(attendanceId);
    if (record === null) throw new Error("Attendance record not found.");
    await ctx.db.delete(attendanceId);
  },
});

/** Delete a student and their attendance history (admins only). */
export const remove = mutation({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    const { role } = await requireUser(ctx);
    if (role !== "admin") {
      throw new Error("Only admins can delete students.");
    }
    const student = await ctx.db.get(studentId);
    if (student === null) throw new Error("Student not found.");
    for (const record of await ctx.db
      .query("attendance")
      .withIndex("by_studentId", (q) => q.eq("studentId", studentId))
      .collect()) {
      await ctx.db.delete(record._id);
    }
    await ctx.db.delete(studentId);
  },
});
