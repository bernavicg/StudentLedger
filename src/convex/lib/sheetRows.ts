/**
 * Pure row builders for the Google Sheets mirror.
 *
 * Deliberately free of Convex runtime imports: these take plain data in and
 * return plain arrays out, so the same code works whether it is called from a
 * query (which reads the database) or from a test. The derivations here are
 * kept in step with students.ts so the sheet agrees with the app.
 */

/** A row is one cell value; empty string means "blank cell". */
export type SheetRow = (string | number)[];

/** The tab names we create. No spaces, so A1 ranges need no quoting. */
export const SHEET_TABS = {
  students: "Students",
  attendance: "Attendance",
  ledger: "Ledger",
  summary: "Summary",
} as const;

export type StudentDoc = {
  _id: string;
  name: string;
  contact?: string;
  totalSessions: number;
  ratePerSessionCents?: number;
  authorizedMinutes?: 30 | 60;
  notes?: string;
};

export type AttendanceDoc = {
  studentId: string;
  day: string;
  startTime?: string;
  endTime?: string;
  sessionNumber: number;
  durationMinutes?: number;
  sessionsConsumed?: number;
  recordedBy: string;
  createdAt: number;
  reviewStatus?: "pending" | "approved" | "rejected";
  reviewNote?: string;
  reviewedAt?: number;
};

export type EntryDoc = {
  _id: string;
  title: string;
  category?: string;
  amount: number;
  status: "pending" | "approved" | "rejected";
  studentId?: string;
  provider?: string;
  paidAt?: number;
  reviewNote?: string;
  reviewedBy?: string;
  reviewedAt?: number;
  createdBy: string;
  createdAt: number;
};

/**
 * Sessions consumed by a mark of the given duration (matches students.ts).
 * Only used as a fallback for old rows that predate the stored field.
 */
function sessionsConsumedFor(
  authorizedMinutes: 30 | 60 | undefined,
  durationMinutes: number,
): number {
  const base = authorizedMinutes ?? 60;
  return Math.max(1, Math.round(durationMinutes / base));
}

/** "HH:MM" → "2:30 PM" so the sheet is readable without mental math. */
function prettyTime(time: string | undefined): string {
  if (!time) return "";
  const [hours, minutes] = time.split(":").map(Number);
  const suffix = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function isoTime(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 16).replace("T", " ");
}

function isoDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/** Resolves a user id to a display name, for the "logged by" columns. */
type NameOf = (id: string) => string;

export function buildStudentsTab(
  students: StudentDoc[],
  attendance: AttendanceDoc[],
): SheetRow[] {
  const rows: SheetRow[] = [
    [
      "Name",
      "Contact",
      "Authorized sessions",
      "Rate / session",
      "Session minutes",
      "Approved hours",
      "Sessions used",
      "Remaining sessions",
      "Remaining hours",
      "Remaining balance",
      "Pending sessions",
      "Rejected sessions",
      "Notes",
    ],
  ];

  for (const student of students) {
    const records = attendance.filter((r) => r.studentId === student._id);
    const used = records.reduce((sum, r) => sum + (r.sessionsConsumed ?? 1), 0);
    const remaining = Math.max(student.totalSessions - used, 0);
    const rate = student.ratePerSessionCents;
    const minutes = student.authorizedMinutes;

    rows.push([
      student.name,
      student.contact ?? "",
      student.totalSessions,
      rate === undefined ? "" : rate / 100,
      minutes ?? "",
      // Same derivation as the app: authorized sessions × session length.
      minutes === undefined ? "" : (student.totalSessions * minutes) / 60,
      used,
      remaining,
      minutes === undefined ? "" : (remaining * minutes) / 60,
      rate === undefined ? "" : remaining * (rate / 100),
      records.filter((r) => (r.reviewStatus ?? "pending") === "pending").length,
      records.filter((r) => r.reviewStatus === "rejected").length,
      student.notes ?? "",
    ]);
  }

  return rows;
}

