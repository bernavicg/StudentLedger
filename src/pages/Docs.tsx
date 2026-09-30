import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
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
import { api } from "@/convex/_generated/api";
import {
  extractGdocId,
  gdocEditUrl,
  gdocEmbedUrl,
} from "@/convex/lib/gdocId";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQuery } from "convex/react";
import {
  ExternalLink,
  FileText,
  Lock,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

const MONTHS = [
  "September",
  "October",
  "November",
  "December",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
] as const;

type MonthDoc = {
  _id: string;
  label: string;
  gdocId: string;
};

function docFor(docs: MonthDoc[] | undefined, label: string) {
  return docs?.find((d: MonthDoc) => d.label === label);
}

/**
 * Docs: the school-year Google Docs (September–June) in one live viewer,
 * replacing the old Scrapes page. Same pattern as the Sheets page — paste a
 * URL or id, and Google renders the doc exactly as shared, colors included.
 */
export default function Docs() {
  const { user, isLoading } = useAuth();
  const isAdmin = user?.role === "admin";

  const docs = useQuery(api.gdocs.list);
  const setDoc = useMutation(api.gdocs.set);
  const removeDoc = useMutation(api.gdocs.remove);

  const [month, setMonth] = useState<string>("September");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const savedRef = useRef<Record<string, string>>({});

  const active = docFor(docs, month);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await setDoc({ label: month, gdocUrl: url });
      savedRef.current[month] = extractGdocId(url);
      setUrl("");
      toast.success(`${month} saved.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save the doc.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (label: string) => {
    setRemoving(label);
    try {
      await removeDoc({ label });
      toast.success(`${label} removed.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not remove the doc.",
      );
    } finally {
      setRemoving(null);
    }
  };

  if (isLoading || docs === undefined) {
    return (
      <AppShell active="docs">
        <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="mt-6 h-64 w-full" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell active="docs">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <header>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            School year
          </p>
          <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight">
            Docs
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Ang mga Google Docs sa school year (September hangtod June), live
            gikan sa Google — same colors ug formatting sama sa original.
          </p>
        </header>

        {/* Month picker */}
        <div className="mt-6 flex flex-wrap items-center gap-1.5">
          {MONTHS.map((m) => {
            const saved = docFor(docs, m);
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMonth(m)}
                className={
                  month === m
                    ? "rounded-full bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground"
                    : "rounded-full border border-border px-3.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                }
              >
                {m.slice(0, 3)}
                {saved && (
                  <span
                    className="ml-1.5 inline-block size-1.5 rounded-full bg-[#2e5c4d]"
                    title="Doc saved"
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Live viewer for the selected month */}
        {active ? (
          <div className="mt-4">
            <div className="rounded-2xl border border-border bg-card p-0">
              <iframe
                key={active.gdocId}
                title={`${active.label} doc`}
                src={gdocEmbedUrl(active.gdocId)}
                className="h-[70vh] min-h-[420px] w-full rounded-2xl"
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <ExternalLink className="size-3.5" />
                <a
                  href={gdocEditUrl(active.gdocId)}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  Open {active.label} in Google Docs
                </a>
              </p>
              {isAdmin && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleRemove(active.label)}
                  disabled={removing === active.label}
                  className="text-[#9c3d31] hover:bg-[#9c3d31]/10 hover:text-[#9c3d31]"
                >
                  <Trash2 className="mr-1.5 size-3.5" />
                  Remove {active.label}
                </Button>
              )}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Blank viewer? Share the doc as &ldquo;anyone with the link&rdquo;
              (viewer), then reload.
            </p>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-border bg-card">
            <div className="flex flex-col items-center py-14 text-center">
              <FileText className="size-9 text-muted-foreground" />
              <p className="mt-3 font-serif text-xl font-semibold">
                Walay {month} doc pa
              </p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                {isAdmin
                  ? "Paste ang Google Doc URL o id sa ubos para ma-show diri."
                  : "Hangyoon ang admin nga mo-add ug doc kini nga month."}
              </p>
            </div>
          </div>
        )}

        {/* Admin editor */}
        {isAdmin && (
          <div className="mt-6 rounded-2xl border border-border bg-card p-5">
            <p className="flex items-center gap-2 font-serif text-lg font-semibold">
              <Plus className="size-4" />
              {active ? `Replace the ${month} doc` : `Add the ${month} doc`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Paste the whole Google Doc URL (or just the id). Replacing keeps
              the same month slot.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-[180px_1fr_auto] sm:items-end">
              <div className="grid gap-1.5">
                <Label>Month</Label>
                <Select value={month} onValueChange={setMonth}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Month" />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="gdoc-url">Google Doc URL or id</Label>
                <Input
                  id="gdoc-url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://docs.google.com/document/d/…/edit"
                />
              </div>
              <Button
                onClick={() => void handleSave()}
                disabled={saving || extractGdocId(url) === ""}
              >
                <RefreshCw
                  className={saveIconClass(saving)}
                />
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        )}

        {!isAdmin && (
          <p className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
            <Lock className="size-3.5" />
            Only an admin can change which docs are shown.
          </p>
        )}
      </div>
    </AppShell>
  );
}

function saveIconClass(saving: boolean) {
  return `mr-2 size-4${saving ? " animate-spin" : ""}`;
}
