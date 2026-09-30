/**
 * Row builders for the single `appSettings` document.
 *
 * Both functions return a complete replacement document rather than a patch.
 * That is deliberate: these fields are `v.optional(v.string())`, and neither a
 * `patch` with `undefined` nor a `null` can actually clear such a field. A
 * `replace` drops the keys entirely, which is what "this is no longer true"
 * needs. Pure, so the clearing rules are unit tested.
 */

/** The fields on the settings row that the sync bookkeeping cares about. */
export type SettingsSnapshot = {
  lastSyncAt?: number;
  lastFingerprint?: string;
  lastSummary?: string;
  lastError?: string;
  targetSheetId?: string;
  lastSyncedSheetId?: string;
  embedSheetId?: string;
};

export type SettingsRow = SettingsSnapshot & { key: string };

const SETTINGS_KEY = "main";

export type SyncOutcome = {
  fingerprint: string;
  summary?: string;
  /** The sheet the export actually wrote to (env-resolved). */
  sheetId?: string;
  error?: string;
};

/**
 * The document to store after a sync attempt.
 *
 * Notes on two rules that are easy to get wrong:
 * - `targetSheetId` is the admin's saved choice and is deliberately NOT
 *   written here. A sync resolves the id from the env first, and persisting
 *   that back would silently overwrite the saved choice, so removing the env
 *   var later would leave the app pointed at the wrong sheet. The resolved id
 *   is recorded separately in `lastSyncedSheetId` for display.
 * - On failure the summary is dropped, because it describes an export that
 *   did not happen. The fingerprint is still written: `stale` also looks at
 *   `lastError`, so the next run still retries.
 */
export function buildRecordedRow(
  existing: SettingsSnapshot | null,
  outcome: SyncOutcome,
  now: number,
): SettingsRow {
  return {
    key: SETTINGS_KEY,
    lastSyncAt: now,
    lastFingerprint: outcome.fingerprint,
    ...(outcome.summary === undefined ? {} : { lastSummary: outcome.summary }),
    ...(outcome.error === undefined ? {} : { lastError: outcome.error }),
    ...(outcome.sheetId === undefined
      ? {}
      : { lastSyncedSheetId: outcome.sheetId }),
    // Carry these over untouched; a sync has no opinion about them.
    ...(existing?.targetSheetId === undefined
      ? {}
      : { targetSheetId: existing.targetSheetId }),
    ...(existing?.embedSheetId === undefined
      ? {}
      : { embedSheetId: existing.embedSheetId }),
  };
}

export type SaveInput = {
  targetSheetId?: string;
  embedSheetId?: string;
};

/**
 * The document to store after the admin edits the settings form.
 *
 * When the target spreadsheet actually changes, the recorded sync is
 * invalidated. Without this the fingerprint from the previous sheet still
 * matches, `stale` stays false, and the new sheet would sit empty until the
 * ledger happened to change — which looks like a broken sync rather than a
 * bookkeeping detail.
 */
export function buildSavedRow(
  existing: SettingsSnapshot | null,
  input: SaveInput,
): SettingsRow {
  const trim = (value: string | undefined) => {
    const next = value?.trim();
    return next ? next : undefined;
  };

  const targetSheetId = trim(input.targetSheetId);
  const embedSheetId = trim(input.embedSheetId);
  const targetChanged =
    (targetSheetId ?? undefined) !== (existing?.targetSheetId ?? undefined);

  const stillFresh =
    existing !== null &&
    !targetChanged &&
    existing.lastFingerprint !== undefined &&
    existing.lastError === undefined;

  return {
    key: SETTINGS_KEY,
    targetSheetId,
    embedSheetId,
    ...(stillFresh
      ? {
          lastSyncAt: existing.lastSyncAt,
          lastFingerprint: existing.lastFingerprint,
          ...(existing.lastSummary === undefined
            ? {}
            : { lastSummary: existing.lastSummary }),
        }
      : {
          // Invalidate, so the next sync re-exports into the new sheet.
          lastFingerprint: undefined,
          lastSyncAt: undefined,
        }),
  };
}
