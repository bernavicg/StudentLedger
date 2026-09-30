/**
 * The change fingerprint that decides whether a Google Sheets export is due.
 *
 * Pure so it can be unit tested, and kept out of the Convex module so the
 * rules are not buried in a query handler.
 */

/** The minimum shape the fingerprint needs from each table. */
export type FingerprintInput = {
  entries: { createdAt: number; updatedAt: number }[];
  attendance: { createdAt: number; reviewedAt?: number }[];
  students: { updatedAt: number }[];
};

function max(rows: { [k: string]: number | undefined }[], key: string): number {
  return rows.reduce((top, row) => Math.max(top, row[key] ?? 0), 0);
}

/**
 * A cheap signature of the data we would export.
 *
 * Status changes do not bump `createdAt`, so the review/updated timestamps are
 * folded in too — otherwise approving a session would not trigger a re-export
 * and the sheet would silently drift out of date.
 */
export function fingerprintOf(input: FingerprintInput): string {
  return [
    `e:${input.entries.length}:${max(input.entries, "createdAt")}:${max(input.entries, "updatedAt")}`,
    `a:${input.attendance.length}:${max(input.attendance, "createdAt")}:${max(input.attendance, "reviewedAt")}`,
    `s:${input.students.length}:${max(input.students, "updatedAt")}`,
  ].join("|");
}
