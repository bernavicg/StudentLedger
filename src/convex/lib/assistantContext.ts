/**
 * Assistant context builders for the whole app (pure logic, isolate-safe).
 *
 * Wraps the attendance context (attendanceContext.ts) and adds the money
 * ledger, the task board, and the paper invoices, so the AI assistant can
 * answer about every page — not just students. Lives in lib/ with zero node
 * imports so it can be bundled from either the isolate or the node runtime.
 */

import {
  buildAttendanceContext,
  contextToPrompt,
  focusNoteFor,
} from "./attendanceContext";

export {
  buildAttendanceContext,
  contextToPrompt,
  focusNoteFor,
};

/** Guards so a large workspace cannot blow up the prompt. */
export const ASSISTANT_LIMITS = {
  maxEntries: 40,
  maxTasks: 60,
  maxInvoices: 60,
} as const;

export type StudentWithCase = {
  name: string;
  caseNo?: string | null;
};

export type EntryRow = {
  title: string;
  amount: number; // signed centavos
  status: "pending" | "approved" | "rejected";
  category?: string | null;
  studentName?: string | null;
  createdAt: number;
};

export type EntryStats = {
  pending: number;
  approvedCount: number;
  netApproved: number; // signed centavos
};

export type TaskRow = {
  title: string;
  status: "todo" | "in_progress" | "done";
  due?: string | null; // YYYY-MM-DD
  createdAt: number;
  creatorName: string;
};

export type InvoiceRow = {
  title: string;
  studentName: string;
  fileName: string;
  caseNo?: string | null;
  createdAt: number;
  // Billing snapshot auto-computed from the student's plan at upload time.
  totalSessions?: number | null;
  totalHours?: number | null;
  totalAmountCents?: number | null;
};

/**
 * How the AI refers to a student anywhere in its context: the case number
 * rides along so answers can cite it ("Mira Chen (case CASE-2026-014)").
 */
export function studentLabelFor(student: StudentWithCase): string {
  return student.caseNo
    ? `${student.name} (case ${student.caseNo})`
    : student.name;
}

/** "$1,250.00"-style signed amount for the prompt. */
export function money(amount: number): string {
  const abs = (Math.abs(amount) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${amount < 0 ? "-" : ""}$${abs}`;
}

function dayOf(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/** Hours label: "40 h" or "22.5 h". */
function hoursLabel(hours: number): string {
  return Number.isInteger(hours) ? `${hours} h` : `${hours.toFixed(1)} h`;
}

/** Ledger section: totals over the full scope plus the newest entries. */
export function summarizeEntries(stats: EntryStats, entries: EntryRow[]): string {
  if (entries.length === 0) {
    return "No ledger entries have been filed yet.";
  }
  const lines = [
    `Totals: ${stats.pending} pending review, ${stats.approvedCount} approved, net approved ${money(stats.netApproved)}.`,
    "Recent entries (newest first):",
  ];
  for (const entry of entries.slice(0, ASSISTANT_LIMITS.maxEntries)) {
    const detail = [
      entry.category ? `, ${entry.category}` : "",
      entry.studentName ? `, student ${entry.studentName}` : "",
    ].join("");
    lines.push(
      `- ${dayOf(entry.createdAt)} ${entry.title} ${money(entry.amount)} (${entry.status}${detail})`,
    );
  }
  return lines.join("\n");
}

/** Task board section: open tasks with due dates and overdue flags. */
export function summarizeTasks(tasks: TaskRow[]): string {
  if (tasks.length === 0) return "No tasks on the board yet.";
  const today = new Date().toISOString().slice(0, 10);
  const todo = tasks.filter((t) => t.status === "todo").length;
  const inProgress = tasks.filter((t) => t.status === "in_progress").length;
  const done = tasks.filter((t) => t.status === "done").length;
  const lines = [
    `${tasks.length} tasks on the board (today is ${today}): ${todo} to do, ${inProgress} in progress, ${done} done.`,
  ];
  let listed = 0;
  for (const task of tasks) {
    if (task.status === "done" || listed >= ASSISTANT_LIMITS.maxTasks) continue;
    const overdue = task.due !== undefined && task.due !== null && task.due < today;
    lines.push(
      `- [${task.status === "todo" ? "to do" : "in progress"}] ${task.title} (by ${task.creatorName}${
        task.due ? `, due ${task.due}${overdue ? " — OVERDUE" : ""}` : ""
      })`,
    );
    listed += 1;
  }
  if (listed === 0) lines.push("Every task is done.");
  return lines.join("\n");
}

/** Paper invoices section: one line per invoice with student + case no. */
export function summarizeInvoices(invoices: InvoiceRow[]): string {
  if (invoices.length === 0) {
    return "No paper invoices have been uploaded yet.";
  }
  const lines = [
    `${invoices.length} paper invoices on file (newest first):`,
  ];
  for (const invoice of invoices.slice(0, ASSISTANT_LIMITS.maxInvoices)) {
    const casePart = invoice.caseNo ? ` (case ${invoice.caseNo})` : "";
    const totals =
      invoice.totalSessions != null
        ? `, ${invoice.totalSessions} sessions` +
          (invoice.totalHours != null ? ` / ${hoursLabel(invoice.totalHours)}` : "") +
          (invoice.totalAmountCents != null ? ` / ${money(invoice.totalAmountCents)}` : "")
        : "";
    lines.push(
      `- ${dayOf(invoice.createdAt)} ${invoice.title} — student ${invoice.studentName}${casePart}, file ${invoice.fileName}${totals}`,
    );
  }
  return lines.join("\n");
}
