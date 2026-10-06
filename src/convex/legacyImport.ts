"use node";

/**
 * Imports data from the two legacy Google Sheets into Ledger.
 *
 * Source sheets (both shared with the service account):
 *  - "Summary of Payments from April 1.2023" (1TYkkr9uBvHjaSreREtft6H-JQyInP2TZ)
 *    · LIst of Students 2025-2026 → students
 *    · SEPTEMBER 2025 … JUNE 2026 → attendance (sessions per student per month)
 *    · Summary of Payments From April → entries (money in)
 *  - "INVOICE MONITORING 2025-2026" (1Zro99gqcVHWMQl1Rp6foOIgdA4nF1sNOicueQVymlfQ)
 *    · SUNDAY SESSIONS → attendance
 *    · MONTHLY SESSIONS 25-26 → attendance
 *    · POLARIS Case No. LIST → providers
 *
 * Design notes:
 * - Import is idempotent: a legacyId tag on each imported row (and name
 *   matching for students) lets a re-run update rather than duplicate.
 * - Everything lands as `approved` so the imported history shows up in
 *   summaries immediately.
 * - The action never deletes rows; it only creates/updates what it can parse.
 * - A `preview` mode returns the parsed rows without touching the database,
 *   which is how the column mapping gets verified before the real run.
 */

import { createSign } from "node:crypto";
import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { internalAction } from "./_generated/server";
import * as XLSX from "xlsx";
import { namesMatch } from "./lib/namesMatch";

/*
 * The store mutation is referenced by hand-typed function reference, not via
 * the generated `internal` object. Reaching through `internal` here would make
 * this module's own action types circular (TS7022), because the internal api
 * includes this very module.
 */
type ApplyArgs = {
  students: { name: string; contact: string; sessions: number; rate?: number }[];
  sessions: { student: string; day: string | null; count?: number }[];
  entries: { student: string; amount?: number; day: string | null; note: string }[];
  providers: { name: string; contact: string }[];
};
type ApplyResult = {
  studentsCreated: number;
  studentsUpdated: number;
  sessionsCreated: number;
  sessionsSkipped: number;
  entriesCreated: number;
  entriesSkipped: number;
  providersCreated: number;
  providersUpdated: number;
  marker: string;
};
const applyRef = makeFunctionReference<"mutation", ApplyArgs, ApplyResult>(
  "legacyImportStore:apply",
);

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const TOKEN_URI = "https://oauth2.googleapis.com/token";
// drive: the legacy payments workbook is an uploaded .xlsx, and converting it
// (once) needs file creation on the service account's own Drive.
const SCOPE =
  "https://www.googleapis.com/auth/spreadsheets.readonly " +
  "https://www.googleapis.com/auth/drive";

const PAYMENTS_SHEET = "1TYkkr9uBvHjaSreREtft6H-JQyInP2TZ";
const INVOICE_SHEET = "1Zro99gqcVHWMQl1Rp6foOIgdA4nF1sNOicueQVymlfQ";

const MONTH_TABS = [
  "SEPTEMBER 2025",
  "OCTOBER 2025",
  "NOVEMBER 2025",
  "DECEMBER 2025",
  "JANUARY 2026",
  "FEBRUARY 2026",
  "MARCH 2026",
  "APRIL 2026",
  "MAY 2026",
  "JUNE 2026",
] as const;

/** Session length the legacy sheets assume, in minutes. */
const DEFAULT_SESSION_MINUTES = 60;

type ServiceAccount = { client_email?: string; private_key?: string };

function base64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function getAccessToken(): Promise<string> {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON is not set. Paste your service account JSON in the Keys tab.",
    );
  }
  const creds = JSON.parse(raw) as ServiceAccount;
  if (!creds.client_email || !creds.private_key) {
    throw new Error("That JSON has no client_email/private_key.");
  }
  const privateKey = creds.private_key.replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: creds.client_email,
      scope: SCOPE,
      aud: TOKEN_URI,
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${claims}`;
  const signed = createSign("RSA-SHA256").update(unsigned).sign(privateKey);
  const assertion = `${unsigned}.${base64url(signed)}`;
  const response = await fetch(TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Google sign-in failed (${response.status}): ${text.slice(0, 300)}`);
  }
  const parsed = JSON.parse(text) as { access_token?: string };
  if (!parsed.access_token) throw new Error("Google did not return an access token.");
  return parsed.access_token;
}

