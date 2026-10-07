import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { extractGdocId } from "./lib/gdocId";
import { requireAdmin, requireUser } from "./lib/auth";

/** Every month slot on the Docs page, in order — Sep 2025 through Dec 2026. */
export const SCHOOL_YEAR_MONTHS = [
  "September 2025",
  "October 2025",
  "November 2025",
  "December 2025",
  "January 2026",
  "February 2026",
  "March 2026",
  "April 2026",
  "May 2026",
  "June 2026",
  "July 2026",
  "August 2026",
  "September 2026",
  "October 2026",
  "November 2026",
  "December 2026",
] as const;

export type SchoolYearMonth = (typeof SCHOOL_YEAR_MONTHS)[number];

/**
 * Labels used before slots carried a year ("September" meant Sep 2025).
 * Readers normalize through this so old rows display correctly, and
 * `migrateLabels` rewrites them permanently.
 */
export const LEGACY_MONTH_LABELS: Record<string, string> = {
  September: "September 2025",
  October: "October 2025",
  November: "November 2025",
  December: "December 2025",
  January: "January 2026",
  February: "February 2026",
  March: "March 2026",
  April: "April 2026",
  May: "May 2026",
  June: "June 2026",
};

/**
 * The row stored under `label` — also matching rows that still use the
 * legacy plain-month label for that slot.
 */
async function findDoc(
  ctx: MutationCtx,
  label: string,
): Promise<Doc<"gdocs"> | null> {
  const direct = await ctx.db
    .query("gdocs")
    .withIndex("by_label", (q) => q.eq("label", label))
    .unique();
  if (direct) return direct;
  const legacy = Object.entries(LEGACY_MONTH_LABELS).find(
    ([, current]) => current === label,
  )?.[0];
  if (legacy === undefined) return null;
  return await ctx.db
    .query("gdocs")
    .withIndex("by_label", (q) => q.eq("label", legacy))
    .unique();
}

/**
 * Every saved month doc, in school-year order. All signed-in members can
 * read; only admins can change what is on the list.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const docs = await ctx.db.query("gdocs").collect();
    const order = new Map(SCHOOL_YEAR_MONTHS.map((m, i) => [m, i]));
    return docs
      .map((doc) => ({
        _id: doc._id,
        label: LEGACY_MONTH_LABELS[doc.label] ?? doc.label,
        gdocId: doc.gdocId,
        position: doc.position,
        createdAt: doc.createdAt,
      }))
      .sort(
        (a, b) =>
          (order.get(a.label as (typeof SCHOOL_YEAR_MONTHS)[number]) ?? 99) -
            (order.get(b.label as (typeof SCHOOL_YEAR_MONTHS)[number]) ?? 99) ||
          a.label.localeCompare(b.label),
      );
  },
});

/** Save (or replace) one month's doc. Admin only. */
export const set = mutation({
  args: {
    label: v.string(),
    gdocUrl: v.string(),
  },
  handler: async (ctx, { label, gdocUrl }) => {
    const admin = await requireAdmin(ctx);

    const trimmedLabel = label.trim();
    if (!SCHOOL_YEAR_MONTHS.includes(trimmedLabel as SchoolYearMonth)) {
      throw new Error("Pick a month from September 2025 to December 2026.");
    }
    const gdocId = extractGdocId(gdocUrl);
    if (gdocId === "") {
      throw new Error("Paste the Google Doc URL or id.");
    }

    const position = SCHOOL_YEAR_MONTHS.indexOf(trimmedLabel as SchoolYearMonth);

    const existing = await findDoc(ctx, trimmedLabel);

    if (existing) {
      // Also relabels rows still stored under the legacy plain month.
      await ctx.db.patch(existing._id, { label: trimmedLabel, gdocId, position });
      return existing._id;
    }

    return await ctx.db.insert("gdocs", {
      label: trimmedLabel,
      gdocId,
      position,
      createdBy: admin.userId,
      createdAt: Date.now(),
    });
  },
});

/** Remove one month's doc. Admin only. */
export const remove = mutation({
  args: { label: v.string() },
  handler: async (ctx, { label }) => {
    await requireAdmin(ctx);
    const existing = await findDoc(ctx, label);
    if (existing) await ctx.db.delete(existing._id);
  },
});

/**
 * Rename legacy plain-month labels ("September" → "September 2025") so every
 * slot carries its year. Idempotent and content-free, so any signed-in member
 * may run it — the Docs page calls it once on load.
 */
export const migrateLabels = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const docs = await ctx.db.query("gdocs").collect();
    for (const doc of docs) {
      const label = LEGACY_MONTH_LABELS[doc.label];
      if (label === undefined) continue;
      const taken = await ctx.db
        .query("gdocs")
        .withIndex("by_label", (q) => q.eq("label", label))
        .unique();
      if (taken) continue; // a year-qualified row already holds this slot
      await ctx.db.patch(doc._id, { label });
    }
  },
});
