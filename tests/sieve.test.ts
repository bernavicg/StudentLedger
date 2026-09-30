import { describe, expect, test } from "bun:test";
import {
  absoluteUrl,
  buildRequest,
  buildScrapeBody,
  classifyHttp,
  classifyRunState,
  createSieveClient,
  decidePoll,
  describeHttpFailure,
  isCleanResult,
  isRetryableMessage,
  isRetryablePoll,
  isRetryableStart,
  joinUrl,
  parseRetryAfter,
  parseRun,
  parseStartAccepted,
  pollDelayMs,
  schemaConformanceNote,
  SieveInputError,
  type FetchLike,
} from "../src/convex/lib/sieve";

/*
 * These cover the logic the Convex modules rely on, without a running backend
 * or a real network. Recorded responses are injected as real `Response`
 * objects at the HTTP boundary (createSieveClient's fetchImpl); everything
 * downstream is the real code.
 *
 * This file lives outside src/ on purpose, like the other tests here —
 * tsconfig.app.json includes all of src and Convex typechecks src/convex, so
 * either would try to compile the "bun:test" import without the Bun types.
 */

const BASE = "https://scrape.usesieve.com";

type Recording = {
  status: number;
  body?: string;
  headers?: Record<string, string>;
};

function fakeFetch(
  recordings: Recording[],
  mode: "sequential" | "last" = "sequential",
) {
  const calls: { url: string; init?: Record<string, unknown> }[] = [];
  let index = 0;
  const fn = async (input: string, init?: Record<string, unknown>) => {
    calls.push({ url: input, init });
    const recording =
      mode === "last"
        ? recordings[recordings.length - 1]!
        : recordings[Math.min(index, recordings.length - 1)]!;
    index += 1;
    return new Response(recording.body ?? "", {
      status: recording.status,
      headers: recording.headers ?? {},
    });
  };
  return { fn: fn as unknown as FetchLike, calls };
}

const throwOnceThen = (recording: Recording) => {
  let first = true;
  const calls: string[] = [];
  const fn = async (input: string) => {
    calls.push(input);
    if (first) {
      first = false;
      throw new Error("The operation timed out");
    }
    return new Response(recording.body ?? "", {
      status: recording.status,
      headers: recording.headers ?? {},
    });
  };
  return { fn: fn as unknown as FetchLike, calls };
};

function makeClient(fetchImpl: FetchLike) {
  return createSieveClient({
    apiKey: "dc_sk_test",
    baseUrl: BASE,
    fetchImpl,
    sleep: async () => {},
    maxAttempts: 3,
  });
}

describe("buildScrapeBody", () => {
  test("defaults compliance_mode to regular and trims the instruction", () => {
    const body = buildScrapeBody({ instruction: "  Extract quotes  " });
    expect(body.instruction).toBe("Extract quotes");
    expect(body.compliance_mode).toBe("regular");
    expect(body.target_urls).toBeUndefined();
  });

  test("passes an explicit compliance mode through", () => {
    expect(buildScrapeBody({ instruction: "x", complianceMode: "yolo" }).compliance_mode).toBe(
      "yolo",
    );
    expect(
      buildScrapeBody({ instruction: "x", complianceMode: "conservative" }).compliance_mode,
    ).toBe("conservative");
  });

  test("rejects an unknown compliance mode", () => {
    expect(() => buildScrapeBody({ instruction: "x", complianceMode: "reckless" })).toThrow(
      SieveInputError,
    );
  });

  test("requires an instruction", () => {
    expect(() => buildScrapeBody({ instruction: "   " })).toThrow(SieveInputError);
  });

  test("keeps only public http(s) target urls and drops blanks", () => {
    const body = buildScrapeBody({
      instruction: "x",
      targetUrls: [" https://quotes.toscrape.com ", "", "http://example.com"],
    });
    expect(body.target_urls).toEqual([
      "https://quotes.toscrape.com",
      "http://example.com",
    ]);
  });

  test("rejects a non-http target url", () => {
    expect(() =>
      buildScrapeBody({ instruction: "x", targetUrls: ["file:///etc/passwd"] }),
    ).toThrow(SieveInputError);
  });

  test("omits an empty target list", () => {
    expect(buildScrapeBody({ instruction: "x", targetUrls: ["  "] }).target_urls).toBeUndefined();
  });

  test("includes fields, table_shape, schema and output_schema when set", () => {
    const body = buildScrapeBody({
      instruction: "x",
      fields: ["quote", "author"],
      tableShape: "long",
      schema: { type: "object" },
      outputSchema: { type: "array" },
    });
    expect(body.fields).toEqual(["quote", "author"]);
    expect(body.table_shape).toBe("long");
    expect(body.schema).toEqual({ type: "object" });
    expect(body.output_schema).toEqual({ type: "array" });
  });

  test("rejects an output_schema over 32KB", () => {
    const big = { type: "object", blob: "x".repeat(33 * 1024) };
    expect(() => buildScrapeBody({ instruction: "x", outputSchema: big })).toThrow(
      /32\d\d\d bytes|32768 bytes/,
    );
  });
});

