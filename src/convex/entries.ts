import { getAuthUserId } from "@convex-dev/auth/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";

type EntryStatus = "pending" | "approved" | "rejected";

/**
 * Which transitions each role may perform.
 * Members move their own entries between pending and rejected (they can
 * withdraw and re-open a request). Only admins approve or reject.
 */
const ALLOWED_TRANSITIONS: Record<string, readonly EntryStatus[]> = {
  member: ["pending", "rejected"],
  user: ["pending", "rejected"],
  admin: ["pending", "approved", "rejected"],
};

const statusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("rejected"),
);

/** Minimal structural view of a Convex context, narrowed to user lookups. */
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

/** Non-admins may only read entries they created. Admins read everything. */
export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const { userId } = await requireUser(ctx);

    /* Everyone reads the whole ledger so a member can see where each entry
       stands. Acting on one (approve/reject/settle) stays admin-only. */
    const page = await ctx.db
      .query("entries")
      .withIndex("by_creation_time")
      .order("desc")
      .paginate(paginationOpts);

    const authorIds = Array.from(
      new Set(page.page.map((entry) => entry.createdBy)),
    ) as Id<"users">[];
    const authors = await Promise.all(authorIds.map((id) => ctx.db.get(id)));

    // Resolve linked students for this page (used by the dashboard rows).
    const studentIds = page.page
      .map((entry) => entry.studentId)
      .filter((id): id is Id<"students"> => id !== undefined);
    const studentNames = new Map<string, string>();
    await Promise.all(
      Array.from(new Set(studentIds)).map(async (id) => {
        const student = await ctx.db.get(id);
        if (student !== null) studentNames.set(id, student.name);
      }),
    );

    return {
      ...page,
      page: page.page.map((entry) => {
        const author = authors.find(
          (a): a is Doc<"users"> => a !== null && a._id === entry.createdBy,
        );
        return {
          ...entry,
          authorName: author?.name ?? author?.email ?? "Unknown",
          mine: entry.createdBy === userId,
          studentName: entry.studentId
            ? studentNames.get(entry.studentId) ?? "Unknown student"
            : undefined,
        };
      }),
    };
  },
});

/** Server-computed totals over ALL entries in scope, for dashboard cards. */
export const stats = query({
  args: {},
  handler: async (ctx) => {
    const { userId, role } = await requireUser(ctx);
    const isAdmin = role === "admin";

    // Read via the status index rather than a full table scan, then filter
    // by owner for non-admins.
    const byStatus = async (status: EntryStatus) =>
      await ctx.db
        .query("entries")
        .withIndex("by_status", (q) => q.eq("status", status))
        .collect();

    const inScope = (entry: Doc<"entries">) =>
      isAdmin || entry.createdBy === userId;

    const pending = (await byStatus("pending")).filter(inScope).length;
    const approvedDocs = (await byStatus("approved")).filter(inScope);
    const rejected = (await byStatus("rejected")).filter(inScope).length;

    return {
      pending,
      approvedCount: approvedDocs.length,
      netApproved: approvedDocs.reduce((sum, entry) => sum + entry.amount, 0),
      total: pending + approvedDocs.length + rejected,
    };
  },
});

/** Single entry detail. Every member can open any entry; changes stay gated. */
export const get = query({
  args: { entryId: v.id("entries") },
  handler: async (ctx, { entryId }) => {
    const { userId, role } = await requireUser(ctx);
    const entry = await ctx.db.get(entryId);
    if (entry === null) return null;

    const author = await ctx.db.get(entry.createdBy);
    const student = entry.studentId ? await ctx.db.get(entry.studentId) : null;
    return {
      ...entry,
      authorName: author?.name ?? author?.email ?? "Unknown",
      mine: entry.createdBy === userId,
      viewerRole: role,
      studentName: student?.name ?? null,
    };
  },
});

