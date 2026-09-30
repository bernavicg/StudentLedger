/**
 * Google Sheets mirror: status, settings, and the two ways a sync starts.
 *
 * Convex actions have no `ctx.db`, so the work is split across three layers:
 *   - `sheetsInternal.buildPayload` (query) reads the database and shapes the
 *     data into tab rows.
 *   - `sheetsNode.upload` (node action) only does the Google I/O.
 *   - the actions here orchestrate those two and record the outcome.
 */

import { v } from "convex/values";
import { makeFunctionReference, type GenericActionCtx } from "convex/server";
import type { DataModel, Doc } from "./_generated/dataModel";
import {
  action,
  mutation,
  query,
} from "./_generated/server";
import { requireAdmin, requireUser } from "./lib/auth";

/** The single settings row. */
const SETTINGS_KEY = "main";

/*
 * Cross-module calls are declared with `makeFunctionReference` rather than the
 * generated `api` object. That is the supported way to call a sibling module
 * when the generated types are still catching up with a brand new file, and it
 * keeps the argument and return types checked either way.
 */
type SheetRow = (string | number)[];

const appSettingsGet = makeFunctionReference<"query", Record<string, never>, Doc<"appSettings"> | null>(
  "appSettings:get",
);
const appSettingsSave = makeFunctionReference<
  "mutation",
  { targetSheetId?: string; embedSheetId?: string },
  null
>("appSettings:saveSettings");
const appSettingsRecord = makeFunctionReference<
  "mutation",
  {
    fingerprint: string;
    summary?: string;
    sheetId?: string;
    error?: string;
  },
  null
>("appSettings:recordResult");
const currentFingerprintRef = makeFunctionReference<"query", Record<string, never>, string>(
  "sheetsInternal:currentFingerprint",
);
const callerRoleRef = makeFunctionReference<
  "query",
  Record<string, never>,
  { role: "admin" | "member" | "user"; userId: string }
>("sheetsInternal:callerRole");
const buildPayloadRef = makeFunctionReference<
  "query",
  Record<string, never>,
  {
    fingerprint: string;
    students: SheetRow[];
    attendance: SheetRow[];
    ledger: SheetRow[];
    summary: SheetRow[];
  }
>("sheetsInternal:buildPayload");
const uploadRef = makeFunctionReference<
  "action",
  {
    savedSheetId?: string;
    students: SheetRow[];
    attendance: SheetRow[];
    ledger: SheetRow[];
    summary: SheetRow[];
  },
  { summary: string; rows: number; sheetId: string }
>("sheetsNode:upload");

/**
 * Public shape of the mirror's health. Annotated explicitly because the
 * handler calls `api.sheetsInternal.*`, and the generated api type transitively
 * includes this module — without the annotation TypeScript infers the return
 * type circularly (TS7022).
 */
export type SheetStatus = {
  hasCredentials: boolean;
  hasEnvSheetId: boolean;
  sheetId: string | null;
  embedSheetId: string | null;
  lastSyncAt: number | null;
  lastSummary: string | null;
  lastError: string | null;
  /** The spreadsheet the last successful export actually wrote to. */
  lastSyncedSheetId: string | null;
  /** True when the sheet is behind, or the last attempt failed. */
  stale: boolean;
};

/** Whether the deployment has the credentials and a target configured. */
export const status = query({
  args: {},
  handler: async (ctx): Promise<SheetStatus> => {
    // Every signed-in user may see whether the mirror is healthy.
    await requireUser(ctx);

    const settings = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY))
      .unique();
    const fingerprint = await ctx.runQuery(
      currentFingerprintRef,
      {},
    );

    return {
      hasCredentials: (process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "") !== "",
      hasEnvSheetId: (process.env.GOOGLE_SHEET_ID ?? "") !== "",
      sheetId: process.env.GOOGLE_SHEET_ID || settings?.targetSheetId || null,
      embedSheetId:
        process.env.GOOGLE_EMBED_SHEET_ID || settings?.embedSheetId || null,
      lastSyncAt: settings?.lastSyncAt ?? null,
      lastSummary: settings?.lastSummary ?? null,
      lastError: settings?.lastError ?? null,
      lastSyncedSheetId: settings?.lastSyncedSheetId ?? null,
      /** True when the sheet is behind, or the last attempt failed. */
      stale:
        settings?.lastSyncAt === undefined ||
        settings?.lastFingerprint !== fingerprint ||
        settings?.lastError !== undefined,
    };
  },
});

/** Save which spreadsheets to use. Takes effect on the next sync. */
export const saveSettings = mutation({
  args: {
    targetSheetId: v.optional(v.string()),
    embedSheetId: v.optional(v.string()),
  },
  handler: async (ctx, { targetSheetId, embedSheetId }) => {
    await requireAdmin(ctx);
    await ctx.runMutation(appSettingsSave, {
      targetSheetId,
      embedSheetId,
    });
  },
});

/**
 * Reduce a caught error to something worth showing a person.
 *
 * Convex hands back a message that has the whole stack appended to it, which
 * buries the one useful line (Google's own complaint). Keep the first line and
 * drop the "Uncaught Error:" prefix.
 */
function tidyError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const firstLine = raw.split("\n")[0] ?? "";
  return firstLine.replace(/^Uncaught Error:\s*/, "").trim() || "Unknown error";
}

/** Shared body for both sync entry points. */
async function performSync(
  ctx: GenericActionCtx<DataModel>,
): Promise<{ skipped: boolean; message: string }> {
  const settings = await ctx.runQuery(appSettingsGet, {});
  const payload = await ctx.runQuery(buildPayloadRef, {});

  try {
    const result = await ctx.runAction(uploadRef, {
      savedSheetId: settings?.targetSheetId,
      students: payload.students,
      attendance: payload.attendance,
      ledger: payload.ledger,
      summary: payload.summary,
    });
    await ctx.runMutation(appSettingsRecord, {
      fingerprint: payload.fingerprint,
      summary: result.summary,
      sheetId: result.sheetId,
    });
    return { skipped: false, message: result.summary };
  } catch (error) {
    // Persist the failure so the UI can explain what went wrong instead of
    // silently staying stale forever.
    const message = tidyError(error);
    await ctx.runMutation(appSettingsRecord, {
      fingerprint: payload.fingerprint,
      sheetId: settings?.targetSheetId,
      error: message,
    });
    throw new Error(message);
  }
}

/** Run the export now. Admin only. */
export const syncNow = action({
  args: {},
  handler: async (ctx) => {
    const caller = await ctx.runQuery(callerRoleRef, {});
    if (caller.role !== "admin") throw new Error("Only admins can sync.");
    return await performSync(ctx);
  },
});

/**
 * The automatic sync. Skips entirely when the data has not changed since the
 * last successful export, so a quiet day costs one cheap read and no Google
 * API calls.
 *
 * Called by the app when an admin opens it (see useSheetsAutoSync), which
 * stands in for a server cron. The role check is the same as the manual path —
 * only an admin can spend Google API quota.
 */
export const syncIfStale = action({
  args: {},
  handler: async (ctx) => {
    const caller = await ctx.runQuery(callerRoleRef, {});
    if (caller.role !== "admin") throw new Error("Only admins can sync.");

    const settings = await ctx.runQuery(appSettingsGet, {});
    const fingerprint = await ctx.runQuery(currentFingerprintRef, {});

    if (
      settings?.lastFingerprint === fingerprint &&
      settings?.lastError === undefined
    ) {
      return { skipped: true as const, message: "Nothing changed." };
    }

    const result = await performSync(ctx);
    return { skipped: false as const, message: result.message };
  },
});