describe("request building", () => {
  test("joins base and path without doubling slashes", () => {
    expect(joinUrl("https://scrape.usesieve.com/", "/api/scrapes")).toBe(
      "https://scrape.usesieve.com/api/scrapes",
    );
  });

  test("leaves an absolute url alone", () => {
    expect(joinUrl(BASE, "https://cdn.example.com/a.csv")).toBe(
      "https://cdn.example.com/a.csv",
    );
  });

  test("prefixes a relative file url with the base", () => {
    expect(absoluteUrl("/files/a.csv", BASE)).toBe(
      "https://scrape.usesieve.com/files/a.csv",
    );
    expect(absoluteUrl("files/a.csv", BASE)).toBe(
      "https://scrape.usesieve.com/files/a.csv",
    );
  });

  test("sends the bearer header and JSON body", () => {
    const request = buildRequest({
      baseUrl: BASE,
      path: "/api/scrapes",
      method: "POST",
      apiKey: "dc_sk_secret",
      body: { instruction: "x" },
    });
    expect(request.url).toBe("https://scrape.usesieve.com/api/scrapes");
    expect(request.method).toBe("POST");
    expect(request.headers.Authorization).toBe("Bearer dc_sk_secret");
    expect(request.headers["Content-Type"]).toBe("application/json");
    expect(request.body).toBe(JSON.stringify({ instruction: "x" }));
  });

  test("omits the content type and body on a GET", () => {
    const request = buildRequest({
      baseUrl: BASE,
      path: "/api/scrapes/abc",
      method: "GET",
      apiKey: "k",
    });
    expect(request.headers["Content-Type"]).toBeUndefined();
    expect(request.body).toBeUndefined();
  });
});

describe("status handling", () => {
  test("maps running, done and refused", () => {
    expect(classifyRunState("running")).toBe("running");
    expect(classifyRunState("done")).toBe("done");
    expect(classifyRunState("refused")).toBe("refused");
  });

  test("treats anything else as an error", () => {
    expect(classifyRunState("queued")).toBe("error");
    expect(classifyRunState(undefined)).toBe("error");
    expect(classifyRunState("finished")).toBe("error");
  });

  test("parses a done payload with files, conformance and result", () => {
    const run = parseRun({
      status: "done",
      session_id: "sess_1",
      turns: 2,
      summary: "12 rows",
      schema_conformance: { status: "pass" },
      result: [{ quote: "a", author: "b" }],
      files: [{ name: "quotes.csv", size: 120, ext: "csv", url: "/files/q.csv" }],
    });
    expect(run.state).toBe("done");
    expect(run.sessionId).toBe("sess_1");
    expect(run.turns).toBe(2);
    expect(run.hasResult).toBe(true);
    expect(run.files[0]).toEqual({
      name: "quotes.csv",
      size: 120,
      ext: "csv",
      url: "/files/q.csv",
    });
    expect(run.schemaConformance?.status).toBe("pass");
  });

  test("parses a running payload with no result yet", () => {
    const run = parseRun({ status: "running", turns: 1 });
    expect(run.state).toBe("running");
    expect(run.hasResult).toBe(false);
    expect(run.files).toEqual([]);
  });

  test("parses a refusal with its reason", () => {
    const run = parseRun({
      status: "refused",
      refusal: { code: "quota", message: "out of credits" },
    });
    expect(run.state).toBe("refused");
    expect(run.refusal?.code).toBe("quota");
  });

  test("ignores files without a url", () => {
    const run = parseRun({ status: "done", files: [{ name: "x" }, { url: "/a" }] });
    expect(run.files).toHaveLength(1);
    expect(run.files[0].name).toBe("download");
  });

  test("parses the 202 body and requires a session id", () => {
    expect(parseStartAccepted({ status: "queued", session_id: "s1" })).toEqual({
      sessionId: "s1",
      status: "queued",
    });
    expect(() => parseStartAccepted({ status: "queued" })).toThrow(/session_id/);
  });
});

