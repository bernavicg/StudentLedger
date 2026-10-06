import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./lib/auth";

const statusValidator = v.union(
  v.literal("todo"),
  v.literal("in_progress"),
  v.literal("done"),
);

/** YYYY-MM-DD shape check for optional due dates. */
function normalizeDue(due: string | undefined): string | undefined {
  const trimmed = due?.trim();
  if (!trimmed) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error("Due date must be a date (YYYY-MM-DD).");
  }
  return trimmed;
}

/**
 * Every task, newest first, with display names for who created and who
 * completed it. Visible to every signed-in member.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const [tasks, users] = await Promise.all([
      ctx.db.query("tasks").order("desc").collect(),
      ctx.db.query("users").collect(),
    ]);
    const names = new Map(
      users.map((u) => [u._id, u.name ?? u.email ?? "Unknown"]),
    );
    return tasks.map((task) => ({
      _id: task._id,
      title: task.title,
      notes: task.notes,
      status: task.status,
      due: task.due,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      completedAt: task.completedAt,
      createdBy: task.createdBy,
      creatorName: names.get(task.createdBy) ?? "Unknown",
      completedByName: task.completedBy
        ? (names.get(task.completedBy) ?? "Unknown")
        : undefined,
    }));
  },
});

/** Board counters over the full task scope: per status plus overdue. */
export const stats = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const tasks = await ctx.db.query("tasks").collect();
    const today = new Date().toISOString().slice(0, 10);
    let todo = 0;
    let inProgress = 0;
    let done = 0;
    let overdue = 0;
    for (const task of tasks) {
      if (task.status === "todo") todo += 1;
      else if (task.status === "in_progress") inProgress += 1;
      else done += 1;
      if (task.status !== "done" && task.due && task.due < today) {
        overdue += 1;
      }
    }
    return { todo, inProgress, done, overdue, total: tasks.length };
  },
});

/** Add a task to the board. Any signed-in member can. */
export const create = mutation({
  args: {
    title: v.string(),
    notes: v.optional(v.string()),
    due: v.optional(v.string()),
  },
  handler: async (ctx, { title, notes, due }) => {
    const user = await requireUser(ctx);
    const trimmed = title.trim();
    if (!trimmed) throw new Error("Give the task a short title.");
    const now = Date.now();
    return await ctx.db.insert("tasks", {
      title: trimmed,
      notes: notes?.trim() || undefined,
      due: normalizeDue(due),
      status: "todo",
      createdBy: user.userId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Edit a task's title, notes, or due date. Any signed-in member can. */
export const update = mutation({
  args: {
    taskId: v.id("tasks"),
    title: v.string(),
    notes: v.optional(v.string()),
    due: v.optional(v.string()),
  },
  handler: async (ctx, { taskId, title, notes, due }) => {
    await requireUser(ctx);
    const task = await ctx.db.get(taskId);
    if (!task) throw new Error("Task not found.");
    const trimmed = title.trim();
    if (!trimmed) throw new Error("Give the task a short title.");
    await ctx.db.patch(taskId, {
      title: trimmed,
      notes: notes?.trim() || undefined,
      due: normalizeDue(due),
      updatedAt: Date.now(),
    });
  },
});

/** Move a task along todo → in progress → done. Any signed-in member can. */
export const setStatus = mutation({
  args: { taskId: v.id("tasks"), status: statusValidator },
  handler: async (ctx, { taskId, status }) => {
    const user = await requireUser(ctx);
    const task = await ctx.db.get(taskId);
    if (!task) throw new Error("Task not found.");
    await ctx.db.patch(taskId, {
      status,
      updatedAt: Date.now(),
      completedAt: status === "done" ? Date.now() : undefined,
      completedBy: status === "done" ? user.userId : undefined,
    });
  },
});

/** Delete a task. Only its creator or an admin can. */
export const remove = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const user = await requireUser(ctx);
    const task = await ctx.db.get(taskId);
    if (!task) throw new Error("Task not found.");
    if (task.createdBy !== user.userId && user.role !== "admin") {
      throw new Error("Only the task creator or an admin can delete it.");
    }
    await ctx.db.delete(taskId);
  },
});
