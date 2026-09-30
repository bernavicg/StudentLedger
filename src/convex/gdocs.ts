import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { extractGdocId } from "./lib/gdocId";
import { requireAdmin, requireUser } from "./lib/auth";

/** The school-year months, in order — Sep 2025 through Jun 2026. */
export const SCHOOL_YEAR_MONTHS = [
  "September",
  "October",
  "November",
  "December",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
] as const;

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
        label: doc.label,
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
    if (
      !SCHOOL_YEAR_MONTHS.includes(
        trimmedLabel as (typeof SCHOOL_YEAR_MONTHS)[number],
      )
    ) {
      throw new Error("Pick a month from September to June.");
    }
    const gdocId = extractGdocId(gdocUrl);
    if (gdocId === "") {
      throw new Error("Paste the Google Doc URL or id.");
    }

    const existing = await ctx.db
      .query("gdocs")
      .withIndex("by_label", (q) => q.eq("label", trimmedLabel))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { gdocId });
      return existing._id;
    }

    const position = SCHOOL_YEAR_MONTHS.indexOf(
      trimmedLabel as (typeof SCHOOL_YEAR_MONTHS)[number],
    );
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
    const existing = await ctx.db
      .query("gdocs")
      .withIndex("by_label", (q) => q.eq("label", label))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});
