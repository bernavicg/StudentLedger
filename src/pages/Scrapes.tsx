import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import type { ScrapeRunSummary } from "@/convex/sieve";
import { COMPLIANCE_MODES } from "@/convex/lib/sieve";
import { useAuth } from "@/hooks/use-auth";
import { useScrapesPolling } from "@/hooks/use-scrapes-polling";
import { cn } from "@/lib/utils";
import { useAction, useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Coins,
  Download,
  FileText,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/** Badge look per run status (kept out of JSX so both list and detail agree). */
function statusClass(status: string): string {
  switch (status) {
    case "done":
      return "border-transparent bg-[#2e5c4d] text-white";
    case "refused":
      return "border-transparent bg-destructive text-white";
    case "error":
      return "border-transparent bg-destructive text-white";
    case "running":
    case "queued":
    case "starting":
      return "border-transparent bg-secondary text-secondary-foreground";
    default:
      return "border-border";
  }
}

function formatBytes(size: number | undefined): string {
  if (size === undefined) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function ResultPanel({ runId }: { runId: ScrapeRunSummary["_id"] }) {
  const detail = useQuery(api.sieve.detail, { runId });
  if (detail === undefined) {
    return <Skeleton className="mt-2 h-24 w-full" />;
  }
  if (detail?.result === null || detail?.result === undefined) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">No result payload.</p>
    );
  }
  return (
    <pre className="scrollbar-thin mt-2 max-h-72 overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-[11px] leading-4">
      {JSON.stringify(JSON.parse(detail.result), null, 2)}
    </pre>
  );
}

