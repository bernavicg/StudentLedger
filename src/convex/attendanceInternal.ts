import { getAuthUserId } from "@convex-dev/auth/server";
import { internalQuery } from "./_generated/server";

/**
 * Gather everything the AI attendance action needs in one read:
 * the signed-in user (for personalizing the answer) plus the full roster
 * and every attendance mark. Internal-only, so it can never be called
 * directly by the client; the public action checks auth before spending
 * AI credits.
 */
export const gatherContext = internalQuery({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return { user: null, students: [], attendance: [] };
    }
    const user = await ctx.db.get(userId);
    const [students, attendance] = await Promise.all([
      ctx.db.query("students").order("desc").collect(),
      ctx.db.query("attendance").collect(),
    ]);
    return {
      user:
        user === null
          ? null
          : { name: user.name ?? user.email ?? "Team member" },
      students,
      attendance,
    };
  },
});
