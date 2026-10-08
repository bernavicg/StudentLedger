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
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/** Keep in sync with SCHOOL_YEAR_MONTHS in convex/gdocs.ts. */
const MONTHS = [
  "September 2025",
  "October 2025",
  "November 2025",
  "December 2025",
  "January 2026",
  "February 2026",
  "March 2026",
  "April 2026",
  "May 2026",
  "June 2026",
  "July 2026",
  "August 2026",
  "September 2026",
  "October 2026",
  "November 2026",
  "December 2026",
] as const;

/** "September 2026" → "Sep 26", so same-month pills stay distinguishable. */
function pillLabel(label: string) {
  const [monthName, year] = label.split(" ");
  return year === undefined
    ? monthName.slice(0, 3)
    : `${monthName.slice(0, 3)} ${year.slice(2)}`;
}

const DEFAULT_MONTH =
  MONTHS.find(
    (m) =>
      m ===
      `${new Date().toLocaleString("en-US", { month: "long" })} ${new Date().getFullYear()}`,
  ) ?? MONTHS[0];

type MonthDoc = {
  _id: string;
  label: string;
  gdocId: string;
};

function docFor(docs: MonthDoc[] | undefined, label: string) {
  return docs?.find((d: MonthDoc) => d.label === label);
}

/**
 * Docs: the school-year Google Docs (Sep 2025 – Dec 2026) in one live viewer,
 * replacing the old Scrapes page. Same pattern as the Sheets page — paste a
 * URL or id, and Google renders the doc exactly as shared, colors included.
 */
export default function Docs() {
  const { user, isLoading } = useAuth();
  const isAdmin = user?.role === "admin";

  const docs = useQuery(api.gdocs.list);
  const setDoc = useMutation(api.gdocs.set);
  const removeDoc = useMutation(api.gdocs.remove);
  const migrateLabels = useMutation(api.gdocs.migrateLabels);

  // Rename legacy plain-month labels ("September" → "September 2025") once
  // per load. Idempotent server-side; a failure is harmless because list()
  // normalizes old labels for display anyway.
  useEffect(() => {
    if (isLoading) return;
    void migrateLabels({}).catch(() => undefined);
  }, [isLoading, migrateLabels]);

  const [month, setMonth] = useState<string>(DEFAULT_MONTH);
  const [search, setSearch] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const filteredMonths =
    search.trim() === ""
      ? MONTHS
      : MONTHS.filter((m) =>
          m.toLowerCase().includes(search.trim().toLowerCase()),
        );

  const searchEmpty = search.trim() === "";
  const searchNoMatch = !searchEmpty && filteredMonths.length === 0;

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
            Ang mga Google Docs sa school year (September 2025 hangtod
            December 2026), live gikan sa Google — same colors ug formatting
            sama sa original.
          </p>
        </header>

        {/* Search */}
        <div className="mt-6 flex flex-col gap-2">
          <div className="relative">
            <Label className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              Search months
            </Label>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Type a month, e.g. October 2026"
              className="pl-9"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:bg-accent"
                aria-label="Clear search"
              >
                <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          {searchNoMatch && (
            <p className="text-xs text-muted-foreground">
              Walay month nga match sa “{search}”.
            </p>
          )}

          {/* Month picker */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {filteredMonths.map((m) => {
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
                  {pillLabel(m)}
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
        </div>

        {/* Live viewer for the selected month */}
        {searchNoMatch ? (
          <div className="mt-4 rounded-2xl border border-border bg-card">
            <div className="flex flex-col items-center py-14 text-center">
              <FileText className="size-9 text-muted-foreground" />
              <p className="mt-3 font-serif text-xl font-semibold">
                Walay doc nga makita sa “{search}”
              </p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Try another search term, or clear the search to see all months.
              </p>
            </div>
          </div>
        ) : active ? (
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
