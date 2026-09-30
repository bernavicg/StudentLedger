"use node";

/**
 * Writes a prepared mirror of Ledger into a Google Sheet.
 *
 * This runs in the Node runtime because the service-account JWT flow needs
 * Node crypto. Convex actions have no `ctx.db`, so this file deliberately
 * knows nothing about the database: the caller gathers the rows (see
 * lib/sheetRows.ts) and hands them over. That keeps the network I/O here and
 * the data shaping there.
 *
 * Design notes:
 * - Ledger stays the single source of truth. Every sync REWRITES each tab from
 *   scratch rather than appending, so the sheet is always a clean snapshot and
 *   re-running a sync can never duplicate rows.
 * - Auth is a service account, so setup is a single JSON blob pasted into the
 *   deployment env. The spreadsheet must be shared with that account's
 *   `client_email` as an editor.
 * - No npm dependency: the service-account JWT is signed with Node's built-in
 *   crypto, so this adds nothing to install and keeps the two lockfiles from
 *   drifting apart.
 */

import { createSign } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { SHEET_TABS, type SheetRow } from "./lib/sheetRows";
import { resolveTargetId } from "./lib/sheetId";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const TOKEN_URI = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

type ServiceAccount = {
  client_email?: string;
  private_key?: string;
};

/** base64url, which is what JWT uses (not standard base64). */
function base64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Get an access token for the service account.
 *
 * This signs the JWT assertion by hand with Node's built-in crypto rather than
 * pulling in a Google client library. The whole flow is one signed payload
 * plus one POST, so a dependency would add install weight (and a second
 * lockfile to keep in sync) for no benefit.
 */
async function getAccessToken(): Promise<string> {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON is not set. Paste your service account JSON in the Keys tab.",
    );
  }

  let creds: ServiceAccount;
  try {
    creds = JSON.parse(raw) as ServiceAccount;
  } catch {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON. Paste the whole file contents.",
    );
  }
  if (!creds.client_email || !creds.private_key) {
    throw new Error(
      "That JSON has no client_email/private_key. Paste the full service account file, not part of it.",
    );
  }

  // A JSON blob escapes the newlines in the PEM key; restore them.
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

  const signature = createSign("RSA-SHA256")
    .update(unsigned)
    .sign(privateKey);
  const assertion = `${unsigned}.${base64url(signature)}`;

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
    throw new Error(
      `Google sign-in failed (${response.status}): ${text.slice(0, 300)}`,
    );
  }
  const parsed = JSON.parse(text) as { access_token?: string };
  if (!parsed.access_token) {
    throw new Error("Google did not return an access token.");
  }
  return parsed.access_token;
}

/** Which spreadsheet to write. Env wins, then the value saved in settings. */

async function sheetsFetch(
  url: string,
  token: string,
  init?: { method?: string; body?: unknown },
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  if (!response.ok) {
    // Surface Google's own message; it is usually the useful part.
    throw new Error(
      `Google Sheets API ${response.status}: ${text.slice(0, 400)}`,
    );
  }
  return text === "" ? {} : (JSON.parse(text) as Record<string, unknown>);
}

/** Create any tabs that do not exist yet, so a brand new sheet just works. */
async function ensureTabs(
  sheetId: string,
  token: string,
): Promise<void> {
  const meta = await sheetsFetch(
    `${SHEETS_API}/${sheetId}?fields=sheets.properties.title`,
    token,
  );
  const existing = new Set(
    (
      (meta.sheets as { properties?: { title?: string } }[] | undefined) ?? []
    )
      .map((sheet) => sheet.properties?.title)
      .filter((title): title is string => typeof title === "string"),
  );

  const missing = Object.values(SHEET_TABS).filter(
    (title) => !existing.has(title),
  );
  if (missing.length === 0) return;

  await sheetsFetch(`${SHEETS_API}/${sheetId}:batchUpdate`, token, {
    method: "POST",
    body: {
      requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
    },
  });
}

/**
 * Overwrite a tab with these rows, header first. `RAW` keeps numbers as
 * numbers so the sheet can sum and chart them.
 */
async function writeTab(
  sheetId: string,
  token: string,
  tab: string,
  rows: SheetRow[],
): Promise<number> {
  // An empty dataset still needs its header row, and every builder emits one.
  const values = rows.length > 0 ? rows : [["No data yet"]];
  // The range lives in the URL and nowhere else. Sending a `range` in the body
  // as well makes Google reject the request when the two disagree
  // ("Request range[Students] does not match value's range[Students!A1]").
  const range = `${tab}!A1`;
  await sheetsFetch(
    `${SHEETS_API}/${sheetId}/values/${range}?valueInputOption=RAW`,
    token,
    {
      method: "PUT",
      body: { majorDimension: "ROWS", values },
    },
  );
  return rows.length;
}

/** Upload every tab. Returns the spreadsheet id and a short summary. */
export const upload = internalAction({
  args: {
    savedSheetId: v.optional(v.string()),
    students: v.array(v.array(v.union(v.string(), v.number()))),
    attendance: v.array(v.array(v.union(v.string(), v.number()))),
    ledger: v.array(v.array(v.union(v.string(), v.number()))),
    summary: v.array(v.array(v.union(v.string(), v.number()))),
  },
  handler: async (ctx, { savedSheetId, students, attendance, ledger, summary }) => {
    const token = await getAccessToken();
    const sheetId = resolveTargetId(savedSheetId);

    await ensureTabs(sheetId, token);

    const written =
      (await writeTab(sheetId, token, SHEET_TABS.students, students)) +
      (await writeTab(sheetId, token, SHEET_TABS.attendance, attendance)) +
      (await writeTab(sheetId, token, SHEET_TABS.ledger, ledger)) +
      (await writeTab(sheetId, token, SHEET_TABS.summary, summary));

    return {
      summary: `${Math.max(students.length - 1, 0)} students · ${Math.max(attendance.length - 1, 0)} sessions · ${Math.max(ledger.length - 1, 0)} entries`,
      rows: written,
      sheetId,
    };
  },
});
