import { AppShell } from "@/components/AppShell";
import { MarkSessionDialog } from "@/components/MarkSessionDialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  amountTone,
  formatCentavos,
  STATUS_STYLES,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  Clock,
  Pencil,
  Trash2,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

const STUDENT_ID_PATTERN = /^[0-9a-z]{32}$/i;

/** "14:30" -> "2:30 PM" for the attendance timeline. */
function formatStartTime(value: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return value;
  const hours = Number(match[1]);
  const suffix = hours >= 12 ? "PM" : "AM";
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${display}:${match[2]} ${suffix}`;
}

/** Parse "YYYY-MM-DD" into a local Date (avoids the UTC shift of new Date(string)). */
function fromDayString(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Hours -> "2.5 h" / "3 h" / "45 min" for the authorization and monthly totals. */
function formatHours(hours: number): string {
  if (hours === 0) return "0 h";
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
}

/** Review state pill shown on every attendance row. */
function ReviewBadge({
  status,
}: {
  status: "pending" | "approved" | "rejected";
}) {
  if (status === "approved") {
    return (
      <span className="ml-2 rounded-full bg-[#2e5c4d] px-2 py-0.5 text-[11px] font-medium text-[#fdfcf9]">
        Approved
      </span>
    );
  }
  if (status === "rejected") {
    return (
      <span className="ml-2 rounded-full bg-[#9c3d31] px-2 py-0.5 text-[11px] font-medium text-[#fdfcf9]">
        Rejected
      </span>
    );
  }
  return (
    <span className="ml-2 rounded-full bg-[#8a8578]/25 px-2 py-0.5 text-[11px] font-medium text-[#6b6459]">
      Awaiting review
    </span>
  );
}

function isValidStudentId(
  value: string | undefined,
): value is Id<"students"> {
  return typeof value === "string" && STUDENT_ID_PATTERN.test(value);
}

export default function StudentDetail() {
  const { studentId } = useParams<{ studentId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const validId = isValidStudentId(studentId) ? studentId : "skip";

  const student = useQuery(
    api.students.get,
    validId === "skip" ? "skip" : { studentId: validId },
  );
  // Ledger charges linked to this student, with payment totals.
  const charges = useQuery(
    api.entries.listByStudent,
    validId === "skip" ? "skip" : { studentId: validId },
  );
  const removeAttendance = useMutation(api.students.removeAttendance);
  const reviewAttendance = useMutation(api.students.reviewAttendance);
  const updateStudent = useMutation(api.students.update);
  const removeStudent = useMutation(api.students.remove);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [monthFilter, setMonthFilter] = useState("all");
  const [rejectId, setRejectId] = useState<Id<"attendance"> | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [reviewing, setReviewing] = useState(false);

  const [editName, setEditName] = useState("");
  const [editContact, setEditContact] = useState("");
  const [editCaseNo, setEditCaseNo] = useState("");
  const [editTotalSessions, setEditTotalSessions] = useState("");
  const [editRate, setEditRate] = useState("");
  const [editMinutes, setEditMinutes] = useState<30 | 60 | null>(null);
  const [editNotes, setEditNotes] = useState("");

  // Derived max preview inside the edit dialog: sessions × rate.
  const editSessionsNum = Number.parseInt(editTotalSessions, 10);
  const editRateNum = Number.parseFloat(editRate.replace(/,/g, ""));
  const editDerivedMax =
    Number.isInteger(editSessionsNum) && editSessionsNum > 0 &&
    Number.isFinite(editRateNum) && editRateNum >= 0
      ? editSessionsNum * editRateNum
      : null;
  // Approved hours: 30-min sessions count as half, 60-min as full.
  const editDerivedHours =
    Number.isInteger(editSessionsNum) && editSessionsNum > 0 &&
    editMinutes !== null
      ? (editSessionsNum * editMinutes) / 60
      : null;

  const isAdmin = user?.role === "admin";

  /* Attendance grouped by month: distinct days attended, sessions used, and
     minutes of actual time, so a long history stays readable. Declared with
     the other hooks, above the early returns that follow. */
  const records = useMemo(() => student?.records ?? [], [student?.records]);
  const monthly = useMemo(() => {
    const buckets = new Map<
      string,
      { key: string; label: string; days: Set<string>; sessions: number; minutes: number }
    >();
    for (const record of records) {
      const key = record.day.slice(0, 7); // YYYY-MM
      const bucket = buckets.get(key) ?? {
        key,
        label: fromDayString(`${key}-01`).toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
        }),
        days: new Set<string>(),
        sessions: 0,
        minutes: 0,
      };
      bucket.days.add(record.day);
      bucket.sessions += record.sessionsConsumed;
      bucket.minutes += record.durationMinutes ?? 0;
      buckets.set(key, bucket);
    }
    return [...buckets.values()]
      .sort((a, b) => (a.key < b.key ? 1 : -1))
      .map((b) => ({
        key: b.key,
        label: b.label,
        days: b.days.size,
        sessions: b.sessions,
        minutes: b.minutes,
      }));
  }, [records]);

  const visibleRecords = useMemo(
    () =>
      monthFilter === "all"
        ? records
        : records.filter((r) => r.day.startsWith(monthFilter)),
    [records, monthFilter],
  );

  if (student === undefined) {
    if (validId === "skip") {
      return (
        <AppShell active="students">
          <div className="mx-auto flex w-full max-w-4xl flex-col items-center px-6 py-24 text-center">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              404 · student not found
            </p>
            <h1 className="mt-3 font-serif text-2xl font-semibold">
              This student isn't available
            </h1>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              The link looks malformed. Check the URL or head back to the
              roster.
            </p>
            <Button asChild variant="outline" className="mt-6 rounded-full">
              <Link to="/students">Back to students</Link>
            </Button>
          </div>
        </AppShell>
      );
    }
    return (
      <AppShell active="students">
        <div className="mx-auto w-full max-w-4xl px-6 py-10">
          <Skeleton className="h-9 w-72" />
          <Skeleton className="mt-4 h-4 w-96" />
          <Skeleton className="mt-8 h-40 w-full rounded-2xl" />
        </div>
      </AppShell>
    );
  }

  if (student === null) {
    return (
      <AppShell active="students">
        <div className="mx-auto flex w-full max-w-4xl flex-col items-center px-6 py-24 text-center">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            404 · student not found
          </p>
          <h1 className="mt-3 font-serif text-2xl font-semibold">
            This student isn't available
          </h1>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            It may have been deleted, or you don't have access to it.
          </p>
          <Button asChild variant="outline" className="mt-6 rounded-full">
            <Link to="/students">Back to students</Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  const handleReview = async (
    attendanceId: Id<"attendance">,
    status: "approved" | "rejected",
    note?: string,
  ) => {
    try {
      await reviewAttendance({ attendanceId, status, note });
      toast.success(
        status === "approved" ? "Session approved." : "Session rejected.",
      );
      setRejectId(null);
      setRejectNote("");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not review session.",
      );
    }
  };

  const handleUndo = async (attendanceId: Id<"attendance">) => {
    try {
      await removeAttendance({ attendanceId });
      toast.success("Attendance undone. The session is available again.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not undo.");
    }
  };

  const openEdit = () => {
    setEditName(student.name);
    setEditContact(student.contact ?? "");
    setEditCaseNo(student.caseNo ?? "");
    setEditTotalSessions(String(student.totalSessions));
    setEditRate(
      student.ratePerSessionCents !== null
        ? (student.ratePerSessionCents / 100).toFixed(2)
        : "",
    );
    setEditMinutes(student.authorizedMinutes ?? null);
    setEditNotes(student.notes ?? "");
    setEditOpen(true);
  };

  const handleEditSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const sessions = Number.parseInt(editTotalSessions, 10);
    if (!Number.isInteger(sessions) || sessions <= 0) {
      toast.error("Sessions must be a whole number of at least 1.");
      return;
    }
    const rateVal = editRate.trim() === "" ? undefined : Number.parseFloat(editRate.replace(/,/g, ""));
    if (rateVal !== undefined && (!Number.isFinite(rateVal) || rateVal < 0)) {
      toast.error("Rate per session must be zero or more.");
      return;
    }
    try {
      await updateStudent({
        studentId: student._id,
        name: editName,
        contact: editContact || undefined,
        caseNo: editCaseNo || undefined,
        totalSessions: sessions,
        ratePerSession: rateVal,
        authorizedMinutes: editMinutes ?? undefined,
        notes: editNotes || undefined,
      });
      toast.success("Student updated.");
      setEditOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save changes.",
      );
    }
  };

  const handleDelete = async () => {
    try {
      await removeStudent({ studentId: student._id });
      toast.success("Student deleted.");
      navigate("/students");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not delete.",
      );
    }
  };

  return (
    <AppShell active="students">
      <div className="mx-auto w-full max-w-4xl px-6 py-8 sm:py-10">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="-ml-2 text-muted-foreground"
        >
          <Link to="/students">
            <ArrowLeft className="mr-1.5 size-3.5" />
            Back to students
          </Link>
        </Button>

        {/* Title */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
                {student.name}
              </h1>
              {student.caseNo && (
                <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                  {student.caseNo}
                </span>
              )}
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {student.contact ?? "No contact on file"}
            </p>
          </div>
          <div className="flex gap-2">
            {isAdmin ? (
              <>
                <Button
                  variant="outline"
                  className="rounded-full"
                  onClick={openEdit}
                >
                  <Pencil className="mr-2 size-4" />
                  Edit
                </Button>
                <Button
                  variant="outline"
                  className="rounded-full border-destructive/40 text-destructive hover:bg-destructive/10"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="mr-2 size-4" />
                  Delete
                </Button>
              </>
            ) : (
              <p className="self-center text-xs text-muted-foreground">
                View only · an admin can edit or delete
              </p>
            )}
          </div>
        </div>

        {/* Session stats */}
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-border bg-card px-6 py-5">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Sessions remaining
            </p>
            <p
              className={cn(
                "mt-1 font-serif text-3xl font-semibold",
                student.remainingSessions === 0
                  ? "text-[#9c3d31]"
                  : "text-[#2e5c4d]",
              )}
            >
              {student.remainingSessions}
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card px-6 py-5">
            <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <CheckCircle2 className="size-3" />
              Sessions used
            </p>
            <p className="mt-1 font-serif text-3xl font-semibold">
              {student.usedSessions}
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                of {student.totalSessions}
              </span>
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card px-6 py-5">
            <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <CalendarDays className="size-3" />
              Days attended
            </p>
            <p className="mt-1 font-serif text-3xl font-semibold">
              {student.records.length}
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-4">
          <div className="h-2.5 overflow-hidden rounded-full bg-secondary">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                student.remainingSessions === 0
                  ? "bg-[#9c3d31]"
                  : "bg-[#2e5c4d]",
              )}
              style={{
                width: `${Math.min(
                  (student.usedSessions / student.totalSessions) * 100,
                  100,
                )}%`,
              }}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {student.remainingSessions === 0
              ? "No sessions left — add more to continue."
              : `${student.remainingSessions} of ${student.totalSessions} sessions remaining.`}
          </p>
        </div>

        {/* Authorization plan */}
        <div className="mt-4 rounded-2xl border border-border bg-card px-6 py-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Authorization
          </p>
          <div className="mt-2 flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <span className="text-muted-foreground">
              Max authorized amount:{" "}
              <span className="font-medium text-foreground">
                {student.maxAuthorizedAmountCents !== null
                  ? formatCentavos(student.maxAuthorizedAmountCents)
                  : "not set"}
              </span>
            </span>
            <span className="text-muted-foreground">
              Rate per session:{" "}
              <span className="font-medium text-foreground">
                {student.ratePerSessionCents !== null
                  ? formatCentavos(student.ratePerSessionCents)
                  : "not set"}
              </span>
            </span>
            <span className="text-muted-foreground">
              Authorized minutes:{" "}
              <span className="font-medium text-foreground">
                {student.authorizedMinutes !== null
                  ? `${student.authorizedMinutes} minutes`
                  : "not set"}
              </span>
            </span>
            <span className="text-muted-foreground">
              Approved hours:{" "}
              <span className="font-medium text-foreground">
                {student.approvedHours !== null
                  ? formatHours(student.approvedHours)
                  : "not set"}
              </span>
            </span>
            <span className="text-muted-foreground">
              Remaining sessions:{" "}
              <span className="font-medium text-foreground">
                {student.remainingSessions} of {student.totalSessions}
              </span>
            </span>
            <span className="text-muted-foreground">
              Remaining hours:{" "}
              <span className="font-medium text-foreground">
                {student.approvedHours !== null
                  ? formatHours(
                      Math.max(student.remainingSessions * (student.authorizedMinutes ?? 0), 0) / 60,
                    )
                  : "not set"}
              </span>
            </span>
            <span className="text-muted-foreground">
              Remaining balance:{" "}
              <span className="font-medium text-foreground">
                {student.maxAuthorizedAmountCents !== null &&
                student.ratePerSessionCents !== null
                  ? formatCentavos(
                      student.remainingSessions * student.ratePerSessionCents,
                    )
                  : "not set"}
              </span>
            </span>
          </div>
          {student.maxAuthorizedAmountCents !== null &&
            charges !== undefined && (
              <div className="mt-3">
                <div className="h-2 overflow-hidden rounded-full bg-secondary">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      charges.totals.charged > student.maxAuthorizedAmountCents
                        ? "bg-[#9c3d31]"
                        : "bg-[#2e5c4d]",
                    )}
                    style={{
                      width: `${Math.min(
                        Math.max(
                          (charges.totals.charged /
                            student.maxAuthorizedAmountCents) *
                            100,
                          0,
                        ),
                        100,
                      )}%`,
                    }}
                  />
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {formatCentavos(charges.totals.charged)} charged of{" "}
                  {formatCentavos(student.maxAuthorizedAmountCents)} authorized
                  {charges.totals.charged > student.maxAuthorizedAmountCents &&
                    " — over the authorized cap"}
                </p>
              </div>
            )}
        </div>

        {/* Mark a session: manual date + start time */}
        <div className="mt-6 rounded-2xl border border-border bg-card px-6 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1">
              <p className="font-medium">Mark a session</p>
              <p className="text-sm text-muted-foreground">
                Pick the date and start time manually (8:00am–8:45pm). Sessions
                used scale with duration
                {student.authorizedMinutes
                  ? ` (${student.authorizedMinutes}-min authorized)`
                  : ""}
                .
              </p>
            </div>
            <MarkSessionDialog
              studentId={student._id}
              studentName={student.name}
              authorizedMinutes={student.authorizedMinutes}
              remainingSessions={student.remainingSessions}
              trigger={
                <Button
                  className="rounded-full"
                  disabled={student.remainingSessions === 0}
                >
                  <CalendarCheck className="mr-2 size-4" />
                  Mark session
                </Button>
              }
            />
          </div>
        </div>

        {/* Notes */}
        {student.notes && (
          <div className="mt-4 rounded-2xl border border-border bg-card p-6">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Notes
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground/90">
              {student.notes}
            </p>
          </div>
        )}

        {/* Charges & payments */}
        <Card className="mt-6 rounded-2xl border-border shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center justify-between gap-3 font-serif text-xl">
              <span>Charges &amp; payments</span>
              {charges !== undefined && (
                <span className="font-sans text-xs font-normal text-muted-foreground">
                  {formatCentavos(charges.totals.paid)} paid of{" "}
                  {formatCentavos(charges.totals.charged)}
                  {charges.totals.unpaidCount > 0 &&
                    ` · ${charges.totals.unpaidCount} unpaid`}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {charges === undefined ? (
              <p className="py-4 text-sm text-muted-foreground">Loading…</p>
            ) : charges.rows.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                No charges linked to this student yet. File a ledger entry and
                link them to start tracking what they owe.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {charges.rows.map((row) => (
                  <li key={row._id}>
                    <Link
                      to={`/entries/${row._id}`}
                      className="group flex items-center gap-4 py-3 transition-colors hover:bg-accent/50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium group-hover:text-primary">
                          {row.title}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {row.provider ? `${row.provider} · ` : ""}
                          filed by {row.authorName} ·{" "}
                          {new Date(row.createdAt).toLocaleDateString("en-PH", {
                            month: "short",
                            day: "numeric",
                          })}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "hidden whitespace-nowrap font-serif text-base font-semibold sm:block",
                          amountTone(row.amount),
                        )}
                      >
                        {formatCentavos(row.amount)}
                      </span>
                      {row.status === "approved" ? (
                        row.paidAt !== undefined ? (
                          <span className="rounded-full bg-[#2e5c4d] px-3 py-1 text-xs font-medium text-[#fdfcf9]">
                            paid
                          </span>
                        ) : (
                          <span className="rounded-full bg-[#8a8578] px-3 py-1 text-xs font-medium text-[#fdfcf9]">
                            unpaid
                          </span>
                        )
                      ) : (
                        <span
                          className={cn(
                            "rounded-full px-3 py-1 text-xs font-medium",
                            STATUS_STYLES[row.status],
                          )}
                        >
                          {row.status}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Attendance timeline */}
        <Card className="mt-6 rounded-2xl border-border shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center justify-between gap-2 font-serif text-xl">
              <span className="flex items-center gap-2">
                <CalendarDays className="size-4 text-muted-foreground" />
                Days attended
              </span>
              <span className="font-sans text-xs font-normal text-muted-foreground">
                {student.records.length} session
                {student.records.length === 1 ? "" : "s"} total
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {student.records.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                No attendance yet. Mark the first session above.
              </p>
            ) : (
              <>
                {/* Per-month totals: distinct days, sessions used, hours */}
                <ul className="mb-4 grid gap-2 sm:grid-cols-2">
                  {monthly.map((month) => (
                    <li
                      key={month.key}
                      className="rounded-xl border border-border bg-secondary/50 px-4 py-3"
                    >
                      <p className="font-serif text-base font-semibold">
                        {month.label}
                      </p>
                      <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                        <div className="flex items-baseline gap-1.5">
                          <dt>Days</dt>
                          <dd className="font-serif text-base font-semibold text-foreground">
                            {month.days}
                          </dd>
                        </div>
                        <div className="flex items-baseline gap-1.5">
                          <dt>Sessions</dt>
                          <dd className="font-serif text-base font-semibold text-foreground">
                            {month.sessions}
                          </dd>
                        </div>
                        <div className="flex items-baseline gap-1.5">
                          <dt>Hours</dt>
                          <dd className="font-serif text-base font-semibold text-foreground">
                            {formatHours(month.minutes / 60)}
                          </dd>
                        </div>
                      </dl>
                    </li>
                  ))}
                </ul>

                {/* Filter the day list down to one month */}
                <div className="mb-3 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setMonthFilter("all")}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs transition-colors",
                      monthFilter === "all"
                        ? "bg-[#2e5c4d] text-[#fdfcf9]"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    All months
                  </button>
                  {monthly.map((month) => (
                    <button
                      key={month.key}
                      type="button"
                      onClick={() => setMonthFilter(month.key)}
                      className={cn(
                        "rounded-full px-3 py-1 text-xs transition-colors",
                        monthFilter === month.key
                          ? "bg-[#2e5c4d] text-[#fdfcf9]"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {month.label}
                    </button>
                  ))}
                </div>

                <ul className="divide-y divide-border">
                  {visibleRecords.map((record) => (
                    <li
                      key={record._id}
                      className="flex items-center gap-4 py-3"
                    >
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 font-serif text-sm text-primary">
                        {record.sessionNumber}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          {record.day}
                          {record.startTime && (
                            <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                              {formatStartTime(record.startTime)}
                              {record.endTime &&
                                ` – ${formatStartTime(record.endTime)}`}
                            </span>
                          )}
                          <ReviewBadge status={record.reviewStatus} />
                          {record.sessionsConsumed > 1 && (
                            <span className="ml-2 rounded-full bg-[#8a8578]/20 px-2 py-0.5 text-[11px] font-medium text-[#8a8578]">
                              {record.durationMinutes} min · {record.sessionsConsumed} sessions
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Sessions {record.sessionNumber}
                          {record.sessionsConsumed > 1
                            ? `–${record.sessionNumber + record.sessionsConsumed - 1}`
                            : ""} ·{" "}
                          {new Date(record.createdAt).toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </p>
                        {record.reviewStatus === "rejected" &&
                          record.reviewNote && (
                            <p className="mt-1 rounded-lg bg-[#9c3d31]/10 px-2 py-1 text-xs text-[#9c3d31]">
                              Rejected: {record.reviewNote}
                            </p>
                          )}
                      </div>
                      {!isAdmin ? (
                        <span
                          className="shrink-0 text-[11px] text-muted-foreground"
                          title="You can see the review status. Only an admin can approve or reject."
                        >
                          Status visible · admin decides
                        </span>
                      ) : null}
                      {isAdmin && (
                        <div className="flex shrink-0 items-center gap-1">
                          {record.reviewStatus !== "approved" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-muted-foreground hover:text-[#2e5c4d]"
                              onClick={() => void handleReview(record._id, "approved")}
                            >
                              <CheckCircle2 className="mr-1.5 size-3.5" />
                              Approve
                            </Button>
                          )}
                          {record.reviewStatus !== "rejected" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-muted-foreground hover:text-[#9c3d31]"
                              onClick={() => setRejectId(record._id)}
                            >
                              <XCircle className="mr-1.5 size-3.5" />
                              Reject
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground"
                            onClick={() => handleUndo(record._id)}
                          >
                            <Clock className="mr-1.5 size-3.5" />
                            Undo
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Reject reason */}
      <Dialog
        open={rejectId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRejectId(null);
            setRejectNote("");
          }
        }}
      >
        <DialogContent className="rounded-2xl sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">Reject session?</DialogTitle>
            <DialogDescription>
              Tell the recorder why this session is being turned down. The
              reason shows on the attendance record.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="reject-note">Reason</Label>
            <Textarea
              id="reject-note"
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder="e.g. Wrong date, or the time does not match."
              className="min-h-20"
              disabled={reviewing}
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setRejectId(null);
                setRejectNote("");
              }}
              disabled={reviewing}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={reviewing || rejectNote.trim() === ""}
              onClick={() => {
                if (rejectId === null) return;
                setReviewing(true);
                void handleReview(rejectId, "rejected", rejectNote).finally(() =>
                  setReviewing(false),
                );
              }}
            >
              {reviewing ? "Rejecting…" : "Reject session"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="rounded-2xl sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">
              Delete {student.name}?
            </DialogTitle>
            <DialogDescription>
              This removes the student and their whole attendance history.
              This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Keep student
            </Button>
            <Button
              variant="destructive"
              className="rounded-full"
              onClick={handleDelete}
            >
              Delete student
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">
              Edit student
            </DialogTitle>
            <DialogDescription>
              Adjusting the session total updates the remaining count right
              away.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-student-name">Name</Label>
              <Input
                id="edit-student-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-student-contact">Contact</Label>
              <Input
                id="edit-student-contact"
                value={editContact}
                onChange={(e) => setEditContact(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-student-case-no">Case no.</Label>
              <Input
                id="edit-student-case-no"
                value={editCaseNo}
                onChange={(e) => setEditCaseNo(e.target.value)}
                placeholder="e.g. CASE-2026-014"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-student-sessions">Authorized sessions</Label>
              <Input
                id="edit-student-sessions"
                value={editTotalSessions}
                onChange={(e) => setEditTotalSessions(e.target.value)}
                inputMode="numeric"
                required
              />
            </div>

            {/* Authorization fields */}
            <div className="rounded-xl border border-border bg-secondary/50 p-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Authorization
              </p>
              <div className="mt-3 grid gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label className="text-xs">
                      Max amount{" "}
                      <span className="text-muted-foreground">(auto)</span>
                    </Label>
                    <div className="flex h-9 items-center rounded-md border border-border bg-background px-3 text-sm font-medium">
                      {editDerivedMax !== null
                        ? `$${editDerivedMax.toFixed(2)}`
                        : "—"}
                    </div>
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Rate / session ($)</Label>
                    <Input
                      value={editRate}
                      onChange={(e) => setEditRate(e.target.value)}
                      inputMode="decimal"
                      placeholder="45"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Max amount = authorized sessions × rate per session.
                </p>
                <div className="grid gap-1.5">
                  <Label className="text-xs">
                    Approved hours <span className="text-muted-foreground">(auto)</span>
                  </Label>
                  <div className="flex h-9 items-center rounded-md border border-border bg-background px-3 text-sm font-medium">
                    {editDerivedHours !== null
                      ? Number.isInteger(editDerivedHours)
                        ? `${editDerivedHours} h`
                        : `${editDerivedHours.toFixed(1)} h`
                      : "—"}
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Authorized minutes per session</Label>
                  <div className="flex overflow-hidden rounded-full border border-border text-xs font-medium">
                    {([30, 60] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setEditMinutes(m)}
                        className={cn(
                          "flex-1 px-3 py-1.5 transition-colors",
                          editMinutes === m
                            ? "bg-[#2e5c4d] text-[#fdfcf9]"
                            : "text-muted-foreground hover:text-foreground",
                          m === 60 && "border-l border-border",
                        )}
                      >
                        {m} minutes
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-student-notes">Notes</Label>
              <Textarea
                id="edit-student-notes"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                className="min-h-20"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" className="rounded-full">
                Save changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
