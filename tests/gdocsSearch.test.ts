import { describe, expect, test } from "bun:test";
import {
  extractTextFromDoc,
  MAX_SEARCH_CHARS,
} from "../src/convex/lib/gdocsSearch";

/** Build a Docs API `content` array from plain paragraph strings. */
function content(...paragraphs: string[]) {
  return paragraphs.map((text) => ({
    paragraph: { elements: [{ textRun: { text } }] },
  }));
}

describe("extractTextFromDoc", () => {
  test("flattens every paragraph into one lowercase searchable string", () => {
    const text = extractTextFromDoc({
      title: "October 2026",
      content: content("Shemini Atzeret notes.", "Torah reading: Deuteronomy."),
    });

    expect(text).toBe(
      "shemini atzeret notes. torah reading: deuteronomy.",
    );
  });

  test("searches case-insensitively for a word deep in the doc", () => {
    const text = extractTextFromDoc({
      content: content(
        "September recap",
        "Nothing to see here.",
        "The budget for Shemini Atzeret is 120.",
      ),
    });

    expect(text.includes("shemini atzeret")).toBe(true);
  });

  test("collapses newlines and runs of whitespace", () => {
    const text = extractTextFromDoc({
      content: content("line one\n\n\n  line two\tend"),
    });

    expect(text).toBe("line one line two end");
  });

  test("ignores structural elements with no text run", () => {
    const text = extractTextFromDoc({
      content: [
        {},
        { paragraph: {} },
        { paragraph: { elements: [{}, { textRun: { text: "kept" } }] } },
      ],
    });

    expect(text).toBe("kept");
  });

  test("returns an empty string when there is no content", () => {
    expect(extractTextFromDoc({})).toBe("");
    expect(extractTextFromDoc({ content: [] })).toBe("");
  });

  test("caps the cached text so one huge doc cannot bloat the payload", () => {
    const huge = "word ".repeat(MAX_SEARCH_CHARS);
    const text = extractTextFromDoc({ content: content(huge) });

    expect(text.length).toBeLessThanOrEqual(MAX_SEARCH_CHARS);
  });
});
