/**
 * Google Sheets id parsing, shared by the sync action and the Sheets page.
 *
 * Pure and dependency-free so it can be unit tested directly, and so the
 * browser and the Convex action can never disagree about what id the user
 * actually pasted.
 */

/**
 * Pull the bare spreadsheet id out of whatever the user pasted.
 *
 * People paste any of these, so all are accepted:
 *  - the bare id on its own
 *  - the editor URL: .../spreadsheets/d/<id>/edit
 *  - the published link that File → Share → Publish to the web hands out:
 *    .../spreadsheets/d/e/2PACX-...  (a different id from the editor one —
 *    kept verbatim because it is the only id the pubhtml endpoint serves)
 *
 * Returns the input trimmed when it is already a bare id.
 */
export function extractSheetId(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return "";
  const fromUrl = trimmed.match(
    /spreadsheets\/d\/(?:e\/)?([a-zA-Z0-9-_]+)/,
  );
  return fromUrl ? fromUrl[1] : trimmed;
}

/**
 * Which spreadsheet to write to.
 *
 * The deployment env var wins over the id saved in settings, which is what
 * lets an operator pin the sheet without anyone touching the UI. Throws with
 * an actionable message when neither is present.
 */
export function resolveTargetId(saved: string | undefined): string {
  const id = extractSheetId(process.env.GOOGLE_SHEET_ID) || extractSheetId(saved);
  if (id === "") {
    throw new Error(
      "No spreadsheet configured. Set GOOGLE_SHEET_ID in the Keys tab, or save one on the Sheets page.",
    );
  }
  return id;
}
