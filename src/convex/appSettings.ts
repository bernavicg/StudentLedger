/**
 * Internal helpers around the single `appSettings` row. Kept separate from
 * the public sheets.ts surface so the sync paths can read and write sync
 * bookkeeping without exposing it as an API.
 *
 * The document shape is built by the pure helpers in lib/settingsRow.ts, so
 * the "replace to clear a field" rules live in one tested place.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { buildRecordedRow, buildSavedRow } from "./lib/settingsRow";

const SETTINGS_KEY = "main";

/** The settings row, or null if the app has never synced. */
export const get = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY))
      .unique();
  },
});

/**
 * Record the outcome of a sync. Always stamps `lastSyncAt`, even on failure,
 * so the UI can show "last attempt" honestly; a failure drops the stored
 * summary and leaves `lastError` set, which keeps `stale` true so the next
 * run retries.
 */
export const recordResult = internalMutation({
  args: {
    fingerprint: v.string(),
    summary: v.optional(v.string()),
    sheetId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { fingerprint, summary, sheetId, error }) => {
    const existing = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY))
      .unique();

    const row = buildRecordedRow(
      existing,
      { fingerprint, summary, sheetId, error },
      Date.now(),
    );

    if (existing === null) {
      await ctx.db.insert("appSettings", row);
    } else {
      await ctx.db.replace(existing._id, row);
    }
  },
});

/** Save which spreadsheets to use. Blank fields clear the saved override. */
export const saveSettings = internalMutation({
  args: {
    targetSheetId: v.optional(v.string()),
    embedSheetId: v.optional(v.string()),
  },
  handler: async (ctx, { targetSheetId, embedSheetId }) => {
    const existing = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY))
      .unique();

    const row = buildSavedRow(existing, { targetSheetId, embedSheetId });

    if (existing === null) {
      await ctx.db.insert("appSettings", row);
    } else {
      await ctx.db.replace(existing._id, row);
    }
  },
});
