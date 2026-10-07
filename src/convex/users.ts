import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { roleValidator } from "./schema";

/**
 * Get the current signed in user. Returns null if the user is not signed in.
 * Usage: const signedInUser = await ctx.runQuery(api.users.currentUser);
 * THIS FUNCTION IS READ-ONLY. DO NOT MODIFY.
 */
export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    return await ctx.db.get(userId);
  },
});

/** Returns true when the signed-in user has the admin role. */
export const isCurrentUserAdmin = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return false;
    const user = await ctx.db.get(userId);
    return user?.role === "admin";
  },
});

/**
 * Whether any account currently holds the admin role. Public to signed-in
 * users so the first account can be offered the one-time claim.
 */
export const adminExists = query({
  args: {},
  handler: async (ctx) => {
    const admin = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "admin"))
      .first();
    return admin !== null;
  },
});

/**
 * One-time bootstrap: the very first person to sign up claims the admin
 * role. Returns "claimed" for the taker, "taken" once an admin exists.
 */
export const claimAdmin = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to continue.");
    const user = await ctx.db.get(userId);
    if (user === null) throw new Error("Account not found.");

    const existingAdmin = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "admin"))
      .first();
    if (existingAdmin !== null) return "taken";

    await ctx.db.patch(userId, { role: "admin" });
    return "claimed";
  },
});

/**
 * Full team roster for the admin area. Returns null for non-admins so the
 * roster never leaks outside the admin area.
 */
export const listTeam = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const user = await ctx.db.get(userId);
    if (user?.role !== "admin") return null;
    return await ctx.db.query("users").collect();
  },
});

/** Admins set anyone's role; the last admin can't demote themselves. */
export const setUserRole = mutation({
  args: { userId: v.id("users"), role: roleValidator },
  handler: async (ctx, { userId, role }) => {
    const adminId = await getAuthUserId(ctx);
    if (adminId === null) throw new Error("Sign in to continue.");
    const admin = await ctx.db.get(adminId);
    if (admin?.role !== "admin") {
      throw new Error("Only admins can change roles.");
    }
    if (userId === adminId && role !== "admin") {
      throw new Error("You can't demote your own admin account.");
    }
    await ctx.db.patch(userId, { role });
  },
});

/**
 * Soft-removes a member: their sessions are revoked so they're signed out
 * and can't start a new one, while their filed entries and comments stay on
 * the record.
 */
export const removeFromTeam = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const adminId = await getAuthUserId(ctx);
    if (adminId === null) throw new Error("Sign in to continue.");
    const admin = await ctx.db.get(adminId);
    if (admin?.role !== "admin") {
      throw new Error("Only admins can remove members.");
    }
    if (userId === adminId) {
      throw new Error("You can't remove your own account.");
    }

    // Revoke every active session. A fresh email-OTP sign-in would create a
    // new account row for the same email, so also mark the account removed.
    for (const session of await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .collect()) {
      await ctx.db.delete(session._id);
    }

    await ctx.db.patch(userId, { isAnonymous: true });
  },
});

// User settings: get/set per-user preferences.
export const getSettings = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const caller = await getAuthUserId(ctx);
    if (caller === null) throw new Error("Sign in to continue.");
    if (caller !== userId) throw new Error("Not allowed.");
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found");
    return {
      timezone: user.timezone ?? "",
    };
  },
});

export const setTimezone = mutation({
  args: { userId: v.id("users"), timezone: v.string() },
  handler: async (ctx, { userId, timezone }) => {
    const caller = await getAuthUserId(ctx);
    if (caller === null) throw new Error("Sign in to continue.");
    if (caller !== userId) throw new Error("You can only change your own settings.");
    await ctx.db.patch(userId, { timezone });
  },
});