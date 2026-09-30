/**
 * Sieve scrape API.
 *
 * Everything in this file is deliberately framework-free: request building,
 * status/error classification, response parsing and the polling decisions all
 * live here so they can be unit tested without a running backend or network.
 * The HTTP calls go through an injected `fetchImpl`, so a test can record a
 * response at the boundary and drive the real code.
 *
 * The Convex action (sieveNode.ts) is the only caller that passes the real
 * fetch and the SIEVE_API_KEY from the deployment's secret store. The key is
 * never read, logged or referenced here — it is just an argument.
 */

export const SIEVE_BASE_URL = "https://scrape.usesieve.com";

export const COMPLIANCE_MODES = ["conservative", "regular", "yolo"] as const;
export type ComplianceMode = (typeof COMPLIANCE_MODES)[number];
/** Default unless the user explicitly picks another mode. */
export const DEFAULT_COMPLIANCE_MODE: ComplianceMode = "regular";

export type TableShape = "long" | "wide";

export const OUTPUT_SCHEMA_MAX_BYTES = 32 * 1024;

/** Raised before any network call when the caller's input cannot be sent. */
export class SieveInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SieveInputError";
  }
}

/* ------------------------------------------------------------------ *
 * Request bodies
 * ------------------------------------------------------------------ */

export type ScrapeRequestInput = {
  instruction: string;
  targetUrls?: string[];
  fields?: string[];
  /** Advisory JSON Schema. */
  schema?: unknown;
  /** Strict JSON Schema 2020-12, ≤32KB. */
  outputSchema?: unknown;
  tableShape?: string;
  complianceMode?: string;
};

export type ScrapeBody = {
  instruction: string;
  compliance_mode: ComplianceMode;
  target_urls?: string[];
  fields?: string[];
  schema?: unknown;
  output_schema?: unknown;
  table_shape?: TableShape;
};

function asComplianceMode(value: string | undefined): ComplianceMode {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_COMPLIANCE_MODE;
  }
  const trimmed = value.trim();
  if ((COMPLIANCE_MODES as readonly string[]).includes(trimmed)) {
    return trimmed as ComplianceMode;
  }
  throw new SieveInputError(
    `compliance_mode must be one of ${COMPLIANCE_MODES.join(", ")}.`,
  );
}

function asTableShape(value: string | undefined): TableShape | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const trimmed = value.trim();
  if (trimmed === "long" || trimmed === "wide") return trimmed;
  throw new SieveInputError('table_shape must be "long" or "wide".');
}

function asStringList(values: string[] | undefined): string[] | undefined {
  if (values === undefined) return undefined;
  const cleaned = values.map((value) => value.trim()).filter(Boolean);
  if (cleaned.length === 0) return undefined;
  return cleaned;
}