function RunCard({ run }: { run: ScrapeRunSummary }) {
  const fetchFile = useAction(api.sieve.fetchFile);
  const poll = useAction(api.sieve.poll);
  const followUp = useAction(api.sieve.followUp);
  const [showResult, setShowResult] = useState(false);
  const [followUpText, setFollowUpText] = useState("");
  const [busy, setBusy] = useState(false);

  const download = async (url: string, name: string) => {
    try {
      const file = await fetchFile({ runId: run._id, url });
      const blob = new Blob([file.text], { type: file.contentType });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = name;
      anchor.click();
      URL.revokeObjectURL(href);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Download failed.");
    }
  };

  const sendFollowUp = async () => {
    const instruction = followUpText.trim();
    if (instruction === "") return;
    setBusy(true);
    try {
      await followUp({ runId: run._id, instruction });
      setFollowUpText("");
      toast.success("Follow-up sent. Polling for the new answer…");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Follow-up failed.");
    } finally {
      setBusy(false);
    }
  };

  const conformanceIsBad =
    run.schemaConformance === "fail" || run.schemaConformance === "partial";

  return (
    <Card className="rounded-2xl border-border shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 font-serif text-lg">
          <Badge className={cn("uppercase", statusClass(run.status))}>
            {run.status}
          </Badge>
          <span className="min-w-0 flex-1 truncate text-sm font-normal text-muted-foreground">
            {run.instruction}
          </span>
          {(run.status === "queued" ||
            run.status === "running" ||
            run.status === "starting" ||
            run.awaitingTurn) && (
            <RefreshCw className="size-3.5 animate-spin text-muted-foreground" />
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {run.lastError && run.status === "error" && (
          <p className="flex items-start gap-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {run.lastError}
          </p>
        )}

        {run.status === "refused" && (
          <p className="text-xs text-muted-foreground">
            Refused ({run.refusalCode ?? "unknown"}): {run.refusalMessage}
          </p>
        )}

        {run.summary && <p className="text-muted-foreground">{run.summary}</p>}

        {run.schemaConformance && (
          <p
            className={cn(
              "flex items-start gap-2 text-xs",
              conformanceIsBad ? "text-[#9c3d31]" : "text-muted-foreground",
            )}
          >
            {conformanceIsBad ? (
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            ) : (
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
            )}
            {run.conformanceNote}
          </p>
        )}

        {run.files.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {run.files.map((file) => (
              <Button
                key={file.url}
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={() => void download(file.url, file.name)}
              >
                <Download className="mr-1.5 size-3.5" />
                {file.name}
                {file.size !== undefined && (
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    {formatBytes(file.size)}
                  </span>
                )}
              </Button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          {run.hasResult && (
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full"
              onClick={() => setShowResult((value) => !value)}
            >
              <FileText className="mr-1.5 size-3.5" />
              {showResult ? "Hide result" : "View result"}
            </Button>
          )}
          {run.sessionId !== null &&
            run.status !== "done" &&
            run.status !== "refused" && (
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full"
              onClick={() => void poll({ runId: run._id }).catch(() => {})}
            >
              <RefreshCw className="mr-1.5 size-3.5" />
              Poll now
            </Button>
          )}
        </div>

        {showResult && <ResultPanel runId={run._id} />}

        {run.status === "done" && (
          <div className="flex flex-wrap items-end gap-2 pt-2">
            <div className="grid min-w-[200px] flex-1 gap-1.5">
              <Label htmlFor={`follow-up-${run._id}`} className="text-xs">
                Follow-up
              </Label>
              <Input
                id={`follow-up-${run._id}`}
                value={followUpText}
                onChange={(event) => setFollowUpText(event.target.value)}
                placeholder="Ask for more detail…"
              />
            </div>
            <Button
              size="sm"
              className="rounded-full"
              disabled={busy || followUpText.trim() === ""}
              onClick={() => void sendFollowUp()}
            >
              Send
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Scrapes() {
  const { user, isLoading } = useAuth();
  const isAdmin = user?.role === "admin";

  // Keeps running scrapes moving without a server cron.
  useScrapesPolling();

  const config = useQuery(api.sieve.config, isAdmin ? {} : "skip");
  const runs = useQuery(api.sieve.runs, isAdmin ? {} : "skip");
  const startScrape = useAction(api.sieve.start);
  const readCredits = useAction(api.sieve.credits);

  const [instruction, setInstruction] = useState("");
  const [targetUrls, setTargetUrls] = useState("");
  const [outputSchema, setOutputSchema] = useState("");
  const [mode, setMode] = useState<string>("regular");
  const [starting, setStarting] = useState(false);

  const handleStart = async () => {
    if (instruction.trim() === "") {
      toast.error("Write an instruction first.");
      return;
    }
    let parsedSchema: unknown;
    if (outputSchema.trim() !== "") {
      try {
        parsedSchema = JSON.parse(outputSchema);
      } catch {
        toast.error("The output schema is not valid JSON.");
        return;
      }
    }
    setStarting(true);
    try {
      const result = await startScrape({
        instruction,
        targetUrls: targetUrls
          .split("\n")
          .map((value) => value.trim())
          .filter(Boolean),
        complianceMode: mode as "conservative" | "regular" | "yolo",
        ...(parsedSchema === undefined ? {} : { outputSchema: parsedSchema }),
      });
      toast.success("Run started.", { description: result.sessionId });
      setInstruction("");
      setTargetUrls("");
      setOutputSchema("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start.");
    } finally {
      setStarting(false);
    }
  };

  const handleCredits = async () => {
    try {
      const credits = await readCredits({});
      toast.success(
        credits.remaining === undefined
          ? "Credits checked."
          : `${credits.remaining} of ${credits.limit ?? "?"} credits remaining`,
        {
          description: credits.used === undefined ? undefined : `${credits.used} used`,
        },
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read credits.");
    }
  };

  if (isLoading) {
    return (
      <AppShell active="scrapes">
        <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="mt-6 h-64 w-full" />
        </div>
      </AppShell>
    );
  }

  if (!isAdmin) {
    return (
      <AppShell active="scrapes">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 py-24 text-center sm:px-6">
          <ShieldCheck className="size-8 text-muted-foreground/50" />
          <h1 className="mt-2 font-serif text-2xl font-semibold">
            Scrapes are limited to admins.
          </h1>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell active="scrapes">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <header className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Scraping
              </p>
              <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight">
                Sieve scrapes
              </h1>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                Turn public pages into rows. Runs happen on sieve&apos;s servers
                and the results land here.
              </p>
            </div>
            <Button variant="outline" className="rounded-full" onClick={() => void handleCredits()}>
              <Coins className="mr-2 size-4" />
              Credits
            </Button>
          </header>

          {config !== undefined && !config.configured ? (
            <Card className="mt-6 rounded-2xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 font-serif text-xl">
                  <Sparkles className="size-4 text-muted-foreground" />
                  Sieve is not connected yet
                </CardTitle>
                <CardDescription>
                  Add <span className="font-mono">SIEVE_API_KEY</span> in the
                  project&apos;s <strong>Keys</strong> tab. The key is
                  server-side only: it is never sent to the browser, logged, or
                  stored in git. Everything else in the app keeps working
                  normally without it.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <Card className="mt-6 rounded-2xl">
              <CardHeader>
                <CardTitle className="font-serif text-xl">New run</CardTitle>
                <CardDescription>
                  Describe in plain language what to extract.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="instruction">Instruction</Label>
                  <Textarea
                    id="instruction"
                    value={instruction}
                    onChange={(event) => setInstruction(event.target.value)}
                    placeholder="Extract the text and author of each quote"
                    rows={3}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="targets">Target pages (one per line, optional)</Label>
                  <Textarea
                    id="targets"
                    value={targetUrls}
                    onChange={(event) => setTargetUrls(event.target.value)}
                    placeholder="https://quotes.toscrape.com"
                    rows={2}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Site-access policy</Label>
                  <Select value={mode} onValueChange={setMode}>
                    <SelectTrigger className="w-full sm:w-64">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COMPLIANCE_MODES.map((value) => (
                        <SelectItem key={value} value={value}>
                          {value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {mode === "yolo" && (
                    <p className="flex items-center gap-2 text-xs text-[#9c3d31]">
                      <AlertTriangle className="size-3.5" />
                      yolo relaxes the site-access policy. Choose it only
                      deliberately.
                    </p>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="output-schema">Output schema (JSON, optional)</Label>
                  <Textarea
                    id="output-schema"
                    value={outputSchema}
                    onChange={(event) => setOutputSchema(event.target.value)}
                    placeholder='{"type":"object"}'
                    rows={2}
                    className="font-mono text-xs"
                  />
                </div>
                <Button
                  className="rounded-full"
                  disabled={starting}
                  onClick={() => void handleStart()}
                >
                  {starting ? "Starting…" : "Start run"}
                </Button>
              </CardContent>
            </Card>
          )}

          <div className="mt-8 space-y-3">
            <h2 className="font-serif text-xl font-semibold">Runs</h2>
            {runs === undefined ? (
              <Skeleton className="h-32 w-full" />
            ) : runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No runs yet. Start one above.
              </p>
            ) : (
              runs.map((run) => <RunCard key={run._id} run={run} />)
            )}
          </div>
        </motion.div>
      </div>
    </AppShell>
  );
}
