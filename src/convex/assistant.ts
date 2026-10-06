"use node";

/**
 * AI Assistant ("AI Agent" page).
 *
 * A signed-in member asks a question about anything in the app — students,
 * attendance, ledger entries, the task board, or paper invoices ("Asa si
 * Rina?", "Unsa nga tasks ang overdue?", "Pila na nga invoice ni Marco?").
 * The action gathers the real data from the database, builds a compact
 * context, and asks the FreeBuff AI gateway (vly.ai.completion) to answer
 * using ONLY that data. The model never invents numbers: anything numeric
 * comes from the context built here.
 *
 * The node runtime is required because @vly-ai/integrations pulls the Vercel
 * AI SDK. Actions have no ctx.db, so the data comes from an internal query
 * (assistantInternal) — the same split other node actions in this codebase
 * use. All logic that touches the data is unit-tested in
 * src/convex/lib/assistantContext.ts and stays isolate-safe.
 */

import { vly } from "../lib/vly-integrations";
import { v } from "convex/values";
import { internalQueryReference } from "./lib/functionRefs";
import {
  buildAttendanceContext,
  contextToPrompt,
  focusNoteFor,
  studentLabelFor,
  summarizeEntries,
  summarizeInvoices,
  summarizeTasks,
  type EntryRow,
  type EntryStats,
  type InvoiceRow,
  type TaskRow,
} from "./lib/assistantContext";
import { action } from "./_generated/server";

const gatherContextRef = internalQueryReference<
  Record<string, never>,
  {
    user: { name: string } | null;
    students: {
      _id: string;
      name: string;
      caseNo?: string | null;
      totalSessions: number;
      ratePerSessionCents?: number | null;
      authorizedMinutes?: number | null;
    }[];
    attendance: {
      studentId: string;
      day: string;
      startTime?: string | null;
      durationMinutes?: number | null;
      sessionsConsumed?: number | null;
      reviewStatus?: "pending" | "approved" | "rejected" | null;
      reviewNote?: string | null;
    }[];
    entries: EntryRow[];
    entryStats: EntryStats | null;
    tasks: TaskRow[];
    invoices: InvoiceRow[];
  }
>("assistantInternal:gatherContext");

export const ask = action({
  args: {
    question: v.string(),
    // Optional student focus: the context narrows to this student's history.
    studentId: v.optional(v.string()),
  },
  handler: async (ctx, { question, studentId }) => {
    const trimmed = question.trim().slice(0, 500);
    if (trimmed.length === 0) {
      return { success: false as const, error: "Type a question first." };
    }

    // The gateway rejects empty bearer tokens with confusing errors, so
    // report the missing setup clearly instead.
    if (!process.env.VLY_INTEGRATION_KEY) {
      return {
        success: false as const,
        error:
          "AI is not configured yet: the VLY_INTEGRATION_KEY environment variable is missing on the Convex deployment. Set it with `convex env set VLY_INTEGRATION_KEY sk_...` (the key lives in the FreeBuff dashboard) and try again.",
      };
    }

    const contextData = await ctx.runQuery(gatherContextRef, {});
    if (contextData.user === null || contextData.entryStats === null) {
      return { success: false as const, error: "Sign in to continue." };
    }

    // Real data only: the roster (with case numbers), every attendance mark,
    // the newest entries, the task board, and the paper invoices. With a
    // student focus the student/attendance context narrows to that student.
    const focusedStudents = studentId
      ? contextData.students.filter((s) => s._id === studentId)
      : contextData.students;
    const focusedAttendance = studentId
      ? contextData.attendance.filter((a) => a.studentId === studentId)
      : contextData.attendance;
    const focusName = studentId
      ? (contextData.students.find((s) => s._id === studentId)?.name ?? null)
      : null;

    const attendanceContext = buildAttendanceContext(
      focusedStudents.map((student) => ({
        ...student,
        // The case number rides along wherever the student is named.
        name: studentLabelFor(student),
      })),
      focusedAttendance,
    );

    const sections = [
      "=== STUDENTS & ATTENDANCE ===",
      contextToPrompt(attendanceContext),
      "=== ENTRIES (LEDGER) ===",
      summarizeEntries(contextData.entryStats, contextData.entries),
      "=== TASKS ===",
      summarizeTasks(contextData.tasks),
      "=== PAPER INVOICES ===",
      summarizeInvoices(contextData.invoices),
    ];

    const focusNote = focusNoteFor(focusName);
    const systemPrompt = [
      "You are the Ledger AI Assistant for a tutoring program team.",
      "Answer questions about students, attendance, ledger entries (money), the task board, and paper invoices using ONLY the data below.",
      "Numbers (sessions, amounts, counts) must come straight from the data — never invent or extrapolate.",
      "If the data does not contain the answer, say so plainly.",
      "The person asking is a signed-in team member named "
        + contextData.user.name
        + "; answer them directly.",
      "Be concise and friendly; a short summary line plus a compact list beats long prose.",
      "Dates are YYYY-MM-DD; amounts are US dollars; students may carry a case number like (case CASE-2026-014).",
      ...(focusNote === null ? [] : [focusNote]),
      "",
      ...sections,
    ].join("\n");

    const completion = await vly.ai.completion({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: trimmed },
      ],
      temperature: 0.3,
      maxTokens: 700,
    });

    if (!completion.success || !completion.data) {
      return {
        success: false as const,
        error: completion.error || "The AI gateway returned no answer.",
      };
    }

    const answer = completion.data.choices?.[0]?.message?.content;
    if (!answer) {
      return {
        success: false as const,
        error: "The AI gateway returned an empty answer.",
      };
    }

    return { success: true as const, answer };
  },
});