/** Public pages only: sieve fetches these from its own network. */
function asTargetUrls(values: string[] | undefined): string[] | undefined {
  const cleaned = asStringList(values);
  if (cleaned === undefined) return undefined;
  for (const value of cleaned) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new SieveInputError(`Not a valid URL: ${value}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new SieveInputError(`Only public http(s) pages are allowed: ${value}`);
    }
  }
  return cleaned;
}

function jsonByteLength(value: unknown): number {
  const json = JSON.stringify(value);
  return new TextEncoder().encode(json).length;
}

/**
 * Build the JSON body for POST /api/scrapes (and the follow-up /messages
 * endpoint, which takes the same fields). Undefined optionals are omitted
 * rather than sent as null, and `compliance_mode` always defaults to
 * "regular" — the run should never silently relax the site-access policy.
 */
export function buildScrapeBody(input: ScrapeRequestInput): ScrapeBody {
  const instruction = input.instruction?.trim() ?? "";
  if (instruction === "") {
    throw new SieveInputError("An instruction is required.");
  }

  const targetUrls = asTargetUrls(input.targetUrls);
  const fields = asStringList(input.fields);
  const tableShape = asTableShape(input.tableShape);

  if (input.outputSchema !== undefined && input.outputSchema !== null) {
    if (jsonByteLength(input.outputSchema) > OUTPUT_SCHEMA_MAX_BYTES) {
      throw new SieveInputError(
        `output_schema must be at most ${OUTPUT_SCHEMA_MAX_BYTES} bytes.`,
      );
    }
  }

  return {
    instruction,
    compliance_mode: asComplianceMode(input.complianceMode),
    ...(targetUrls === undefined ? {} : { target_urls: targetUrls }),
    ...(fields === undefined ? {} : { fields }),
    ...(input.schema === undefined || input.schema === null
      ? {}
      : { schema: input.schema }),
    ...(input.outputSchema === undefined || input.outputSchema === null
      ? {}
      : { output_schema: input.outputSchema }),
    ...(tableShape === undefined ? {} : { table_shape: tableShape }),
  };
}

/* ------------------------------------------------------------------ *
 * Request building
 * ------------------------------------------------------------------ */

export const SIEVE_PATHS = {
  start: "/api/scrapes",
  poll: (sessionId: string) => `/api/scrapes/${encodeURIComponent(sessionId)}`,
  messages: (sessionId: string) =>
    `/api/scrapes/${encodeURIComponent(sessionId)}/messages`,
  credits: "/api/me/credits",
} as const;

/** Join a base URL and a path, leaving an already-absolute URL untouched. */
export function joinUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = baseUrl.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

/** Sieve hands back file URLs that are relative to the API base. */
export function absoluteUrl(url: string, baseUrl: string = SIEVE_BASE_URL): string {
  return joinUrl(baseUrl, url);
}

export type SieveRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
};

/** Every request carries the bearer key; bodies are JSON. */
export function buildRequest(params: {
  baseUrl: string;
  path: string;
  method: string;
  apiKey: string;
  body?: unknown;
}): SieveRequest {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${params.apiKey}`,
    Accept: "application/json",
  };
  const hasBody = params.body !== undefined;
  if (hasBody) headers["Content-Type"] = "application/json";
  return {
    url: joinUrl(params.baseUrl, params.path),
    method: params.method,
    headers,
    ...(hasBody ? { body: JSON.stringify(params.body) } : {}),
  };
}

/* ------------------------------------------------------------------ *
 * Status + error classification
 * ------------------------------------------------------------------ */

export type RunState = "running" | "done" | "refused" | "error";

/** `turns`-style schema-repair turns also report "running", so they poll. */
export function classifyRunState(status: string | undefined): RunState {
  switch (status) {
    case "running":
      return "running";
    case "done":
      return "done";
    case "refused":
      return "refused";
    default:
      // Anything else (including a missing status) is an error, never a
      // reason to keep polling forever.
      return "error";
  }
}

export type HttpClass =
  | "ok"
  | "accepted"
  | "fix_request"
  | "auth"
  | "credits"
  | "not_found"
  | "turn_in_flight"
  | "rate_limited"
  | "retry"
  | "client_error";

export function classifyHttp(status: number): HttpClass {
  if (status === 202) return "accepted";
  if (status >= 200 && status < 300) return "ok";
  switch (status) {
    case 400:
      return "fix_request";
    case 401:
      return "auth";
    case 402:
      return "credits";
    case 404:
      return "not_found";
    case 409:
      return "turn_in_flight";
    case 429:
      return "rate_limited";
  }
  if (status >= 500) return "retry";
  return "client_error";
}

/**
 * POST /api/scrapes has no idempotency key, so a 429 or 5xx is the only safe
 * retry (no run was created). A timeout or network error is NOT safe: the
 * first call may have succeeded and a retry would spend credits twice.
 */
export function isRetryableStart(classification: HttpClass): boolean {
  return classification === "rate_limited" || classification === "retry";
}

/** GET is idempotent, so retrying a poll on a network blip is safe. */
export function isRetryablePoll(classification: HttpClass): boolean {
  return classification === "rate_limited" || classification === "retry";
}

/** 409 means no turn was created, so waiting and resending is safe. */
export function isRetryableMessage(classification: HttpClass): boolean {
  return (
    classification === "turn_in_flight" ||
    classification === "rate_limited" ||
    classification === "retry"
  );
}

