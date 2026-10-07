import { AppShell } from "@/components/AppShell";import { amountTone,
  formatCentavos,
  formatDate,
  formatDateTime,
  STATUS_STYLES,
} from "@/lib/format";
import { useUserTimezone } from "@/hooks/use-user-timezone";
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import {
  CheckCircle2,
  ChevronsUpDown,
  Clock,
  Inbox,
  Plus,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

const PAGE_SIZE = 25;

/** Student-relevant charge categories for the entry dialogs. */
const CATEGORIES = [
  "paper invoice",
  "session fee",
  "materials",
  "assessment",
  "transportation",
  "other",
] as const;

/** Offered as one-tap presets in the entry description combobox. */
const TITLE_PRESETS = ["Paper Invoice", "Polaris Billing"] as const;

/** Compact approved/pending/rejected counter used on the ledger. */
function ReviewPill({
  count,
  status,
}: {
  count: number;
  status: "approved" | "pending" | "rejected";
}) {
  if (count === 0) return null;
  const styles = {
    approved: "bg-[#2e5c4d] text-[#fdfcf9]",
    pending: "bg-[#8a8578]/25 text-[#6b6459]",
    rejected: "bg-[#9c3d31] text-[#fdfcf9]",
  }[status];
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-0.5 text-[11px] font-medium",
        styles,
      )}
    >
      {count} {status}
    </span>
  );
}

type StatusFilter = "all" | "pending" | "approved" | "rejected";

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

