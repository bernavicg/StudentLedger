import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";

/** Minimal structural view of a Convex context for auth lookups. */
type AuthedCtx = {
  db: {
    get: (id: Id<"users">) => Promise<Doc<"users"> | null>;
  };
  auth: unknown;
};

async function requireUser(ctx: AuthedCtx) {
  const userId = await getAuthUserId(ctx as never);
  if (userId === null) throw new Error("Sign in to continue.");
  const user = await ctx.db.get(userId);
  if (user === null) throw new Error("Account not found.");
  return { userId, role: user.role ?? "user" };
}

/** Roster of service providers, alphabetical. All signed-in members can view. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);

    const providers = await ctx.db.query("providers").collect();
    return providers
      .map((provider) => ({
        _id: provider._id,
        name: provider.name,
        contact: provider.contact ?? null,
        ssid: provider.ssid ?? null,
        notes: provider.notes ?? null,
        createdAt: provider.createdAt,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

/**
 * Account numbers are stored trimmed with inner whitespace collapsed. Account
 * numbers are often copied or retyped, which introduces stray spaces, and a
 * blank entry is stored as "no account number".
 */
function normalizeSsid(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned === "" ? undefined : cleaned;
}

/** Enroll a new provider. Name must be unique. */
export const create = mutation({
  args: {
    name: v.string(),
    contact: v.optional(v.string()),
    ssid: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { name, contact, ssid, notes }) => {
    const { userId } = await requireUser(ctx);
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Give the provider a name.");

    const duplicate = await ctx.db
      .query("providers")
      .filter((q) => q.eq(q.field("name"), trimmed))
      .first();
    if (duplicate !== null) {
      throw new Error(`A provider named "${trimmed}" already exists.`);
    }

    const now = Date.now();
    return await ctx.db.insert("providers", {
      name: trimmed,
      contact: contact?.trim() || undefined,
      ssid: normalizeSsid(ssid),
      notes: notes?.trim() || undefined,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Edit provider details. Admins only. */
export const update = mutation({
  args: {
    providerId: v.id("providers"),
    name: v.string(),
    contact: v.optional(v.string()),
    ssid: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { providerId, name, contact, ssid, notes }) => {
    const { role } = await requireUser(ctx);
    if (role !== "admin") {
      throw new Error("Only admins can edit providers.");
    }
    const provider = await ctx.db.get(providerId);
    if (provider === null) throw new Error("Provider not found.");

    const trimmed = name.trim();
    if (!trimmed) throw new Error("Give the provider a name.");
    if (trimmed !== provider.name) {
      const duplicate = await ctx.db
        .query("providers")
        .filter((q) => q.eq(q.field("name"), trimmed))
        .first();
      if (duplicate !== null) {
        throw new Error(`A provider named "${trimmed}" already exists.`);
      }
    }

    await ctx.db.patch(providerId, {
      name: trimmed,
      contact: contact?.trim() || undefined,
      ssid: normalizeSsid(ssid),
      notes: notes?.trim() || undefined,
      updatedAt: Date.now(),
    });
  },
});

/** Delete a provider (admins only). Ledger entries keep the name as history. */
export const remove = mutation({
  args: { providerId: v.id("providers") },
  handler: async (ctx, { providerId }) => {
    const { role } = await requireUser(ctx);
    if (role !== "admin") {
      throw new Error("Only admins can delete providers.");
    }
    const provider = await ctx.db.get(providerId);
    if (provider === null) throw new Error("Provider not found.");
    await ctx.db.delete(providerId);
  },
});