export function describeHttpFailure(
  classification: HttpClass,
  status: number,
  body?: string,
): string {
  const detail = body ? ` ${body.slice(0, 300)}` : "";
  switch (classification) {
    case "auth":
      return "sieve rejected the API key (401). Add or replace SIEVE_API_KEY in the project's Keys tab.";
    case "credits":
      return "sieve says there are no credits left (402). Check the plan and usage in sieve Settings → API keys.";
    case "fix_request":
      return `sieve rejected the request (400). Fix the request before retrying.${detail}`;
    case "not_found":
      return "sieve could not find that run (404). It may belong to a different account.";
    case "turn_in_flight":
      return "a turn is already in flight for this run (409).";
    case "rate_limited":
      return "sieve rate-limited this request (429). Waiting before retrying.";
    case "retry":
      return `sieve is temporarily unavailable (${status}). Retrying is safe.`;
    case "client_error":
      return `sieve rejected the request (${status}).${detail}`;
    default:
      return `sieve accepted the request (${status}).`;
  }
}

/* ------------------------------------------------------------------ *
 * Response parsing
 * ------------------------------------------------------------------ */

export type ScrapeFile = {
  name: string;
  size?: number;
  ext?: string;
  url: string;
};

export type SchemaConformance = {
  status: string;
  message?: string;
};

