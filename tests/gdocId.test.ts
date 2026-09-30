import { describe, expect, test } from "bun:test";
import {
  extractGdocId,
  gdocEditUrl,
  gdocEmbedUrl,
} from "../src/convex/lib/gdocId";

describe("extractGdocId", () => {
  test("parses the editor URL", () => {
    expect(
      extractGdocId(
        "https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit",
      ),
    ).toBe("1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms");
  });

  test("parses deep links (mobilebasic, export)", () => {
    expect(
      extractGdocId(
        "https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/mobilebasic",
      ),
    ).toBe("1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms");
    expect(
      extractGdocId(
        "https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/export?format=pdf",
      ),
    ).toBe("1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms");
  });

  test("accepts the bare id", () => {
    expect(extractGdocId("1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms")).toBe(
      "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
    );
    expect(extractGdocId("  1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms  ")).toBe(
      "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
    );
  });

  test("does not confuse spreadsheet URLs with docs", () => {
    expect(
      extractGdocId("https://docs.google.com/spreadsheets/d/e/2PACX-abc/pubhtml"),
    ).toBe("https://docs.google.com/spreadsheets/d/e/2PACX-abc/pubhtml");
  });

  test("returns empty for empty input", () => {
    expect(extractGdocId("")).toBe("");
    expect(extractGdocId(undefined)).toBe("");
    expect(extractGdocId("   ")).toBe("");
  });
});

describe("embed/edit URLs", () => {
  test("preview endpoint for the live viewer", () => {
    expect(gdocEmbedUrl("abc123")).toBe(
      "https://docs.google.com/document/d/abc123/preview",
    );
  });

  test("edit endpoint for the footer link", () => {
    expect(gdocEditUrl("abc123")).toBe(
      "https://docs.google.com/document/d/abc123/edit",
    );
  });
});