async function sheetsFetch(
  url: string,
  token: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Google Sheets API ${response.status}: ${text.slice(0, 400)}`);
  }
  return text === "" ? {} : (JSON.parse(text) as Record<string, unknown>);
}

type Cell = string | number | null;
type Grid = Cell[][];

type TabResult = { grid: Grid } | { error: string };

/** Internal shape the picker page reads: candidates + their sheet sessions. */
export type Candidate = {
  name: string;
  caseNo: string;
  remaining: number | undefined;
  monthlyHours: number;
  sundayHours: number;
  row: number;
};
export type SheetSessions = { student: string; day: string; count: number }[];

export type Candidates = {
  candidates: Candidate[];
  sessions: SheetSessions;
  warnings: string[];
};

/**
 * Read ONLY the two real source tabs the owner picked:
 *  - MONTHLY MONITORING 2025-2026 (invoice sheet) — the roster with per-month
 *    session-hours per student
 *  - SUNDAY SESSIONS (payments xlsx) — per-date Sunday attendance
 * Nothing is written to the database; the picker page chooses who to add.
 */
export const candidates = internalAction({
  args: {},
  handler: async (): Promise<Candidates> => {
    const token = await getAccessToken();
    const warnings: string[] = [];
    const candidates: Candidate[] = [];
    const sessions: SheetSessions = [];

    // ---- roster: MONTHLY MONITORING 2025-2026 -----------------------------
    const monRes = await readTab(INVOICE_SHEET, "MONTHLY MONITORING 2025-2026", token);
    if ("error" in monRes) {
      throw new Error(`Cannot read MONTHLY MONITORING 2025-2026: ${monRes.error}`);
    }
    const mon = monRes.grid;
    let headerIdx = -1;
    for (let i = 0; i < mon.length; i++) {
      const joined = (mon[i] ?? []).map((c) => String(c ?? "").toLowerCase()).join("|");
      if (joined.includes("student name") && joined.includes("case no")) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) throw new Error("MONTHLY MONITORING header row not found");

    /*
     * Rows: [No., Case No., STUDENT NAME (+school year), REMAINING, Provider
     * or Sunday total, Sept … Jul hours]. Several stacked lists follow the
     * header (authorized, make-ups, next-year walk-ins) and row labels like
     * "AUTHORIZED" separate them — every row with a student name + a case
     * number is a real candidate.
     */
    for (let r = headerIdx + 1; r < mon.length; r++) {
      const row = mon[r] ?? [];
      const name = cellText(row, 2);
      if (!/[a-zA-Z]/.test(name)) continue;
      if (/^total\b/i.test(name.trim())) continue;
      const caseNo = cellText(row, 1);
      const remaining = cellNumber(row, 3);
      let monthlyHours = 0;
      for (let c = 5; c <= 15; c++) {
        const h = cellNumber(row, c);
        if (h && h > 0) monthlyHours += h;
      }
      /*
       * Real candidates need a case number OR monthly hours: section labels
       * carry neither. Some students (recently added walk-ins) have no case
       * number on the sheet yet but do have hours, and they belong here.
       */
      if (!/^\d{4,}$/.test(caseNo) && monthlyHours <= 0) continue;
      const sundayHours = sessions
        .filter((s) => namesMatch(s.student, name))
        .reduce((sum, s) => sum + s.count, 0);
      candidates.push({
        name: name.trim(),
        caseNo,
        remaining,
        monthlyHours: Math.round(monthlyHours * 100) / 100,
        sundayHours: Math.round(sundayHours * 100) / 100,
        row: r + 1,
      });
    }

    // ---- attendance: SUNDAY SESSIONS (per-date) ---------------------------
    const sun = await resolvePaymentsSource(PAYMENTS_SHEET, token);
    const sundayRes = await readPaymentsTab(sun, "SUNDAY SESSIONS", token);
    if ("error" in sundayRes) {
      warnings.push(`SUNDAY SESSIONS tab unreadable: ${sundayRes.error}`);
    } else {
      const grid = sundayRes.grid;
      let headerRow = -1;
      let dateCols: { col: number; day: string }[] = [];
      const syYear = (month: number) => (month >= 7 ? 2025 : 2026);
      for (let r = 0; r < Math.min(grid.length, 12); r++) {
        const row = grid[r] ?? [];
        const cols: { col: number; day: string }[] = [];
        for (let c = 0; c < row.length; c++) {
          const text = cellText(row, c);
          const dm = text.match(/^(\d{1,2})[\s-]+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/i);
          if (dm) {
            const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
            const mo = months.indexOf(dm[2].toLowerCase()) + 1;
            cols.push({ col: c, day: `${syYear(mo)}-${String(mo).padStart(2, "0")}-${dm[1].padStart(2, "0")}` });
          }
        }
        if (cols.length >= 3) {
          headerRow = r;
          dateCols = cols;
          break;
        }
      }
      if (headerRow < 0) {
        warnings.push("SUNDAY SESSIONS has no recognizable date header row");
      } else {
        for (let r = headerRow + 1; r < grid.length; r++) {
          const row = grid[r] ?? [];
          const studentName = cellText(row, 1).trim();
          if (!/[a-zA-Z]/.test(studentName) || /^total\b/i.test(studentName)) continue;
          for (const { col, day } of dateCols) {
            const count = cellNumber(row, col);
            if (count === undefined || count <= 0) continue;
            sessions.push({ student: studentName, day, count });
          }
        }
      }
    }

    return { candidates, sessions, warnings };
  },
});

/** Read a whole tab; keeps the real error text so warnings can surface it. */
async function readTab(
  sheetId: string,
  tab: string,
  token: string,
): Promise<TabResult> {
  const url = `${SHEETS_API}/${sheetId}/values/${encodeURIComponent(tab)}?majorDimension=ROWS`;
  try {
    const data = await sheetsFetch(url, token);
    return { grid: (data.values as Grid | undefined) ?? [] };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}


/**
 * The payments workbook is an .xlsx, which the Sheets API refuses to read
 * ("The document must not be an Office file"), and the service account has
 * zero Drive storage so it cannot convert or copy anything. It CAN download
 * the file's bytes, though — so download once and parse the Excel in-memory.
 */
type PaymentsSource =
  | { kind: "api"; id: string }
  | { kind: "workbook"; wb: XLSX.WorkBook; cache: Map<string, TabResult> };

async function resolvePaymentsSource(
  fileId: string,
  token: string,
): Promise<PaymentsSource> {
  const meta = await fetch(`${SHEETS_API}/${fileId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (meta.ok) return { kind: "api", id: fileId };

  const content = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!content.ok) {
    throw new Error(
      `Cannot read the payments workbook (${content.status} from Drive). ` +
        "Share it with the service account as Viewer, or save it as a Google Sheet and share that instead.",
    );
  }
  const wb = XLSX.read(Buffer.from(await content.arrayBuffer()), { type: "buffer" });
  return { kind: "workbook", wb, cache: new Map() };
}

