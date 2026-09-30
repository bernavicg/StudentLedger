import { describe, expect, test } from "bun:test";
import {
  buildAttendanceContext,
  contextToPrompt,
  summarizeStudent,
  type AttendanceRow,
  type StudentRow,
} from "../src/convex/lib/attendanceContext";

function student(overrides: Partial<StudentRow> = {}): StudentRow {
  return {
    name: "Rina Ishay",
    totalSessions: 24,
    ratePerSessionCents: 15000,
    authorizedMinutes: 60,
    ...overrides,
  };
}

function mark(overrides: Partial<AttendanceRow> = {}): AttendanceRow {
  return {
    day: "2026-09-20",
    startTime: "15:00",
    durationMinutes: 60,
    sessionsConsumed: 1,
    reviewStatus: "approved",
    reviewNote: null,
    ...overrides,
  };
}

describe("summarizeStudent", () => {
  test("counts sessions with the same scaling rule as students.list", () => {
    const summary = summarizeStudent(student({ totalSessions: 10 }), [
      mark({ sessionsConsumed: 1 }),
      mark({ sessionsConsumed: 2, durationMinutes: 60 }),
      mark({ sessionsConsumed: 2 }),
    ]);
    expect(summary.sessionsUsed).toBe(5);
    expect(summary.sessionsRemaining).toBe(5);
    expect(summary.marksLogged).toBe(3);
  });

  test("treats missing sessionsConsumed as 1 (legacy rows)", () => {
    const summary = summarizeStudent(student(), [
      mark({ sessionsConsumed: null }),
      mark({ sessionsConsumed: null, durationMinutes: null }),
    ]);
    expect(summary.sessionsUsed).toBe(2);
    expect(summary.minutesAttended).toBe(60);
    expect(summary.hoursAttended).toBe(1);
  });

  test("derives approved hours from the plan", () => {
    expect(
      summarizeStudent(student({ totalSessions: 24, authorizedMinutes: 60 }), [])
        .approvedHours,
    ).toBe(24);
    expect(
      summarizeStudent(student({ totalSessions: 24, authorizedMinutes: 30 }), [])
        .approvedHours,
    ).toBe(12);
    expect(
      summarizeStudent(student({ authorizedMinutes: null }), []).approvedHours,
    ).toBeNull();
  });

  test("classifies review states (missing status counts as pending)", () => {
    const summary = summarizeStudent(student(), [
      mark({ reviewStatus: "approved" }),
      mark({ reviewStatus: null }),
      mark({ reviewStatus: "rejected", reviewNote: "Wrong day" }),
      mark({ reviewStatus: "rejected" }),
    ]);
    expect(summary.pendingReview).toBe(1);
    expect(summary.rejected).toBe(2);
  });

  test("sorts records by day and time; first/last follow the sort", () => {
    const summary = summarizeStudent(student(), [
      mark({ day: "2026-09-25" }),
      mark({ day: "2026-09-01" }),
      mark({ day: "2026-09-14", startTime: "10:00" }),
    ]);
    expect(summary.firstDay).toBe("2026-09-01");
    expect(summary.lastDay).toBe("2026-09-25");
    expect(summary.recentDays[0]?.day).toBe("2026-09-25");
    expect(summary.recentDays[2]?.day).toBe("2026-09-01");
  });

  test("caps recent days at five, newest first", () => {
    const many = Array.from({ length: 9 }, (_, index) =>
      mark({ day: `2026-09-${String(index + 10).padStart(2, "0")}` }),
    );
    const summary = summarizeStudent(student(), many);
    expect(summary.recentDays).toHaveLength(5);
    expect(summary.recentDays[0]?.day).toBe("2026-09-18");
  });

  test("rejected notes surface only on rejected days", () => {
    const summary = summarizeStudent(student(), [
      mark({ reviewStatus: "approved", reviewNote: "ignored note" }),
      mark({ reviewStatus: "rejected", reviewNote: "Wrong date" }),
    ]);
    // Same day+time: order is stable, newest-first puts the rejected mark on top.
    expect(summary.recentDays[0]?.note).toBe("Wrong date");
    expect(summary.recentDays[1]?.note).toBeNull();
  });

  test("handles empty history", () => {
    const summary = summarizeStudent(student(), []);
    expect(summary.marksLogged).toBe(0);
    expect(summary.firstDay).toBeNull();
    expect(summary.lastDay).toBeNull();
    expect(summary.recentDays).toHaveLength(0);
    expect(summary.sessionsRemaining).toBe(24);
  });
});

describe("buildAttendanceContext", () => {
  test("groups attendance rows by student", () => {
    const context = buildAttendanceContext(
      [
        { _id: "s1", ...student() },
        { _id: "s2", ...student({ name: "Marco" }) },
      ],
      [
        mark({ studentId: "s1" } as AttendanceRow & { studentId: string }),
        mark({ studentId: "s1", day: "2026-09-21" } as AttendanceRow & {
          studentId: string;
        }),
        mark({ studentId: "s2", durationMinutes: 30 } as AttendanceRow & {
          studentId: string;
        }),
      ],
    );
    expect(context.students).toHaveLength(2);
    expect(context.students[0]?.marksLogged).toBe(2);
    expect(context.students[1]?.marksLogged).toBe(1);
    expect(context.totalMarks).toBe(3);
  });

  test("caps students included in the context", () => {
    const many = Array.from({ length: 150 }, (_, index) => ({
      _id: `s${index}`,
      ...student({ name: `Student ${index}` }),
    }));
    const context = buildAttendanceContext(many, []);
    expect(context.students).toHaveLength(100);
    expect(context.students[99]?.name).toBe("Student 99");
  });
});

describe("contextToPrompt", () => {
  test("renders plan, usage, review, and recent days", () => {
    const context = buildAttendanceContext(
      [{ _id: "s1", ...student() }],
      [
        mark({ studentId: "s1", reviewStatus: "rejected", reviewNote: "Duplicate mark" } as AttendanceRow & { studentId: string }),
        mark({ studentId: "s1", day: "2026-09-21", startTime: "16:00" } as AttendanceRow & { studentId: string }),
      ],
    );
    const prompt = contextToPrompt(context);
    expect(prompt).toContain("Student: Rina Ishay");
    expect(prompt).toContain("24 sessions × 60 min (24 approved hours)");
    expect(prompt).toContain("Sessions used: 2 of 24 (22 remaining)");
    expect(prompt).toContain("1 approved, 0 pending, 1 rejected");
    expect(prompt).toContain("2026-09-21 16:00 (approved, 60 min)");
    expect(prompt).toContain('2026-09-20 15:00 (rejected, 60 min) — "Duplicate mark"');
  });

  test("has a clear line when the ledger is empty", () => {
    expect(contextToPrompt({ students: [], totalMarks: 0 })).toContain(
      "No students are enrolled yet",
    );
  });
});