describe("follow-up turn check", () => {
  test("keeps polling while the run is running", () => {
    expect(decidePoll({ state: "running", turns: 3, turnsBefore: 3 })).toEqual({
      action: "keep_polling",
      reason: "run still running",
    });
  });

  test("completes a first run that is done", () => {
    expect(decidePoll({ state: "done", turns: 1 })).toEqual({ action: "complete" });
  });

  test("completes only once the turn count has advanced", () => {
    expect(decidePoll({ state: "done", turns: 3, turnsBefore: 2 })).toEqual({
      action: "complete",
    });
  });

  test("keeps polling when done but the new turn is not reflected yet", () => {
    const decision = decidePoll({ state: "done", turns: 2, turnsBefore: 2 });
    expect(decision.action).toBe("keep_polling");
    // Missing turn count is also treated as not-yet-advanced.
    expect(decidePoll({ state: "done", turnsBefore: 2 }).action).toBe("keep_polling");
  });

  test("treats refused as terminal and unknown as an error", () => {
    expect(decidePoll({ state: "refused" }).action).toBe("terminal");
    expect(decidePoll({ state: "error" }).action).toBe("error");
  });
});

describe("error mapping", () => {
  test("classifies the contract's statuses", () => {
    expect(classifyHttp(202)).toBe("accepted");
    expect(classifyHttp(200)).toBe("ok");
    expect(classifyHttp(400)).toBe("fix_request");
    expect(classifyHttp(401)).toBe("auth");
    expect(classifyHttp(402)).toBe("credits");
    expect(classifyHttp(404)).toBe("not_found");
    expect(classifyHttp(409)).toBe("turn_in_flight");
    expect(classifyHttp(429)).toBe("rate_limited");
    expect(classifyHttp(500)).toBe("retry");
    expect(classifyHttp(503)).toBe("retry");
    expect(classifyHttp(418)).toBe("client_error");
  });

  test("retries a 429/5xx start but nothing else", () => {
    expect(isRetryableStart("rate_limited")).toBe(true);
    expect(isRetryableStart("retry")).toBe(true);
    expect(isRetryableStart("fix_request")).toBe(false);
    expect(isRetryableStart("auth")).toBe(false);
    expect(isRetryableStart("credits")).toBe(false);
  });

  test("retries an idempotent poll on 429/5xx", () => {
    expect(isRetryablePoll("retry")).toBe(true);
    expect(isRetryablePoll("rate_limited")).toBe(true);
    expect(isRetryablePoll("not_found")).toBe(false);
  });

  test("re-sends a message on 409 but not on a plain 400", () => {
    expect(isRetryableMessage("turn_in_flight")).toBe(true);
    expect(isRetryableMessage("rate_limited")).toBe(true);
    expect(isRetryableMessage("fix_request")).toBe(false);
  });

  test("explains the important failures", () => {
    expect(describeHttpFailure("auth", 401)).toContain("SIEVE_API_KEY");
    expect(describeHttpFailure("credits", 402)).toContain("credits");
    expect(describeHttpFailure("fix_request", 400)).toContain("400");
    expect(describeHttpFailure("not_found", 404)).toContain("404");
  });
});