export function buildAttendanceTab(
  students: StudentDoc[],
  attendance: AttendanceDoc[],
  nameOf: NameOf,
): SheetRow[] {
  const rows: SheetRow[] = [
    [
      "Student",
      "Day",
      "Start",
      "End",
      "Duration (min)",
      "Sessions used",
      "Session #",
      "Logged by",
      "Logged at",
      "Status",
      "Note",
    ],
  ];

  const byId = new Map(students.map((s) => [s._id, s]));
  // Newest day first, then newest within a day.
  const ordered = [...attendance].sort((a, b) =>
    a.day === b.day ? b.createdAt - a.createdAt : a.day < b.day ? 1 : -1,
  );

  for (const record of ordered) {
    const student = byId.get(record.studentId);
    const duration =
      record.durationMinutes ?? student?.authorizedMinutes ?? 60;
    rows.push([
      student?.name ?? "Unknown student",
      record.day,
      prettyTime(record.startTime),
      prettyTime(record.endTime),
      duration,
      record.sessionsConsumed ?? sessionsConsumedFor(student?.authorizedMinutes, duration),
      record.sessionNumber,
      nameOf(record.recordedBy),
      isoTime(record.createdAt),
      // Old rows have no reviewStatus; the app treats those as pending too.
      record.reviewStatus ?? "pending",
      record.reviewNote ?? "",
    ]);
  }

  return rows;
}

export function buildLedgerTab(
  students: StudentDoc[],
  entries: EntryDoc[],
  nameOf: NameOf,
): SheetRow[] {
  const rows: SheetRow[] = [
    [
      "Title",
      "Category",
      "Amount",
      "Status",
      "Student",
      "Provider",
      "Paid on",
      "Filed by",
      "Filed at",
      "Reviewed at",
      "Note",
    ],
  ];

  const studentName = new Map(students.map((s) => [s._id, s.name]));
  const ordered = [...entries].sort((a, b) => b.createdAt - a.createdAt);

  for (const entry of ordered) {
    rows.push([
      entry.title,
      entry.category ?? "",
      // Stored in centavos; the sheet shows plain dollars.
      entry.amount / 100,
      entry.status,
      entry.studentId ? studentName.get(entry.studentId) ?? "" : "",
      entry.provider ?? "",
      entry.paidAt === undefined ? "" : isoDay(entry.paidAt),
      nameOf(entry.createdBy),
      isoTime(entry.createdAt),
      entry.reviewedAt === undefined ? "" : isoTime(entry.reviewedAt),
      entry.reviewNote ?? "",
    ]);
  }

  return rows;
}

export function buildSummaryTab(
  students: StudentDoc[],
  attendance: AttendanceDoc[],
  entries: EntryDoc[],
  syncedAt: number,
): SheetRow[] {
  const approved = attendance.filter((r) => r.reviewStatus === "approved");
  const pending = attendance.filter(
    (r) => (r.reviewStatus ?? "pending") === "pending",
  );
  const rejected = attendance.filter((r) => r.reviewStatus === "rejected");
  const approvedMoney = entries
    .filter((e) => e.status === "approved")
    .reduce((sum, e) => sum + e.amount, 0);
  const approvedHours =
    approved.reduce((sum, r) => sum + (r.durationMinutes ?? 60), 0) / 60;

  return [
    ["Metric", "Value"],
    ["Students", students.length],
    [
      "Authorized sessions",
      students.reduce((sum, s) => sum + s.totalSessions, 0),
    ],
    ["Sessions logged", attendance.length],
    ["Sessions approved", approved.length],
    ["Sessions pending", pending.length],
    ["Sessions rejected", rejected.length],
    // Rounded to 2dp to avoid float noise like 3.3333333333333335.
    ["Approved hours", Math.round(approvedHours * 100) / 100],
    ["Ledger entries", entries.length],
    ["Entries pending", entries.filter((e) => e.status === "pending").length],
    ["Entries approved", entries.filter((e) => e.status === "approved").length],
    ["Entries rejected", entries.filter((e) => e.status === "rejected").length],
    ["Approved spend (USD)", Math.round(approvedMoney) / 100],
    ["Last synced (UTC)", isoTime(syncedAt)],
  ];
}
