import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { useMutation } from "convex/react";
import { CalendarCheck, CalendarIcon, Clock } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

/** Sessions can only start between 8:00am and 8:45pm. */
const FIRST_HOUR = 8;
const LAST_HOUR = 20;
const MINUTE_STEPS = [0, 15, 30, 45] as const;

/** Every bookable "HH:MM" slot between 8:00am and 8:45pm. */
const TIME_SLOTS: string[] = (() => {
  const slots: string[] = [];
  for (let hour = FIRST_HOUR; hour <= LAST_HOUR; hour++) {
    for (const minute of MINUTE_STEPS) {
      // 8:45pm is the last bookable start, so skip 9:00pm and later.
      if (hour === LAST_HOUR && minute > 45) continue;
      slots.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
    }
  }
  return slots;
})();

/** "14:30" -> "2:30 PM". */
function formatSlot(value: string): string {
  const [hourPart, minute] = value.split(":");
  const hour = Number(hourPart);
  const suffix = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${minute} ${suffix}`;
}

/** Start time plus the duration the session ran, mirroring the server. */
function computeEndSlot(start: string, durationMinutes: number): string {
  const [hourPart, minute] = start.split(":");
  const total = Number(hourPart) * 60 + Number(minute) + durationMinutes;
  const wrapped = ((total % 1440) + 1440) % 1440;
  const hours = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Local YYYY-MM-DD (avoids the UTC shift of toISOString). */
function toDayString(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function todayString(): string {
  return toDayString(new Date());
}

/** Parse "YYYY-MM-DD" back to a local Date for the calendar. */
function fromDayString(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDayLabel(value: string): string {
  return fromDayString(value).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Manual attendance marking: pick the date, the start time, and how long the
 * session ran. Sessions used scale with the duration against the student's
 * authorized minutes, so a 60-minute mark on a 30-minute plan costs 2.
 */
export function MarkSessionDialog({
  studentId,
  studentName,
  authorizedMinutes,
  remainingSessions,
  trigger,
}: {
  studentId: Id<"students">;
  studentName: string;
  authorizedMinutes: 30 | 60 | null;
  remainingSessions: number;
  /** Custom trigger; defaults to a "Mark session" button. */
  trigger?: ReactNode;
}) {
  const markAttendance = useMutation(api.students.markAttendance);
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(todayString);
  const [startTime, setStartTime] = useState<string>("08:00");
  const [duration, setDuration] = useState<30 | 60>(authorizedMinutes ?? 60);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const consumed = Math.max(1, Math.round(duration / (authorizedMinutes ?? 60)));
  const isToday = day === todayString();
  const overBudget = consumed > remainingSessions;
  // Derived from the chosen start + duration, same as the server.
  const endTime = computeEndSlot(startTime, duration);

  const handleSubmit = async () => {
    if (overBudget) return;
    setIsSubmitting(true);
    try {
      await markAttendance({
        studentId,
        day,
        startTime,
        durationMinutes: duration,
      });
      toast.success(
        consumed > 1
          ? `${studentName} marked · ${formatDayLabel(day)} ${formatSlot(startTime)}–${formatSlot(endTime)} · ${duration} min = ${consumed} sessions used.`
          : `${studentName} marked · ${formatDayLabel(day)} ${formatSlot(startTime)}–${formatSlot(endTime)} · ${duration} min.`,
      );
      setOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not mark session.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button className="rounded-full">
            <CalendarCheck className="mr-2 size-4" />
            Mark session
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">Mark a session</DialogTitle>
          <DialogDescription>
            Pick the date and start time manually. Sessions used scale with
            the duration
            {authorizedMinutes ? ` (${authorizedMinutes}-min authorized)` : ""}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Date */}
          <div className="grid gap-1.5">
            <Label className="text-xs">Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full justify-start rounded-xl font-normal"
                >
                  <CalendarIcon className="mr-2 size-4 shrink-0 opacity-60" />
                  <span className="truncate">{formatDayLabel(day)}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={fromDayString(day)}
                  onSelect={(date) => date && setDay(toDayString(date))}
                  // Month + year dropdowns so past years are one tap away,
                  // for backfilling attendance from earlier years.
                  captionLayout="dropdown"
                  startMonth={new Date(new Date().getFullYear() - 10, 0)}
                  endMonth={new Date(new Date().getFullYear() + 1, 11)}
                  autoFocus
                />
              </PopoverContent>
            </Popover>
            <div className="flex gap-2">
              <Button
                variant={isToday ? "default" : "outline"}
                size="sm"
                className="rounded-full"
                onClick={() => setDay(todayString())}
              >
                Today
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full"
                onClick={() => {
                  const yesterday = new Date();
                  yesterday.setDate(yesterday.getDate() - 1);
                  setDay(toDayString(yesterday));
                }}
              >
                Yesterday
              </Button>
            </div>
          </div>

          {/* Start time: 8:00am - 8:45pm in 15-minute steps. End time follows
              automatically from the duration. */}
          <div className="grid gap-1.5">
            <Label className="text-xs">Start time</Label>
            <div className="grid grid-cols-2 gap-2">
              <Select value={startTime} onValueChange={setStartTime}>
                <SelectTrigger className="rounded-xl">
                  <Clock className="mr-2 size-4 shrink-0 opacity-60" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {TIME_SLOTS.map((slot) => (
                    <SelectItem key={slot} value={slot}>
                      {formatSlot(slot)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex h-9 items-center rounded-xl border border-border bg-secondary/50 px-3 text-sm font-medium">
                {formatSlot(endTime)}
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              8:00am to 8:45pm start, in 15-minute steps. End time is worked
              out from the duration.
            </p>
          </div>

          {/* Duration */}
          <div className="grid gap-1.5">
            <Label className="text-xs">Duration</Label>
            <div className="flex overflow-hidden rounded-full border border-border text-xs font-medium">
              {([30, 60] as const).map((m, index) => {
                const cost = Math.max(
                  1,
                  Math.round(m / (authorizedMinutes ?? 60)),
                );
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setDuration(m)}
                    className={cn(
                      "flex-1 px-3 py-2 transition-colors",
                      duration === m
                        ? "bg-[#2e5c4d] text-[#fdfcf9]"
                        : "text-muted-foreground hover:text-foreground",
                      index === 1 && "border-l border-border",
                    )}
                  >
                    {m} min
                    <span className="ml-1 opacity-75">
                      ({cost} session{cost > 1 ? "s" : ""})
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Summary */}
          <div className="rounded-xl border border-border bg-secondary/50 p-4 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                Sessions used
              </span>
              <span className="font-serif text-xl font-semibold">
                {consumed}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatDayLabel(day)}, {formatSlot(startTime)} –{" "}
              {formatSlot(endTime)} · {remainingSessions - consumed} session
              {remainingSessions - consumed === 1 ? "" : "s"} left after this
              mark.
            </p>
            {overBudget && (
              <p className="mt-2 text-xs text-[#9c3d31]">
                Not enough sessions left — only {remainingSessions} remain.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || overBudget || remainingSessions === 0}
            className="rounded-full"
          >
            {isSubmitting ? "Marking…" : `Mark ${consumed} session${consumed > 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
