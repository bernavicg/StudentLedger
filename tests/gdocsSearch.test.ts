import { afterEach, describe, expect, test } from "bun:test";
import {
  MAX_SEARCH_CHARS,
  loadDocViaDrive,
  normalizeSearchText,
} from "../src/convex/lib/gdocsSearch";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Answer the two Drive calls `loadDocViaDrive` makes, in order. */
function stubDrive(responses: Response[]) {
  let call = 0;
  globalThis.fetch = (async () => {
    const next = responses[call++];
    if (!next) throw new Error(`unexpected fetch #${call}`);
    return next;
  }) as typeof fetch;
}

const ok = (body: string, type = "text/plain") =>
  new Response(body, { status: 200, headers: { "Content-Type": type } });

describe("normalizeSearchText", () => {
  test("lowercases and collapses whitespace", () => {
    expect(normalizeSearchText("Line One\n\n   line two\tend")).toBe(
      "line one line two end",
    );
  });

  test("caps the cached text so one huge doc cannot bloat the payload", () => {
    const text = normalizeSearchText("word ".repeat(MAX_SEARCH_CHARS));
    expect(text.length).toBeLessThanOrEqual(MAX_SEARCH_CHARS);
  });
});

describe("loadDocViaDrive", () => {
  test("returns the doc's name and its flattened text", async () => {
    stubDrive([
      ok(JSON.stringify({ id: "abc", name: "October 2026 — Shemini Atzeret" }), "application/json"),
      ok("Shemini Atzeret notes.\nBudget for the haggadah printing is 120."),
    ]);

    const doc = await loadDocViaDrive("token", "abc");

    expect(doc.title).toBe("October 2026 — Shemini Atzeret");
    expect(doc.searchText).toBe(
      "shemini atzeret notes. budget for the haggadah printing is 120.",
    );
  });

  test("searches case-insensitively for a word deep in the doc", async () => {
    stubDrive([
      ok(JSON.stringify({ id: "abc", name: "Doc" }), "application/json"),
      ok("September recap\nNothing here\nThe budget for Shemini Atzeret is 120"),
    ]);

    const doc = await loadDocViaDrive("token", "abc");

    expect(doc.searchText.includes("shemini atzeret")).toBe(true);
  });

  test("a doc the service account cannot see explains how to share it", async () => {
    stubDrive([
      new Response(
        JSON.stringify({ error: { code: 404, message: "File not found: abc." } }),
        { status: 404 },
      ),
    ]);

    expect(loadDocViaDrive("token", "abc")).rejects.toThrow(/Share the Google Doc/);
  });

  test("a permissions error surfaces Google's explanation", async () => {
    stubDrive([
      new Response(JSON.stringify({ error: { message: "Drive API is disabled" } }), {
        status: 403,
      }),
    ]);

    expect(loadDocViaDrive("token", "abc")).rejects.toThrow(/403/);
  });

  test("an export failure does not return a half-empty index", async () => {
    stubDrive([
      ok(JSON.stringify({ id: "abc", name: "Doc" }), "application/json"),
      new Response(JSON.stringify({ error: { message: "export unsupported" } }), {
        status: 400,
      }),
    ]);

    expect(loadDocViaDrive("token", "abc")).rejects.toThrow(/Google Drive API 400/);
  });
});
