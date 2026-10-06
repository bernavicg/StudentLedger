import { AppShell } from "@/components/AppShell";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  amountTone,
  formatCentavos,
  formatDateTime,
  STATUS_STYLES,
  timeAgo,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  MessageSquare,
  RotateCcw,
  Trash2,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

const CATEGORIES = [
  "operations",
  "equipment",
  "software",
  "services",
  "other",
];

/** A status action available to the current viewer. */
type StatusAction = {
  status: "approved" | "rejected" | "pending";
  label: string;
  icon: typeof CheckCircle2;
};

/** Convex document IDs are 32-char base64url-ish strings. */
const ENTRY_ID_PATTERN = /^[0-9a-z]{32}$/i;

function isValidEntryId(value: string | undefined): value is Id<"entries"> {
  return typeof value === "string" && ENTRY_ID_PATTERN.test(value);
}

export default function EntryDetail() {
  const { entryId } = useParams<{ entryId: string }>();
  const navigate = useNavigate();

  // Validate the URL param before handing it to Convex so a malformed id
  // (e.g. /entries/xyz) renders the not-found state instead of throwing.
  const validId = isValidEntryId(entryId) ? entryId : "skip";

  const entry = useQuery(api.entries.get, validId === "skip" ? "skip" : { entryId: validId });
  const comments = useQuery(
    api.entries.listComments,
    validId === "skip" ? "skip" : { entryId: validId },
  );
  const setStatus = useMutation(api.entries.setStatus);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const addComment = useMutation(api.entries.addComment);
  const removeEntry = useMutation(api.entries.remove);
  const updateEntry = useMutation(api.entries.update);

  const [commentBody, setCommentBody] = useState("");
  const [sending, setSending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const setPaid = useMutation(api.entries.setPaid);

  const [editTitle, setEditTitle] = useState("");
  const [editRawAmount, setEditRawAmount] = useState("");
  const [editDirection, setEditDirection] = useState<"in" | "out">("out");
  const [editDescription, setEditDescription] = useState("");
  const [editCategory, setEditCategory] = useState("operations");

  if (entry === undefined) {
    // A malformed id never loads; show not-found instead of a stuck skeleton.
    if (validId === "skip") {
      return (
        <AppShell active="entries">
          <div className="mx-auto flex w-full max-w-4xl flex-col items-center px-6 py-24 text-center">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              404 · entry not found
            </p>
            <h1 className="mt-3 font-serif text-2xl font-semibold">
              This entry isn't available
            </h1>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              The link looks malformed. Check the URL or head back to the
              entries list.
            </p>
            <Button asChild variant="outline" className="mt-6 rounded-full">
              <Link to="/entries">Back to entries</Link>
            </Button>
          </div>
        </AppShell>
      );
    }
    return (
      <AppShell active="entries">
        <div className="mx-auto w-full max-w-4xl px-6 py-10">
          <Skeleton className="h-9 w-72" />
          <Skeleton className="mt-4 h-4 w-96" />
          <Skeleton className="mt-8 h-40 w-full rounded-2xl" />
        </div>
      </AppShell>
    );
  }

  if (entry === null) {
    return (
      <AppShell active="entries">
        <div className="mx-auto flex w-full max-w-4xl flex-col items-center px-6 py-24 text-center">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            404 · entry not found
          </p>
          <h1 className="mt-3 font-serif text-2xl font-semibold">
            This entry isn't available
          </h1>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            It may have been deleted, or you don't have access to it.
          </p>
          <Button asChild variant="outline" className="mt-6 rounded-full">
            <Link to="/entries">Back to entries</Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  const isOwner = entry.mine;
  const isAdmin = entry.viewerRole === "admin";

  // Actions depend on the viewer: admins settle; owners manage their own
  // pending entries; everyone else just watches.
  const actions: StatusAction[] = [];
  if (isAdmin) {
    if (entry.status !== "approved") {
      actions.push({ status: "approved", label: "Approve", icon: CheckCircle2 });
    }
    if (entry.status !== "rejected") {
      actions.push({ status: "rejected", label: "Reject", icon: XCircle });
    }
    if (entry.status !== "pending") {
      actions.push({ status: "pending", label: "Re-open", icon: RotateCcw });
    }
  } else if (isOwner && entry.status === "pending") {
    actions.push({ status: "rejected", label: "Withdraw", icon: XCircle });
  } else if (isOwner && entry.status === "rejected") {
    actions.push({ status: "pending", label: "Re-open", icon: RotateCcw });
  }

  const canEdit = (isOwner || isAdmin) && entry.status === "pending";

  // Payment settlement: approved entries only; admins or the owner.
  const canSetPaid = (isAdmin || isOwner) && entry.status === "approved";

  const handleSetPaid = async (paid: boolean) => {
    try {
      await setPaid({ entryId: entry._id, paid });
      toast.success(paid ? "Marked as paid." : "Payment cleared.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update payment.",
      );
    }
  };

  const handleComment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!commentBody.trim()) return;
    setSending(true);
    try {
      await addComment({ entryId: entry._id, body: commentBody });
      setCommentBody("");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Message failed to send.",
      );
    } finally {
      setSending(false);
    }
  };

  const handleStatus = async (
    status: "approved" | "rejected" | "pending",
    note?: string,
  ) => {
    try {
      await setStatus({ entryId: entry._id, status, note });
      const messages: Record<string, string> = {
        approved: "Entry approved.",
        rejected: "Entry rejected.",
        pending: "Entry re-opened.",
      };
      toast.success(messages[status]);
      setRejectOpen(false);
      setRejectNote("");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update the entry.",
      );
    }
  };

  const handleDelete = async () => {
    try {
      await removeEntry({ entryId: entry._id });
      toast.success("Entry deleted.");
      navigate("/entries");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not delete the entry.",
      );
    }
  };

  const openEdit = () => {
    setEditTitle(entry.title);
    setEditRawAmount((Math.abs(entry.amount) / 100).toFixed(2));
    setEditDirection(entry.amount >= 0 ? "in" : "out");
    setEditDescription(entry.description ?? "");
    setEditCategory(entry.category ?? "other");
    setEditOpen(true);
  };

  const handleEditSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = Number.parseFloat(editRawAmount.replace(/,/g, ""));
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("Enter an amount greater than zero.");
      return;
    }
    const amount = Math.round(value * 100) * (editDirection === "in" ? 1 : -1);
    try {
      await updateEntry({
        entryId: entry._id,
        title: editTitle,
        amount,
        description: editDescription || undefined,
        category: editCategory,
      });
      toast.success("Entry updated.");
      setEditOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save changes.",
      );
    }
  };

  return (
    <AppShell active="entries">
      <div className="mx-auto w-full max-w-4xl px-6 py-8 sm:py-10">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="-ml-2 text-muted-foreground"
        >
          <Link to="/entries">
            <ArrowLeft className="mr-1.5 size-3.5" />
            Back to entries
          </Link>
        </Button>

        {/* Title block */}
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
              {entry.title}
            </h1>
            <span
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium",
                STATUS_STYLES[entry.status],
              )}
            >
              {entry.status}
            </span>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Filed by {entry.authorName} · {formatDateTime(entry.createdAt)}
          </p>
          {entry.status === "rejected" && entry.reviewNote && (
            <p className="mt-3 rounded-xl bg-[#9c3d31]/10 px-4 py-3 text-sm text-[#9c3d31]">
              <span className="font-medium">Rejected:</span>{" "}
              {entry.reviewNote}
            </p>
          )}
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
          {/* Main column */}
          <div className="flex flex-col gap-6">
            {/* Summary card */}
            <div className="rounded-2xl border border-border bg-card px-6 py-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Amount
              </p>
              <p
                className={cn(
                  "mt-1 flex items-center gap-2 font-serif text-4xl font-semibold",
                  amountTone(entry.amount),
                )}
              >
                {entry.amount >= 0 ? (
                  <ArrowUpRight className="size-6" />
                ) : (
                  <ArrowDownLeft className="size-6" />
                )}
                {formatCentavos(entry.amount)}
              </p>
              <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 border-t border-border pt-4 text-sm">
                <span className="text-muted-foreground">
                  Category:{" "}
                  <span className="text-foreground">
                    {entry.category ?? "uncategorized"}
                  </span>
                </span>
                {entry.studentName && (
                  <span className="text-muted-foreground">
                    Student:{" "}
                    <Link
                      to={`/students/${entry.studentId}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {entry.studentName}
                    </Link>
                  </span>
                )}
                {entry.provider && (
                  <span className="text-muted-foreground">
                    Provider: <span className="text-foreground">{entry.provider}</span>
                  </span>
                )}
                <span className="text-muted-foreground">
                  Last updated:{" "}
                  <span className="text-foreground">
                    {formatDateTime(entry.updatedAt)}
                  </span>
                </span>
              </div>

              {/* Student payment settlement */}
              {(entry.studentName || entry.provider) && entry.status === "approved" && (
                <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-secondary px-4 py-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium">
                      {entry.paidAt !== undefined
                        ? `Student paid · ${formatDateTime(entry.paidAt)}`
                        : "Student hasn't paid yet"}
                    </p>
                  </div>
                  {canSetPaid &&
                    (entry.paidAt !== undefined ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full"
                        onClick={() => handleSetPaid(false)}
                      >
                        Undo payment
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className="rounded-full"
                        onClick={() => handleSetPaid(true)}
                      >
                        <CheckCircle2 className="mr-1.5 size-3.5" />
                        Mark student paid
                      </Button>
                    ))}
                </div>
              )}
            </div>

            {entry.description && (
              <div className="rounded-2xl border border-border bg-card p-6">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Notes
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground/90">
                  {entry.description}
                </p>
              </div>
            )}

            {/* Discussion */}
            <Card className="rounded-2xl border-border shadow-none">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 font-serif text-xl">
                  <MessageSquare className="size-4 text-muted-foreground" />
                  Discussion
                  <span className="text-sm font-normal text-muted-foreground">
                    ({comments?.length ?? 0})
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-4">
                  {comments === undefined ? (
                    <p className="text-sm text-muted-foreground">
                      Loading messages…
                    </p>
                  ) : comments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No messages yet. Ask the reviewer a question or add
                      context here.
                    </p>
                  ) : (
                    comments.map((comment) => (
                      <div key={comment._id} className="flex gap-3">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary font-serif text-xs text-primary-foreground">
                          {comment.authorName.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <span className="truncate text-sm font-medium">
                              {comment.authorName}
                              {comment.mine && (
                                <span className="ml-1.5 text-xs text-primary">
                                  you
                                </span>
                              )}
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {timeAgo(comment.createdAt)}
                            </span>
                          </div>
                          <p className="mt-0.5 whitespace-pre-wrap text-sm leading-6 text-foreground/90">
                            {comment.body}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <form onSubmit={handleComment} className="flex gap-2">
                  <Input
                    value={commentBody}
                    onChange={(e) => setCommentBody(e.target.value)}
                    placeholder="Write a message…"
                    disabled={sending}
                  />
                  <Button
                    type="submit"
                    className="rounded-full"
                    disabled={sending || !commentBody.trim()}
                  >
                    {sending ? "Sending…" : "Send"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>

          {/* Side column */}
          <div className="flex flex-col gap-4">
            {(actions.length > 0 || canEdit || isOwner || isAdmin) && (
              <Card className="rounded-2xl border-border shadow-none">
                <CardHeader className="pb-2">
                  <CardTitle className="font-serif text-base">Actions</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {!isAdmin && (
                    <p className="text-xs text-muted-foreground">
                      You can see where this entry stands. Only an admin can
                      approve or reject it.
                    </p>
                  )}
                  {actions.map(({ status, label, icon: Icon }) => (
                    <Button
                      key={label}
                      variant="outline"
                      className="justify-start rounded-full"
                      onClick={() => {
                        // A rejection needs a reason, so ask for one first.
                        if (status === "rejected") {
                          setRejectNote("");
                          setRejectOpen(true);
                          return;
                        }
                        void handleStatus(status);
                      }}
                    >
                      <Icon className="mr-2 size-4" />
                      {label}
                    </Button>
                  ))}
                  {canEdit && (
                    <Button
                      variant="outline"
                      className="justify-start rounded-full"
                      onClick={openEdit}
                    >
                      Edit details
                    </Button>
                  )}
                  {(isOwner || isAdmin) && (
                    <Button
                      variant="outline"
                      className="justify-start rounded-full border-destructive/40 text-destructive hover:bg-destructive/10"
                      onClick={() => setConfirmDelete(true)}
                    >
                      <Trash2 className="mr-2 size-4" />
                      Delete entry
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}

            <Card className="rounded-2xl border-border shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="font-serif text-base">Record</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-xs text-muted-foreground">
                <div className="flex justify-between gap-2">
                  <span>Entry id</span>
                  <span className="truncate text-foreground/80">{entry._id}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Filed by</span>
                  <span className="text-foreground/80">{entry.authorName}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Created</span>
                  <span className="text-foreground/80">
                    {formatDateTime(entry.createdAt)}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Updated</span>
                  <span className="text-foreground/80">
                    {formatDateTime(entry.updatedAt)}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Reject reason */}
      <Dialog
        open={rejectOpen}
        onOpenChange={(open) => {
          if (!open) setRejectOpen(false);
        }}
      >
        <DialogContent className="rounded-2xl sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">Reject entry?</DialogTitle>
            <DialogDescription>
              Give a reason. Everyone on the team can see it, so say what needs
              fixing.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="entry-reject-note">Reason</Label>
            <Textarea
              id="entry-reject-note"
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder="e.g. The amount does not match the receipt."
              className="min-h-20"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={rejectNote.trim() === ""}
              onClick={() => void handleStatus("rejected", rejectNote)}
            >
              Reject entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="rounded-2xl sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">
              Delete this entry?
            </DialogTitle>
            <DialogDescription>
              This permanently removes the entry and its whole discussion
              thread. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
            <Button variant="destructive" className="rounded-full" onClick={handleDelete}>
              Delete entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">Edit entry</DialogTitle>
            <DialogDescription>
              Pending entries can be corrected before they're settled.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-title">What is it for?</Label>
              <Input
                id="edit-title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                required
              />
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <div className="grid gap-2">
                <Label htmlFor="edit-amount">Amount ($)</Label>
                <Input
                  id="edit-amount"
                  value={editRawAmount}
                  onChange={(e) => setEditRawAmount(e.target.value)}
                  inputMode="decimal"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label>Direction</Label>
                <div className="flex h-9 overflow-hidden rounded-full border border-border font-medium text-xs">
                  <button
                    type="button"
                    onClick={() => setEditDirection("in")}
                    className={cn(
                      "flex items-center gap-1.5 px-3.5 transition-colors",
                      editDirection === "in"
                        ? "bg-[#2e5c4d] text-[#fdfcf9]"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <ArrowUpRight className="size-3.5" />
                    in
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditDirection("out")}
                    className={cn(
                      "flex items-center gap-1.5 border-l border-border px-3.5 transition-colors",
                      editDirection === "out"
                        ? "bg-[#9c3d31] text-[#fdfcf9]"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <ArrowDownLeft className="size-3.5" />
                    out
                  </button>
                </div>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Category</Label>
              <Select value={editCategory} onValueChange={setEditCategory}>
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
              <Label htmlFor="edit-notes">Notes</Label>
              <Textarea
                id="edit-notes"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
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
