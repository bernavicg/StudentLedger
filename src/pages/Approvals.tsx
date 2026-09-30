import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import { amountTone, formatCentavos, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  CalendarCheck,
  CheckCircle2,
  ClipboardCheck,
  Inbox,
  Receipt,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

/** "14:30" → "2:30 PM" for the session time chips. */
function formatStartTime(time: string): string {
  const [hours, minutes] = time.split(":").map(Number);
  const suffix = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

/** What a rejection is waiting on. Both kinds require a reason. */
type RejectTarget =
  | { kind: "entry"; id: Id<"entries">; label: string }
  | { kind: "attendance"; id: Id<"attendance">; label: string };

type Tab = "all" | "entries" | "attendance";

export default function Approvals() {
  const { user, isLoading } = useAuth();
  const isAdmin = user?.role === "admin";

  // The query is admin-guarded server-side, so a member must never call it.
  const queue = useQuery(api.approvals.pending, isAdmin ? undefined : "skip");
  const setEntryStatus = useMutation(api.entries.setStatus);
  const reviewAttendance = useMutation(api.students.reviewAttendance);

  const [tab, setTab] = useState<Tab>("all");
  const [rejectTarget, setRejectTarget] = useState<RejectTarget | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [busy, setBusy] = useState(false);

  const pendingEntries = queue?.entries ?? [];
  const pendingAttendance = queue?.attendance ?? [];

  const total = pendingEntries.length + pendingAttendance.length;

  const handleApproveEntry = async (id: Id<"entries">) => {
    try {
      await setEntryStatus({ entryId: id, status: "approved" });
      toast.success("Entry approved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not approve.");
    }
  };

  const handleApproveAttendance = async (id: Id<"attendance">) => {
    try {
      await reviewAttendance({ attendanceId: id, status: "approved" });
      toast.success("Session approved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not approve.");
    }
  };

  const handleReject = async () => {
    if (rejectTarget === null || rejectNote.trim() === "") return;
    setBusy(true);
    try {
      if (rejectTarget.kind === "entry") {
        await setEntryStatus({
          entryId: rejectTarget.id,
          status: "rejected",
          note: rejectNote.trim(),
        });
      } else {
        await reviewAttendance({
          attendanceId: rejectTarget.id,
          status: "rejected",
          note: rejectNote.trim(),
        });
      }
      toast.success("Rejected, with your reason attached.");
      setRejectTarget(null);
      setRejectNote("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reject.");
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) {
    return (
      <AppShell active="approvals">
        <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="mt-6 h-40 w-full" />
        </div>
      </AppShell>
    );
  }

  if (!isAdmin) {
    return (
      <AppShell active="approvals">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center px-4 py-20 text-center sm:px-6">
          <ShieldAlert className="size-10 text-muted-foreground" />
          <h1 className="mt-4 font-serif text-2xl font-semibold">
            Admin only
          </h1>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Ang approvals page para ra sa admin. Ask an admin to review the
            pending items for you.
          </p>
          <Button asChild variant="outline" className="mt-6">
            <Link to="/dashboard">Back to the ledger</Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  const showEntries = tab === "all" || tab === "entries";
  const showAttendance = tab === "all" || tab === "attendance";

  return (
    <AppShell active="approvals">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Review queue
            </p>
            <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight">
              Approvals
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Tanang pending entries ug attendance nga naghimug wait sa imong
              desisyon.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card px-4 py-3 text-center">
            <p className="font-serif text-2xl font-semibold leading-none">
              {total}
            </p>
            <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              waiting
            </p>
          </div>
        </header>

        {/* Queue filters */}
        <div className="mt-6 flex flex-wrap gap-2">
          {(
            [
              { key: "all", label: "All", count: total },
              {
                key: "entries",
                label: "Ledger entries",
                count: pendingEntries.length,
              },
              {
                key: "attendance",
                label: "Attendance",
                count: pendingAttendance.length,
              },
            ] as { key: Tab; label: string; count: number }[]
          ).map((filter) => (
            <button
              key={filter.key}
              type="button"
              onClick={() => setTab(filter.key)}
              className={cn(
                "flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm transition-colors",
                tab === filter.key
                  ? "bg-primary font-medium text-primary-foreground"
                  : "border border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {filter.label}
              <span
                className={cn(
                  "rounded-full px-1.5 text-[11px] font-semibold",
                  tab === filter.key
                    ? "bg-primary-foreground/20"
                    : "bg-muted-foreground/15",
                )}
              >
                {filter.count}
              </span>
            </button>
          ))}
        </div>

        {total === 0 && (
          <Card className="mt-6 rounded-2xl">
            <CardContent className="flex flex-col items-center py-14 text-center">
              <Inbox className="size-9 text-muted-foreground" />
              <p className="mt-3 font-serif text-xl font-semibold">
                Clean queue
              </p>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                Walay pending ngayon. Everything filed has been reviewed.
              </p>
            </CardContent>
          </Card>
        )}

        {showAttendance && pendingAttendance.length > 0 && (
          <section className="mt-6">
            <h2 className="flex items-center gap-2 font-serif text-lg font-semibold">
              <CalendarCheck className="size-4 text-muted-foreground" />
              Attendance
              <span className="rounded-full bg-[#8a8578] px-2 py-0.5 text-[11px] font-semibold text-[#fdfcf9]">
                {pendingAttendance.length}
              </span>
            </h2>
            <Card className="mt-3 rounded-2xl">
              <CardContent className="p-0">
                <ul className="divide-y divide-border">
                  {pendingAttendance.map((record) => (
                    <li
                      key={record._id}
                      className="flex flex-wrap items-center gap-4 px-5 py-4"
                    >
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 font-serif text-sm text-primary">
                        {record.sessionNumber}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          {record.studentName}
                          {record.startTime && (
                            <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                              {formatStartTime(record.startTime)}
                              {record.endTime &&
                                ` – ${formatStartTime(record.endTime)}`}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {record.day} · Session{" "}
                          {record.sessionsConsumed > 1
                            ? `${record.sessionNumber}–${record.sessionNumber + record.sessionsConsumed - 1}`
                            : record.sessionNumber}
                          {record.durationMinutes
                            ? ` · ${record.durationMinutes} min`
                            : ""}{" "}
                          · logged by {record.recorderName}{" "}
                          {timeAgo(record.createdAt)}
                        </p>
                        <Link
                          to={`/students/${record.studentId}`}
                          className="mt-1 inline-block text-xs text-primary underline-offset-2 hover:underline"
                        >
                          Open student
                        </Link>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground hover:text-[#2e5c4d]"
                          onClick={() =>
                            void handleApproveAttendance(record._id)
                          }
                        >
                          <CheckCircle2 className="mr-1.5 size-3.5" />
                          Approve
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground hover:text-[#9c3d31]"
                          onClick={() =>
                            setRejectTarget({
                              kind: "attendance",
                              id: record._id,
                              label: `${record.studentName} · ${record.day}`,
                            })
                          }
                        >
                          <XCircle className="mr-1.5 size-3.5" />
                          Reject
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </section>
        )}

        {showEntries && pendingEntries.length > 0 && (
          <section className="mt-6">
            <h2 className="flex items-center gap-2 font-serif text-lg font-semibold">
              <Receipt className="size-4 text-muted-foreground" />
              Ledger entries
              <span className="rounded-full bg-[#8a8578] px-2 py-0.5 text-[11px] font-semibold text-[#fdfcf9]">
                {pendingEntries.length}
              </span>
            </h2>
            <Card className="mt-3 rounded-2xl">
              <CardContent className="p-0">
                <ul className="divide-y divide-border">
                  {pendingEntries.map((entry) => (
                    <li
                      key={entry._id}
                      className="flex flex-wrap items-center gap-4 px-5 py-4"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          {entry.title}
                          {entry.category && (
                            <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                              {entry.category}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatCentavos(entry.amount)}
                          {entry.studentName
                            ? ` · ${entry.studentName}`
                            : ""}
                          {entry.provider ? ` · ${entry.provider}` : ""} ·
                          filed by {entry.authorName} {timeAgo(entry.createdAt)}
                        </p>
                        <Link
                          to={`/entries/${entry._id}`}
                          className="mt-1 inline-block text-xs text-primary underline-offset-2 hover:underline"
                        >
                          Open entry
                        </Link>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span
                          className={cn(
                            "font-serif text-base font-semibold",
                            amountTone(entry.amount),
                          )}
                        >
                          {formatCentavos(entry.amount)}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground hover:text-[#2e5c4d]"
                          onClick={() => void handleApproveEntry(entry._id)}
                        >
                          <CheckCircle2 className="mr-1.5 size-3.5" />
                          Approve
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground hover:text-[#9c3d31]"
                          onClick={() =>
                            setRejectTarget({
                              kind: "entry",
                              id: entry._id,
                              label: entry.title,
                            })
                          }
                        >
                          <XCircle className="mr-1.5 size-3.5" />
                          Reject
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </section>
        )}

        {total > 0 && (
          <p className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
            <ClipboardCheck className="size-3.5" />
            Rejections need a reason — it shows on the record so whoever filed
            it knows what to fix.
          </p>
        )}
      </div>

      {/* Reject reason — required for both entry and attendance rejections. */}
      <Dialog
        open={rejectTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRejectTarget(null);
            setRejectNote("");
          }
        }}
      >
        <DialogContent className="rounded-2xl sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">
              Reject this one?
            </DialogTitle>
            <DialogDescription>
              {rejectTarget?.kind === "entry"
                ? "Tell the team why this entry is being turned down. The reason shows on the entry."
                : "Tell the recorder why this session is being turned down. The reason shows on the attendance record."}
            </DialogDescription>
          </DialogHeader>
          {rejectTarget && (
            <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              {rejectTarget.label}
            </p>
          )}
          <div className="grid gap-2">
            <Label htmlFor="approval-reject-note">Reason</Label>
            <Textarea
              id="approval-reject-note"
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder={
                rejectTarget?.kind === "entry"
                  ? "e.g. Duplicate of the Paper Invoice already filed."
                  : "e.g. Wrong date, or the time does not match."
              }
              className="min-h-20"
              disabled={busy}
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setRejectTarget(null);
                setRejectNote("");
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy || rejectNote.trim() === ""}
              onClick={() => void handleReject()}
            >
              {busy ? "Rejecting…" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
