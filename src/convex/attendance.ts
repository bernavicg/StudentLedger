"use node";

/**
 * AI Attendance Assistant ("AI Agent" page).
 *
 * A signed-in member asks a question about attendance ("Asa si Rina?" /
 * "How many sessions does Marco have left?"); the action gathers the real
 * roster + attendance data from the database, builds a compact context, and
 * asks the FreeBuff AI gateway (vly.ai.completion) to answer using ONLY that
 * data. The model never invents numbers: anything numeric comes from the
 * context built here.
 *
 * The node runtime is required because @vly-ai/integrations pulls the Vercel
 * AI SDK. Actions have no ctx.db, so the data comes from an internal query
 * (attendanceInternal) — the same split other node actions in this codebase
 * use. All logic that touches the data is unit-tested in
 * src/convex/lib/attendanceContext.ts and stays isolate-safe.
 */

import { vly } from "../lib/vly-integrations";
import { v } from "convex/values";
import { internalQueryReference } from "./lib/functionRefs";
import {
  buildAttendanceContext,
  contextToPrompt,
  focusNoteFor,
} from "./lib/attendanceContext";
import { action } from "./_generated/server";

const gatherContextRef = internalQueryReference<
  Record<string, never>,
  {
    user: { name: string } | null;
    students: {
      _id: string;
      name: string;
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
  }
>("attendanceInternal:gatherContext");

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
    if (contextData.user === null) {
      return { success: false as const, error: "Sign in to continue." };
    }

    // Real data only: roster + every attendance mark, summarized the same
    // way the Students page computes them. With a student focus the context
    // narrows to that one student so answers are about them.
    const focusName = studentId
      ? (contextData.students.find((s) => s._id === studentId)?.name ?? null)
      : null;
    const context = buildAttendanceContext(
      studentId
        ? contextData.students.filter((s) => s._id === studentId)
        : contextData.students,
      studentId
        ? contextData.attendance.filter((a) => a.studentId === studentId)
        : contextData.attendance,
    );
    const contextText = [
      focusNoteFor(focusName),
      contextToPrompt(context),
    ]
      .filter((part) => part !== null)
      .join("\n\n");

    const systemPrompt = [
      "You are the Ledger AI Attendance Assistant for a tutoring program.",
      "Answer questions about student attendance using ONLY the data below.",
      "Numbers (sessions used, remaining, hours) must come straight from the data — never invent or extrapolate.",
      "If the data does not contain the answer, say so plainly.",
      "The person asking is a signed-in team member named "
        + contextData.user.name
        + "; answer them directly.",
      "Be concise and friendly; a short summary line plus a compact list beats long prose.",
      "Dates are YYYY-MM-DD.",
      "",
      "=== ATTENDANCE DATA ===",
      contextText,
    ].join("\n");

    const completion = await vly.ai.completion({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: trimmed },
      ],
      temperature: 0.3,
      maxTokens: 500,
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