export type NormalizedRun = {
  rawStatus: string;
  state: RunState;
  sessionId?: string;
  turns?: number;
  summary?: string;
  schemaConformance?: SchemaConformance;
  result?: unknown;
  hasResult: boolean;
  files: ScrapeFile[];
  refusal?: { code?: string; message?: string };
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function parseFiles(value: unknown): ScrapeFile[] {
  if (!Array.isArray(value)) return [];
  const files: ScrapeFile[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const url = typeof record.url === "string" ? record.url : "";
    if (url === "") continue;
    files.push({
      name: typeof record.name === "string" ? record.name : "download",
      url,
      ...(typeof record.size === "number" ? { size: record.size } : {}),
      ...(typeof record.ext === "string" ? { ext: record.ext } : {}),
    });
  }
  return files;
}

function parseConformance(value: unknown): SchemaConformance | undefined {
  const record = asRecord(value);
  if (typeof record.status !== "string" || record.status === "") return undefined;
  return {
    status: record.status,
    ...(typeof record.message === "string" ? { message: record.message } : {}),
  };
}

function parseRefusal(value: unknown): NormalizedRun["refusal"] {
  const record = asRecord(value);
  const code = typeof record.code === "string" ? record.code : undefined;
  const message = typeof record.message === "string" ? record.message : undefined;
  if (code === undefined && message === undefined) return undefined;
  return { ...(code ? { code } : {}), ...(message ? { message } : {}) };
}

/** Tolerant parse of a GET /api/scrapes/<id> payload. */
export function parseRun(payload: unknown): NormalizedRun {
  const record = asRecord(payload);
  const rawStatus = typeof record.status === "string" ? record.status : "";
  const summaryValue = record.summary;
  return {
    rawStatus,
    state: classifyRunState(rawStatus),
    ...(typeof record.session_id === "string"
      ? { sessionId: record.session_id }
      : {}),
    ...(typeof record.turns === "number" ? { turns: record.turns } : {}),
    ...(typeof summaryValue === "string"
      ? { summary: summaryValue }
      : summaryValue === undefined || summaryValue === null
        ? {}
        : { summary: JSON.stringify(summaryValue) }),
    ...(parseConformance(record.schema_conformance) === undefined
      ? {}
      : { schemaConformance: parseConformance(record.schema_conformance) }),
    ...(Object.prototype.hasOwnProperty.call(record, "result") &&
    record.result !== null &&
    record.result !== undefined
      ? { result: record.result, hasResult: true }
      : { hasResult: false }),
    files: parseFiles(record.files),
    ...(parseRefusal(record.refusal) === undefined
      ? {}
      : { refusal: parseRefusal(record.refusal) }),
  };
}

/** Parse the 202 body of POST /api/scrapes. Throws if there is no session id. */
export function parseStartAccepted(payload: unknown): {
  sessionId: string;
  status: string;
  poll?: string;
} {
  const record = asRecord(payload);
  const sessionId = typeof record.session_id === "string" ? record.session_id : "";
  if (sessionId === "") {
    throw new Error("sieve accepted the run but did not return a session_id.");
  }
  const status = typeof record.status === "string" ? record.status : "queued";
  const poll = typeof record.poll === "string" ? record.poll : undefined;
  return { sessionId, status, ...(poll ? { poll } : {}) };
}

/* ------------------------------------------------------------------ *
 * Polling + turn decisions
 * ------------------------------------------------------------------ */

export type PollDecision =
  | { action: "complete" }
  | { action: "keep_polling"; reason: string }
  | { action: "terminal"; reason: string }
  | { action: "error"; reason: string };

/**
 * Decide whether a poll is finished.
 *
 * After a follow-up message, `status` can be "done" while `turns` still
 * reflects the previous answer. Recording `turns` BEFORE sending the message
 * and requiring the count to advance is what stops the UI reading the old
 * result as if it were the reply.
 */
export function decidePoll(input: {
  state: RunState;
  turns?: number;
  turnsBefore?: number;
}): PollDecision {
  if (input.state === "running") {
    return { action: "keep_polling", reason: "run still running" };
  }
  if (input.state === "refused") {
    return { action: "terminal", reason: "run was refused" };
  }
  if (input.state === "error") {
    return { action: "error", reason: "unexpected run status" };
  }
  // Done.
  if (input.turnsBefore === undefined) return { action: "complete" };
  if (input.turns !== undefined && input.turns > input.turnsBefore) {
    return { action: "complete" };
  }
  return {
    action: "keep_polling",
    reason: "the follow-up turn is not reflected in the run yet",
  };
}

export const POLL_DELAY_START_MS = 5_000;
export const POLL_DELAY_MAX_MS = 30_000;

/** 5s, 10s, 20s, then a 30s ceiling. Runs take minutes, so never poll faster. */
export function pollDelayMs(attempt: number): number {
  const step = Math.max(1, Math.floor(attempt));
  return Math.min(POLL_DELAY_START_MS * 2 ** (step - 1), POLL_DELAY_MAX_MS);
}

/** Backoff between retries of one call (429/5xx/network), capped small. */
export function retryBackoffMs(attempt: number): number {
  const step = Math.max(1, Math.floor(attempt));
  return Math.min(1_000 * 2 ** (step - 1), 15_000);
}

/** Retry-After is either a number of seconds or an HTTP date. */
export function parseRetryAfter(
  header: string | null | undefined,
  now: number = Date.now(),
): number | undefined {
  if (header === null || header === undefined) return undefined;
  const trimmed = header.trim();
  if (trimmed === "") return undefined;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) return Math.max(0, date - now);
  return undefined;
}

/* ------------------------------------------------------------------ *
 * Schema conformance
 * ------------------------------------------------------------------ */

/** A result may only be presented as clean data when the check actually passed. */
export function isCleanResult(
  conformance: SchemaConformance | undefined,
): boolean {
  return conformance?.status === "pass";
}

export function schemaConformanceNote(
  conformance: SchemaConformance | undefined,
): string {
  switch (conformance?.status) {
    case "pass":
      return "Validated cleanly against the output schema.";
    case "partial":
      return "No violations, but some declared columns are missing.";
    case "fail":
      return "Non-conforming after repair — treat this output as incomplete, not clean data.";
    case "not_checkable":
      return "Nothing checkable was produced.";
    case "no_artifact":
      return "No artifact to validate.";
    case undefined:
      return "No output schema was requested.";
    default:
      return `Schema check reported "${conformance?.status ?? "unknown"}".`;
  }
}

/* ------------------------------------------------------------------ *
 * HTTP client (dependency-injected so it can be tested at the boundary)
 * ------------------------------------------------------------------ */

export type ResponseLike = {
  status: number;
  text: () => Promise<string>;
  headers: { get: (name: string) => string | null };
};