/** Read one tab of the payments workbook, from the API or the in-memory xlsx. */
async function readPaymentsTab(
  source: PaymentsSource,
  tab: string,
  token: string,
): Promise<TabResult> {
  if (source.kind === "api") return readTab(source.id, tab, token);

  const wanted = tab.trim().toLowerCase();
  const sheetName = source.wb.SheetNames.find(
    (name) => name.trim().toLowerCase() === wanted,
  );
  if (!sheetName) {
    return { error: `tab '${tab}' not found in the Excel file` };
  }
  const cached = source.cache.get(wanted);
  if (cached) return cached;
  // raw:false → cells come back as their formatted text. This matters for
  // the date headers: some serial columns in this workbook are corrupted
  // (+~1 year) while their displayed text (" Sep 10") is correct.
  const rows = XLSX.utils.sheet_to_json<Cell[]>(source.wb.Sheets[sheetName]!, {
    header: 1,
    raw: false,
    defval: null,
  }) as unknown as Grid;
  const grid: Grid = rows.map((row) =>
    (row ?? []).map((cell) =>
      cell === null || cell === undefined || typeof cell === "string" || typeof cell === "number"
        ? (cell as Cell)
        : (String(cell) as Cell),
    ),
  );
  const result: TabResult = { grid };
  source.cache.set(wanted, result);
  return result;
}

