import { AppShell } from "@/components/AppShell";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/convex/_generated/api";
import { extractSheetId } from "@/convex/lib/sheetId";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  RefreshCw,
  Sheet,
  Table2,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

/**
 * Embeddable viewer URL.
 *
 * Two id shapes arrive here and each has its own endpoint that allows
 * framing:
 *  - the spreadsheet's own id (from the /edit URL) → /preview, which serves
 *    any sheet the visitor could otherwise open, published or not
 *  - the published-link id handed out by File → Share → Publish to the web
 *    (always starts with 2PACX-) → /pubhtml, the only endpoint that serves it
 *
 * No query params: a hardcoded gid=0 breaks whenever the first tab's gid is
 * not 0, which is the norm for sheets Google created recently.
 */
function embedUrl(sheetId: string): string {
  const id = extractSheetId(sheetId);
  if (id.startsWith("2PACX-")) {
    return `https://docs.google.com/spreadsheets/d/e/${id}/pubhtml`;
  }
  return `https://docs.google.com/spreadsheets/d/${id}/preview`;
}

export default function Sheets() {
  const { user, isLoading } = useAuth();
  const isAdmin = user?.role === "admin";

  const status = useQuery(api.sheets.status);
  const syncNow = useAction(api.sheets.syncNow);
  const saveSettings = useMutation(api.sheets.saveSettings);

  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Uncontrolled inputs seeded from the saved values, remounted by `key`
  // whenever those change. Reading them on submit avoids an effect that would
  // copy query data into state on every render.
  const targetRef = useRef<HTMLInputElement>(null);
  const embedRef = useRef<HTMLInputElement>(null);
  const savedTarget = status?.sheetId ?? "";
  const savedEmbed = status?.embedSheetId ?? "";

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await syncNow({});
      toast.success("Synced to Google Sheets.", {
        description: result.message,
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not sync the sheet.",
      );
    } finally {
      setSyncing(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSettings({
        targetSheetId: extractSheetId(targetRef.current?.value ?? ""),
        embedSheetId: extractSheetId(embedRef.current?.value ?? ""),
      });
      toast.success("Saved.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save settings.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <AppShell active="sheets">
        <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="mt-6 h-64 w-full" />
        </div>
      </AppShell>
    );
  }

  const embedId = status?.embedSheetId ?? status?.sheetId ?? null;

  return (
    <AppShell active="sheets">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Export
            </p>
            <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight">
              Google Sheets
            </h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Usa ka nga mirror sa Ledger, tapos tanan students, sessions, ug
              entries. Si Ledger ang source of truth — ang sheet usa ra ka
              copy.
            </p>
          </div>
          {isAdmin && (
            <Button
              onClick={() => void handleSync()}
              disabled={syncing || !status?.hasCredentials}
            >
              <RefreshCw
                className={cn("mr-2 size-4", syncing && "animate-spin")}
              />
              {syncing ? "Syncing…" : "Sync now"}
            </Button>
          )}
        </header>

        {/* Status strip */}
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Card className="rounded-2xl">
            <CardContent className="p-4">
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                Connection
              </p>
              <p className="mt-1.5 flex items-center gap-2 text-sm font-medium">
                {status?.hasCredentials ? (
                  <>
                    <CheckCircle2 className="size-4 text-[#2e5c4d]" />
                    Credentials found
                  </>
                ) : (
                  <>
                    <AlertTriangle className="size-4 text-[#9c3d31]" />
                    No credentials
                  </>
                )}
              </p>
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardContent className="p-4">
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                Last sync
              </p>
              <p className="mt-1.5 text-sm font-medium">
                {status?.lastSyncAt
                  ? new Date(status.lastSyncAt).toLocaleString("en-PH", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : "Never"}
              </p>
              {status?.lastSummary && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {status.lastSummary}
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardContent className="p-4">
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                Sheet
              </p>
              <p
                className={cn(
                  "mt-1.5 flex items-center gap-2 text-sm font-medium",
                  status?.stale && "text-[#8a8578]",
                )}
              >
                {status?.stale ? (
                  "Changes waiting"
                ) : status?.lastSyncAt ? (
                  "Up to date"
                ) : (
                  "Not configured"
                )}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Error from the last attempt, shown in full — Google's own message
            is usually the part that tells you what to fix. */}
        {status?.lastError && (
          <Card className="mt-4 rounded-2xl border-[#9c3d31]/30 bg-[#9c3d31]/5">
            <CardContent className="p-4">
              <p className="flex items-center gap-2 text-sm font-medium text-[#9c3d31]">
                <AlertTriangle className="size-4" />
                Last sync failed
              </p>
              <p className="mt-1 break-words text-xs text-muted-foreground">
                {status.lastError}
              </p>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="viewer" className="mt-6">
          <TabsList>
            <TabsTrigger value="viewer">
              <Table2 className="mr-1.5 size-3.5" />
              Sheet
            </TabsTrigger>
            <TabsTrigger value="setup">
              <KeyRound className="mr-1.5 size-3.5" />
              Setup
            </TabsTrigger>
          </TabsList>

          <TabsContent value="viewer" className="mt-4">
            {embedId ? (
              <Card className="rounded-2xl">
                <CardContent className="p-0">
                  <iframe
                    title="Google Sheet"
                    src={embedUrl(embedId)}
                    className="h-[70vh] min-h-[420px] w-full rounded-b-2xl"
                  />
                </CardContent>
              </Card>
            ) : (
              <Card className="rounded-2xl">
                <CardContent className="flex flex-col items-center py-16 text-center">
                  <Sheet className="size-9 text-muted-foreground" />
                  <p className="mt-3 font-serif text-xl font-semibold">
                    Walay sheet pa
                  </p>
                  <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                    Add a spreadsheet in the Setup tab, then press Sync now to
                    fill it in.
                  </p>
                </CardContent>
              </Card>
            )}

            {embedId && (
              <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-2">
                  <ExternalLink className="size-3.5" />
                  <a
                    href={`https://docs.google.com/spreadsheets/d/${extractSheetId(embedId)}/edit`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    Open in Google Sheets
                  </a>
                </span>
                <span>
                  Blank viewer? Check that the sheet is shared with &ldquo;anyone
                  with the link&rdquo; (viewer) or published to the web, then reload.
                </span>
              </p>
            )}
          </TabsContent>

          <TabsContent value="setup" className="mt-4 space-y-4">
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="font-serif text-xl">
                  1. Add your credentials
                </CardTitle>
                <CardDescription>
                  Google needs a service account so the app can write on your
                  behalf. In your Google Cloud project, enable the Google Sheets
                  API, create a service account, download its JSON key, then
                  paste both values into the project&apos;s{" "}
                  <strong>Keys</strong> tab.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="font-mono text-xs text-muted-foreground">
                  GOOGLE_SERVICE_ACCOUNT_JSON
                </p>
                <p className="text-xs text-muted-foreground">
                  The whole service account file, pasted as one block.
                </p>
                <p className="mt-3 font-mono text-xs text-muted-foreground">
                  GOOGLE_SHEET_ID
                </p>
                <p className="text-xs text-muted-foreground">
                  Optional if you save a sheet id below. The bare id from the
                  sheet URL, or the whole URL.
                </p>
              </CardContent>
            </Card>

            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="font-serif text-xl">
                  2. Share the sheet
                </CardTitle>
                <CardDescription>
                  Open your spreadsheet, click Share, and add the service
                  account&apos;s <span className="font-mono">client_email</span>{" "}
                  as an <strong>Editor</strong>. It looks like{" "}
                  <span className="font-mono">
                    something@project.iam.gserviceaccount.com
                  </span>
                  . Without this, syncing fails with a 404 or a permissions
                  error.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="font-serif text-xl">
                  3. Choose the sheet
                </CardTitle>
                <CardDescription>
                  Paste the spreadsheet you want written to. To see it in the
                  Sheet tab, it also has to be published: in Google Sheets open{" "}
                  <strong>File → Share → Publish to the web</strong> and publish
                  it — or share the sheet so anyone with the link can view. The
                  embedded viewer uses Google&apos;s{" "}
                  <span className="font-mono">preview</span> endpoint, which
                  serves any sheet the visitor could otherwise open.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="target-sheet">Write to</Label>
                  <Input
                    key={savedTarget}
                    ref={targetRef}
                    id="target-sheet"
                    defaultValue={savedTarget}
                    placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
                    disabled={!isAdmin}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="embed-sheet">Embed in the Sheet tab</Label>
                  <Input
                    key={savedEmbed}
                    ref={embedRef}
                    id="embed-sheet"
                    defaultValue={savedEmbed}
                    placeholder="Leave blank to reuse the sheet above"
                    disabled={!isAdmin}
                  />
                </div>
                {isAdmin ? (
                  <Button
                    onClick={() => void handleSave()}
                    disabled={saving}
                    variant="outline"
                  >
                    {saving ? "Saving…" : "Save"}
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Only an admin can change this.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="font-serif text-xl">
                  What gets written
                </CardTitle>
                <CardDescription>
                  Four tabs are created automatically and fully rewritten on
                  every sync, so re-running never duplicates rows.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>
                    <strong className="text-foreground">Students</strong> —
                    authorized and remaining sessions, hours, rate, and balance.
                  </li>
                  <li>
                    <strong className="text-foreground">Attendance</strong> —
                    every session with its date, time, duration, and review
                    status.
                  </li>
                  <li>
                    <strong className="text-foreground">Ledger</strong> —
                    every entry with amount, status, student, and provider.
                  </li>
                  <li>
                    <strong className="text-foreground">Summary</strong> —
                    counts, approved hours, and approved spend.
                  </li>
                </ul>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
