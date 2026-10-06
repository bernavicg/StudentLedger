/** Shared helpers for the task monitoring board (status + due dates). */

export const TASK_STATUSES = ["todo", "in_progress", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Human labels shown on the board. */
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

/** Solid pill styles matching the app's editorial palette. */
export const TASK_STATUS_STYLES: Record<TaskStatus, string> = {
  todo: "bg-[#8a8578] text-[#fdfcf9]",
  in_progress: "bg-[#8a6d3b] text-[#fdfcf9]",
  done: "bg-[#2e5c4d] text-[#fdfcf9]",
};

/** Local YYYY-MM-DD, e.g. "2026-10-06". */
export function todayISO(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** A task is overdue when its due date has passed and it isn't done. */
export function isTaskOverdue(
  task: { due?: string; status: TaskStatus },
  today = todayISO(),
): boolean {
  return task.status !== "done" && task.due !== undefined && task.due < today;
}

/** "Oct 12" style label for a YYYY-MM-DD due date. */
export function formatDueDate(due: string): string {
  const [year, month, day] = due.split("-").map(Number);
  if (!year || !month || !day) return due;
  return new Date(year, month - 1, day).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
  });
}
