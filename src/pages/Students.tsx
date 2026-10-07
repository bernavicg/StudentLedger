import { AppShell } from "@/components/AppShell";
import { MarkSessionDialog } from "@/components/MarkSessionDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import { formatCentavos } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  CalendarCheck,
  Plus,
  Search,
  UserPlus,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

/** Minutes -> "2.5 h" / "3 h" / "45 min" for the authorization summary. */
function formatHours(hours: number): string {
  if (hours === 0) return "0 h";
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
}

/**
 * Admin-only manual inputs for the card's derived usage numbers: used
 * sessions (attendance) and used amount / charged (approved entries). Blank
 * input = keep the automatic total; saving a value stores an override, and
 * clearing it falls back to the derived number again.
 */
function UsageOverride({
  studentId,
  usedSessions,
  chargedCents,
  manualUsedSessions,
  manualUsedAmountCents,
}: {
  studentId: Id<"students">;
  usedSessions: number;
  chargedCents: number | null;
  manualUsedSessions: number | null;
  manualUsedAmountCents: number | null;
}) {
  const setUsage = useMutation(api.students.setUsage);
  const [saving, setSaving] = useState(false);
  // Bumped on errors so the uncontrolled inputs remount and reset.
  const [nonce, setNonce] = useState(0);

  const save = async (args: {
    usedSessions?: number | null;
    usedAmountCents?: number | null;
  }) => {
    setSaving(true);
    try {
      await setUsage({ studentId, ...args });
      toast.success("Usage updated.");
    } catch (error) {
      setNonce((n) => n + 1);
      toast.error(
        error instanceof Error ? error.message : "Could not save usage.",
      );
    } finally {
      setSaving(false);
    }
  };

  const saveSessions = async (raw: string) => {
    const text = raw.trim();
    const value = text === "" ? null : Number(text);
    if (value !== null && (!Number.isInteger(value) || value < 0)) {
      setNonce((n) => n + 1);
      toast.error("Used sessions must be a whole number of zero or more.");
      return;
    }
    if ((value ?? null) === (manualUsedSessions ?? null)) return;
    // Typing the automatic total back in just clears the override.
    if (value !== null && manualUsedSessions === null && value === usedSessions) return;
    await save({ usedSessions: value });
  };

  const saveAmount = async (raw: string) => {
    const text = raw.replace(/[^0-9.]/g, "").trim();
    const value = text === "" ? null : Math.round(Number(text) * 100);
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      setNonce((n) => n + 1);
      toast.error("Used amount must be a number of zero or more.");
      return;
    }
    if ((value ?? null) === (manualUsedAmountCents ?? null)) return;
    if (
      value !== null &&
      manualUsedAmountCents === null &&
      chargedCents !== null &&
      value === chargedCents
    ) {
      return;
    }
    await save({ usedAmountCents: value });
  };

  const resetKey = `${manualUsedSessions ?? "s"}:${manualUsedAmountCents ?? "a"}:${usedSessions}:${chargedCents ?? "c"}:${nonce}`;

  return (
    <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3">
      <label className="grid gap-1">
        <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
          Used sessions (manual)
        </span>
        <Input
          key={`sessions-${resetKey}`}
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          disabled={saving}
          defaultValue={manualUsedSessions !== null ? String(manualUsedSessions) : ""}
          placeholder={String(usedSessions)}
          className="h-8 text-sm"
          onBlur={(event) => void saveSessions(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </label>
      <label className="grid gap-1">
        <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
          Used amount (manual)
        </span>
        <Input
          key={`amount-${resetKey}`}
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          disabled={saving}
          defaultValue={
            manualUsedAmountCents !== null
              ? (manualUsedAmountCents / 100).toFixed(2)
              : ""
          }
          placeholder={
            chargedCents !== null ? (chargedCents / 100).toFixed(2) : "—"
          }
          className="h-8 text-sm"
          onBlur={(event) => void saveAmount(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </label>
      <p className="col-span-2 text-[11px] text-muted-foreground">
        Admin override — blank keeps the automatic total (attendance + approved
        entries).
      </p>
    </div>
  );
}

/** One labelled figure in the roster summary grid. */
function SummaryStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "muted";
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 truncate font-serif text-base font-semibold",
          tone === "muted" ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}

export default function Students() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const students = useQuery(api.students.list);
  const createStudent = useMutation(api.students.create);

  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  const visible = useMemo(() => {
    if (!students) return [];
    const query = search.trim().toLowerCase();
    return query
      ? students.filter(
          (s) =>
            s.name.toLowerCase().includes(query) ||
            s.contact?.toLowerCase().includes(query) ||
            s.caseNo?.toLowerCase().includes(query),
        )
      : students;
  }, [students, search]);

  if (students === undefined) {
    return (
      <AppShell active="students">
        <div className="mx-auto w-full max-w-4xl px-6 py-10">
          <Skeleton className="h-9 w-48" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-40 rounded-2xl" />
            ))}
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell active="students">
      <div className="mx-auto w-full max-w-4xl px-6 py-8 sm:py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Students
            </p>
            <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
              Student sessions
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {students.length} enrolled ·{" "}
              {students.filter((s) => s.remainingSessions > 0).length} with
              sessions remaining
            </p>
          </div>
          <AddStudentDialog
            open={addOpen}
            onOpenChange={setAddOpen}
            onCreate={createStudent}
          />
        </div>

        {/* Search */}
        <div className="relative mt-6">
          <Search className="absolute left-3.5 top-3 size-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search students…"
            className="pl-10"
          />
        </div>

        {/* Roster */}
        {visible.length === 0 ? (
          <div className="mt-4 flex flex-col items-center rounded-2xl border border-border bg-card px-6 py-16 text-center">
            <Users className="size-8 text-muted-foreground/50" />
            <p className="mt-3 font-serif text-lg font-semibold">
              {students.length === 0
                ? "No students enrolled yet"
                : "No students match that search"}
            </p>
            {students.length === 0 && (
              <>
                <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                  Add your first student and track their session days here.
                </p>
                <Button
                  className="mt-5 rounded-full"
                  onClick={() => setAddOpen(true)}
                >
                  <UserPlus className="mr-2 size-4" />
                  Add student
                </Button>
              </>
            )}
          </div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {visible.map((student) => {
              return (
                <div
                  key={student._id}
                  className="flex flex-col rounded-2xl border border-border bg-card p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          to={`/students/${student._id}`}
                          className="truncate font-serif text-lg font-semibold hover:text-primary"
                        >
                          {student.name}
                        </Link>
                        {student.caseNo && (
                          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                            {student.caseNo}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {student.contact ?? "no contact"}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-3 py-1 text-xs font-medium",
                        student.remainingSessions === 0
                          ? "bg-[#9c3d31] text-[#fdfcf9]"
                          : student.remainingSessions <=
                              Math.ceil(student.totalSessions / 3)
                            ? "bg-[#8a8578] text-[#fdfcf9]"
                            : "bg-[#2e5c4d] text-[#fdfcf9]",
                      )}
                    >
                      {student.remainingSessions} left
                    </span>
                  </div>

                  {/* Session progress */}
                  <div className="mt-4">
                    <div className="flex items-baseline justify-between text-xs text-muted-foreground">
                      <span>
                        {student.usedSessions} of {student.totalSessions}{" "}
                        sessions used
                      </span>
                      <span>
                        {student.attendanceDays}{" "}
                        {student.attendanceDays === 1 ? "day" : "days"}{" "}
                        attended
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          student.remainingSessions === 0
                            ? "bg-[#9c3d31]"
                            : "bg-[#2e5c4d]",
                        )}
                        style={{
                          width: `${Math.min(
                            (student.usedSessions / student.totalSessions) *
                              100,
                            100,
                          )}%`,
                        }}
                      />
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        {student.lastAttendanceDay
                          ? `Last attended ${student.lastAttendanceDay}`
                          : "No attendance yet"}
                      </span>
                      {student.pendingReviewCount > 0 && (
                        <span className="rounded-full bg-[#8a8578]/25 px-2 py-0.5 text-[11px] font-medium text-[#6b6459]">
                          {student.pendingReviewCount} awaiting review
                        </span>
                      )}
                      {student.rejectedCount > 0 && (
                        <span className="rounded-full bg-[#9c3d31]/15 px-2 py-0.5 text-[11px] font-medium text-[#9c3d31]">
                          {student.rejectedCount} rejected
                        </span>
                      )}
                    </div>

                    {/* Authorization summary: authorized vs remaining, side by side */}
                    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-3 text-xs">
                      <SummaryStat
                        label="Authorized sessions"
                        value={`${student.totalSessions}`}
                      />
                      <SummaryStat
                        label="Remaining sessions"
                        value={`${student.remainingSessions}`}
                        tone={student.remainingSessions === 0 ? "muted" : "default"}
                      />
                      {student.approvedHours !== null && (
                        <SummaryStat
                          label="Authorized hours"
                          value={formatHours(student.approvedHours)}
                        />
                      )}
                      {student.remainingHours !== null && (
                        <SummaryStat
                          label="Remaining hours"
                          value={formatHours(student.remainingHours)}
                          tone={
                            student.remainingHours === 0 ? "muted" : "default"
                          }
                        />
                      )}
                      {student.authorizedMinutes !== null && (
                        <SummaryStat
                          label="Per session"
                          value={`${student.authorizedMinutes} min`}
                        />
                      )}
                      {student.ratePerSessionCents !== null && (
                        <SummaryStat
                          label="Rate per session"
                          value={formatCentavos(student.ratePerSessionCents)}
                        />
                      )}
                      {student.maxAuthorizedAmountCents !== null &&
                      student.remainingBalanceCents !== null && (
                        <>
                          <SummaryStat
                            label="Charged"
                            value={formatCentavos(
                              Math.min(
                                student.maxAuthorizedAmountCents,
                                student.maxAuthorizedAmountCents -
                                  student.remainingBalanceCents,
                              ),
                            )}
                          />
                          <SummaryStat
                            label="Remaining balance"
                            value={formatCentavos(student.remainingBalanceCents)}
                            tone={
                              student.remainingBalanceCents === 0
                                ? "muted"
                                : "default"
                            }
                          />
                        </>
                      )}
                    </div>

                    {/* Admin: manually adjust the derived usage numbers */}
                    {isAdmin && (
                      <UsageOverride
                        studentId={student._id}
                        usedSessions={student.usedSessions}
                        chargedCents={student.chargedCents}
                        manualUsedSessions={student.manualUsedSessions}
                        manualUsedAmountCents={student.manualUsedAmountCents}
                      />
                    )}

                    {/* Balance breakdown */}
                    {student.maxAuthorizedAmountCents !== null &&
                      student.remainingBalanceCents !== null && (
                        <div className="mt-2 rounded-xl border border-border bg-secondary/40 px-3 py-2 text-xs">
                          <p className="text-muted-foreground">
                            Balance: {formatCentavos(student.maxAuthorizedAmountCents)}
                            {student.remainingBalanceCents < student.maxAuthorizedAmountCents
                              ? ` − ${formatCentavos(
                                  student.maxAuthorizedAmountCents -
                                    student.remainingBalanceCents,
                                )} = ${formatCentavos(student.remainingBalanceCents)}`
                              : ``}
                          </p>
                        </div>
                      )}

                    {/* Over-cap alert */}
                    {student.maxAuthorizedAmountCents !== null &&
                      student.remainingBalanceCents !== null &&
                      student.remainingBalanceCents === 0 && (
                        <div className="mt-2 rounded-xl bg-[#9c3d31]/10 px-3 py-2 text-xs text-[#9c3d31]">
                          ⚠️ Charged over the authorized cap.
                        </div>
                      )}

                    {/* Duration cost hint: a longer mark burns more sessions */}
                    {student.authorizedMinutes === 30 && (
                      <p className="mt-2 text-[11px] text-[#8a8578]">
                        30-min plan: a 60-minute mark uses 2 sessions.
                      </p>
                    )}
                  </div>

                  {/* Actions: mark a session with a manual date + time */}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <MarkSessionDialog
                      studentId={student._id}
                      studentName={student.name}
                      authorizedMinutes={student.authorizedMinutes}
                      remainingSessions={student.remainingSessions}
                      trigger={
                        <Button
                          className="flex-1 rounded-full"
                          disabled={student.remainingSessions === 0}
                        >
                          <CalendarCheck className="mr-2 size-4" />
                          Mark session
                        </Button>
                      }
                    />
                    <Button asChild className="rounded-full" variant="ghost">
                      <Link to={`/students/${student._id}`}>Details</Link>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}

/** Add-student dialog, kept next to the roster that renders it. */
function AddStudentDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: ReturnType<typeof useMutation<typeof api.students.create>>;
}) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [caseNo, setCaseNo] = useState("");
  const [totalSessions, setTotalSessions] = useState("10");
  const [rate, setRate] = useState("");
  const [minutes, setMinutes] = useState<"30" | "60" | "none">("60");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Max authorized amount is derived: sessions × rate.
  const sessionsNum = Number.parseInt(totalSessions, 10);
  const rateNum = Number.parseFloat(rate.replace(/,/g, ""));
  const derivedMax =
    Number.isInteger(sessionsNum) && sessionsNum > 0 &&
    Number.isFinite(rateNum) && rateNum >= 0
      ? sessionsNum * rateNum
      : null;
  // Approved hours: 30-min sessions count as half, 60-min as full.
  const derivedHours =
    Number.isInteger(sessionsNum) && sessionsNum > 0 && minutes !== "none"
      ? (sessionsNum * Number(minutes)) / 60
      : null;

  const reset = () => {
    setName("");
    setContact("");
    setCaseNo("");
    setTotalSessions("10");
    setRate("");
    setMinutes("60");
    setNotes("");
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const sessions = Number.parseInt(totalSessions, 10);
    if (!name.trim()) {
      toast.error("Give the student a name.");
      return;
    }
    if (!Number.isInteger(sessions) || sessions <= 0) {
      toast.error("Sessions must be a whole number of at least 1.");
      return;
    }
    const rateCents = rate.trim() === "" ? undefined : Number.parseFloat(rate.replace(/,/g, ""));
    if (rateCents !== undefined && (!Number.isFinite(rateCents) || rateCents < 0)) {
      toast.error("Rate per session must be zero or more.");
      return;
    }
    setIsSubmitting(true);
    try {
      await onCreate({
        name,
        contact: contact || undefined,
        caseNo: caseNo || undefined,
        totalSessions: sessions,
        ratePerSession: rateCents,
        authorizedMinutes: minutes === "none" ? undefined : Number(minutes) as 30 | 60,
        notes: notes || undefined,
      });
      toast.success("Student enrolled.");
      reset();
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not enroll student.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button className="rounded-full">
          <Plus className="mr-2 size-4" />
          Add student
        </Button>
      </DialogTrigger>
      <DialogContent className="rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">
            Enroll a student
          </DialogTitle>
          <DialogDescription>
            Set their authorized sessions, rate, and spending cap. Attendance
            and charges are tracked automatically.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="student-name">Name</Label>
            <Input
              id="student-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Mira Chen"
              disabled={isSubmitting}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="student-contact">
              Contact <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="student-contact"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="Phone or email"
              disabled={isSubmitting}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="student-case-no">
              Case no. <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="student-case-no"
              value={caseNo}
              onChange={(e) => setCaseNo(e.target.value)}
              placeholder="e.g. CASE-2026-014"
              disabled={isSubmitting}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="student-sessions">Authorized sessions</Label>
            <Input
              id="student-sessions"
              value={totalSessions}
              onChange={(e) => setTotalSessions(e.target.value)}
              inputMode="numeric"
              placeholder="10"
              disabled={isSubmitting}
              required
            />
          </div>

          {/* Authorization block */}
          <div className="rounded-xl border border-border bg-secondary/50 p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Authorization
            </p>
            <div className="mt-3 grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="student-rate" className="text-xs">
                    Rate / session ($)
                  </Label>
                  <Input
                    id="student-rate"
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                    inputMode="decimal"
                    placeholder="45"
                    className="font-medium"
                    disabled={isSubmitting}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">
                    Max amount <span className="text-muted-foreground">(auto)</span>
                  </Label>
                  <div className="flex h-9 items-center rounded-md border border-border bg-background px-3 text-sm font-medium">
                    {derivedMax !== null ? `$${derivedMax.toFixed(2)}` : "—"}
                  </div>
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
                  {derivedHours !== null
                    ? Number.isInteger(derivedHours)
                      ? `${derivedHours} h`
                      : `${derivedHours.toFixed(1)} h`
                    : "—"}
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                30-min sessions count as half a session; 60-min as full.
              </p>
              <div className="grid gap-1.5">
                <Label className="text-xs">Authorized minutes per session</Label>
                <div className="flex overflow-hidden rounded-full border border-border text-xs font-medium">
                  {(["30", "60"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMinutes(m)}
                      className={cn(
                        "flex-1 px-3 py-1.5 transition-colors",
                        minutes === m
                          ? "bg-[#2e5c4d] text-[#fdfcf9]"
                          : "text-muted-foreground hover:text-foreground",
                        m === "60" && "border-l border-border",
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
            <Label htmlFor="student-notes">
              Notes <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="student-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Schedule, preferences, anything worth remembering."
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
              {isSubmitting ? "Enrolling…" : "Enroll student"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
