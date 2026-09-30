"use node";

/**
 * The only place that talks to sieve over the network.
 *
 * Mirrors sheetsNode.ts: this runs in the Node runtime and owns the outbound
 * calls, while the request building, response parsing and polling decisions
 * live in lib/sieve.ts (pure, unit tested). Convex actions have no `ctx.db`,
 * so the caller does the persistence around these calls.
 *
 * The API key lives in the deployment's secret store (`process.env`), the same
 * place GOOGLE_SERVICE_ACCOUNT_JSON comes from. It is read here, handed to the
 * client and never logged, returned or stored in the database.
 */

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import {
  SIEVE_BASE_URL,
  createSieveClient,
  type CreditsInfo,
  type NormalizedRun,
  type ScrapeBody,
  type SieveOutcome,
} from "./lib/sieve";

export type StartOutcome = SieveOutcome<{ sessionId: string; status: string }>;
export type MessageOutcome = SieveOutcome<{ status: string }>;
export type PollOutcome = SieveOutcome<NormalizedRun>;
export type CreditsOutcome = SieveOutcome<CreditsInfo>;
export type FileOutcome = SieveOutcome<{ contentType: string; text: string }>;

function requireKey(): string {
  const key = process.env.SIEVE_API_KEY;
  if (key === undefined || key.trim() === "") {
    throw new Error(
      "SIEVE_API_KEY is not set. Add it to the project's Keys tab (or run the sieve device-login script) to enable scraping.",
    );
  }
  return key;
}

function makeClient() {
  return createSieveClient({
    apiKey: requireKey(),
    baseUrl: process.env.SIEVE_BASE_URL || SIEVE_BASE_URL,
    fetchImpl: fetch,
  });
}

/**
 * POST /api/scrapes once. Never retried by the caller after a timeout or a
 * network error — the run may already exist and a retry would spend credits
 * twice. The client itself retries only 429/5xx responses, which are the ones
 * where no run was created.
 */
export const startRun = internalAction({
  args: { body: v.any() },
  handler: async (_ctx, { body }): Promise<StartOutcome> => {
    return await makeClient().startRun(body as ScrapeBody);
  },
});

/** One GET /api/scrapes/<id>. GET is idempotent, so transient errors retry. */
export const pollRun = internalAction({
  args: { sessionId: v.string() },
  handler: async (_ctx, { sessionId }): Promise<PollOutcome> => {
    return await makeClient().pollRun(sessionId);
  },
});

/** POST /api/scrapes/<id>/messages: a follow-up turn. */
export const sendMessage = internalAction({
  args: { sessionId: v.string(), body: v.any() },
  handler: async (_ctx, { sessionId, body }): Promise<MessageOutcome> => {
    return await makeClient().sendMessage(sessionId, body as ScrapeBody);
  },
});

/** GET /api/me/credits: plan and usage, for the page's credits readout. */
export const getCredits = internalAction({
  args: {},
  handler: async (): Promise<CreditsOutcome> => {
    return await makeClient().getCredits();
  },
});

/** Fetch one delivered file, with the bearer header, server-side. */
export const downloadFile = internalAction({
  args: { url: v.string() },
  handler: async (_ctx, { url }): Promise<FileOutcome> => {
    return await makeClient().downloadFile(url);
  },
});
