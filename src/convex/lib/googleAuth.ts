"use node";

import { createSign } from "node:crypto";

const TOKEN_URI = "https://oauth2.googleapis.com/token";

export type ServiceAccount = {
  client_email?: string;
  private_key?: string;
};

/** base64url, which is what JWT uses (not standard base64). */
export function base64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Build a Google access token from the service-account JSON stored in
 * `process.env.GOOGLE_SERVICE_ACCOUNT_JSON` (set on the Convex backend,
 * not in a project `.env`).
 *
 * The Google Docs API scope is `https://www.googleapis.com/auth/documents.readonly`
 * for read-only document access. Other Google APIs use different scopes; call
 * sites that need a different scope with their own scope value rather than
 * changing this one.
 */
export async function getGoogleAccessToken(
  scope: string,
): Promise<string> {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON is not set. Paste your service account JSON in the Keys tab on the Convex dashboard.",
    );
  }

  let creds: ServiceAccount;
  try {
    creds = JSON.parse(raw) as ServiceAccount;
  } catch {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON. Paste the whole service account file contents.",
    );
  }
  if (!creds.client_email || !creds.private_key) {
    throw new Error(
      "That service account JSON has no client_email / private_key. Paste the full file, not part of it.",
    );
  }

  // A JSON blob escapes the newlines in the PEM key; restore them.
  const privateKey = creds.private_key.replace(/\\n/g, "\n");

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  );
  const claims = base64url(
    JSON.stringify({
      iss: creds.client_email,
      scope,
      aud: TOKEN_URI,
      iat: now,
      exp: now + 3600,
    }),
  );

  const unsigned = `${header}.${claims}`;
  const signed = createSign("RSA-SHA256").update(unsigned).sign(privateKey);
  // The signature must be base64url like the other two segments — string
  // -interpolating the raw Buffer produces UTF-8 garbage and Google rejects
  // the assertion with 400 invalid_request.
  const assertion = `${unsigned}.${base64url(signed)}`;

  const response = await fetch(TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Google token exchange failed (${response.status}): ${text.slice(0, 300)}`,
    );
  }

  const parsed = (await response.json()) as {
    access_token?: string;
  };
  if (!parsed.access_token) {
    throw new Error("Google did not return an access_token.");
  }
  return parsed.access_token;
}
