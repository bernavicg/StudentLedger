import { useState, useMemo, useCallback } from "react";
import { AppShell } from "@/components/AppShell";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameDay,
  addMonths,
  subMonths,
  isSameMonth,
  isWithinInterval,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Jewish holiday data (Gregorian windows, approximate).
//
// Floating holidays (all of them, really) are given as a
// [monthIndex, startDay, endDay] tuple so we can recompute for any year
// without a full Hebrew-calendar engine. "Fixed" Gregorian entries use
// [monthIndex, day, day] (start === end).
//
// This is a viewer convenience dataset, not a halakhic calendar. When the
// team needs exact dates, plug in a real Jewish-calendar library
// (hebcal / holidays-jewish) and replace this const.
// ---------------------------------------------------------------------------

interface HolidayInfo {
  nameEn: string;
  nameHe?: string;
  note: string;
  tone: "gold" | "blue" | "green" | "red" | "purple";
}

type HolidayFixed = { kind: "fixed"; month: number; day: number; info: HolidayInfo };
type HolidayRange = { kind: "range"; month: number; dayStart: number; dayEnd: number; info: HolidayInfo; };
type HolidayEntry = HolidayFixed | HolidayRange;

const HOLIDAYS: readonly HolidayEntry[] = [
  // Rosh Hashanah — Jewish new year (≈22–24 Tishrei ≈ Sep/Oct)
  { kind: "range", month: 8, dayStart: 24, dayEnd: 26, info: {
    nameEn: "Rosh Hashanah",
    nameHe: "ראש השנה",
    note: "Jewish new year. Two days of prayer, shofar blowing, and sweet new-year foods.",
    tone: "gold",
  }},
  // Yom Kippur — Day of Atonement (≈10 Tishrei ≈ Sep/Oct)
  { kind: "range", month: 8, dayStart: 2, dayEnd: 4, info: {
    nameEn: "Yom Kippur",
    nameHe: "יום כיפור",
    note: "Day of Atonement — the holiest day of the Jewish year. Fast and prayer.",
    tone: "red",
  }},
  // Sukkot first day (≈15 Tishrei ≈ Sep/Oct)
  { kind: "range", month: 8, dayStart: 18, dayEnd: 20, info: {
    nameEn: "Sukkot (first day)",
    nameHe: "סוכות",
    note: "Feast of Tabernacles — dwell in the sukkah, celebrate the fall harvest.",
    tone: "green",
  }},
  // Shemini Atzeret (≈22 Tishrei ≈ Sep/Oct)
  { kind: "range", month: 8, dayStart: 25, dayEnd: 27, info: {
    nameEn: "Shemini Atzeret",
    nameHe: "שמיני עצרת",
    note: "Eighth-day assembly after Sukkot. In Israel, Simchat Torah is combined here.",
    tone: "blue",
  }},
  // Simchat Torah (≈23 Tishrei ≈ Sep/Oct)
  { kind: "range", month: 8, dayStart: 26, dayEnd: 28, info: {
    nameEn: "Simchat Torah",
    nameHe: "שמחת תורה",
    note: "Rejoicing with the Torah — dancing with the scrolls, finishing and restarting the cycle.",
    tone: "purple",
  }},
  // Hanukkah first day (≈25 Kislev ≈ Nov/Dec)
  { kind: "range", month: 10, dayStart: 10, dayEnd: 12, info: {
    nameEn: "Hanukkah (first day)",
    nameHe: "חנוכה",
    note: "Festival of Lights — kindle the menorah, fried foods, games with the dreidel.",
    tone: "gold",
  }},
  // Tu BiShvat — "New Year of the Trees", 15th of Shevat (≈ Jan/Feb)
  { kind: "range", month: 0, dayStart: 15, dayEnd: 17, info: {
    nameEn: "Tu BiShvat",
    nameHe: "טו בשבט",
    note: "New Year of the Trees — planting, fruit, and ecological awareness.",
    tone: "green",
  }},
  // Purim — 14th of Adar (≈ Feb/Mar)
  { kind: "range", month: 1, dayStart: 20, dayEnd: 22, info: {
    nameEn: "Purim",
    nameHe: "פורים",
    note: "Joyful holiday celebrating the saving of the Jews in the Purim story. Costumes, mishloach manot, and megillah reading.",
    tone: "purple",
  }},
  // Pesach / Passover — first seder night, 15th of Nisan (≈ Mar/Apr)
  { kind: "range", month: 2, dayStart: 22, dayEnd: 25, info: {
    nameEn: "Pesach (first seder)",
    nameHe: "פסח",
    note: "Passover — the exodus from Egypt. Seder night, matzah, and the story of liberation.",
    tone: "gold",
  }},
  // Yom HaShoah — Holocaust Remembrance Day (≈ 27 Nisan ≈ Mar/Apr)
  { kind: "range", month: 3, dayStart: 5, dayEnd: 7, info: {
    nameEn: "Yom HaShoah",
    nameHe: "יום השואה",
    note: "Holocaust Remembrance Day — sirens, memories, and honoring those lost.",
    tone: "red",
  }},
  // Yom HaZikaron — Israeli Memorial Day (≈ 4 Iyar ≈ Apr/May)
  { kind: "range", month: 3, dayStart: 13, dayEnd: 15, info: {
    nameEn: "Yom HaZikaron",
    nameHe: "יום הזיכרון",
    note: "Israeli Memorial Day — remembering fallen soldiers and victims of terror.",
    tone: "blue",
  }},
  // Yom HaAtzmaut — Israeli Independence Day (≈ 5 Iyar ≈ Apr/May)
  { kind: "range", month: 3, dayStart: 14, dayEnd: 16, info: {
    nameEn: "Yom HaAtzmaut",
    nameHe: "יום העצמאות",
    note: "Israeli Independence Day — celebration of the founding of the State of Israel.",
    tone: "blue",
  }},
  // Lag BaOmer — 18th of Iyar (≈ Apr/May)
  { kind: "range", month: 3, dayStart: 25, dayEnd: 27, info: {
    nameEn: "Lag BaOmer",
    nameHe: "ל\"ג בעומר",
    note: "Lag BaOmer — bonfires, archery, and the end of a mourning period.",
    tone: "gold",
  }},
  // Shavuot — Feast of Weeks (≈ 6 Sivan ≈ May/Jun)
  { kind: "range", month: 4, dayStart: 26, dayEnd: 29, info: {
    nameEn: "Shavuot",
    nameHe: "שבועות",
    note: "Feast of Weeks — Torah given at Sinai, dairy meals, and all-night study.",
    tone: "green",
  }},
  // Tisha B'Av — 9th of Av (≈ Jul/Aug)
  { kind: "range", month: 6, dayStart: 8, dayEnd: 11, info: {
    nameEn: "Tisha B'Av",
    nameHe: "תשעה באב",
    note: "Ninth of Av — a major fast day mourning the destruction of the Temple and other tragedies.",
    tone: "red",
  }},

  // ---- Non-Jewish / secular "Jiwish" team holidays can go here ----
  // Example placeholder so the dataset isn't purely Jewish:
  { kind: "fixed", month: 0, day: 1, info: {
    nameEn: "New Year's Day",
    note: "Start-of-year closure. Team holiday.",
    tone: "blue",
  }},
  { kind: "fixed", month: 11, day: 25, info: {
    nameEn: "Christmas Day",
    note: "Fixed Gregorian closure the team observes.",
    tone: "gold",
  }},
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function holidayStartEnd(entry: HolidayEntry, year: number): { start: Date; end: Date } {
  if (entry.kind === "fixed") {
    const d = new Date(year, entry.month, entry.day, 0, 0, 0, 0);
    return { start: d, end: d };
  }
  return {
    start: new Date(year, entry.month, entry.dayStart, 0, 0, 0, 0),
    end: new Date(year, entry.month, entry.dayEnd, 23, 59, 59, 0),
  };
}

function buildYearHolidays(year: number) {
  const out: { date: Date; info: HolidayInfo; span?: { from: Date; to: Date } }[] = [];
  for (const entry of HOLIDAYS) {
    const { start, end } = holidayStartEnd(entry, year);
    out.push({ date: start, info: entry.info, span: entry.kind === "range" ? { from: start, to: end } : undefined });
  }
  return out;
}

function holidaysInMonth(year: number, month: number) {
  const monthStart = new Date(year, month, 1, 0, 0, 0, 0);
  const monthEnd = new Date(year, month, 1, 0, 0, 0, 0);
  monthEnd.setMonth(monthEnd.getMonth() + 1);
  monthEnd.setSeconds(monthEnd.getSeconds() - 1);

  const out: { date: Date; info: HolidayInfo; span?: { from: Date; to: Date } }[] = [];
  const yearHolidays = buildYearHolidays(year);
  for (const h of yearHolidays) {
    if (h.date > monthEnd || h.date < monthStart) continue;
    // for range holidays, also include if the range overlaps the month
    if (h.span) {
      const { from, to } = h.span;
      if (to < monthStart || from > monthEnd) continue;
    }
    out.push(h);
  }
  // keep one marker per distinct date
  const seen = new Set<string>();
  return out.filter((h) => {
    const key = format(h.date, "yyyy-MM-dd");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CalendarPage() {
  const today = new Date();
  const todayLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);

  // View = the month currently displayed. Initialized to today's month.
  const [view, setView] = useState<Date>(todayLocal);

  const year = view.getFullYear();
  const month = view.getMonth();

  const markers = useMemo(() => holidaysInMonth(year, month), [year, month]);

  // We render a static set of "holiday" buttons ourselves rather than relying
  // on DayPicker's custom modifiers classNames, because the installed
  // react-day-picker version (9.13.0) accepts Date[] selectors but we couldn't
  // confirm the classNames modifier hooks up to a custom "holiday" class in this
  // build. Rendering on top of the calendar keeps the behavior deterministic.
  const holidayButtons = useMemo(() => {
    return markers.map((m) => {
      const day = m.date.getDate();
      return {
        day,
        info: m.info,
        span: m.span,
        key: format(m.date, "yyyy-MM-dd"),
      };
    });
  }, [markers]);

  // selected day for the popup (any date, not only in-view)
  const [selected, setSelected] = useState<Date | undefined>(undefined);

  const selectedMarker = useMemo<{ info: HolidayInfo; span?: { from: Date; to: Date } } | undefined>(() => {
    if (!selected) return undefined;
    return markers.find((m) => isSameDay(m.date, selected)) ?? undefined;
  }, [markers, selected]);

  const monthLabel = format(view, "MMMM yyyy");
  const todayLabel = format(todayLocal, "MMMM d, yyyy");

  const navigatePrev = useCallback(() => {
    setView((d) => {
      // if we are already at the earliest viewable edge, just go back one month
      return subMonths(d, 1);
    });
  }, []);

  const navigateNext = useCallback(() => {
    setView((d) => addMonths(d, 1));
  }, []);

  const goToday = useCallback(() => setView(todayLocal), [todayLocal]);

  const setViewMonth = useCallback((next: Date) => setView(next), []);

  return (
    <AppShell active="calendar">
      <div className="mx-auto w-full max-w-3xl px-6 py-8 sm:py-10">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Jiwish calendar
            </p>
            <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
              Jewish holiday calendar
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Gregorian month grid with Jewish holidays marked. Click a marked day
              for the holiday detail. Dates are approximate windows — a real Hebrew
              calendar library would be needed for exact halakhic dates.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="rounded-full" onClick={goToday}>
              Today
            </Button>
          </div>
        </div>

        {/* Today reminder */}
        <div className="mt-6 rounded-2xl border border-border bg-card px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Today
          </p>
          <p className="mt-1 font-serif text-lg font-semibold">{todayLabel}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {markers.length === 0
              ? "No Jiwish holidays in this month."
              : `${markers.length} holiday${markers.length === 1 ? "" : "s"} in view`}
          </p>
        </div>

        {/* Month navigator (we render this above the grid so the calendar
            component's own caption doesn't double up) */}
        <div className="mt-6 flex items-center justify-between">
          <Button variant="ghost" size="icon" className="size-9" onClick={navigatePrev} aria-label="Previous month">
            <ChevronLeft className="size-4" />
          </Button>
          <h2 className="font-serif text-xl font-semibold">{monthLabel}</h2>
          <Button variant="ghost" size="icon" className="size-9" onClick={navigateNext} aria-label="Next month">
            <ChevronRight className="size-4" />
          </Button>
        </div>

        {/* Calendar grid — captionLayout="label" with the month label hidden via
            CSS (sr-only) so keyboard users still get the accessible label while we
            render our own visual month label above. */}
        <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card p-4 sm:p-6">
          <Calendar
            mode="single"
            // keep the selection inside a sane historical range
            startMonth={new Date(2020, 0, 1)}
            endMonth={new Date(2035, 11, 31)}
            showOutsideDays
            captionLayout="label"
            onMonthChange={setViewMonth}
            formatters={{
              formatMonthCaption: () => "",
            }}
            classNames={{
              caption_label: "sr-only",
            }}
          />

          {/* Overlay holiday markers: absolutely positioned dots/badges over
              the calendar grid cells. The calendar is 7 columns (weekdays) by
              ~6 rows. We compute positions relative to the grid container. */}
          {holidayButtons.length > 0 && (
            <HolidayMarkers
              year={year}
              month={month}
              buttons={holidayButtons}
              onDayClick={(day) => {
                const d = new Date(year, month, day, 0, 0, 0, 0);
                setSelected(d);
              }}
            />
          )}
        </div>

        {/* Legend */}
        <div className="mt-6 flex flex-wrap gap-3">
          {Object.entries(TONE_COLORS).map(([tone, color]) => (
            <div key={tone} className="flex items-center gap-2 text-xs text-muted-foreground">
              <span
                className="inline-block rounded-full size-3"
                style={{ backgroundColor: color }}
              />
              {tone}
            </div>
          ))}
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          Marker colors are decorative only — each holiday's tone is described in
          its popup. Click any marked day for details.
        </p>

        {/* Popup */}
        {selectedMarker && (
          <HolidayDialog
            open
            onOpenChange={(open) => {
              if (!open) setSelected(undefined);
            }}
            marker={selectedMarker}
            referenceDate={selected!}
          />
        )}
      </div>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Absolute-positioned holiday markers on top of the DayPicker grid.
// ---------------------------------------------------------------------------

interface HolidayMarkersProps {
  year: number;
  month: number;
  buttons: { day: number; info: HolidayInfo; span?: { from: Date; to: Date }; key: string }[];
  onDayClick: (day: number) => void;
}

const TONE_COLORS: Record<HolidayInfo["tone"], string> = {
  gold: "#d4a017",
  blue: "#1d4ed8",
  green: "#15803d",
  red: "#9c3d31",
  purple: "#6b21a8",
};

function HolidayMarkers({ year, month, buttons, onDayClick }: HolidayMarkersProps) {
  // Build a map: day-of-month -> list of markers (some days may have >1 holiday
  // if windows overlap; we show the first one's tone as the chip color).
  const byDay = new Map<number, { info: HolidayInfo; span?: { from: Date; to: Date } }>();
  for (const b of buttons) {
    if (!byDay.has(b.day)) {
      byDay.set(b.day, { info: b.info, span: b.span });
    }
  }

  // Get the week-start (Sunday) of the first day of the month so we can
  // position the 1st correctly. Weekday: 0=Sunday … 6=Saturday.
  const firstOfMonth = new Date(year, month, 1);
  const startOffset = firstOfMonth.getDay(); // 0..6
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cellSize = "min(4.5vw, 44px)"; // matches --cell-size roughly
  const cellGap = "0.25rem";
  const weekHeight = `calc(${cellSize} + ${cellGap})`;

  return (
    <div
      className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl"
      style={{ touchAction: "none" }}
    >
      {/* Each marker positioned over its cell. We assume the top of the grid
          aligns with the caption area omitted by captionLayout="none"; if the
          calendar has a top nav/caption block we would need to offset. In our
          configuration (captionLayout="label" with sr-only caption, showOutsideDays)
          the month grid starts near the top of the Calendar's inner container, so
          this works for the current build. If the app later adds a nav inside
          Calendar, adjust top offset. */}
      {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
        const marker = byDay.get(day);
        if (!marker) return null;
        // row: 0-based week index within the month grid
        const gridIndex = startOffset + (day - 1);
        const weekIndex = Math.floor(gridIndex / 7);
        const colIndex = gridIndex % 7;
        const top = weekIndex * (parseFloat(cellSize) + parseFloat(cellGap));
        const left = colIndex * (parseFloat(cellSize) + parseFloat(cellGap));
        const toneColor = TONE_COLORS[marker.info.tone];

        return (
          <button
            key={day}
            type="button"
            className="absolute pointer-events-auto rounded-full border-2 border-white/60 shadow-sm transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            style={{
              top: `${top + parseFloat(cellSize) - 10}px`,
              left: `${left + parseFloat(cellSize) - 10}px`,
              width: "20px",
              height: "20px",
              backgroundColor: toneColor,
            }}
            onClick={() => onDayClick(day)}
            aria-label={`Holiday on ${day} ${format(new Date(year, month, day), "MMMM yyyy")}`}
            title={marker.info.nameEn}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Holiday detail dialog
// ---------------------------------------------------------------------------

function HolidayDialog({
  open,
  onOpenChange,
  marker,
  referenceDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  marker: { info: HolidayInfo; span?: { from: Date; to: Date } };
  referenceDate: Date;
}) {
  const { info, span } = marker;
  const label = span
    ? `${format(span.from, "MMM d")} – ${format(span.to, "MMM d, yyyy")}`
    : format(referenceDate, "MMMM d, yyyy");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl flex items-center gap-3">
            <span
              className="inline-block rounded-full size-3"
              style={{ backgroundColor: TONE_COLORS[info.tone] }}
            />
            {info.nameEn}
          </DialogTitle>

          {info.nameHe && (
            <DialogDescription className="text-right">
              {info.nameHe}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="rounded-xl border border-border bg-secondary/40 p-4 text-sm">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {span ? "Observed window" : "Date"}
          </p>
          <p className="mt-1 font-serif text-base font-semibold">{label}</p>
          <p className="mt-2 leading-relaxed text-muted-foreground">{info.note}</p>
        </div>

        {span && (
          <p className="text-xs text-muted-foreground">
            This is a floating holiday — the observed window shown is an
            approximation for {span.from.getFullYear()}. For exact Hebrew dates,
            use a dedicated Jewish calendar source.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export { HOLIDAYS, buildYearHolidays, holidaysInMonth, type HolidayInfo, type HolidayEntry };
