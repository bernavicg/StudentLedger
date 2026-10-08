"use node";

import { getGoogleAccessToken } from "./googleAuth";

export const DRIVE_API = "https://www.googleapis.com/drive/v3";
export const DRIVE_READONLY_SCOPE =
  "https://www.googleapis.com/auth/drive.readonly";

export type ExtractedDoc = {
  title: string;
  searchText: string;
};

/** See MAX_SEARCH_CHARS below. */
export const MAX_SEARCH_CHARS = 200_000;

/**
 * Turn whatever text Drive hands back into the cached search string:
 * lowercase, single-spaced, capped.
 *
 * The cap matters: this string is stored on the `gdocs` row and shipped to
 * every client by `list` for client-side ranking, so an enormous doc must not
 * blow up the subscription payload (Convex also caps a whole document at
 * 1 MiB). A month doc is a couple of pages — the cap is only a guard rail, and
 * past it search still works, just on the first N characters.
 */
export function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SEARCH_CHARS);
}

/** Turn Google's error body into something an admin can act on. */
async function driveError(response: Response, gdocId: string): Promise<string> {
  const body = await response.text().catch(() => "");
  const detail = body.slice(0, 300);
  if (response.status === 404) {
    return (
      `Google cannot see the doc ${gdocId}. Share the Google Doc with the ` +
      `Ledger service account (Viewer), or set it to "anyone with the link" ` +
      `(Viewer), then press Re-index.`
    );
  }
  if (response.status === 403) {
    return `Google refused the Docs request (403) for ${gdocId}: ${detail}`;
  }
  return `Google Drive API ${response.status} for ${gdocId}: ${detail}`;
}

/**
 * Fetch a doc's own name and its visible text through the Drive API.
 *
 * Drive's `files.export` (text/plain) is used rather than the Docs API: it
 * returns exactly the text a reader sees, it works for Google Docs shared to
 * this service account, and the Docs API is not even enabled in the project —
 * requiring only that the doc is shared, which search needs either way.
 *
 * Takes the access token as an argument so tests can drive it without the
 * service-account JWT flow.
 */
export async function loadDocViaDrive(
  token: string,
  gdocId: string,
): Promise<ExtractedDoc> {
  const headers = { Authorization: `Bearer ${token}` };

  const meta = await fetch(
    `${DRIVE_API}/files/${encodeURIComponent(gdocId)}?fields=id,name`,
    { headers },
  );
  if (!meta.ok) throw new Error(await driveError(meta, gdocId));
  const { name } = (await meta.json()) as { name?: string };

  const exported = await fetch(
    `${DRIVE_API}/files/${encodeURIComponent(gdocId)}/export?mimeType=text%2Fplain`,
    { headers },
  );
  if (!exported.ok) throw new Error(await driveError(exported, gdocId));
  const text = await exported.text();

  return { title: name ?? "", searchText: normalizeSearchText(text) };
}

/** Fetch one saved doc's title + searchable body from Google. */
export async function fetchDocText(gdocId: string): Promise<ExtractedDoc> {
  const token = await getGoogleAccessToken(DRIVE_READONLY_SCOPE);
  return await loadDocViaDrive(token, gdocId);
}
