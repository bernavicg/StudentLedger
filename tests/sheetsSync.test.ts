import { describe, expect, test } from "bun:test";
import { extractSheetId } from "../src/convex/lib/sheetId";
import { fingerprintOf } from "../src/convex/lib/fingerprint";
import {
  buildRecordedRow,
  buildSavedRow,
  type SettingsSnapshot,
} from "../src/convex/lib/settingsRow";

/*
 * Covers the logic extracted out of the Convex modules so it can be tested
 * without a running backend. The two rules worth protecting most are in
 * buildRecordedRow / buildSavedRow: a sync must never overwrite the admin's
 * saved sheet id, and changing that sheet must invalidate the recorded sync.
 *
 * Outside src/ on purpose — tsconfig.app.json includes all of src, and
 * Convex typechecks all of src/convex, so either would try to compile the
 * "bun:test" import without the Bun types.
 */

describe("extractSheetId", () => {
  test("accepts a bare id", () => {
    expect(extractSheetId("1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms")).toBe(
      "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
    );
  });

  test("pulls the id out of a full URL", () => {
    expect(
      extractSheetId(
        "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0",
      ),
    ).toBe("1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms");
  });

  test("pulls the id out of a published-link URL (d/e form)", () => {
    // The publish dialog hands out .../d/e/2PACX-…; the old regex matched the
    // literal "e" as the id and produced .../d/e/pubhtml embeds.
    expect(
      extractSheetId(
        "https://docs.google.com/spreadsheets/d/e/2PACX-1vTKkYYbfb3k19j3Ff2oHlGurrLz",
      ),
    ).toBe("2PACX-1vTKkYYbfb3k19j3Ff2oHlGurrLz");
  });

  test("keeps the trailing token of a 2PACX id that contains a dash", () => {
    // Real published ids look like 2PACX-1vTKkYY…-jlSAMihAl4HRm…. The greedy
    // character class already spans the inner dashes; this pins that behavior.
    expect(extractSheetId("2PACX-1vTKkYY-jlSAMihAl4HRm")).toBe(
      "2PACX-1vTKkYY-jlSAMihAl4HRm",
    );
  });

  test("trims surrounding whitespace", () => {
    expect(extractSheetId("  abc123  ")).toBe("abc123");
  });

  test("returns empty for missing or blank input", () => {
    expect(extractSheetId(undefined)).toBe("");
    expect(extractSheetId("   ")).toBe("");
  });
});

describe("fingerprintOf", () => {
  const base = { entries: [], attendance: [], students: [] };

  test("is stable for identical input", () => {
    const input = {
      entries: [{ createdAt: 1, updatedAt: 2 }],
      attendance: [{ createdAt: 3, reviewedAt: 4 }],
      students: [{ updatedAt: 5 }],
    };
    expect(fingerprintOf(input)).toBe(fingerprintOf(input));
  });

  test("changes when a row is added", () => {
    const before = fingerprintOf({
      ...base,
      entries: [{ createdAt: 1, updatedAt: 1 }],
    });
    const after = fingerprintOf({
      ...base,
      entries: [
        { createdAt: 1, updatedAt: 1 },
        { createdAt: 2, updatedAt: 2 },
      ],
    });
    expect(before).not.toBe(after);
  });

  test("changes when an entry is updated, even without a new row", () => {
    // Approving an entry bumps updatedAt but not createdAt. Without this the
    // sheet would silently drift out of date.
    const before = fingerprintOf({ ...base, entries: [{ createdAt: 1, updatedAt: 1 }] });
    const after = fingerprintOf({ ...base, entries: [{ createdAt: 1, updatedAt: 9 }] });
    expect(before).not.toBe(after);
  });

  test("changes when a session is reviewed, without a new row", () => {
    const before = fingerprintOf({ ...base, attendance: [{ createdAt: 1 }] });
    const after = fingerprintOf({
      ...base,
      attendance: [{ createdAt: 1, reviewedAt: 9 }],
    });
    expect(before).not.toBe(after);
  });

  test("is unaffected by unrelated timestamps", () => {
    const before = fingerprintOf({ ...base, students: [{ updatedAt: 1 }] });
    const after = fingerprintOf({ ...base, students: [{ updatedAt: 1 }] });
    expect(before).toBe(after);
  });
});