function cellText(row: Cell[], index: number): string {
  const value = row[index];
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function cellNumber(row: Cell[], index: number): number | undefined {
  const value = row[index];
  if (value === null || value === undefined || value === "") return undefined;
  const num = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(num) ? num : undefined;
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Turn a date-ish cell into YYYY-MM-DD. Handles the formats the legacy
 * sheets use: Excel serials, "9/7/2025", "Sep 7", "2025-09-07".
 */
function parseDay(value: Cell, fallbackYear: number, fallbackMonth: number): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && value > 20000 && value < 60000) {
    // Excel serial date (days since 1899-12-30).
    const ms = (value - 25569) * 86400 * 1000;
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  const text = String(value).trim();
  const iso = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  }
  const slash = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (slash) {
    const year = slash[3].length === 2 ? 2000 + Number(slash[3]) : Number(slash[3]);
    return `${year}-${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}`;
  }
  const monthDay = text.match(
    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})/i,
  );
  if (monthDay) {
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const m = months.indexOf(monthDay[1].toLowerCase()) + 1;
    return `${fallbackYear}-${String(m).padStart(2, "0")}-${monthDay[2].padStart(2, "0")}`;
  }
  // "7-Sep" style (day first), as used by the SUNDAY SESSIONS header.
  const dayMonth = text.match(/^(\d{1,2})[\s-]+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/i);
  if (dayMonth) {
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const m = months.indexOf(dayMonth[2].toLowerCase()) + 1;
    return `${fallbackYear}-${String(m).padStart(2, "0")}-${dayMonth[1].padStart(2, "0")}`;
  }
  const dayOnly = text.match(/^(\d{1,2})$/);
  if (dayOnly) {
    return `${fallbackYear}-${String(fallbackMonth).padStart(2, "0")}-${dayOnly[1].padStart(2, "0")}`;
  }
  return null;
}

function monthOf(tab: string): { year: number; month: number } | null {
  const m = tab.match(
    /(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+(\d{4})/i,
  );
  if (!m) return null;
  const names = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  return { month: names.indexOf(m[1].toLowerCase()) + 1, year: Number(m[2]) };
}

export type PreviewStudent = { name: string; contact: string; sessions: number; rate: number | undefined; row: number };
export type PreviewSession = { student: string; day: string | null; count?: number; tab: string; row: number };
export type PreviewEntry = { student: string; amount: number | undefined; day: string | null; note: string; tab: string; row: number };
export type PreviewProvider = { name: string; contact: string };

export type Preview = {
  students: PreviewStudent[];
  sessions: PreviewSession[];
  entries: PreviewEntry[];
  providers: PreviewProvider[];
  tabsSeen: string[];
  warnings: string[];
};

/**
 * Dry-run: read every source tab and shape the rows, but change nothing.
 * This is how the mapping gets verified against the real data before
 * anything is written.
 */
export const preview = internalAction({
  args: {},
  handler: async (): Promise<Preview> => {
    const token = await getAccessToken();
    const warnings: string[] = [];
    const tabsSeen: string[] = [];

    return buildPreview(PAYMENTS_SHEET, INVOICE_SHEET, token, warnings, tabsSeen);
  },
});

/** Run the import for real. Creates/updates students, sessions, entries. */
export const run = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }) => {
    const token = await getAccessToken();
    const warnings: string[] = [];
    const tabsSeen: string[] = [];

    const data = await buildPreview(PAYMENTS_SHEET, INVOICE_SHEET, token, warnings, tabsSeen);
    if (dryRun) {
      return {
        students: data.students.length,
        sessions: data.sessions.length,
        entries: data.entries.length,
        providers: data.providers.length,
        warnings,
        tabsSeen,
        dryRun: true,
      };
    }

    const result: ApplyResult = await ctx.runMutation(applyRef, {
      students: data.students.map(({ name, contact, sessions: n, rate }) => ({
        name,
        contact,
        sessions: n,
        rate,
      })),
      sessions: data.sessions.map(({ student, day, count }) => ({ student, day, count })),
      entries: data.entries.map(({ student, amount, day, note }) => ({ student, amount, day, note })),
      providers: data.providers,
    });

    return {
      ...result,
      warnings,
      tabsSeen,
      dryRun: false,
    };
  },
});

/** Public action an admin can call from the UI. */
export const importNow = internalAction({
  args: {},
  handler: async (ctx) => {
    const token = await getAccessToken();
    const warnings: string[] = [];
    const tabsSeen: string[] = [];

    const data = await buildPreview(PAYMENTS_SHEET, INVOICE_SHEET, token, warnings, tabsSeen);
    const result: ApplyResult = await ctx.runMutation(applyRef, {
      students: data.students.map(({ name, contact, sessions: n, rate }) => ({
        name,
        contact,
        sessions: n,
        rate,
      })),
      sessions: data.sessions.map(({ student, day, count }) => ({ student, day, count })),
      entries: data.entries.map(({ student, amount, day, note }) => ({ student, amount, day, note })),
      providers: data.providers,
    });
    return { ...result, warnings, tabsSeen };
  },
});

