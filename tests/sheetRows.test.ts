import { describe, expect, test } from "bun:test";
import {
  buildAttendanceTab,
  buildLedgerTab,
  buildStudentsTab,
  buildSummaryTab,
  type AttendanceDoc,
  type EntryDoc,
  type StudentDoc,
} from "../src/convex/lib/sheetRows";

/*
 * These cover the tab content, which is what actually lands in the sheet.
 *
 * The derived columns (approved hours, remaining sessions, remaining balance)
 * are deliberately duplicated from students.ts, so these assertions pin them
 * down: if that derivation ever drifts from the app, this is what catches it.
 *
 * This file lives outside src/ on purpose — tsconfig.app.json includes all of
 * src, and Convex typechecks everything in src/convex, so either would try to
 * compile the "bun:test" import without the Bun types.
 */

const student: StudentDoc = {
  _id: "s1",
  name: "Maria Santos",
  contact: "0917-000-0000",
  totalSessions: 10,
  ratePerSessionCents: 50_000, // $500
  authorizedMinutes: 60,
  notes: "Prefers weekends",
};

const noRateStudent: StudentDoc = {
  _id: "s2",
  name: "Juan Dela Cruz",
  totalSessions: 4,
};

function attendance(over: Partial<AttendanceDoc> = {}): AttendanceDoc {
  return {
    studentId: "s1",
    day: "2026-09-01",
    startTime: "14:00",
    endTime: "15:00",
    sessionNumber: 1,
    durationMinutes: 60,
    sessionsConsumed: 1,
    recordedBy: "u1",
    createdAt: 1_757_000_000_000,
    reviewStatus: "approved",
    ...over,
  };
}

const nameOf = (id: string) => (id === "u1" ? "Owner" : "Unknown");

describe("buildStudentsTab", () => {
  test("derives remaining sessions, hours and balance", () => {
    const rows = buildStudentsTab(
      [student],
      [attendance(), attendance({ sessionNumber: 2 })],
    );
    const row = rows[1];
    expect(row[2]).toBe(10); // authorized sessions
    expect(row[3]).toBe(500); // rate, in dollars
    expect(row[5]).toBe(10); // 10 sessions x 60 min = 10 approved hours
    expect(row[6]).toBe(2); // sessions used
    expect(row[7]).toBe(8); // remaining sessions
    expect(row[8]).toBe(8); // remaining hours
    expect(row[9]).toBe(4000); // 8 remaining x $500
  });

  test("counts pending and rejected sessions", () => {
    const rows = buildStudentsTab(
      [student],
      [
        attendance({ reviewStatus: "pending" }),
        attendance({ reviewStatus: "rejected" }),
        attendance({ reviewStatus: "approved" }),
      ],
    );
    expect(rows[1][10]).toBe(1); // pending
    expect(rows[1][11]).toBe(1); // rejected
  });

  test("treats a missing reviewStatus as pending", () => {
    // Rows created before the review flow existed have no reviewStatus.
    const rows = buildStudentsTab(
      [student],
      [attendance({ reviewStatus: undefined })],
    );
    expect(rows[1][10]).toBe(1);
  });

  test("leaves money and hour cells blank when no rate is set", () => {
    const rows = buildStudentsTab([noRateStudent], []);
    expect(rows[1][3]).toBe(""); // rate
    expect(rows[1][5]).toBe(""); // approved hours
    expect(rows[1][9]).toBe(""); // remaining balance
    expect(rows[1][7]).toBe(4); // remaining sessions still derived
  });

  test("emits only a header when there are no students", () => {
    // writeTab relies on a header surviving empty data.
    expect(buildStudentsTab([], [])).toHaveLength(1);
  });
});

describe("buildAttendanceTab", () => {
  test("formats times for reading and keeps duration", () => {
    const rows = buildAttendanceTab([student], [attendance()], nameOf);
    expect(rows[1][0]).toBe("Maria Santos");
    expect(rows[1][1]).toBe("2026-09-01");
    expect(rows[1][2]).toBe("2:00 PM");
    expect(rows[1][3]).toBe("3:00 PM");
    expect(rows[1][4]).toBe(60);
    expect(rows[1][7]).toBe("Owner");
    expect(rows[1][9]).toBe("approved");
  });

  test("renders midnight and noon correctly", () => {
    const rows = buildAttendanceTab(
      [student],
      [
        attendance({ startTime: "00:00", endTime: "00:30" }),
        attendance({ startTime: "12:00", endTime: "12:30" }),
      ],
      nameOf,
    );
    expect(rows[1][2]).toBe("12:00 AM");
    expect(rows[2][2]).toBe("12:00 PM");
  });

  test("falls back for old rows with no duration or sessionsConsumed", () => {
    const rows = buildAttendanceTab(
      [student],
      [attendance({ durationMinutes: undefined, sessionsConsumed: undefined })],
      nameOf,
    );
    expect(rows[1][4]).toBe(60); // falls back to the authorized length
    expect(rows[1][5]).toBe(1);
  });

  test("sorts newest day first", () => {
    const rows = buildAttendanceTab(
      [student],
      [
        attendance({ day: "2026-09-01" }),
        attendance({ day: "2026-09-20" }),
      ],
      nameOf,
    );
    expect(rows[1][1]).toBe("2026-09-20");
    expect(rows[2][1]).toBe("2026-09-01");
  });

  test("emits only a header when there is no attendance", () => {
    expect(buildAttendanceTab([], [], nameOf)).toHaveLength(1);
  });
});

