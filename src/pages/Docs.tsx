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
import { useAction, useMutation, useQuery } from "convex/react";
import {
  ExternalLink,
  FileText,
  Lock,
  Plus,
  RefreshCw,
  Search,
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

/** "September 2026" -> "Sep 26", so same-month pills stay distinguishable. */
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
  title: string;
  searchText: string;
};

function docFor(docs: MonthDoc[] | undefined, label: string) {
  return docs?.find((d: MonthDoc) => d.label === label);
}

/** Score how well a doc matches the search term. Higher = better (rises to top).
 *
 * Matches are case-insensitive. Title matches are worth the most (they are
 * what the doc *is*), then matches inside the doc's own text, then the plain
 * month label — so the "right" doc rises above a doc that merely mentions the
 * keyword in passing.
 */
function matchScore(doc: MonthDoc, term: string): number {
  if (term === "") return 0;
  let score = 0;
  const labelLower = doc.label.toLowerCase();
  const titleLower = doc.title.toLowerCase();
  const bodyLower = doc.searchText.toLowerCase();

  if (labelLower.includes(term)) score += 1;
  if (titleLower.includes(term)) score += 5;
  if (bodyLower.includes(term)) score += 3;

  return score;
}

/** True when the term occurs in the doc's own body (not just its label/title). */
function bodyMatch(doc: MonthDoc | undefined, term: string): boolean {
  return (
    term !== "" && doc !== undefined && doc.searchText.toLowerCase().includes(term)
  );
}

/** A short window of the doc body around the first occurrence of `term`, or
 * the start of the body when the term isn't in it. Used as the search-result
 * snippet so the user can see *why* a doc matched before opening it.
 */
function snippet(doc: MonthDoc, term: string): string {
  if (term.trim() === "") return "";
  const idx = doc.searchText.indexOf(term);
  if (idx === -1) {
    return doc.searchText.slice(0, 80).trim();
  }
  const start = Math.max(0, idx - 40);
  return doc.searchText.slice(start, start + 120).trim();
}

/** Docs: the school-year Google Docs (Sep 2025 - Dec 2026) in one live viewer,
 * replacing the old Scrapes page. Same pattern as the Sheets page - paste a
 * URL or id, and Google renders the doc exactly as shared, colors included.
 *
 * Search matches against the month label AND the doc's own title and cached
 * content (from the Google Docs API), so a keyword that appears inside the
 * document rises to the top of the month list.
 */
