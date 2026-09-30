/**
 * Internal data-gathering for the Google Sheets mirror.
 *
 * These live apart from sheets.ts on purpose. A Convex module that references
 * `api.<itself>.*` inside a handler makes TypeScript infer the handler's type
 * circularly (TS7022), because the generated `api` type includes that very
 * module. Keeping the internal queries here means sheets.ts only ever points
 * at `api.sheetsInternal.*`, and nothing refers to itself.
 *
 * Convex actions have no `ctx.db`, so the reading happens in these queries and
 * the node action is handed the finished rows.
 */

import { internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  buildAttendanceTab,
  buildLedgerTab,
  buildStudentsTab,
  buildSummaryTab,
  type SheetRow,
} from "./lib/sheetRows";
import { fingerprintOf } from "./lib/fingerprint";
import { requireUser } from "./lib/auth";

export type Payload = {
  fingerprint: string;
  students: SheetRow[];
  attendance: SheetRow[];
  ledger: SheetRow[];
  summary: SheetRow[];
};

/** Read the app and shape it into the four tabs. */
export const buildPayload = internalQuery({
  args: {},
  handler: async (ctx): Promise<Payload> => {
    const [students, attendance, entries] = await Promise.all([
      ctx.db.query("students").collect(),
      ctx.db.query("attendance").collect(),
      ctx.db.query("entries").collect(),
    ]);

    const fingerprint = fingerprintOf({ entries, attendance, students });

    // Resolve every referenced person once, so the row builders stay pure.
    const userIds = new Set<Id<"users">>();
    for (const row of attendance) userIds.add(row.recordedBy);
    for (const row of entries) userIds.add(row.createdBy);
    const users = await Promise.all(
      Array.from(userIds).map((id) => ctx.db.get(id)),
    );
    const nameOf = (id: string): string => {
      const user = users.find((u) => u !== null && u._id === id);
      return user?.name ?? user?.email ?? "Unknown";
    };

    return {
      fingerprint,
      students: buildStudentsTab(students, attendance),
      attendance: buildAttendanceTab(students, attendance, nameOf),
      ledger: buildLedgerTab(students, entries, nameOf),
      summary: buildSummaryTab(students, attendance, entries, Date.now()),
    };
  },
});

/** The current data fingerprint, for deciding whether a sync is needed. */
export const currentFingerprint = internalQuery({
  args: {},
  handler: async (ctx) => {
    const [entries, attendance, students] = await Promise.all([
      ctx.db.query("entries").collect(),
      ctx.db.query("attendance").collect(),
      ctx.db.query("students").collect(),
    ]);
    return fingerprintOf({ entries, attendance, students });
  },
});

/** The caller's role, so actions can enforce admin without a ctx type fight. */
export const callerRole = internalQuery({
  args: {},
  handler: async (ctx) => {
    const session = await requireUser(ctx);
    return { role: session.role, userId: session.userId };
  },
});