describe("buildLedgerTab", () => {
  const entry: EntryDoc = {
    _id: "e1",
    title: "Paper Invoice",
    category: "School",
    amount: -125_000, // centavos
    status: "pending",
    studentId: "s1",
    provider: "Polaris",
    createdBy: "u1",
    createdAt: 1_757_000_000_000,
  };

  test("converts centavos to dollars and resolves the student", () => {
    const rows = buildLedgerTab([student], [entry], nameOf);
    expect(rows[1][0]).toBe("Paper Invoice");
    expect(rows[1][2]).toBe(-1250); // not -125000
    expect(rows[1][3]).toBe("pending");
    expect(rows[1][4]).toBe("Maria Santos");
    expect(rows[1][5]).toBe("Polaris");
    expect(rows[1][6]).toBe(""); // not paid yet
  });

  test("sorts newest first", () => {
    const rows = buildLedgerTab(
      [student],
      [entry, { ...entry, _id: "e2", createdAt: entry.createdAt + 5000 }],
      nameOf,
    );
    expect(rows[1][3]).toBe("pending");
    expect(rows).toHaveLength(3); // header + 2
  });

  test("emits only a header when there are no entries", () => {
    expect(buildLedgerTab([], [], nameOf)).toHaveLength(1);
  });
});

describe("buildSummaryTab", () => {
  test("counts by review status and sums approved spend", () => {
    const entries: EntryDoc[] = [
      { _id: "e1", title: "a", amount: -10_000, status: "approved", createdBy: "u1", createdAt: 1 },
      { _id: "e2", title: "b", amount: -25_000, status: "approved", createdBy: "u1", createdAt: 2 },
      { _id: "e3", title: "c", amount: -5_000, status: "pending", createdBy: "u1", createdAt: 3 },
    ];
    const rows = buildSummaryTab(
      [student],
      [
        attendance({ reviewStatus: "approved" }),
        attendance({ reviewStatus: "pending" }),
        attendance({ reviewStatus: "rejected" }),
      ],
      entries,
      1_757_000_000_000,
    );
    const metric = (label: string) => {
      const row = rows.find((r) => r[0] === label);
      if (!row) throw new Error(`missing metric: ${label}`);
      return row[1];
    };

    expect(metric("Students")).toBe(1);
    expect(metric("Authorized sessions")).toBe(10);
    expect(metric("Sessions logged")).toBe(3);
    expect(metric("Sessions approved")).toBe(1);
    expect(metric("Sessions pending")).toBe(1);
    expect(metric("Sessions rejected")).toBe(1);
    expect(metric("Approved hours")).toBe(1);
    expect(metric("Ledger entries")).toBe(3);
    expect(metric("Entries approved")).toBe(2);
    expect(metric("Entries pending")).toBe(1);
    expect(metric("Approved spend (USD)")).toBe(-350); // -100 + -250
  });

  test("keeps fractional approved hours readable", () => {
    const rows = buildSummaryTab(
      [],
      [attendance({ reviewStatus: "approved", durationMinutes: 90 })],
      [],
      0,
    );
    const row = rows.find((r) => r[0] === "Approved hours");
    expect(row?.[1]).toBe(1.5);
  });

  test("always emits every metric, zeroed, even with no data", () => {
    // Unlike the three data tabs, Summary deliberately does not collapse to a
    // bare header: a dashboard full of named zeros is more useful than a
    // blank tab, and it keeps the row positions stable for charts.
    const rows = buildSummaryTab([], [], [], 0);
    expect(rows[0][0]).toBe("Metric");
    expect(rows.length).toBe(14);
    const metric = (label: string) => {
      const row = rows.find((r) => r[0] === label);
      if (!row) throw new Error(`missing metric: ${label}`);
      return row[1];
    };
    expect(metric("Students")).toBe(0);
    expect(metric("Sessions logged")).toBe(0);
    expect(metric("Approved hours")).toBe(0);
    expect(metric("Approved spend (USD)")).toBe(0);
  });
});
