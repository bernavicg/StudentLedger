"use node";

import { getGoogleAccessToken } from "./googleAuth";

export const GOOGLE_DOCS_API = "https://docs.googleapis.com/v1/documents";
export const DOCS_READONLY_SCOPE =
  "https://www.googleapis.com/auth/documents.readonly";

export type DocContentElement = {
  paragraph?: {
    elements?: Array<{
      textRun?: {
        text?: string;
      };
    }>;
  };
};

export type ExtractedDoc = {
  title: string;
  searchText: string;
};

export async function fetchDocText(gdocId: string): Promise<ExtractedDoc> {
  const token = await getGoogleAccessToken(DOCS_READONLY_SCOPE);

  const response = await fetch(
    `${GOOGLE_DOCS_API}/${gdocId}?fields=title,content`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Google Docs API ${response.status} for ${gdocId}: ${text.slice(0, 400)}`,
    );
  }

  const doc = (await response.json()) as {
    title?: string;
    content?: DocContentElement[];
  };
  if (!doc || typeof doc !== "object") {
    throw new Error(`Google Docs API returned no document for ${gdocId}.`);
  }

  return {
    title: doc.title ?? "",
    searchText: extractTextFromDoc(doc),
  };
}

/**
 * Flatten a Docs API document's `content` into one lowercase searchable
 * string. Keeps all visible text; drops structural-only fields.
 *
 * Capped at MAX_SEARCH_CHARS: this string is stored on the `gdocs` row and
 * shipped to every client by `list` for client-side ranking, so an enormous
 * doc must not blow up the subscription payload (Convex also caps a whole
 * document at 1 MiB). A month doc is a couple of pages — the cap is only a
 * guard rail, and past it search still works, just on the first N characters.
 */
export const MAX_SEARCH_CHARS = 200_000;

export function extractTextFromDoc(
  doc: { title?: string | undefined; content?: DocContentElement[] | undefined },
): string {
  const parts: string[] = [];
  for (const section of doc.content ?? []) {
    const para = section.paragraph;
    if (!para?.elements) continue;
    for (const el of para.elements) {
      const run = el.textRun;
      if (!run) continue;
      const text = run.text;
      if (typeof text !== "string") continue;
      parts.push(text);
    }
  }
  return parts
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, MAX_SEARCH_CHARS);
}
