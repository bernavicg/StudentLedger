/**
 * Sieve scrape API — the app-facing surface.
 *
 * Three layers, the same split the Google Sheets mirror uses:
 *   - lib/sieve.ts      pure request building, classification and polling logic
 *   - sieveNode.ts      the only network I/O ("use node")
 *   - this file         orchestration + persistence
 *
 * Convex actions have no `ctx.db`, so the database work happens in
 * sieveInternal.ts through hand-typed function references. That also avoids
 * the TS7022 self-reference trap.
 *
 * Everything here is admin-only: a run spends credits and the API key has full
 * account access. When SIEVE_API_KEY is unset nothing is called and the rest of
 * the app behaves exactly as before.
 */

import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { action, query } from "./_generated/server";
import {
  buildScrapeBody,
  decidePoll,
  isCleanResult,
  schemaConformanceNote,
  type CreditsInfo,
  type NormalizedRun,
  type ScrapeBody,
  type SieveOutcome,
} from "./lib/sieve";

type RunDoc = Doc<"scrapes">;
type CallerRole = { role: "admin" | "member" | "user"; userId: Id<"users"> };

/**
 * Non-throwing admin check for queries. Convex queries that throw crash the
 * whole page render on the client (the query result surfaces as a hard error
 * in useQuery), so every read here returns a safe empty value instead —
 * the same convention as users.listTeam in this codebase.
 */
async function isAdminUser(ctx: QueryCtx): Promise<boolean> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return false;
  const user = await ctx.db.get(userId);
  return user?.role === "admin";
}

const callerRoleRef = makeFunctionReference<"query", Record<string, never>, CallerRole>(
  "sieveInternal:callerRole",
);
const getRunRef = makeFunctionReference<
  "query",
  { runId: Id<"scrapes"> },
  RunDoc | null
>("sieveInternal:getRun");
const createRunRef = makeFunctionReference<
  "mutation",
  {
    instruction: string;
    targetUrls?: string[];
    complianceMode: string;
    createdBy: Id<"users">;
  },
  Id<"scrapes">
>("sieveInternal:createRun");
const recordSessionRef = makeFunctionReference<
  "mutation",
  { runId: Id<"scrapes">; sessionId: string },
  null
>("sieveInternal:recordSession");
const recordTurnStartRef = makeFunctionReference<
  "mutation",
  { runId: Id<"scrapes">; turnsBefore: number },
  null
>("sieveInternal:recordTurnStart");
const markErrorRef = makeFunctionReference<
  "mutation",
  { runId: Id<"scrapes">; error: string },
  null
>("sieveInternal:markError");

type PollPatch = {
  status: string;
  sessionId?: string;
  summary?: string;
  schemaConformance?: string;
  conformanceNote?: string;
  result?: string;
  files?: { name: string; size?: number; ext?: string; url: string }[];
  refusalCode?: string;
  refusalMessage?: string;
  turns?: number;
  turnsBefore: number;
  awaitingTurn: boolean;
  lastError?: string;
};
const recordPollRef = makeFunctionReference<
  "mutation",
  { runId: Id<"scrapes"> } & PollPatch,
  null
>("sieveInternal:recordPoll");

const nodeStartRef = makeFunctionReference<
  "action",
  { body: ScrapeBody },
  SieveOutcome<{ sessionId: string; status: string }>
>("sieveNode:startRun");
const nodePollRef = makeFunctionReference<
  "action",
  { sessionId: string },
  SieveOutcome<NormalizedRun>
>("sieveNode:pollRun");
const nodeMessageRef = makeFunctionReference<
  "action",
  { sessionId: string; body: ScrapeBody },
  SieveOutcome<{ status: string }>
>("sieveNode:sendMessage");
const nodeCreditsRef = makeFunctionReference<
  "action",
  Record<string, never>,
  SieveOutcome<CreditsInfo>
>("sieveNode:getCredits");
const nodeFileRef = makeFunctionReference<
  "action",
  { url: string },
  SieveOutcome<{ contentType: string; text: string }>
>("sieveNode:downloadFile");

/** The scrape form's inputs, shared by the start and follow-up actions. */
const scrapeArgs = {
  instruction: v.string(),
  targetUrls: v.optional(v.array(v.string())),
  fields: v.optional(v.array(v.string())),
  schema: v.optional(v.any()),
  outputSchema: v.optional(v.any()),
  tableShape: v.optional(v.union(v.literal("long"), v.literal("wide"))),
  complianceMode: v.optional(
    v.union(v.literal("conservative"), v.literal("regular"), v.literal("yolo")),
  ),
};