/** Shared read+parse pipeline for preview and run. */
async function buildPreview(
  paymentsFileId: string,
  invoiceSheetId: string,
  token: string,
  warnings: string[],
  tabsSeen: string[],
): Promise<Preview> {
  // The payments workbook is an .xlsx: download the bytes and parse them
  // in-memory (the Sheets API refuses Office files).
  const payments = await resolvePaymentsSource(paymentsFileId, token);
  const students: PreviewStudent[] = [];
  const sessions: PreviewSession[] = [];
  const entries: PreviewEntry[] = [];
  const providers: PreviewProvider[] = [];

  void tabsSeen;
  void warnings;
  void students;
  void sessions;
  void entries;
  void providers;
  void invoiceSheetId;

  // ---- Sheet 1: students list -------------------------------------------
  const studentTabRes = await readPaymentsTab(payments, "LIst of Students 2025-2026", token);
  if ("error" in studentTabRes) {
    warnings.push(`Sheet 1: 'LIst of Students 2025-2026' — ${studentTabRes.error}`);
  } else {
    const studentTab = studentTabRes.grid;
    tabsSeen.push("LIst of Students 2025-2026");
    // Row 0 is expected to be headers. We scan for a name-like column
    // instead of trusting column positions.
    let headerIdx = 0;
    for (let i = 0; i < Math.min(studentTab.length, 10); i++) {
      const joined = studentTab[i]!.map((c) => String(c ?? "").toLowerCase()).join(" ");
      if (joined.includes("name")) {
        headerIdx = i;
        break;
      }
    }
    const header = studentTab[headerIdx] ?? [];
    const nameCol = header.findIndex((c) => String(c ?? "").toLowerCase().includes("name"));
    const contactCol = header.findIndex((c) => {
      const h = String(c ?? "").toLowerCase();
      return h.includes("contact") || h.includes("phone") || h.includes("mobile");
    });
    const sessionsCol = (() => {
      const lower2 = header.map((c) => String(c ?? "").toLowerCase());
      const approved = lower2.findIndex((h) => h.includes("approved session"));
      if (approved >= 0) return approved;
      return lower2.findIndex((h) => h.includes("session") && !h.includes("minutes"));
    })();
    const rateCol = header.findIndex((c) => {
      const h = String(c ?? "").toLowerCase();
      return h.includes("rate") || h.includes("fee") || h.includes("price");
    });

    for (let r = headerIdx + 1; r < studentTab.length; r++) {
      const row = studentTab[r] ?? [];
      const name = nameCol >= 0 ? cellText(row, nameCol) : cellText(row, 0);
      if (name === "" || normalizeName(name) === "name") continue;
      // Section headers ("COMPENSATORY (9 Students …)") and note rows have
      // nothing numeric in the NO. column — every real student row does.
      if (cellNumber(row, 0) === undefined) continue;
      students.push({
        name,
        contact: contactCol >= 0 ? cellText(row, contactCol) : "",
        sessions: sessionsCol >= 0 ? cellNumber(row, sessionsCol) ?? 0 : 0,
        rate: rateCol >= 0 ? cellNumber(row, rateCol) : undefined,
        row: r + 1,
      });
    }
  }

  // ---- Sheet 1: monthly session tabs → attendance ------------------------
  for (const tab of MONTH_TABS) {
    const res = await readPaymentsTab(payments, tab, token);
    if ("error" in res) {
      warnings.push(`Sheet 1: '${tab}' skipped — ${res.error}`);
      continue;
    }
    const grid = res.grid;
    tabsSeen.push(tab);
    const monthInfo = monthOf(tab);
    if (!monthInfo) continue;

    /*
     * Real layout: row 0 is [NO., STUDENT NAME, TOTAL, <date>, <date>, …]
     * where the date headers display as " Sep 1" etc. (the underlying
     * serials are unreliable — some are shifted ~1 year — so the formatted
     * text is the source of truth, with the year coming from the tab).
     * Each cell in a date column is that student's session count for the
     * day (0.5 = half session, blank = none).
     */
    const header = grid[0] ?? [];
    const dateCols: { col: number; day: string }[] = [];
    for (let c = 3; c < header.length; c++) {
      const day = parseDay(header[c]!, monthInfo.year, monthInfo.month);
      if (day) dateCols.push({ col: c, day });
    }
    if (dateCols.length === 0) {
      warnings.push(`Sheet 1: '${tab}' has no date columns in its header, skipped`);
      continue;
    }
    for (let r = 1; r < grid.length; r++) {
      const row = grid[r] ?? [];
      const studentName = cellText(row, 1) || cellText(row, 0);
      const clean = studentName.trim();
      if (!/[a-zA-Z]/.test(clean) || /^total\b/i.test(clean)) continue;
      for (const { col, day } of dateCols) {
        if (day < "2025-07-01" || day > "2026-06-30") continue;
        const count = cellNumber(row, col);
        if (count === undefined || count <= 0) continue;
        sessions.push({ student: studentName, day, count, tab, row: r + 1 });
      }
    }
  }

  // ---- Sheet 1: Summary of Payments From April → entries ------------------
  const paymentsTabRes = await readPaymentsTab(payments, "Summary of Payments From April", token);
  if ("error" in paymentsTabRes) {
    warnings.push(`Sheet 1: 'Summary of Payments From April' — ${paymentsTabRes.error}`);
  } else {
    const paymentsTab = paymentsTabRes.grid;
    tabsSeen.push("Summary of Payments From April");
    let headerIdx = 0;
    for (let i = 0; i < Math.min(paymentsTab.length, 10); i++) {
      const joined = paymentsTab[i]!.map((c) => String(c ?? "").toLowerCase()).join(" ");
      if (joined.includes("amount") || joined.includes("payment")) {
        headerIdx = i;
        break;
      }
    }

    /*
     * Real layout: [Date, Client's Name, CASE NO. - INVOICE NO., Month/Year,
     * Payment Amount, Invoice Amount, Total Payment, remark]. Rows without a
     * client name are invoice line items of the row above (the parent row's
     * Total Payment already covers them). Current-year scope: keep dates
     * from April 2025 on.
     */
    for (let r = headerIdx + 1; r < paymentsTab.length; r++) {
      const row = paymentsTab[r] ?? [];
      const student = cellText(row, 1);
      if (student === "" || /^total\b/i.test(student.trim())) continue;
      const amount = cellNumber(row, 6) ?? cellNumber(row, 4);
      if (amount === undefined || amount === 0) continue;
      const day = parseDay(row[0]!, 2025, 4);
      if (day === null || day < "2025-04-01" || day > "2026-08-31") continue;
      const caseNo = cellText(row, 2);
      const remark = cellText(row, 7);
      entries.push({
        student,
        amount: Math.round(amount * 100),
        day,
        note: [caseNo, remark].filter(Boolean).join(" · "),
        tab: "Summary of Payments From April",
        row: r + 1,
      });
    }
  }

  // ---- Sheet 2: SUNDAY SESSIONS + MONTHLY SESSIONS 25-26 ------------------
  /*
   * SUNDAY SESSIONS: a title block, then a header row of "7-Sep"-style
   * dates, then [name, TOTAL, count, count, …]. MONTHLY SESSIONS 25-26 is
   * free text: a student name row, a "Total: N sessions" line, then one
   * line per session like "09/17/25 – 1 hour, evaluation".
   * School year 25-26: Sep–Dec → 2025, Jan–Jun → 2026.
   */
  const syYear = (month: number) => (month >= 7 ? 2025 : 2026);

  const sundayRes = await readTab(invoiceSheetId, "SUNDAY SESSIONS", token);
  if ("error" in sundayRes) {
    warnings.push(`Sheet 2: 'SUNDAY SESSIONS' skipped — ${sundayRes.error}`);
  } else {
    const grid = sundayRes.grid;
    tabsSeen.push("SUNDAY SESSIONS");
    let headerRow = -1;
    let dateCols: { col: number; day: string }[] = [];
    for (let r = 0; r < Math.min(grid.length, 12); r++) {
      const row = grid[r] ?? [];
      const cols: { col: number; day: string }[] = [];
      for (let c = 0; c < row.length; c++) {
        const text = cellText(row, c);
        const dm = text.match(/^(\d{1,2})[\s-]+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/i);
        if (dm) {
          const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
          const mo = months.indexOf(dm[2].toLowerCase()) + 1;
          cols.push({ col: c, day: `${syYear(mo)}-${String(mo).padStart(2, "0")}-${dm[1].padStart(2, "0")}` });
        }
      }
      if (cols.length >= 3) {
        headerRow = r;
        dateCols = cols;
        break;
      }
    }
    if (headerRow < 0) {
      warnings.push("Sheet 2: 'SUNDAY SESSIONS' has no recognizable date header row");
    } else {
      for (let r = headerRow + 1; r < grid.length; r++) {
        const row = grid[r] ?? [];
        const studentName = cellText(row, 0);
        const clean = studentName.trim();
        if (!/[a-zA-Z]/.test(clean) || /^total\b/i.test(clean)) continue;
        for (const { col, day } of dateCols) {
          const count = cellNumber(row, col);
          if (count === undefined || count <= 0) continue;
          sessions.push({ student: studentName, day, count, tab: "SUNDAY SESSIONS", row: r + 1 });
        }
      }
    }
  }

  const monthlyRes = await readTab(invoiceSheetId, "MONTHLY SESSIONS 25-26", token);
  if ("error" in monthlyRes) {
    warnings.push(`Sheet 2: 'MONTHLY SESSIONS 25-26' skipped — ${monthlyRes.error}`);
  } else {
    const grid = monthlyRes.grid;
    tabsSeen.push("MONTHLY SESSIONS 25-26");
    let currentStudent = "";
    for (let r = 0; r < grid.length; r++) {
      const cells = (grid[r] ?? []).map((c) => (c === null ? "" : String(c).trim()));
      const nonEmpty = cells.filter(Boolean);
      if (nonEmpty.length === 0) continue;
      const first = nonEmpty[0] ?? "";
      // Session lines all start with a date: "09/17/25 – 1 hour",
      // "09/09/25 – 30 minutes", "09/16/25 – 4:00 PM–5:00 PM".
      const sessionDate = first.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*[–\-—]/);
      if (sessionDate && currentStudent) {
        const year = Number(sessionDate[3]!.length === 2 ? `20${sessionDate[3]}` : sessionDate[3]);
        const day = `${year}-${sessionDate[1]!.padStart(2, "0")}-${sessionDate[2]!.padStart(2, "0")}`;
        if (day >= "2025-07-01" && day <= "2026-06-30") {
          const hourMatch = first.match(/([0-9.]+)\s*hour/i);
          const minMatch = first.match(/([0-9.]+)\s*minutes?/i);
          const count = hourMatch
            ? Number(hourMatch[1]) || 1
            : minMatch
              ? Number(minMatch[1]) / 60
              : 1;
          sessions.push({
            student: currentStudent,
            day,
            count: Math.round(count * 100) / 100,
            tab: "MONTHLY SESSIONS 25-26",
            row: r + 1,
          });
        }
        continue;
      }
      if (/^total\b/i.test(first)) continue;
      // Otherwise a row starting with text is the next student's name.
      if (/[a-zA-Z]/.test(first)) {
        currentStudent = first.replace(/\s*\([^)]*\)\s*$/, "").trim();
      }
    }
  }

  // ---- Sheet 2: POLARIS Case No. LIST → providers -------------------------
  const polarisRes = await readTab(invoiceSheetId, "POLARIS Case No. LIST", token);
  if ("error" in polarisRes) {
    warnings.push(`Sheet 2: 'POLARIS Case No. LIST' — ${polarisRes.error}`);
  } else {
    const polarisTab = polarisRes.grid;
    tabsSeen.push("POLARIS Case No. LIST");
    const header = polarisTab[0] ?? [];
    const lower = header.map((c) => String(c ?? "").toLowerCase());
    const nameCol = lower.findIndex((h) => h.includes("name") || h.includes("provider"));
    const contactCol = lower.findIndex((h) => h.includes("contact") || h.includes("case"));
    for (let r = 1; r < polarisTab.length; r++) {
      const row = polarisTab[r] ?? [];
      const name = nameCol >= 0 ? cellText(row, nameCol) : cellText(row, 0);
      if (name === "") continue;
      providers.push({
        name,
        contact: contactCol >= 0 ? cellText(row, contactCol) : "",
      });
    }
  }

  void DEFAULT_SESSION_MINUTES;
  return { students, sessions, entries, providers, tabsSeen, warnings };
}
