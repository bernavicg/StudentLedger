import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * Minimal structural view of a Convex context, narrowed to what the auth
 * helpers need. Narrowing keeps these usable from queries and actions
 * without each file re-declaring the same shape.
 */
export type AuthedCtx = {
  db: {
    get: (id: Id<"users">) => Promise<Doc<"users"> | null>;
  };
  auth: unknown;
};

export type SessionUser = {
  userId: Id<"users">;
  role: "admin" | "member" | "user";
  name: string;
  email: string;
};

/** Any signed-in user, with their role resolved (missing role = "user"). */
export async function requireUser(ctx: AuthedCtx): Promise<SessionUser> {
  const userId = await getAuthUserId(ctx as never);
  if (userId === null) throw new Error("Sign in to continue.");
  const user = await ctx.db.get(userId);
  if (user === null) throw new Error("Account not found.");
  return {
    userId,
    role: user.role ?? "user",
    name: user.name ?? user.email ?? "Unknown",
    email: user.email ?? "",
  };
}

/** Signed-in user who must be an admin. */
export async function requireAdmin(ctx: AuthedCtx): Promise<SessionUser> {
  const session = await requireUser(ctx);
  if (session.role !== "admin") {
    throw new Error("Only admins can do that.");
  }
  return session;
}