export default function Docs() {
  const { user, isLoading } = useAuth();
  const isAdmin = user?.role === "admin";

  const docs = useQuery(api.gdocs.list);
  const setDoc = useMutation(api.gdocs.set);
  const removeDoc = useMutation(api.gdocs.remove);
  const migrateLabels = useMutation(api.gdocs.migrateLabels);
  const reindexDoc = useAction(api.gdocsActions.reindexDoc);

  // Rename legacy plain-month labels ("September" -> "September 2025") once
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
  const [reindexing, setReindexing] = useState(false);
  const [removing, setRemoving] = useState(false);

  // Ranked month list. With a search term only matching months survive,
  // best match first (title > body > plain label); with no term every month
  // is listed in school-year order.
  const ranked = (() => {
    const term = search.trim().toLowerCase();
    const all = MONTHS.map((m) => {
      const doc = docFor(docs, m);
      return { month: m, doc, score: doc ? matchScore(doc, term) : 0 };
    });
    return term === "" ? all : all.filter((item) => item.score > 0);
  })();

  const searchEmpty = search.trim() === "";
  const searchNoMatch = !searchEmpty && ranked.length === 0;
  const savedRef = useRef<Record<string, string>>({});

  // Docs saved before search indexing existed (or whose index failed) have no
  // cached text, so nothing inside them is findable. Backfill them once per
  // session, admins only — non-admins just search whatever is already cached.
  const backfilledRef = useRef(false);
  useEffect(() => {
    if (isLoading || docs === undefined || !isAdmin || backfilledRef.current) {
      return;
    }
    const missing = docs.filter((d) => d.searchText === "");
    if (missing.length === 0) return;
    backfilledRef.current = true;
    void (async () => {
      for (const doc of missing) {
        try {
          await reindexDoc({ gdocId: doc.gdocId });
        } catch {
          // Almost always "the doc isn't shared with the service account".
          // Search then simply skips that doc; the Re-index button stays
          // available once sharing is fixed.
        }
      }
    })();
  }, [isLoading, docs, isAdmin, reindexDoc]);

  const active = docFor(docs, month);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await setDoc({ label: month, gdocUrl: url });
      const gdocId = extractGdocId(url);
      savedRef.current[month] = gdocId;
      if (gdocId) {
        try {
          await reindexDoc({ gdocId });
        } catch (reindexError) {
          // Save succeeded but indexing failed (e.g. doc not shared with the
          // service account). The doc still shows; search just won't find its
          // content until it's re-indexed.
          toast.warning(
            reindexError instanceof Error
              ? reindexError.message
              : "Saved, but could not index the doc for search.",
          );
        }
      }
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

  const handleReindex = async (label: string) => {
    const doc = docFor(docs, label);
    if (!doc) {
      toast.error("No doc found for that month.");
      return;
    }
    setReindexing(true);
    try {
      await reindexDoc({ gdocId: doc.gdocId });
      toast.success(`${label} re-indexed.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not re-index the doc.",
      );
    } finally {
      setReindexing(false);
    }
  };

  const handleRemove = async (label: string) => {
    const doc = docFor(docs, label);
    if (!doc) {
      toast.error("No doc found for that month.");
      return;
    }
    setRemoving(true);
    try {
      await removeDoc({ label });
      toast.success(`${label} removed.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not remove the doc.",
      );
    } finally {
      setRemoving(false);
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
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search months and doc content"
              placeholder="Search a month, title, or a word inside a doc"
              className="pl-9 pr-9"
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
              Walay month o doc nga match sa "{search}".
            </p>
          )}

          {/* Month picker (matching months only, best match first) */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {ranked.map(({ month: m, doc, score }) => {
              const saved = doc ? doc.gdocId : undefined;
              const term = search.trim().toLowerCase();
              const inBody = bodyMatch(doc, term);
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
                  title={
                    doc?.title
                      ? inBody
                        ? `Found inside: ${doc.title}`
                        : doc.title
                      : m
                  }
                >
                  {pillLabel(m)}
                  {saved && (
                    <span
                      className="ml-1.5 inline-block size-1.5 rounded-full bg-[#2e5c4d]"
                      title="Doc saved"
                    />
                  )}
                  {inBody && (
                    <span
                      className="ml-1 inline-block size-1.5 rounded-full bg-amber-500"
                      title="Match found inside the doc"
                    />
                  )}
                  {score > 0 && !inBody && (
                    <span
                      className="ml-1 inline-block size-1.5 rounded-full bg-sky-600"
                      title="Match on the month or doc title"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Search result guidance */}
        {!searchEmpty && ranked.length > 0 && ranked[0].score > 0 && (
          <div className="mt-3 text-xs text-muted-foreground">
            <p>
              {ranked.length} nga month/doc ang match sa "{search}".
              {ranked[0].doc?.title && (
                <>
                  {" "}
                  <span className="font-medium text-foreground/80">
                    Top match: {ranked[0].doc.title}
                  </span>
                </>
              )}
            </p>
            {ranked[0].doc && snippet(ranked[0].doc, search.trim().toLowerCase()) && (
              <p className="mt-1 italic">
                “{snippet(ranked[0].doc, search.trim().toLowerCase())}”
              </p>
            )}
          </div>
        )}

        {/* Live viewer for the selected month */}
        {searchNoMatch ? (
          <div className="mt-4 rounded-2xl border border-border bg-card">
            <div className="flex flex-col items-center py-14 text-center">
              <FileText className="size-9 text-muted-foreground" />
              <p className="mt-3 font-serif text-xl font-semibold">
                Walay doc nga makita sa "{search}"
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
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleReindex(active.label)}
                    disabled={reindexing || removing}
                    className="text-[#2e5c4d] hover:bg-[#2e5c4d]/10 hover:text-[#2e5c4d]"
                  >
                    <RefreshCw
                      className={`mr-1.5 size-3.5 ${reindexing ? "animate-spin" : ""}`}
                    />
                    Re-index {active.label}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleRemove(active.label)}
                    disabled={reindexing || removing}
                    className="text-[#9c3d31] hover:bg-[#9c3d31]/10 hover:text-[#9c3d31]"
                  >
                    <Trash2 className="mr-1.5 size-3.5" />
                    Remove {active.label}
                  </Button>
                </>
              )}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Blank viewer? Share the doc as "anyone with the link" (viewer),
              then reload.
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
                  ? "Paste the Google Doc URL or id below to add it."
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
              the same month slot. The doc must be shared with the Ledger service
              account for search to index it.
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
