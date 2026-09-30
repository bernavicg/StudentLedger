/**
 * Google Docs id parsing, shared by the Docs page and its mutations.
 *
 * Pure and dependency-free so it can be unit tested directly, and so the
 * browser and the Convex mutation can never disagree about what id the user
 * actually pasted. Mirrors src/convex/lib/sheetId.ts for spreadsheets.
 */

/**
 * Pull the bare document id out of whatever the user pasted.
 *
 * People paste any of these, so all are accepted:
 *  - the bare id on its own
 *  - the editor URL: .../document/d/<id>/edit
 *  - any deep link into the doc (…/document/d/<id>/mobilebasic, /export, ...)
 *
 * Docs have no separate "published" id like spreadsheets do, so one pattern
 * covers everything. Returns the input trimmed when it is already a bare id.
 */
export function extractGdocId(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return "";
  const fromUrl = trimmed.match(/document\/d\/([a-zA-Z0-9-_]+)/);
  return fromUrl ? fromUrl[1] : trimmed;
}

/** The endpoint that serves the doc framed like the Sheets page does. */
export function gdocEmbedUrl(gdocId: string): string {
  return `https://docs.google.com/document/d/${gdocId}/preview`;
}

/** The normal editor link used for the "Open in Google Docs" footer. */
export function gdocEditUrl(gdocId: string): string {
  return `https://docs.google.com/document/d/${gdocId}/edit`;
}