/** Members file an entry; admins may file one on behalf of anyone. */
export const create = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    amount: v.number(),
    category: v.optional(v.string()),
    studentId: v.optional(v.id("students")),
    provider: v.optional(v.string()),
  },
  handler: async (ctx, { title, description, amount, category, studentId, provider }) => {
    const { userId } = await requireUser(ctx);
    if (!title.trim()) throw new Error("Give the entry a short description.");
    if (!Number.isFinite(amount) || amount === 0) {
      throw new Error("Enter a non-zero amount.");
    }
    if (studentId !== undefined && (await ctx.db.get(studentId)) === null) {
      throw new Error("That student no longer exists.");
    }
    const now = Date.now();
    return await ctx.db.insert("entries", {
      title: title.trim(),
      description: description?.trim() || undefined,
      amount: Math.round(amount),
      status: "pending",
      category: category?.trim() || undefined,
      studentId,
      provider: provider?.trim() || undefined,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Student-payment settlement. "paid" stamps who/when; "unpaid" clears it.
 * Admins settle any entry; owners settle their own approved charges.
 */
export const setPaid = mutation({
  args: { entryId: v.id("entries"), paid: v.boolean() },
  handler: async (ctx, { entryId, paid }) => {
    const { userId, role } = await requireUser(ctx);
    const entry = await ctx.db.get(entryId);
    if (entry === null) throw new Error("Entry not found.");
    const isOwn = entry.createdBy === userId;
    if (!isOwn && role !== "admin") {
      throw new Error("You can only update entries you filed.");
    }
    if (paid && entry.status !== "approved") {
      throw new Error("Only approved entries can be marked as paid.");
    }
    await ctx.db.patch(entryId, {
      paidAt: paid ? Date.now() : undefined,
      updatedAt: Date.now(),
    });
  },
});

/** All ledger charges linked to one student, newest first. */
export const listByStudent = query({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    await requireUser(ctx);
    const entries = await ctx.db
      .query("entries")
      .withIndex("by_studentId", (q) => q.eq("studentId", studentId))
      .order("desc")
      .collect();

    const authorIds = Array.from(
      new Set(entries.map((entry) => entry.createdBy)),
    ) as Id<"users">[];
    const authors = await Promise.all(authorIds.map((id) => ctx.db.get(id)));

    const rows = entries.map((entry) => {
      const author = authors.find(
        (a): a is Doc<"users"> => a !== null && a._id === entry.createdBy,
      );
      return {
        _id: entry._id,
        title: entry.title,
        amount: entry.amount,
        status: entry.status,
        paidAt: entry.paidAt,
        provider: entry.provider,
        createdAt: entry.createdAt,
        authorName: author?.name ?? author?.email ?? "Unknown",
      };
    });

    const approved = rows.filter((row) => row.status === "approved");
    return {
      rows,
      totals: {
        charged: approved.reduce((sum, row) => sum + row.amount, 0),
        paid: approved
          .filter((row) => row.paidAt !== undefined)
          .reduce((sum, row) => sum + row.amount, 0),
        unpaidCount: approved.filter((row) => row.paidAt === undefined).length,
      },
    };
  },
});

/** Status changes follow the role rules; every change is logged as a comment. */
export const setStatus = mutation({
  args: {
    entryId: v.id("entries"),
    status: statusValidator,
    note: v.optional(v.string()),
  },
  handler: async (ctx, { entryId, status, note }) => {
    const { userId, role } = await requireUser(ctx);
    const entry = await ctx.db.get(entryId);
    if (entry === null) throw new Error("Entry not found.");

    /* Review is an admin decision: members can see the outcome but not set it. */
    if (role !== "admin") {
      throw new Error("Only admins can review entries.");
    }
    if (!ALLOWED_TRANSITIONS[role]?.includes(status)) {
      throw new Error("Your role cannot set that status.");
    }

    const trimmed = note?.trim() ?? "";
    if (status === "rejected" && trimmed === "") {
      throw new Error("Give a reason for rejecting this entry.");
    }

    const labels: Record<EntryStatus, string> = {
      pending: "re-opened",
      approved: "approved",
      rejected: "rejected",
    };
    const now = Date.now();
    await ctx.db.patch(entryId, {
      status,
      // Keep the reason on the entry so the dashboard can show it inline.
      reviewNote: status === "rejected" ? trimmed : undefined,
      reviewedBy: userId,
      reviewedAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("comments", {
      entryId,
      authorId: userId,
      body:
        status === "rejected"
          ? `Rejected: ${trimmed}`
          : `Marked this entry as ${labels[status]}.`,
      createdAt: now,
    });
  },
});

/** Editable while pending, by the author or an admin. */
export const update = mutation({
  args: {
    entryId: v.id("entries"),
    title: v.string(),
    description: v.optional(v.string()),
    amount: v.number(),
    category: v.optional(v.string()),
    studentId: v.optional(v.id("students")),
    provider: v.optional(v.string()),
  },
  handler: async (ctx, { entryId, title, description, amount, category, studentId, provider }) => {
    const { userId, role } = await requireUser(ctx);
    const entry = await ctx.db.get(entryId);
    if (entry === null) throw new Error("Entry not found.");
    if (entry.createdBy !== userId && role !== "admin") {
      throw new Error("You can only edit entries you filed.");
    }
    if (entry.status !== "pending") {
      throw new Error("Only pending entries can be edited.");
    }
    if (!title.trim()) throw new Error("Give the entry a short description.");
    if (!Number.isFinite(amount) || amount === 0) {
      throw new Error("Enter a non-zero amount.");
    }
    if (studentId !== undefined && (await ctx.db.get(studentId)) === null) {
      throw new Error("That student no longer exists.");
    }
    await ctx.db.patch(entryId, {
      title: title.trim(),
      description: description?.trim() || undefined,
      amount: Math.round(amount),
      category: category?.trim() || undefined,
      studentId,
      provider: provider?.trim() || undefined,
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { entryId: v.id("entries") },
  handler: async (ctx, { entryId }) => {
    const { userId, role } = await requireUser(ctx);
    const entry = await ctx.db.get(entryId);
    if (entry === null) throw new Error("Entry not found.");
    if (entry.createdBy !== userId && role !== "admin") {
      throw new Error("You can only delete entries you filed.");
    }
    for (const comment of await ctx.db
      .query("comments")
      .withIndex("by_entryId", (q) => q.eq("entryId", entryId))
      .collect()) {
      await ctx.db.delete(comment._id);
    }
    await ctx.db.delete(entryId);
  },
});

/** Threaded discussion on one entry. */
export const listComments = query({
  args: { entryId: v.id("entries") },
  handler: async (ctx, { entryId }) => {
    const { userId } = await requireUser(ctx);
    const entry = await ctx.db.get(entryId);
    if (entry === null) return [];

    const comments = await ctx.db
      .query("comments")
      .withIndex("by_entryId", (q) => q.eq("entryId", entryId))
      .order("asc")
      .collect();

    const authorIds = Array.from(
      new Set(comments.map((comment) => comment.authorId)),
    );
    const authors = await Promise.all(
      authorIds.map((id) => ctx.db.get(id as Id<"users">)),
    );

    return comments.map((comment) => {
      const author = authors.find(
        (a): a is Doc<"users"> => a !== null && a._id === comment.authorId,
      );
      return {
        _id: comment._id,
        body: comment.body,
        createdAt: comment.createdAt,
        authorId: comment.authorId,
        authorName: author?.name ?? author?.email ?? "Unknown",
        mine: comment.authorId === userId,
      };
    });
  },
});

export const addComment = mutation({
  args: { entryId: v.id("entries"), body: v.string() },
  handler: async (ctx, { entryId, body }) => {
    const { userId } = await requireUser(ctx);
    const entry = await ctx.db.get(entryId);
    if (entry === null) throw new Error("Entry not found.");
    const trimmed = body.trim();
    if (!trimmed) throw new Error("Write a message first.");
    await ctx.db.insert("comments", {
      entryId,
      authorId: userId,
      body: trimmed,
      createdAt: Date.now(),
    });
  },
});
