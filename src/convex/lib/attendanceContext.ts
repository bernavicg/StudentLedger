/**
 * Attendance context for the AI assistant (pure logic, isolate-safe).
 *
 * Mirrors the session math used by students.list — sessionsConsumed scales
 * with duration (a 60-minute mark against a 30-minute plan costs 2) — so the
 * AI never quotes numbers that disagree with the roster page.
 *
 * Lives in lib/ with zero node imports so it can be bundled from either the
 * isolate or the node runtime without `node:` resolution failures.
 */

export type AttendanceRow = {
  day: string; // YYYY-MM-DD
  startTime?: string | null;
  durationMinutes?: number | null;
  sessionsConsumed?: number | null;
  reviewStatus?: "pending" | "approved" | "rejected" | null;
  reviewNote?: string | null;
};

export type StudentRow = {
  name: string;
  totalSessions: number;
  ratePerSessionCents?: number | null;
  authorizedMinutes?: number | null;
};

export type StudentAttendanceContext = {
  name: string;
  totalSessions: number;
  authorizedMinutes: number | null;
  approvedHours: number | null;
  marksLogged: number;
  sessionsUsed: number;
  sessionsRemaining: number;
  minutesAttended: number;
  hoursAttended: number;
  firstDay: string | null;
  lastDay: string | null;
  pendingReview: number;
  rejected: number;
  recentDays: {
    day: string;
    startTime: string | null;
    durationMinutes: number | null;
    status: string;
    note: string | null;
  }[];
};

export type AttendanceContext = {
  students: StudentAttendanceContext[];
  totalMarks: number;
};

/** Guards so a huge roster cannot blow up the prompt. */
export const CONTEXT_LIMITS = {
  maxStudents: 100,
  recentDaysPerStudent: 5,
} as const;

/** Derive one student's summary from their attendance rows. */
export function summarizeStudent(
  student: StudentRow,
  records: AttendanceRow[],
): StudentAttendanceContext {
  const sorted = [...records].sort((a, b) =>
    a.day === b.day
      ? (a.startTime ?? "").localeCompare(b.startTime ?? "")
      : a.day.localeCompare(b.day),
  );

  const sessionsUsed = sorted.reduce(
    (sum, record) => sum + (record.sessionsConsumed ?? 1),
    0,
  );
  const minutesAttended = sorted.reduce(
    (sum, record) => sum + (record.durationMinutes ?? 0),
    0,
  );

  const pendingReview = sorted.filter(
    (record) => (record.reviewStatus ?? "pending") === "pending",
  ).length;
  const rejected = sorted.filter(
    (record) => record.reviewStatus === "rejected",
  ).length;

  const recentDays = sorted
    .slice(-CONTEXT_LIMITS.recentDaysPerStudent)
    .reverse()
    .map((record) => ({
      day: record.day,
      startTime: record.startTime ?? null,
      durationMinutes: record.durationMinutes ?? null,
      status: record.reviewStatus ?? "pending",
      note: record.reviewStatus === "rejected" ? (record.reviewNote ?? null) : null,
    }));

  return {
    name: student.name,
    totalSessions: student.totalSessions,
    authorizedMinutes: student.authorizedMinutes ?? null,
    approvedHours:
      student.authorizedMinutes != null
        ? (student.totalSessions * student.authorizedMinutes) / 60
        : null,
    marksLogged: sorted.length,
    sessionsUsed,
    sessionsRemaining: Math.max(student.totalSessions - sessionsUsed, 0),
    minutesAttended,
    hoursAttended: Math.round((minutesAttended / 60) * 10) / 10,
    firstDay: sorted.length > 0 ? sorted[0].day : null,
    lastDay: sorted.length > 0 ? sorted[sorted.length - 1].day : null,
    pendingReview,
    rejected,
    recentDays,
  };
}

/** Group raw rows by student id and summarize each student. */
export function buildAttendanceContext<
  S extends StudentRow & { _id: string },
  A extends AttendanceRow & { studentId: string },
>(students: S[], attendance: A[]): AttendanceContext {
  const byStudent = new Map<string, A[]>();
  for (const record of attendance) {
    const bucket = byStudent.get(record.studentId) ?? [];
    bucket.push(record);
    byStudent.set(record.studentId, bucket);
  }

  const chosen = students.slice(0, CONTEXT_LIMITS.maxStudents);
  const context = chosen.map((student) =>
    summarizeStudent(student, byStudent.get(student._id) ?? []),
  );

  return { students: context, totalMarks: attendance.length };
}

/** Render the context as compact text for the AI prompt. */
export function contextToPrompt(context: AttendanceContext): string {
  if (context.students.length === 0) {
    return "No students are enrolled yet, and no attendance has been recorded.";
  }

  const blocks = context.students.map((student) => {
    const plan = student.authorizedMinutes
      ? `${student.totalSessions} sessions × ${student.authorizedMinutes} min (${student.approvedHours} approved hours)`
      : `${student.totalSessions} sessions`;

    const review = [
      `${student.marksLogged - student.pendingReview - student.rejected} approved`,
      `${student.pendingReview} pending`,
      `${student.rejected} rejected`,
    ].join(", ");

    const recent = student.recentDays
      .map((day) => {
        const time = day.startTime ? ` ${day.startTime}` : "";
        const minutes = day.durationMinutes != null ? `, ${day.durationMinutes} min` : "";
        const note = day.note ? ` — "${day.note}"` : "";
        return `  · ${day.day}${time} (${day.status}${minutes})${note}`;
      })
      .join("\n");

    return [
      `Student: ${student.name}`,
      `- Plan: ${plan}`,
      `- Sessions used: ${student.sessionsUsed} of ${student.totalSessions} (${student.sessionsRemaining} remaining)`,
      `- Marks logged: ${student.marksLogged} days, ${student.minutesAttended} minutes (${student.hoursAttended} hours) attended`,
      student.firstDay ? `- Attendance range: ${student.firstDay} to ${student.lastDay}` : null,
      `- Review: ${review}`,
      recent ? `- Recent days:\n${recent}` : "- Recent days: none",
    ]
      .filter((line) => line !== null)
      .join("\n");
  });

  return blocks.join("\n\n");
}

/**
 * Header line when the chat is focused on one student, so the model knows
 * to answer only about them.
 */
export function focusNoteFor(name: string | null): string | null {
  return name === null
    ? null
    : `The question is about ${name}. Use only their data below and ignore other students unless the question compares them.`;
}