describe("buildRecordedRow", () => {
  const existing: SettingsSnapshot & { _id: string } = {
    _id: "s",
    key: "main",
    targetSheetId: "saved-sheet",
    embedSheetId: "embed-sheet",
    lastFingerprint: "old",
    lastSummary: "old summary",
  };

  test("never overwrites the admin's saved target sheet id", () => {
    // The sync resolves the env id first; persisting that back would silently
    // destroy the saved choice.
    const row = buildRecordedRow(
      existing,
      { fingerprint: "new", summary: "ok", sheetId: "env-sheet" },
      1000,
    );
    expect(row.targetSheetId).toBe("saved-sheet");
    // The resolved id is recorded separately for display.
    expect(row.lastSyncedSheetId).toBe("env-sheet");
  });

  test("drops the summary on failure so it cannot go stale", () => {
    const row = buildRecordedRow(
      existing,
      { fingerprint: "new", sheetId: "env-sheet", error: "boom" },
      1000,
    );
    expect(row.lastSummary).toBeUndefined();
    expect(row.lastError).toBe("boom");
  });

  test("keeps the fingerprint on failure so stale stays driven by lastError", () => {
    const row = buildRecordedRow(existing, { fingerprint: "new", error: "boom" }, 1000);
    expect(row.lastFingerprint).toBe("new");
  });

  test("clears a previous error after a good run", () => {
    const row = buildRecordedRow(
      { ...existing, lastError: "boom" },
      { fingerprint: "new", summary: "ok" },
      1000,
    );
    expect(row.lastError).toBeUndefined();
  });

  test("preserves the embed sheet", () => {
    const row = buildRecordedRow(existing, { fingerprint: "new" }, 1000);
    expect(row.embedSheetId).toBe("embed-sheet");
  });

  test("works when there is no existing row", () => {
    const row = buildRecordedRow(null, { fingerprint: "new" }, 1000);
    expect(row.key).toBe("main");
    expect(row.lastFingerprint).toBe("new");
    expect(row.targetSheetId).toBeUndefined();
  });
});

describe("buildSavedRow", () => {
  const synced: SettingsSnapshot = {
    key: "main",
    targetSheetId: "sheet-a",
    embedSheetId: "sheet-a",
    lastSyncAt: 1000,
    lastFingerprint: "fp",
    lastSummary: "ok",
  };

  test("keeps the recorded sync when nothing changed", () => {
    const row = buildSavedRow(synced, {
      targetSheetId: "sheet-a",
      embedSheetId: "sheet-a",
    });
    expect(row.lastFingerprint).toBe("fp");
    expect(row.lastSyncAt).toBe(1000);
  });

  test("invalidates the sync when the target sheet changes", () => {
    // Otherwise stale stays false and the new sheet sits empty until the
    // ledger happens to change.
    const row = buildSavedRow(synced, {
      targetSheetId: "sheet-b",
      embedSheetId: "sheet-a",
    });
    expect(row.targetSheetId).toBe("sheet-b");
    expect(row.lastFingerprint).toBeUndefined();
    expect(row.lastSyncAt).toBeUndefined();
  });

  test("clears the target when the field is blanked", () => {
    const row = buildSavedRow(synced, { targetSheetId: "   " });
    expect(row.targetSheetId).toBeUndefined();
  });

  test("ignores whitespace when comparing the target", () => {
    const row = buildSavedRow(synced, { targetSheetId: "  sheet-a  " });
    expect(row.lastFingerprint).toBe("fp");
  });

  test("invalidates when a previous error was outstanding", () => {
    const row = buildSavedRow({ ...synced, lastError: "boom" }, {
      targetSheetId: "sheet-a",
    });
    expect(row.lastFingerprint).toBeUndefined();
  });

  test("works when there is no existing row", () => {
    const row = buildSavedRow(null, { targetSheetId: "sheet-b" });
    expect(row.key).toBe("main");
    expect(row.targetSheetId).toBe("sheet-b");
    expect(row.lastFingerprint).toBeUndefined();
  });
});
