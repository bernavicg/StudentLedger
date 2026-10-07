import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQuery } from "convex/react";
import { Globe, Search } from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";

/** IANA timezone options for the picker, grouped by region. */
const TIMEZONES = [
  "UTC",
  // Americas
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Toronto",
  "America/Vancouver",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "America/Argentina/Buenos_Aires",
  // Europe
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Rome",
  "Europe/Madrid",
  "Europe/Amsterdam",
  "Europe/Stockholm",
  "Europe/Moscow",
  "Europe/Istanbul",
  // Asia
  "Asia/Manila",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Seoul",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Bangkok",
  "Asia/Jakarta",
  // Australia & Pacific
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Brisbane",
  "Pacific/Auckland",
  "Pacific/Fiji",
];

/** Human-readable label for a timezone identifier. */
function timezoneLabel(id: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: id,
      timeZoneName: "long",
    })
      .formatToParts(new Date())
      .filter((p) => p.type === "timeZoneName");
    return parts.length > 0 ? parts[0].value : id;
  } catch {
    return id;
  }
}

export default function Settings() {
  const { user } = useAuth();
  const settings = useQuery(
    api.users.getSettings,
    user ? { userId: user._id } : "skip",
  );
  const setTimezone = useMutation(api.users.setTimezone);

  const [saving, setSaving] = useState(false);
  const [selectedTimezone, setSelectedTimezone] = useState(
    settings?.timezone ?? "",
  );
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterText, setFilterText] = useState("");

  // Filter timezones by search text (case-insensitive match on name or label).
  const filteredTimezones = useMemo(() => {
    if (!filterText.trim()) return TIMEZONES;
    const q = filterText.toLowerCase();
    return TIMEZONES.filter((tz) => {
      const label = timezoneLabel(tz).toLowerCase();
      return tz.toLowerCase().includes(q) || label.includes(q);
    });
  }, [filterText]);

  const handleTimezoneChange = async (value: string) => {
    setSelectedTimezone(value);
    if (!user?._id) return;
    setSaving(true);
    try {
      await setTimezone({ userId: user._id, timezone: value });
      toast.success("Timezone updated.");
    } catch {
      toast.error("Could not save timezone.");
    } finally {
      setSaving(false);
    }
  };

  const userTimezone = settings?.timezone ?? "";

  return (
    <AppShell active="settings">
      <div className="mx-auto w-full max-w-4xl px-6 py-8 sm:py-10">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Settings
        </p>
        <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
          Settings
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Manage your personal preferences — your timezone affects how dates and times are shown across the ledger.
        </p>

        <div className="mt-8 rounded-2xl border border-border bg-card p-6">
          <div className="flex items-center gap-3">
            <Globe className="size-5 text-muted-foreground" />
            <h2 className="font-serif text-lg font-semibold">Timezone</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose your timezone so dates and times appear correctly for you. This affects the entries, invoices, and tasks pages.
          </p>

          <div className="mt-4 flex flex-col gap-3">
            <Label htmlFor="timezone-select">Your timezone</Label>
            <Popover open={filterOpen} onOpenChange={setFilterOpen}>
              <PopoverTrigger asChild>
                <Button
                  id="timezone-select"
                  variant="outline"
                  className="w-full justify-between rounded-xl"
                >
                  <span className="truncate">
                    {selectedTimezone
                      ? `${selectedTimezone} — ${timezoneLabel(selectedTimezone)}`
                      : "Select your timezone"}
                  </span>
                  <Search className="ml-2 size-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0 rounded-xl">
                <div className="flex flex-col gap-2 p-2">
                  <Input
                    value={filterText}
                    onChange={(event) => setFilterText(event.target.value)}
                    placeholder="Search timezones…"
                    className="h-9"
                    autoFocus
                  />
                  {filteredTimezones.length === 0 ? (
                    <p className="py-2 text-center text-sm text-muted-foreground">
                      No timezones match “{filterText}”
                    </p>
                  ) : (
                    <div className="max-h-72 overflow-y-auto">
                      {filteredTimezones.map((tz) => (
                        <button
                          key={tz}
                          type="button"
                          className="w-full cursor-pointer rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus:bg-accent focus:outline-none"
                          onClick={() => {
                            setSelectedTimezone(tz);
                            setFilterOpen(false);
                            setFilterText("");
                          }}
                        >
                          {tz} — {timezoneLabel(tz)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>
            <p className="text-xs text-muted-foreground">
              {userTimezone && userTimezone !== selectedTimezone && "Unsaved changes — select a timezone to apply."}
              {userTimezone && userTimezone === selectedTimezone && "Your current timezone setting."}
              {!userTimezone && "No timezone set — we'll use your browser's default."}
            </p>
          </div>

          <div className="mt-6 flex justify-end">
            <Button
              className="rounded-full"
              onClick={() => {
                if (selectedTimezone && user?._id) {
                  handleTimezoneChange(selectedTimezone);
                }
              }}
              disabled={saving || !selectedTimezone}
            >
              {saving ? "Saving…" : "Save timezone"}
            </Button>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-border bg-card p-6">
          <h2 className="font-serif text-lg font-semibold">About</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Ledger is a team billing and task management tool for student services.
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            Version 1.0.0
          </p>
        </div>
      </div>
    </AppShell>
  );
}