export default function Entries() {
  const { user } = useAuth();
  const userTimezone = useUserTimezone();

  const {
    results,
    status: pageStatus,
    loadMore,
  } = usePaginatedQuery(
    api.entries.list,
    { paginationOpts: { numItems: PAGE_SIZE, cursor: null } },
    { initialNumItems: PAGE_SIZE },
  );

  const [filter, setFilter] = useState<StatusFilter>("all");
  const [dialogOpen, setDialogOpen] = useState(false);

  // Totals come from the server over the full ledger scope, not page 1.
  const stats = useQuery(api.entries.stats);
  // Per-student attendance review state (approved / pending / rejected).
  const reviewSummary = useQuery(api.students.reviewSummary);

  const visible =
    filter === "all" ? results : results.filter((e) => e.status === filter);

  return (
    <AppShell active="entries">
      <div className="mx-auto w-full max-w-4xl px-6 py-8 sm:py-10">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              The ledger
            </p>
            <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
              Entries
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {stats === undefined ? "…" : stats.pending} awaiting review ·{" "}
              {user?.role === "admin"
                ? "you can see and settle everyone's entries"
                : "the whole ledger, and where each entry stands"}
            </p>
          </div>
          <NewEntryDialog open={dialogOpen} onOpenChange={setDialogOpen} />
        </div>

        {/* Stat cards */}
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-border bg-card px-6 py-5">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Approved net
            </p>
            <p
              className={cn(
                "mt-1 font-serif text-3xl font-semibold",
                amountTone(stats?.netApproved ?? 0),
              )}
            >
              {stats === undefined
                ? "…"
                : formatCentavos(stats.netApproved)}
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card px-6 py-5">
            <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <Clock className="size-3" />
              Awaiting review
            </p>
            <p className="mt-1 font-serif text-3xl font-semibold">
              {stats === undefined ? "…" : stats.pending}
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card px-6 py-5">
            <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <CheckCircle2 className="size-3" />
              Settled
            </p>
            <p className="mt-1 font-serif text-3xl font-semibold">
              {stats === undefined ? "…" : stats.approvedCount}
            </p>
          </div>
        </div>

        {/* Student attendance review: which months are approved, and any
            rejected days with the reason. */}
        {reviewSummary !== undefined && reviewSummary.length > 0 && (
          <section className="mt-8">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-serif text-2xl font-semibold tracking-tight">
                Student attendance
              </h2>
              <p className="text-xs text-muted-foreground">
                {user?.role === "admin"
                  ? "Approve or reject a student's marked sessions"
                  : "Review status is visible to everyone · admins decide"}
              </p>
            </div>
            <ul className="mt-3 grid gap-2">
              {reviewSummary.map((student) => (
                <li
                  key={student._id}
                  className="rounded-2xl border border-border bg-card px-5 py-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Link
                      to={`/students/${student._id}`}
                      className="font-serif text-lg font-semibold hover:underline"
                    >
                      {student.name}
                    </Link>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <ReviewPill count={student.totals.approved} status="approved" />
                      <ReviewPill count={student.totals.pending} status="pending" />
                      <ReviewPill count={student.totals.rejected} status="rejected" />
                    </div>
                  </div>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {student.months.map((month) => (
                      <li
                        key={month.key}
                        className="flex flex-wrap items-center gap-2 rounded-lg bg-secondary/60 px-2.5 py-1 text-xs"
                      >
                        <span className="font-medium">{month.label}</span>
                        {month.approved > 0 && (
                          <span className="text-[#2e5c4d]">
                            {month.approved} approved
                          </span>
                        )}
                        {month.pending > 0 && (
                          <span className="text-muted-foreground">
                            {month.pending} pending
                          </span>
                        )}
                        {month.rejected > 0 && (
                          <span className="text-[#9c3d31]">
                            {month.rejected} rejected
                          </span>
                        )}
                        {month.rejectedNotes.map((rejected) => (
                          <span
                            key={rejected.day}
                            className="rounded-full bg-[#9c3d31]/10 px-2 py-0.5 text-[11px] text-[#9c3d31]"
                          >
                            {rejected.day}
                            {rejected.note ? `: ${rejected.note}` : ""}
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </section>
        )}

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

        {/* Entries */}
        <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
          {pageStatus === "LoadingFirstPage" ? (
            <div className="px-6 py-16 text-center text-sm text-muted-foreground">
              Loading entries…
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-16 text-center">
              <Inbox className="size-8 text-muted-foreground/50" />
              <p className="mt-3 font-serif text-lg font-semibold">
                {filter === "all"
                  ? "Nothing on the ledger yet"
                  : `No ${filter} entries`}
              </p>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                File your first entry and it will show up here, ready for
                review.
              </p>
              <Button
                className="mt-5 rounded-full"
                variant="outline"
                onClick={() => setDialogOpen(true)}
              >
                <Plus className="mr-2 size-4" />
                New entry
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {visible.map((entry) => (
                <li key={entry._id}>
                  <Link
                    to={`/entries/${entry._id}`}
                    className="group flex items-center gap-4 px-6 py-4 transition-colors hover:bg-accent/50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium group-hover:text-primary">
                        {entry.title}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {entry.studentName
                          ? `${entry.studentName} · `
                          : ""}
                        {entry.category ?? "uncategorized"} · filed by{" "}
                        {entry.authorName} · {formatDateTime(entry.createdAt, userTimezone)}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "hidden whitespace-nowrap font-serif text-lg font-semibold sm:block",
                        amountTone(entry.amount),
                      )}
                    >
                      {formatCentavos(entry.amount)}
                    </span>
                    {entry.status === "approved" && entry.paidAt !== undefined && (
                      <span className="hidden rounded-full bg-[#2e5c4d]/10 px-3 py-1 text-xs font-medium text-[#2e5c4d] sm:inline">
                        paid
                      </span>
                    )}
                    <span
                      className={cn(
                        "rounded-full px-3 py-1 text-xs font-medium",
                        STATUS_STYLES[entry.status],
                      )}
                    >
                      {entry.status}
                    </span>
                    {entry.status === "rejected" && entry.reviewNote && (
                      <span className="w-full truncate text-xs text-[#9c3d31] sm:w-auto">
                        {entry.reviewNote}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {pageStatus === "CanLoadMore" && (
            <div className="border-t border-border p-2 text-center">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => loadMore(PAGE_SIZE)}
              >
                Load more
              </Button>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

/** Dialog to file a new entry. Kept close to the page that triggers it. */
function NewEntryDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [title, setTitle] = useState("");
  const [rawAmount, setRawAmount] = useState("");
  // Every entry is a charge the student owes, so amounts are always money out.
  const [category, setCategory] = useState<string>("paper invoice");
  const [description, setDescription] = useState("");
  const [titleOpen, setTitleOpen] = useState(false);
  const [studentId, setStudentId] = useState<string>("none");
  const [provider, setProvider] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const createEntry = useMutation(api.entries.create);

  // Students for the charge picker.
  const students = useQuery(api.students.list);
  const studentOptions = (students ?? []).map((s) => ({
    id: s._id,
    name: s.name,
  }));

  // Providers for the paid-to picker.
  const providers = useQuery(api.providers.list);

  const reset = () => {
    setTitle("");
    setRawAmount("");
    setCategory("paper invoice");
    setDescription("");
    setStudentId("none");
    setProvider("");
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = Number.parseFloat(rawAmount.replace(/,/g, ""));
    if (!title.trim()) {
      toast.error("Give the entry a short description.");
      return;
    }
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("Enter an amount greater than zero.");
      return;
    }
    setIsSubmitting(true);
    try {
      // Charges are money out, so the stored amount is always negative.
      const amount = -Math.round(value * 100);
      await createEntry({
        title,
        amount,
        category,
        description: description || undefined,
        studentId: studentId === "none" ? undefined : (studentId as Id<"students">),
        provider: provider || undefined,
      });
      toast.success("Entry filed. It's now pending review.");
      reset();
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not file the entry.",
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
          New entry
        </Button>
      </DialogTrigger>
      <DialogContent className="rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">
            File a new entry
          </DialogTitle>
          <DialogDescription>
            Log a charge or payment. Link a student to track their balance.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="entry-title">What is it for?</Label>
            <Popover open={titleOpen} onOpenChange={setTitleOpen}>
              <PopoverTrigger asChild>
                <Button
                  id="entry-title"
                  variant="outline"
                  role="combobox"
                  aria-expanded={titleOpen}
                  className="w-full justify-between rounded-xl font-normal"
                  disabled={isSubmitting}
                >
                  <span className="truncate">
                    {title.trim() || "Pick or type a description"}
                  </span>
                  <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-[--radix-popover-trigger-width] min-w-[var(--radix-popover-trigger-width)] p-0"
                align="start"
              >
                <Command shouldFilter={false} className="rounded-xl">
                  <CommandInput
                    value={title}
                    onValueChange={setTitle}
                    onKeyDown={(event) => {
                      // Enter keeps what was typed; Escape closes the list.
                      if (event.key === "Enter") {
                        event.preventDefault();
                        setTitleOpen(false);
                      }
                    }}
                    placeholder="Pick or type a description…"
                    className="h-10"
                  />
                  <CommandList>
                    <CommandEmpty>No preset matches. Your text is kept.</CommandEmpty>
                    <CommandGroup heading="Common">
                      {TITLE_PRESETS.map((preset) => (
                        <CommandItem
                          key={preset}
                          value={preset}
                          onSelect={() => {
                            setTitle(preset);
                            setTitleOpen(false);
                          }}
                          className="cursor-pointer"
                        >
                          {preset}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <p className="text-[11px] text-muted-foreground">
              Pick one of the presets or type your own.
            </p>
          </div>

          <div className="grid gap-2">
            <div className="grid gap-2">
              <Label htmlFor="entry-amount">Amount ($)</Label>
              <Input
                id="entry-amount"
                value={rawAmount}
                onChange={(e) => setRawAmount(e.target.value)}
                inputMode="decimal"
                placeholder="1,250.00"
                disabled={isSubmitting}
                required
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Category</Label>
            <Select
              value={category}
              onValueChange={setCategory}
              disabled={isSubmitting}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pick a category" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>
              Student <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Select
              value={studentId}
              onValueChange={setStudentId}
              disabled={isSubmitting}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Link a student" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="none">No student — general entry</SelectItem>
                {studentOptions.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>
              Provider <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Select
              value={provider === "" ? "none" : provider}
              onValueChange={(v) => setProvider(v === "none" ? "" : v)}
              disabled={isSubmitting}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Who the student paid" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="none">No provider</SelectItem>
                {(providers ?? []).map((p) => (
                  <SelectItem key={p._id} value={p.name}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(providers ?? []).length === 0 && (
              <p className="text-[11px] text-muted-foreground">
                No providers yet — add them on the Providers page.
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="entry-notes">
              Notes <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="entry-notes"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Anything the reviewer should know — receipts, links, context."
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
              {isSubmitting ? "Filing…" : "File entry"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
