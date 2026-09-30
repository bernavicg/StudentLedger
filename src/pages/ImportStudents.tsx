import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { AlertTriangle, Download, Loader2, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type Candidate = {
  name: string;
  caseNo: string;
  remaining: number | undefined;
  monthlyHours: number;
  sundayHours: number;
  row: number;
};

function formatHours(h: number): string {
  return Number.isInteger(h) ? `${h}` : h.toFixed(h * 10 % 1 === 0 ? 1 : 2);
}

export default function ImportStudents() {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const readCandidates = useAction(api.sheetsPicker.readCandidates);
  const addFromSheets = useAction(api.sheetsPicker.addFromSheets);
  const existing = useQuery(api.students.list) ?? [];

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await readCandidates({});
      setCandidates(result.candidates);
      setWarnings(result.warnings);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to read the sheets.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enrolled = useMemo(
    () => new Set(existing.map((s: { name: string }) => s.name.toLowerCase().trim())),
    [existing],
  );

  const filtered = useMemo(() => {
    if (!candidates) return [];
    const q = search.trim().toLowerCase();
    return candidates.filter(
      (c) => q === "" || c.name.toLowerCase().includes(q) || c.caseNo.includes(q),
    );
  }, [candidates, search]);

  const toggle = (name: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const addSelected = async () => {
    if (picked.size === 0) return;
    setAdding(true);
    try {
      const result = await addFromSheets({ names: [...picked] });
      toast.success(
        `Added ${result.created} students (${result.updated} updated) with ${result.sessions} session days.`,
      );
      setPicked(new Set());
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setAdding(false);
    }
  };

  return (
    <AppShell active="import">
      <div className="mx-auto w-full max-w-4xl px-6 py-8 sm:py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              From the legacy sheets
            </p>
            <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
              Pick students to enroll
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Roster: <span className="font-medium text-foreground">MONTHLY MONITORING 2025-2026</span> ·
              Attendance: <span className="font-medium text-foreground">SUNDAY SESSIONS</span>. Choose
              who to add to the Students page.
            </p>
          </div>
          <Button onClick={load} disabled={loading} variant="outline" className="gap-2">
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            Refresh from sheets
          </Button>
        </div>

        {loadError && (
          <div className="mt-6 flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 px-6 py-4 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div>{loadError}</div>
          </div>
        )}
        {warnings.length > 0 && (
          <div className="mt-4 rounded-2xl border border-[#8a8578]/30 bg-[#8a8578]/10 px-6 py-4 text-xs text-[#6b6459]">
            {warnings.map((w) => (
              <div key={w}>⚠ {w}</div>
            ))}
          </div>
        )}

        <Card className="mt-6 rounded-2xl">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="font-serif text-xl">Candidates</CardTitle>
                <CardDescription>
                  {candidates === null
                    ? "Loading from Google Sheets…"
                    : `${candidates.length} found · ${enrolled.size} already enrolled · ${picked.size} selected`}
                </CardDescription>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name or case no…"
                  className="pl-9"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="pb-4">
            {candidates === null ? (
              <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Reading the sheets…
              </div>
            ) : filtered.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No candidates match.</p>
            ) : (
              <ul className="divide-y divide-border">
                {filtered.map((c) => {
                  const isEnrolled = enrolled.has(c.name.toLowerCase().trim());
                  return (
                    <li key={`${c.name}-${c.row}`} className="flex items-center gap-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={picked.has(c.name)}
                        onChange={() => toggle(c.name)}
                        disabled={adding}
                        className="size-4 shrink-0 cursor-pointer rounded border-border accent-[#2e5c4d]"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium">{c.name}</span>
                          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                            {c.caseNo}
                          </span>
                          {isEnrolled && (
                            <span className="rounded-full bg-[#2e5c4d]/15 px-2 py-0.5 text-[10px] font-medium text-[#2e5c4d]">
                              enrolled
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="hidden gap-6 text-right text-xs text-muted-foreground sm:flex">
                        <span title="Hours across Sept–Jun columns">
                          {formatHours(c.monthlyHours)} h monthly
                        </span>
                        <span title="Sessions counted from SUNDAY SESSIONS dates">
                          {formatHours(c.sundayHours)} h sunday
                        </span>
                        {c.remaining !== undefined && (
                          <span title="REMAINING SESSIONS column">
                            {formatHours(c.remaining)} left
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="mt-6 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Selected students get their sheet hours as authorized sessions and their Sunday dates as
            attendance.
          </p>
          <Button onClick={addSelected} disabled={picked.size === 0 || adding} className="gap-2">
            {adding ? <Loader2 className="size-4 animate-spin" /> : null}
            Add {picked.size || ""} to Students
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