/** What the page reads for one run. `result` is fetched separately. */
export type ScrapeRunSummary = {
  _id: Id<"scrapes">;
  instruction: string;
  status: string;
  sessionId: string | null;
  summary: string | null;
  schemaConformance: string | null;
  conformanceNote: string | null;
  refusalCode: string | null;
  refusalMessage: string | null;
  files: { name: string; size?: number; ext?: string; url: string }[];
  turns: number | null;
  awaitingTurn: boolean;
  hasResult: boolean;
  clean: boolean;
  lastError: string | null;
  createdAt: number;
  lastPolledAt: number | null;
};

function toSummary(row: RunDoc): ScrapeRunSummary {
  const conformance =
    row.schemaConformance === undefined
      ? undefined
      : { status: row.schemaConformance };
  return {
    _id: row._id,
    instruction: row.instruction,
    status: row.status,
    sessionId: row.sessionId ?? null,
    summary: row.summary ?? null,
    schemaConformance: row.schemaConformance ?? null,
    conformanceNote: row.conformanceNote ?? null,
    refusalCode: row.refusalCode ?? null,
    refusalMessage: row.refusalMessage ?? null,
    files: row.files ?? [],
    turns: row.turns ?? null,
    awaitingTurn: row.awaitingTurn,
    hasResult: row.result !== undefined,
    clean: isCleanResult(conformance),
    lastError: row.lastError ?? null,
    createdAt: row.createdAt,
    lastPolledAt: row.lastPolledAt ?? null,
  };
}

/** Whether the deployment has a key. False means sieve is simply switched off. */
export const config = query({
  args: {},
  handler: async (ctx): Promise<{ configured: boolean }> => {
    if (!(await isAdminUser(ctx))) return { configured: false };
    return {
      configured: (process.env.SIEVE_API_KEY ?? "").trim() !== "",
    };
  },
});

/** Recent runs, newest first. Deliberately without the result payload. */
export const runs = query({
  args: {},
  handler: async (ctx): Promise<ScrapeRunSummary[]> => {
    if (!(await isAdminUser(ctx))) return [];
    const rows = await ctx.db
      .query("scrapes")
      .withIndex("by_creation_time")
      .order("desc")
      .take(25);
    return rows.map(toSummary);
  },
});

/** One run with its validated result, for the "view result" panel. */
export const detail = query({
  args: { runId: v.id("scrapes") },
  handler: async (ctx, { runId }) => {
    if (!(await isAdminUser(ctx))) return null;
    const row = await ctx.db.get(runId);
    if (row === null) return null;
    return { ...toSummary(row), result: row.result ?? null };
  },
});

/**
 * Start a run.
 *
 * The row is inserted BEFORE the POST, and the session id is persisted as the
 * very next step, so a crash between the two is visible and the poll loop can
 * resume rather than start a duplicate. The POST itself is never retried by
 * this action after a timeout (see sieveNode).
 */
export const start = action({
  args: scrapeArgs,
  handler: async (ctx, args) => {
    const caller = await ctx.runQuery(callerRoleRef, {});
    if (caller.role !== "admin") throw new Error("Only admins can start a scrape.");

    // Validate and shape before anything is written.
    const body = buildScrapeBody(args);

    const runId = await ctx.runMutation(createRunRef, {
      instruction: body.instruction,
      ...(body.target_urls === undefined ? {} : { targetUrls: body.target_urls }),
      complianceMode: body.compliance_mode,
      createdBy: caller.userId,
    });

    const outcome = await ctx.runAction(nodeStartRef, { body });
    if (!outcome.ok) {
      await ctx.runMutation(markErrorRef, { runId, error: outcome.message });
      throw new Error(outcome.message);
    }

    // Persist the session id straight away, before anything else.
    await ctx.runMutation(recordSessionRef, {
      runId,
      sessionId: outcome.data.sessionId,
    });

    return { runId, sessionId: outcome.data.sessionId };
  },
});

/**
 * One poll. The page drives the loop (the platform rejects cron references),
 * so this does a single GET and folds the outcome into the run.
 */
export const poll = action({
  args: { runId: v.id("scrapes") },
  handler: async (ctx, { runId }) => {
    const caller = await ctx.runQuery(callerRoleRef, {});
    if (caller.role !== "admin") throw new Error("Only admins can poll a scrape.");

    const run = await ctx.runQuery(getRunRef, { runId });
    if (run === null) throw new Error("Unknown scrape run.");
    if (run.sessionId === undefined) {
      throw new Error("That run never got a session id; start a new one.");
    }

    const outcome = await ctx.runAction(nodePollRef, { sessionId: run.sessionId });
    if (!outcome.ok) {
      await ctx.runMutation(markErrorRef, { runId, error: outcome.message });
      throw new Error(outcome.message);
    }

    const patch = buildPollPatch(run, outcome.data);
    await ctx.runMutation(recordPollRef, patch);
    return toSummary({ ...run, ...patch });
  },
});