describe("schema conformance", () => {
  test("only a pass counts as clean", () => {
    expect(isCleanResult({ status: "pass" })).toBe(true);
    expect(isCleanResult({ status: "partial" })).toBe(false);
    expect(isCleanResult({ status: "fail" })).toBe(false);
    expect(isCleanResult(undefined)).toBe(false);
  });

  test("never presents a fail as clean data", () => {
    expect(schemaConformanceNote({ status: "fail" })).toContain("not clean data");
    expect(schemaConformanceNote({ status: "partial" })).toContain("missing");
  });
});

describe("timing", () => {
  test("backs off from 5s to a 30s ceiling", () => {
    expect(pollDelayMs(1)).toBe(5_000);
    expect(pollDelayMs(2)).toBe(10_000);
    expect(pollDelayMs(3)).toBe(20_000);
    expect(pollDelayMs(4)).toBe(30_000);
    expect(pollDelayMs(9)).toBe(30_000);
  });

  test("parses Retry-After in seconds and as a date", () => {
    expect(parseRetryAfter("12")).toBe(12_000);
    expect(parseRetryAfter("0")).toBe(0);
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    expect(parseRetryAfter(new Date(now + 5_000).toUTCString(), now)).toBe(5_000);
    expect(parseRetryAfter("nonsense")).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });
});

describe("client retry rules", () => {
  test("never retries POST /api/scrapes after a timeout", async () => {
    // A timeout means the first call may have created a run; retrying would
    // spend credits twice, so exactly one attempt is made.
    const fetchImpl = throwOnceThen({ status: 202, body: JSON.stringify({ session_id: "s" }) });
    const client = makeClient(fetchImpl.fn);
    const outcome = await client.startRun({
      instruction: "x",
      compliance_mode: "regular",
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.kind).toBe("network");
      expect(outcome.retryable).toBe(false);
    }
    expect(fetchImpl.calls).toHaveLength(1);
  });

  test("retries a 429 start, which is safe because no run was created", async () => {
    const fetchImpl = fakeFetch([
      { status: 429, headers: { "retry-after": "1" } },
      { status: 202, body: JSON.stringify({ status: "queued", session_id: "sess_9" }) },
    ]);
    const client = makeClient(fetchImpl.fn);
    const outcome = await client.startRun({ instruction: "x", compliance_mode: "regular" });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.data.sessionId).toBe("sess_9");
    expect(fetchImpl.calls).toHaveLength(2);
  });

  test("does not retry a 400 start", async () => {
    const fetchImpl = fakeFetch([{ status: 400, body: "bad instruction" }]);
    const client = makeClient(fetchImpl.fn);
    const outcome = await client.startRun({ instruction: "x", compliance_mode: "regular" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.classification).toBe("fix_request");
      expect(outcome.retryable).toBe(false);
    }
    expect(fetchImpl.calls).toHaveLength(1);
  });

  test("retries a poll on a 5xx, since GET is idempotent", async () => {
    const fetchImpl = fakeFetch([
      { status: 503 },
      { status: 200, body: JSON.stringify({ status: "done", turns: 1 }) },
    ]);
    const client = makeClient(fetchImpl.fn);
    const outcome = await client.pollRun("sess_1");
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.data.state).toBe("done");
    expect(fetchImpl.calls).toHaveLength(2);
  });

  test("re-sends a follow-up after a 409", async () => {
    const fetchImpl = fakeFetch([{ status: 409 }, { status: 200, body: "{}" }]);
    const client = makeClient(fetchImpl.fn);
    const outcome = await client.sendMessage("sess_1", {
      instruction: "more",
      compliance_mode: "regular",
    });
    expect(outcome.ok).toBe(true);
    expect(fetchImpl.calls).toHaveLength(2);
  });

  test("downloads a relative file with the bearer header", async () => {
    const fetchImpl = fakeFetch([
      { status: 200, body: "quote,author", headers: { "content-type": "text/csv" } },
    ]);
    const client = makeClient(fetchImpl.fn);
    const outcome = await client.downloadFile("/files/q.csv");
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.data.contentType).toBe("text/csv");
      expect(outcome.data.text).toBe("quote,author");
    }
    expect(fetchImpl.calls[0]!.url).toBe("https://scrape.usesieve.com/files/q.csv");
    expect(
      (fetchImpl.calls[0]!.init?.headers as Record<string, string>).Authorization,
    ).toBe("Bearer dc_sk_test");
  });
});
