import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import { useClaimAdmin } from "@/hooks/use-claim-admin";
import { formatDate } from "@/lib/format";
import {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  TASK_STATUS_STYLES,
  type TaskStatus,
  formatDueDate,
  isTaskOverdue,
} from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  CalendarClock,
  CheckCircle2,
  ListTodo,
  Pencil,
  Plus,
  Timer,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/** One row of api.tasks.list. */
type TaskRow = {
  _id: Id<"tasks">;
  title: string;
  notes?: string;
  status: TaskStatus;
  due?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  createdBy: Id<"users">;
  creatorName: string;
  completedByName?: string;
};

type StatusFilter = "all" | TaskStatus;

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
];

export default function Tasks() {
  const { user } = useAuth();
  const { adminAvailable, claim } = useClaimAdmin();

  const tasks = useQuery(api.tasks.list);
  const stats = useQuery(api.tasks.stats);

  const [filter, setFilter] = useState<StatusFilter>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editTask, setEditTask] = useState<TaskRow | undefined>(undefined);
  const [editOpen, setEditOpen] = useState(false);

  const setStatus = useMutation(api.tasks.setStatus);
  const removeTask = useMutation(api.tasks.remove);

  const visible = (tasks ?? []).filter(
    (task) => filter === "all" || task.status === filter,
  );

  const greeting = user?.name
    ? `Good ${greetingWord()}, ${firstName(user.name)}`
    : "Team tasks";

  const handleStatus = async (task: TaskRow, status: TaskStatus) => {
    if (status === task.status) return;
    try {
      await setStatus({ taskId: task._id, status });
      toast.success(
        status === "done"
          ? "Task marked done."
          : `Moved to ${TASK_STATUS_LABELS[status]}.`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update the task.",
      );
    }
  };

  const handleDelete = async (task: TaskRow) => {
    if (!window.confirm(`Delete "${task.title}"?`)) return;
    try {
      await removeTask({ taskId: task._id });
      toast.success("Task deleted.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not delete the task.",
      );
    }
  };

  const openEdit = (task: TaskRow) => {
    setEditTask(task);
    setEditOpen(true);
  };

  const canDelete = (task: TaskRow) => {
    if (!user) return false;
    return user._id === task.createdBy || user.role === "admin";
  };

  return (
    <AppShell active="tasks">
      <div className="mx-auto w-full max-w-4xl px-6 py-8 sm:py-10">
        {/* Greeting */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Task monitoring
            </p>
            <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
              {greeting}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {stats === undefined
                ? "…"
                : `${stats.todo} to do · ${stats.inProgress} in progress${
                    stats.overdue > 0 ? ` · ${stats.overdue} overdue` : ""
                  }`}
              {" · "}
              the team's shared to-do list
            </p>
          </div>
          <TaskDialog
            key="create"
            open={createOpen}
            onOpenChange={setCreateOpen}
          />
        </div>

        {/* One-time admin claim for the first account on the ledger */}
        {adminAvailable && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/40 bg-primary/10 px-6 py-4">
            <div>
              <p className="font-serif text-lg font-semibold">
                You're the first account here
              </p>
              <p className="text-sm text-muted-foreground">
                Claim the admin role to approve entries and manage the team.
              </p>
            </div>
            <Button className="rounded-full" onClick={claim}>
              Claim admin access
            </Button>
          </div>
        )}

        {/* Stat cards */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-2xl border border-border bg-card px-5 py-4">
            <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <ListTodo className="size-3" />
              To do
            </p>
            <p className="mt-1 font-serif text-3xl font-semibold">
              {stats === undefined ? "…" : stats.todo}
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card px-5 py-4">
            <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <Timer className="size-3" />
              In progress
            </p>
            <p className="mt-1 font-serif text-3xl font-semibold">
              {stats === undefined ? "…" : stats.inProgress}
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card px-5 py-4">
            <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <CheckCircle2 className="size-3" />
              Done
            </p>
            <p className="mt-1 font-serif text-3xl font-semibold">
              {stats === undefined ? "…" : stats.done}
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card px-5 py-4">
            <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <CalendarClock className="size-3" />
              Overdue
            </p>
            <p
              className={cn(
                "mt-1 font-serif text-3xl font-semibold",
                (stats?.overdue ?? 0) > 0 && "text-[#9c3d31]",
              )}
            >
              {stats === undefined ? "…" : stats.overdue}
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="mt-8 flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={cn(
                "rounded-full border px-4 py-1.5 text-sm transition-colors",
                filter === f.value
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Task board */}
        <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
          {tasks === undefined ? (
            <div className="px-6 py-16 text-center text-sm text-muted-foreground">
              Loading tasks…
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-16 text-center">
              <ListTodo className="size-8 text-muted-foreground/50" />
              <p className="mt-3 font-serif text-lg font-semibold">
                {filter === "all"
                  ? "No tasks yet"
                  : `No ${TASK_STATUS_LABELS[filter as TaskStatus].toLowerCase()} tasks`}
              </p>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                Add the first task and keep the whole team on track. Everyone
                signed in can add and update tasks.
              </p>
              <Button
                className="mt-5 rounded-full"
                variant="outline"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="mr-2 size-4" />
                New task
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {visible.map((task) => (
                <li
                  key={task._id}
                  className="flex flex-wrap items-center gap-3 px-5 py-4 sm:px-6"
                >
                  {/* Status pill — click to move along the board */}
                  <Select
                    value={task.status}
                    onValueChange={(value) =>
                      handleStatus(task, value as TaskStatus)
                    }
                  >
                    <SelectTrigger
                      aria-label="Task status"
                      className={cn(
                        "h-8 w-[120px] shrink-0 rounded-full border-0 px-3 text-xs font-medium focus:ring-0 focus:ring-offset-0",
                        TASK_STATUS_STYLES[task.status],
                      )}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      {TASK_STATUSES.map((status) => (
                        <SelectItem
                          key={status}
                          value={status}
                          className="cursor-pointer"
                        >
                          {TASK_STATUS_LABELS[status]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <div className="min-w-0 flex-1 basis-48">
                    <p
                      className={cn(
                        "truncate font-medium",
                        task.status === "done" &&
                          "text-muted-foreground line-through",
                      )}
                    >
                      {task.title}
                    </p>
                    {task.notes && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {task.notes}
                      </p>
                    )}
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      by {task.creatorName} · {formatDate(task.createdAt)}
                      {task.status === "done" && task.completedByName
                        ? ` · done by ${task.completedByName}`
                        : ""}
                    </p>
                  </div>

                  {task.due && (
                    <span
                      className={cn(
                        "flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                        isTaskOverdue(task)
                          ? "bg-[#9c3d31]/10 text-[#9c3d31]"
                          : "bg-secondary/60 text-muted-foreground",
                      )}
                    >
                      <CalendarClock className="size-3" />
                      {isTaskOverdue(task)
                        ? `overdue · ${formatDueDate(task.due)}`
                        : `due ${formatDueDate(task.due)}`}
                    </span>
                  )}

                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-foreground"
                      aria-label="Edit task"
                      onClick={() => openEdit(task)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    {canDelete(task) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-[#9c3d31]"
                        aria-label="Delete task"
                        onClick={() => handleDelete(task)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Edit dialog lives outside the board so rows stay lean */}
      {editTask && (
        <TaskDialog
          key={editTask._id}
          open={editOpen}
          onOpenChange={setEditOpen}
          initial={editTask}
        />
      )}
    </AppShell>
  );
}

function greetingWord(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0];
}

/** Create or edit a task. Any signed-in member can do both. */
function TaskDialog({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: TaskRow;
}) {
  const isEdit = initial !== undefined;
  const [title, setTitle] = useState(initial?.title ?? "");
  const [due, setDue] = useState(initial?.due ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const createTask = useMutation(api.tasks.create);
  const updateTask = useMutation(api.tasks.update);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      toast.error("Give the task a short title.");
      return;
    }
    setIsSubmitting(true);
    try {
      if (initial) {
        await updateTask({
          taskId: initial._id,
          title,
          notes: notes || undefined,
          due: due || undefined,
        });
        toast.success("Task updated.");
      } else {
        await createTask({
          title,
          notes: notes || undefined,
          due: due || undefined,
        });
        toast.success("Task added to the board.");
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save the task.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {!isEdit && (
        <DialogTrigger asChild>
          <Button className="rounded-full">
            <Plus className="mr-2 size-4" />
            New task
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">
            {isEdit ? "Edit task" : "Add a task"}
          </DialogTitle>
          <DialogDescription>
            Anything the team needs to do. Everyone signed in can pick it up
            and move it along.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="task-title">What needs doing?</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Follow up on Polaris billing"
              disabled={isSubmitting}
              required
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="task-due">
              Due date <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="task-due"
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="task-notes">
              Notes <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="task-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Context, links, who to talk to…"
              className="min-h-20"
              disabled={isSubmitting}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" className="rounded-full" disabled={isSubmitting}>
              {isSubmitting
                ? "Saving…"
                : isEdit
                  ? "Save changes"
                  : "Add task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