export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<ResponseLike>;

export type SieveFailure = {
  ok: false;
  kind: "config" | "network" | "http";
  status?: number;
  classification: HttpClass | "network" | "config";
  message: string;
  retryable: boolean;
};

export type SieveSuccess<T> = { ok: true; data: T };
export type SieveOutcome<T> = SieveSuccess<T> | SieveFailure;

export type SieveClientOptions = {
  apiKey: string;
  baseUrl?: string;
  fetchImpl: FetchLike;
  /** Injected so tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
};

export type CreditsInfo = {
  plan?: string;
  limit?: number;
  used?: number;
  remaining?: number;
};

function safeJson(text: string): unknown {
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function createSieveClient(options: SieveClientOptions) {
  const baseUrl =
    options.baseUrl && options.baseUrl.trim() !== ""
      ? options.baseUrl.trim()
      : SIEVE_BASE_URL;
  const apiKey = options.apiKey;
  const doFetch = options.fetchImpl;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);

  type Raw =
    | {
        ok: true;
        status: number;
        text: string;
        contentType?: string;
        retryAfter?: number;
      }
    | { ok: false; message: string };

  async function execute(request: SieveRequest): Promise<Raw> {
    try {
      const response = await doFetch(request.url, {
        method: request.method,
        headers: request.headers,
        ...(request.body === undefined ? {} : { body: request.body }),
      });
      const text = await response.text();
      const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
      const contentType = response.headers.get("content-type");
      return {
        ok: true,
        status: response.status,
        text,
        ...(contentType === null ? {} : { contentType }),
        ...(retryAfter === undefined ? {} : { retryAfter }),
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  function networkFailure(message: string, retryable: boolean): SieveFailure {
    return {
      ok: false,
      kind: "network",
      classification: "network",
      message: `Could not reach sieve: ${message}`,
      retryable,
    };
  }

  function httpFailure(
    classification: HttpClass,
    status: number,
    body: string,
  ): SieveFailure {
    return {
      ok: false,
      kind: "http",
      status,
      classification,
      message: describeHttpFailure(classification, status, body),
      retryable:
        isRetryableStart(classification) ||
        isRetryableMessage(classification) ||
        isRetryablePoll(classification),
    };
  }

  /**
   * Start a run. A single POST: retried only after 429/5xx (no run created),
   * never after a timeout or network error (the run may exist).
   */
  async function startRun(
    body: ScrapeBody,
  ): Promise<SieveOutcome<{ sessionId: string; status: string }>> {
    const request = buildRequest({
      baseUrl,
      path: SIEVE_PATHS.start,
      method: "POST",
      apiKey,
      body,
    });

    let attempt = 0;
    let last: SieveFailure | undefined;
    while (attempt < maxAttempts) {
      attempt += 1;
      const raw = await execute(request);
      if (!raw.ok) {
        // Never auto-retry: the first call may have created a run.
        return networkFailure(raw.message, false);
      }
      const classification = classifyHttp(raw.status);
      if (classification === "accepted" || classification === "ok") {
        try {
          return { ok: true, data: parseStartAccepted(safeJson(raw.text)) };
        } catch (error) {
          return {
            ok: false,
            kind: "http",
            status: raw.status,
            classification,
            message:
              error instanceof Error
                ? error.message
                : "sieve returned an unusable response.",
            retryable: false,
          };
        }
      }
      last = httpFailure(classification, raw.status, raw.text);
      if (isRetryableStart(classification) && attempt < maxAttempts) {
        await sleep(raw.retryAfter ?? retryBackoffMs(attempt));
        continue;
      }
      return last;
    }
    return (
      last ?? {
        ok: false,
        kind: "http",
        classification: "retry",
        message: "sieve stayed unavailable; no run was created.",
        retryable: true,
      }
    );
  }

  /** One poll. GET is idempotent, so transient network/5xx errors are retried. */
  async function pollRun(sessionId: string): Promise<SieveOutcome<NormalizedRun>> {
    const request = buildRequest({
      baseUrl,
      path: SIEVE_PATHS.poll(sessionId),
      method: "GET",
      apiKey,
    });

    let attempt = 0;
    let last: SieveFailure | undefined;
    while (attempt < maxAttempts) {
      attempt += 1;
      const raw = await execute(request);
      if (!raw.ok) {
        last = networkFailure(raw.message, true);
        if (attempt < maxAttempts) {
          await sleep(retryBackoffMs(attempt));
          continue;
        }
        return last;
      }
      const classification = classifyHttp(raw.status);
      if (classification === "ok" || classification === "accepted") {
        return { ok: true, data: parseRun(safeJson(raw.text)) };
      }
      last = httpFailure(classification, raw.status, raw.text);
      if (isRetryablePoll(classification) && attempt < maxAttempts) {
        await sleep(raw.retryAfter ?? retryBackoffMs(attempt));
        continue;
      }
      return last;
    }
    return (
      last ?? {
        ok: false,
        kind: "network",
        classification: "network",
        message: "Could not reach sieve.",
        retryable: true,
      }
    );
  }

  /**
   * Send a follow-up turn. 409 means a turn is already in flight, so waiting
   * and resending is safe; a network error is not retried, because the turn
   * may have been created.
   */
  async function sendMessage(
    sessionId: string,
    body: ScrapeBody,
  ): Promise<SieveOutcome<{ status: string }>> {
    const request = buildRequest({
      baseUrl,
      path: SIEVE_PATHS.messages(sessionId),
      method: "POST",
      apiKey,
      body,
    });

    let attempt = 0;
    let last: SieveFailure | undefined;
    while (attempt < maxAttempts) {
      attempt += 1;
      const raw = await execute(request);
      if (!raw.ok) {
        return networkFailure(raw.message, false);
      }
      const classification = classifyHttp(raw.status);
      if (classification === "ok" || classification === "accepted") {
        return { ok: true, data: { status: "running" } };
      }
      last = httpFailure(classification, raw.status, raw.text);
      if (isRetryableMessage(classification) && attempt < maxAttempts) {
        await sleep(raw.retryAfter ?? retryBackoffMs(attempt));
        continue;
      }
      return last;
    }
    return (
      last ?? {
        ok: false,
        kind: "network",
        classification: "network",
        message: "Could not send the follow-up.",
        retryable: true,
      }
    );
  }

  async function getCredits(): Promise<SieveOutcome<CreditsInfo>> {
    const request = buildRequest({
      baseUrl,
      path: SIEVE_PATHS.credits,
      method: "GET",
      apiKey,
    });
    const raw = await execute(request);
    if (!raw.ok) return networkFailure(raw.message, true);
    const classification = classifyHttp(raw.status);
    if (classification !== "ok" && classification !== "accepted") {
      return httpFailure(classification, raw.status, raw.text);
    }
    const record = asRecord(safeJson(raw.text));
    return {
      ok: true,
      data: {
        ...(typeof record.plan === "string" ? { plan: record.plan } : {}),
        ...(typeof record.limit === "number" ? { limit: record.limit } : {}),
        ...(typeof record.used === "number" ? { used: record.used } : {}),
        ...(typeof record.remaining === "number"
          ? { remaining: record.remaining }
          : {}),
      },
    };
  }

  /** Fetch a delivered file; the bearer key never leaves the server. */
  async function downloadFile(
    url: string,
  ): Promise<SieveOutcome<{ contentType: string; text: string }>> {
    const request = buildRequest({
      baseUrl,
      path: absoluteUrl(url, baseUrl),
      method: "GET",
      apiKey,
    });
    const raw = await execute(request);
    if (!raw.ok) return networkFailure(raw.message, true);
    const classification = classifyHttp(raw.status);
    if (classification !== "ok" && classification !== "accepted") {
      return httpFailure(classification, raw.status, raw.text);
    }
    return {
      ok: true,
      data: {
        contentType: raw.contentType ?? "text/plain",
        text: raw.text,
      },
    };
  }

  return { startRun, pollRun, sendMessage, getCredits, downloadFile };
}

export type SieveClient = ReturnType<typeof createSieveClient>;