/** Translate a polled run into the database patch, including turn bookkeeping. */
function buildPollPatch(run: RunDoc, parsed: NormalizedRun): { runId: Id<"scrapes"> } & PollPatch {
  const decision = decidePoll({
    state: parsed.state,
    turns: parsed.turns,
    turnsBefore: run.awaitingTurn ? run.turnsBefore : undefined,
  });
  const stillAwaiting = run.awaitingTurn && decision.action === "keep_polling";
  const conformance =
    parsed.schemaConformance === undefined
      ? undefined
      : {
          status: parsed.schemaConformance.status,
          message: parsed.schemaConformance.message,
        };

  return {
    runId: run._id,
    status: parsed.state,
    ...(parsed.sessionId === undefined ? {} : { sessionId: parsed.sessionId }),
    ...(parsed.summary === undefined ? {} : { summary: parsed.summary }),
    ...(parsed.schemaConformance === undefined
      ? {}
      : { schemaConformance: parsed.schemaConformance.status }),
    ...(conformance === undefined
      ? {}
      : { conformanceNote: schemaConformanceNote(conformance) }),
    ...(parsed.hasResult ? { result: JSON.stringify(parsed.result) } : {}),
    ...(parsed.files.length === 0 ? {} : { files: parsed.files }),
    ...(parsed.refusal?.code === undefined
      ? {}
      : { refusalCode: parsed.refusal.code }),
    ...(parsed.refusal?.message === undefined
      ? {}
      : { refusalMessage: parsed.refusal.message }),
    ...(parsed.turns === undefined ? {} : { turns: parsed.turns }),
    turnsBefore: stillAwaiting ? run.turnsBefore : parsed.turns ?? 0,
    awaitingTurn: stillAwaiting,
    ...(parsed.state === "error"
      ? { lastError: `Unexpected run status from sieve: "${parsed.rawStatus}"` }
      : {}),
  };
}

/**
 * Send a follow-up turn. The turn count is recorded BEFORE the message goes
 * out, so the poll loop can require it to advance rather than serving the
 * previous answer.
 */
export const followUp = action({
  args: { runId: v.id("scrapes"), ...scrapeArgs },
  handler: async (ctx, { runId, ...args }) => {
    const caller = await ctx.runQuery(callerRoleRef, {});
    if (caller.role !== "admin") {
      throw new Error("Only admins can send a follow-up.");
    }

    const run = await ctx.runQuery(getRunRef, { runId });
    if (run === null) throw new Error("Unknown scrape run.");
    if (run.sessionId === undefined) throw new Error("That run has no session id.");
    if (run.status !== "done") {
      throw new Error("Wait for the run to finish before sending a follow-up.");
    }

    const body = buildScrapeBody(args);
    // Record first, then send: the poll loop compares against this count.
    await ctx.runMutation(recordTurnStartRef, {
      runId,
      turnsBefore: run.turns ?? 0,
    });

    const outcome = await ctx.runAction(nodeMessageRef, {
      sessionId: run.sessionId,
      body,
    });
    if (!outcome.ok) {
      await ctx.runMutation(markErrorRef, { runId, error: outcome.message });
      throw new Error(outcome.message);
    }
    return { turnsBefore: run.turns ?? 0 };
  },
});

/** Plan and credit usage, straight from sieve. */
export const credits = action({
  args: {},
  handler: async (ctx) => {
    const caller = await ctx.runQuery(callerRoleRef, {});
    if (caller.role !== "admin") throw new Error("Only admins can read credits.");
    const outcome = await ctx.runAction(nodeCreditsRef, {});
    if (!outcome.ok) throw new Error(outcome.message);
    return outcome.data;
  },
});

/**
 * Download a delivered file. The relative url must be one this run actually
 * reported, which keeps the route from being usable as an SSRF proxy.
 */
export const fetchFile = action({
  args: { runId: v.id("scrapes"), url: v.string() },
  handler: async (ctx, { runId, url }) => {
    const caller = await ctx.runQuery(callerRoleRef, {});
    if (caller.role !== "admin") throw new Error("Only admins can download files.");

    const run = await ctx.runQuery(getRunRef, { runId });
    if (run === null) throw new Error("Unknown scrape run.");
    const allowed = (run.files ?? []).some((file) => file.url === url);
    if (!allowed) {
      throw new Error("That file does not belong to this run.");
    }

    const outcome = await ctx.runAction(nodeFileRef, { url });
    if (!outcome.ok) throw new Error(outcome.message);
    return outcome.data;
  },
});
