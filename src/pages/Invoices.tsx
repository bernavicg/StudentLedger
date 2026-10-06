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
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import { formatCentavos, formatDate } from "@/lib/format";
import {
  formatBytes,
  invoiceViewerUrl,
  isInvoiceExtension,
  resolveInvoiceMimeType,
} from "@/lib/invoices";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  Download,
  ExternalLink,
  FileText,
  Inbox,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

/** One row of api.invoices.list. */
type InvoiceRow = {
  _id: Id<"invoices">;
  title: string;
  studentId: Id<"students">;
  studentName: string;
  caseNo?: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  // Billing snapshot auto-computed from the student's plan at upload.
  totalSessions: number;
  totalHours?: number | null;
  totalAmountCents?: number | null;
  url?: string;
  createdAt: number;
  createdBy: Id<"users">;
  uploaderName: string;
};

/** Keep uploads sensible; Convex storage itself allows far more. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Hours label: "40 h" or "22.5 h". */
function formatHours(hours: number): string {
  return Number.isInteger(hours) ? `${hours} h` : `${hours.toFixed(1)} h`;
}

export default function Invoices() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const invoices = useQuery(api.invoices.list);
  const removeInvoice = useMutation(api.invoices.remove);

  const [studentFilter, setStudentFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<Id<"invoices"> | undefined>(
    undefined,
  );
  const [uploadOpen, setUploadOpen] = useState(false);

  const all = invoices ?? [];
  // Students that actually have invoices — those become the filter chips.
  const filterOptions = (() => {
    const seen = new Map<Id<"students">, string>();
    for (const invoice of all) {
      if (!seen.has(invoice.studentId)) {
        seen.set(invoice.studentId, invoice.studentName);
      }
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  })();

  const visible =
    studentFilter === "all"
      ? all
      : all.filter((invoice) => invoice.studentId === studentFilter);

  // Auto-show the first invoice of the current filter so the viewer is
  // never empty while there is something to look at.
  const selected = visible.find((invoice) => invoice._id === selectedId);
  const current = selected ?? visible[0];

  const handleDelete = async (invoice: InvoiceRow) => {
    if (!window.confirm(`Delete "${invoice.title}"? This can't be undone.`)) {
      return;
    }
    try {
      await removeInvoice({ invoiceId: invoice._id });
      if (selectedId === invoice._id) setSelectedId(undefined);
      toast.success("Invoice deleted.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not delete the invoice.",
      );
    }
  };

  return (
    <AppShell active="invoices">
      <div className="mx-auto w-full max-w-6xl px-6 py-8 sm:py-10">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Paper invoices
            </p>
            <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
              Invoices
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {all.length} filed · one PDF or DOC per student, ready to read
              right here
            </p>
          </div>
          {isAdmin && (
            <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
          )}
        </div>

        {/* Student filter chips */}
        {filterOptions.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setStudentFilter("all")}
              className={cn(
                "rounded-full border px-4 py-1.5 text-sm transition-colors",
                studentFilter === "all"
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              All
            </button>
            {filterOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setStudentFilter(option.id)}
                className={cn(
                  "rounded-full border px-4 py-1.5 text-sm transition-colors",
                  studentFilter === option.id
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {option.name}
              </button>
            ))}
          </div>
        )}

        {invoices === undefined ? (
          <div className="mt-6 rounded-2xl border border-border bg-card px-6 py-16 text-center text-sm text-muted-foreground">
            Loading invoices…
          </div>
        ) : all.length === 0 ? (
          <div className="mt-6 flex flex-col items-center rounded-2xl border border-border bg-card px-6 py-16 text-center">
            <Inbox className="size-8 text-muted-foreground/50" />
            <p className="mt-3 font-serif text-lg font-semibold">
              No invoices yet
            </p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              {isAdmin
                ? "Upload the first PDF or DOC invoice and it will show up here for everyone to read."
                : "Ask an admin to upload the paper invoices — they'll show up here for easy reading."}
            </p>
            {isAdmin && (
              <Button
                className="mt-5 rounded-full"
                variant="outline"
                onClick={() => setUploadOpen(true)}
              >
                <Plus className="mr-2 size-4" />
                Upload invoice
              </Button>
            )}
          </div>
        ) : (
          <div className="mt-6 grid items-start gap-4 lg:grid-cols-[320px_1fr]">
            {/* List */}
            <ul className="grid gap-2">
              {visible.map((invoice) => (
                <li key={invoice._id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(invoice._id)}
                    className={cn(
                      "w-full rounded-2xl border px-4 py-3.5 text-left transition-colors",
                      current?._id === invoice._id
                        ? "border-primary/50 bg-primary/5"
                        : "border-border bg-card hover:bg-accent/50",
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <FileText
                        className={cn(
                          "size-4 shrink-0",
                          invoice.mimeType === "application/pdf"
                            ? "text-[#9c3d31]"
                            : "text-[#2e5c4d]",
                        )}
                      />
                      <p className="min-w-0 flex-1 truncate text-sm font-medium">
                        {invoice.title}
                      </p>
                      {invoice.url && (
                        <a
                          href={invoice.url}
                          download={invoice.fileName}
                          onClick={(event) => event.stopPropagation()}
                          aria-label={`Download ${invoice.title}`}
                          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          <Download className="size-3.5" />
                        </a>
                      )}
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {invoice.studentName}
                      {invoice.caseNo ? ` · case ${invoice.caseNo}` : ""} ·{" "}
                      {invoice.totalSessions} sessions ·{" "}
                      {invoice.totalHours !== null &&
                      invoice.totalHours !== undefined
                        ? `${formatHours(invoice.totalHours)} · `
                        : ""}
                      {invoice.totalAmountCents !== null &&
                      invoice.totalAmountCents !== undefined
                        ? `${formatCentavos(invoice.totalAmountCents)} · `
                        : ""}
                      {formatBytes(invoice.sizeBytes)}{" "}
                      · {formatDate(invoice.createdAt)}
                    </p>
                  </button>
                </li>
              ))}
              {visible.length === 0 && (
                <li className="rounded-2xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
                  No invoices for this student yet.
                </li>
              )}
            </ul>

            {/* View-only reader */}
            <div className="overflow-hidden rounded-2xl border border-border bg-card lg:sticky lg:top-6">
              {current === undefined ? (
                <div className="flex flex-col items-center px-6 py-20 text-center">
                  <FileText className="size-8 text-muted-foreground/50" />
                  <p className="mt-3 font-serif text-lg font-semibold">
                    Pick an invoice to read
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Choose one from the list and it opens right here.
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
                    <div className="min-w-0">
                      <p className="truncate font-serif text-lg font-semibold">
                        {current.title}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {current.studentName}
                        {current.caseNo ? ` · case ${current.caseNo}` : ""} ·{" "}
                        {current.fileName} · {formatBytes(current.sizeBytes)} ·{" "}
                        uploaded {formatDate(current.createdAt)} by{" "}
                        {current.uploaderName}
                      </p>
                      {/* Billing snapshot, auto-filled at upload time */}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-secondary/60 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {current.totalSessions} sessions
                        </span>
                        {current.totalHours !== null &&
                          current.totalHours !== undefined && (
                            <span className="rounded-full bg-secondary/60 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                              {formatHours(current.totalHours)}
                            </span>
                          )}
                        {current.totalAmountCents !== null &&
                          current.totalAmountCents !== undefined && (
                            <span className="rounded-full bg-[#2e5c4d]/10 px-2.5 py-0.5 text-[11px] font-medium text-[#2e5c4d]">
                              {formatCentavos(current.totalAmountCents)}
                            </span>
                          )}
                        <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                          auto from the student's plan
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {current.url && (
                        <>
                          <Button asChild variant="outline" size="sm">
                            <a
                              href={current.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <ExternalLink className="mr-1.5 size-3.5" />
                              Open
                            </a>
                          </Button>
                          <Button asChild variant="ghost" size="sm">
                            <a
                              href={current.url}
                              download={current.fileName}
                            >
                              <Download className="mr-1.5 size-3.5" />
                              Download
                            </a>
                          </Button>
                        </>
                      )}
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-[#9c3d31] hover:bg-[#9c3d31]/10 hover:text-[#9c3d31]"
                          onClick={() => handleDelete(current)}
                        >
                          <Trash2 className="mr-1.5 size-3.5" />
                          Delete
                        </Button>
                      )}
                    </div>
                  </div>
                  {current.url ? (
                    <iframe
                      key={`${current._id}-${current.url}`}
                      src={invoiceViewerUrl(current.url, current.mimeType)}
                      title={current.title}
                      className="h-[70vh] min-h-[420px] w-full bg-white"
                    />
                  ) : (
                    <div className="px-6 py-20 text-center text-sm text-muted-foreground">
                      The file for this invoice is no longer available.
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

/** Admin-only dialog: pick a student, attach one PDF/DOC, optional label. */
function UploadDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const students = useQuery(api.students.list);
  const generateUploadUrl = useMutation(api.invoices.generateUploadUrl);
  const saveInvoice = useMutation(api.invoices.save);

  const [studentId, setStudentId] = useState<string>("none");
  const [caseNo, setCaseNo] = useState("");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const studentOptions = (students ?? []).map((s) => ({
    id: s._id,
    name: s.name,
  }));
  // The picked student's plan drives the auto-filled billing preview.
  const selectedStudent = (students ?? []).find((s) => s._id === studentId);

  const reset = () => {
    setStudentId("none");
    setCaseNo("");
    setTitle("");
    setFile(undefined);
    if (fileInput.current) fileInput.current.value = "";
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (studentId === "none") {
      toast.error("Pick the student this invoice belongs to.");
      return;
    }
    if (!file) {
      toast.error("Attach a PDF or DOC file first.");
      return;
    }
    if (!isInvoiceExtension(file.name)) {
      toast.error("Only PDF, DOC, and DOCX files are supported.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error("That file is over 50 MB — compress it first.");
      return;
    }
    const mimeType = resolveInvoiceMimeType(file.name, file.type);
    if (!mimeType) {
      toast.error("Only PDF, DOC, and DOCX files are supported.");
      return;
    }

    setIsSubmitting(true);
    try {
      // 1) get a short-lived upload URL, 2) POST the bytes, 3) record it.
      const uploadUrl = await generateUploadUrl();
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": mimeType },
        body: file,
      });
      if (!response.ok) {
        throw new Error("Upload failed — try again.");
      }
      const { storageId } = (await response.json()) as {
        storageId: Id<"_storage">;
      };
      await saveInvoice({
        storageId,
        studentId: studentId as Id<"students">,
        fileName: file.name,
        mimeType,
        sizeBytes: file.size,
        title: title || undefined,
        caseNo: caseNo || undefined,
      });
      toast.success("Invoice uploaded. Everyone can read it now.");
      reset();
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not upload the invoice.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button className="rounded-full">
          <Upload className="mr-2 size-4" />
          Upload invoice
        </Button>
      </DialogTrigger>
      <DialogContent className="rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">
            Upload a paper invoice
          </DialogTitle>
          <DialogDescription>
            One PDF or DOC file for one student. Everyone signed in can read
            it; only admins can upload or delete.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label>Student</Label>
            <Select
              value={studentId}
              onValueChange={setStudentId}
              disabled={isSubmitting}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Whose invoice is this?" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                {studentOptions.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {studentOptions.length === 0 && (
              <p className="text-[11px] text-muted-foreground">
                No students yet — add them on the Students page first.
              </p>
            )}
          </div>

          {/* Billing snapshot preview: auto-computed, nothing to type */}
          {selectedStudent && (
            <div className="rounded-xl border border-border bg-secondary/50 p-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Auto-filled from {selectedStudent.name}'s plan
              </p>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="font-serif text-lg font-semibold">
                    {selectedStudent.totalSessions}
                  </p>
                  <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                    sessions
                  </p>
                </div>
                <div>
                  <p className="font-serif text-lg font-semibold">
                    {selectedStudent.approvedHours !== null
                      ? formatHours(selectedStudent.approvedHours)
                      : "—"}
                  </p>
                  <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                    hours
                  </p>
                </div>
                <div>
                  <p className="font-serif text-lg font-semibold">
                    {selectedStudent.maxAuthorizedAmountCents !== null
                      ? formatCentavos(selectedStudent.maxAuthorizedAmountCents)
                      : "—"}
                  </p>
                  <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                    total amount
                  </p>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Saved onto the invoice automatically — no typing needed.
              </p>
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="invoice-file">File</Label>
            <Input
              id="invoice-file"
              ref={fileInput}
              type="file"
              accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => setFile(e.target.files?.[0])}
              disabled={isSubmitting}
              className="cursor-pointer file:mr-3 file:rounded-full file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-xs file:font-medium"
              required
            />
            {file && (
              <p className="text-[11px] text-muted-foreground">
                {file.name} · {formatBytes(file.size)}
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="invoice-case-no">
              Case no. <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="invoice-case-no"
              value={caseNo}
              onChange={(e) => setCaseNo(e.target.value)}
              placeholder="e.g. CASE-2026-014"
              disabled={isSubmitting}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="invoice-title">
              Label <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="invoice-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Paper Invoice — September"
              disabled={isSubmitting}
            />
            <p className="text-[11px] text-muted-foreground">
              Defaults to the file name without the extension.
            </p>
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
              {isSubmitting ? "Uploading…" : "Upload"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
