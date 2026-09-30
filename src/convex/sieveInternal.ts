/**
 * Database layer for sieve scrape runs.
 *
 * Kept apart from sieve.ts for the same reason sheetsInternal.ts is apart from
 * sheets.ts: a Convex module that reaches back into its own public api makes
 * TypeScript infer its handler types circularly (TS7022). sieve.ts calls these
 * through hand-typed function references, so nothing refers to itself.
 */

import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { requireUser } from "./lib/auth";

/** The caller's role, so actions can enforce admin without a ctx.db. */
export const callerRole = internalQuery({
  args: {},
  handler: async (ctx) => {
    const session = await requireUser(ctx);
    return { role: session.role, userId: session.userId };
  },
});

/** One run, for an action that only has a run id. */
export const getRun = internalQuery({
  args: { runId: v.id("scrapes") },
  handler: async (ctx, { runId }) => {
    return await ctx.db.get(runId);
  },
});

/**
 * Insert the run BEFORE the create call goes out. A crash after this point
 * leaves a "starting" row, which is how a restart can tell that a POST may
 * already have been accepted instead of silently starting a second run.
 */
export const createRun = internalMutation({
  args: {
    instruction: v.string(),
    targetUrls: v.optional(v.array(v.string())),
    complianceMode: v.string(),
    createdBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("scrapes", {
      instruction: args.instruction,
      ...(args.targetUrls === undefined ? {} : { targetUrls: args.targetUrls }),
      complianceMode: args.complianceMode,
      status: "starting",
      turnsBefore: 0,
      awaitingTurn: false,
      createdBy: args.createdBy,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** The 202 came back: store the session id immediately, before any polling. */
export const recordSession = internalMutation({
  args: { runId: v.id("scrapes"), sessionId: v.string() },
  handler: async (ctx, { runId, sessionId }) => {
    await ctx.db.patch(runId, {
      sessionId,
      status: "queued",
      updatedAt: Date.now(),
    });
  },
});

/** Fold one poll's outcome into the stored run. */
export const recordPoll = internalMutation({
  args: {
    runId: v.id("scrapes"),
    status: v.string(),
    sessionId: v.optional(v.string()),
    summary: v.optional(v.string()),
    schemaConformance: v.optional(v.string()),
    conformanceNote: v.optional(v.string()),
    result: v.optional(v.string()),
    files: v.optional(
      v.array(
        v.object({
          name: v.string(),
          size: v.optional(v.number()),
          ext: v.optional(v.string()),
          url: v.string(),
        }),
      ),
    ),
    refusalCode: v.optional(v.string()),
    refusalMessage: v.optional(v.string()),
    turns: v.optional(v.number()),
    turnsBefore: v.number(),
    awaitingTurn: v.boolean(),
    lastError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { runId, ...patch } = args;
    // Note: an optional field cannot be cleared by patching it with
    // undefined, so a previous failure is left on the row. The page only
    // surfaces `lastError` while `status` is "error", and a good poll always
    // overwrites the status, so a stale message is never shown.
    await ctx.db.patch(runId, {
      ...patch,
      lastPolledAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

/**
 * Record the turn count BEFORE a follow-up is posted. The next poll only
 * counts as complete once `turns` has advanced past this value, so the UI
 * cannot show the previous answer as if it were the reply.
 */
export const recordTurnStart = internalMutation({
  args: { runId: v.id("scrapes"), turnsBefore: v.number() },
  handler: async (ctx, { runId, turnsBefore }) => {
    await ctx.db.patch(runId, {
      turnsBefore,
      awaitingTurn: true,
      updatedAt: Date.now(),
    });
  },
});

/** Persist a failure so the page can explain it, without losing the run. */
export const markError = internalMutation({
  args: { runId: v.id("scrapes"), error: v.string() },
  handler: async (ctx, { runId, error }) => {
    await ctx.db.patch(runId, {
      status: "error",
      lastError: error,
      updatedAt: Date.now(),
    });
  },
});

export type CallerRole = { role: "admin" | "member" | "user"; userId: Id<"users"> };
