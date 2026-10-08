"use node";

/**
 * Refresh one saved month doc's search index (title + flattened body) from
 * the Google Docs API.
 *
 * This is an action for two reasons: the service-account JWT needs Node's
 * crypto, and actions have no `ctx.db`. The write therefore happens in
 * `internal.gdocs.applySearchIndex`, which is also where the admin check
 * runs — so a non-admin who calls this endpoint can at most trigger a
 * read-only Google fetch; the row is never patched without the role check.
 */

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { fetchDocText } from "./lib/gdocsSearch";

export const reindexDoc = action({
  args: { gdocId: v.string() },
  handler: async (ctx, { gdocId }) => {
    const extracted = await fetchDocText(gdocId);

    await ctx.runMutation(internal.gdocs.applySearchIndex, {
      gdocId,
      title: extracted.title,
      searchText: extracted.searchText,
    });

    return { title: extracted.title };
  },
});
