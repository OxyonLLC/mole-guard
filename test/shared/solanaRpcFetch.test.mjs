// Rate-limit-aware RPC fetch.
//
// The backoff maths is the easy half. The half that matters is that this thing
// sits underneath every JSON-RPC call a Connection makes — INCLUDING
// sendTransaction — so a careless retry here sends someone's tokens twice.
// Most of these tests are about what it refuses to retry.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const {
  createRpcFetch, isRetryableRequest, isRetryableStatus, retryAfterMs, backoffMs, methodsOf, DEFAULTS,
} = require_("../../src/shared/solanaRpcFetch.cjs");

const body = (method) => JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] });
const res = (status, headers = {}) => ({
  status,
  headers: { get: (k) => headers[String(k).toLowerCase()] ?? null },
});

describe("it never retries a send", () => {
  test("sendTransaction is not retryable", () => {
    // A 429 arriving AFTER the validator accepted the transaction, followed by
    // an automatic retry, sends the tokens twice.
    assert.equal(isRetryableRequest({ body: body("sendTransaction") }), false);
    assert.equal(isRetryableRequest({ body: body("requestAirdrop") }), false);
  });

  test("reads are retryable", () => {
    for (const m of ["getSignaturesForAddress", "getParsedTransaction", "getBalance", "getLatestBlockhash", "getSignatureStatuses"]) {
      assert.equal(isRetryableRequest({ body: body(m) }), true, `${m} should be retryable`);
    }
  });

  test("a batch containing a send is not retryable", () => {
    const batch = JSON.stringify([{ method: "getBalance" }, { method: "sendTransaction" }]);
    assert.equal(isRetryableRequest({ body: batch }), false,
      "one unsafe call in a batch makes the whole batch unsafe");
  });

  test("an unparseable or empty body is NOT retried", () => {
    // Unknown means unsafe. Being wrong this way costs a failed read; being
    // wrong the other way costs a double spend.
    assert.equal(isRetryableRequest({ body: "not json" }), false);
    assert.equal(isRetryableRequest({ body: "" }), false);
    assert.equal(isRetryableRequest({}), false);
    assert.equal(isRetryableRequest({ body: JSON.stringify({ id: 1 }) }), false);
    assert.equal(methodsOf("{{"), null);
  });

  test("a send is passed straight through even on a 429", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return res(429); };
    const f = createRpcFetch({ fetchImpl, maxAttempts: 4, baseDelayMs: 1 });
    const out = await f("u", { body: body("sendTransaction") });
    assert.equal(calls, 1, "a sendTransaction was retried after a 429");
    assert.equal(out.status, 429);
  });
});

describe("which statuses are worth retrying", () => {
  test("429 and transient 5xx, nothing else", () => {
    for (const s of [429, 500, 502, 503, 504]) assert.equal(isRetryableStatus(s), true, `${s}`);
    for (const s of [200, 400, 401, 403, 404, 422]) assert.equal(isRetryableStatus(s), false, `${s}`);
  });

  test("a 200 returns immediately", async () => {
    let calls = 0;
    const f = createRpcFetch({ fetchImpl: async () => { calls += 1; return res(200); }, baseDelayMs: 1 });
    await f("u", { body: body("getBalance") });
    assert.equal(calls, 1);
  });

  test("a 400 is not retried — it will fail identically next time", async () => {
    let calls = 0;
    const f = createRpcFetch({ fetchImpl: async () => { calls += 1; return res(400); }, baseDelayMs: 1 });
    await f("u", { body: body("getBalance") });
    assert.equal(calls, 1);
  });
});

describe("backing off without synchronising", () => {
  test("Retry-After in seconds is honoured exactly", () => {
    assert.equal(retryAfterMs(res(429, { "retry-after": "2" }).headers), 2000);
    assert.equal(retryAfterMs(res(429, { "retry-after": "0" }).headers), 0);
  });

  test("Retry-After as an HTTP date is honoured", () => {
    const now = Date.parse("2026-08-15T00:00:00Z");
    const when = new Date(now + 5000).toUTCString();
    const got = retryAfterMs(res(429, { "retry-after": when }).headers, now);
    assert.ok(Math.abs(got - 5000) < 1000, `expected ~5000ms, got ${got}`);
  });

  test("no Retry-After falls back to jittered exponential", () => {
    // Full jitter: a random point in [0, ceiling]. The ceiling grows, the
    // actual wait is spread across it — that spread is what stops every caller
    // waking at the same instant, which was the whole problem with web3.js's
    // fixed 500ms.
    const cfg = { baseDelayMs: 300, maxDelayMs: 8000 };
    assert.equal(backoffMs(0, cfg, () => 1), 300);
    assert.equal(backoffMs(1, cfg, () => 1), 600);
    assert.equal(backoffMs(2, cfg, () => 1), 1200);
    assert.equal(backoffMs(0, cfg, () => 0), 0, "full jitter must be able to return ~0");
    assert.equal(backoffMs(99, cfg, () => 1), 8000, "capped");
  });

  test("garbage in Retry-After is ignored rather than trusted", () => {
    assert.equal(retryAfterMs(res(429, { "retry-after": "soon" }).headers), null);
    assert.equal(retryAfterMs(res(429).headers), null);
  });

  test("a huge Retry-After is CAPPED, not obeyed", async () => {
    // The regression that took winlew.co down on 2026-08-15. Retry-After is
    // whatever the provider sends; Alchemy has returned 60. Obeying it meant one
    // RPC call could sleep for minutes — inside an HTTP request that was holding
    // a PHP worker on shared hosting, until no workers were left and the whole
    // site stopped serving, static files and FTP included.
    const waits = [];
    const f = createRpcFetch({
      fetchImpl: async () => res(429, { "retry-after": "60" }),
      onRetry: (r) => waits.push(r.delayMs),
    });
    await f("u", { body: body("getBalance") });
    assert.ok(waits.length > 0, "it stopped retrying entirely");
    for (const w of waits) {
      assert.ok(w <= DEFAULTS.maxDelayMs, `slept ${w}ms for one attempt, cap is ${DEFAULTS.maxDelayMs}ms`);
    }
    const total = waits.reduce((a, b) => a + b, 0);
    assert.ok(total <= DEFAULTS.maxTotalDelayMs,
      `total sleep ${total}ms exceeds the ${DEFAULTS.maxTotalDelayMs}ms budget for one call`);
  });

  test("the total sleep budget is enforced across attempts", async () => {
    const waits = [];
    const f = createRpcFetch({
      fetchImpl: async () => res(429, { "retry-after": "3" }),
      maxAttempts: 8, maxTotalDelayMs: 2500, maxDelayMs: 2000,
      onRetry: (r) => waits.push(r.delayMs),
    });
    await f("u", { body: body("getBalance") });
    assert.ok(waits.reduce((a, b) => a + b, 0) <= 2500, "budget exceeded");
  });

  test("a request waiting on a person must not sleep for minutes", () => {
    // A guard on the defaults themselves. These are used by request paths that
    // hold a shared-hosting worker, so the ceiling is a product decision, not a
    // tuning knob to raise casually.
    assert.ok(DEFAULTS.maxTotalDelayMs <= 10000,
      `maxTotalDelayMs is ${DEFAULTS.maxTotalDelayMs}ms — too long to hold a web worker`);
    assert.ok(DEFAULTS.maxDelayMs <= DEFAULTS.maxTotalDelayMs);
  });

  test("a server-advised delay wins over our guess", async () => {
    const seen = [];
    const f = createRpcFetch({
      fetchImpl: async () => res(429, { "retry-after": "0" }),
      maxAttempts: 3, baseDelayMs: 5000,
      onRetry: (r) => seen.push(r),
    });
    await f("u", { body: body("getBalance") });
    assert.equal(seen.length, 2);
    assert.ok(seen.every((r) => r.advised && r.delayMs === 0), "ignored Retry-After and used its own backoff");
  });
});

describe("giving up", () => {
  test("it stops at maxAttempts and returns the last response", async () => {
    let calls = 0;
    const f = createRpcFetch({ fetchImpl: async () => { calls += 1; return res(429); }, maxAttempts: 3, baseDelayMs: 1 });
    const out = await f("u", { body: body("getBalance") });
    assert.equal(calls, 3);
    assert.equal(out.status, 429, "the caller must still see the failure, not a hang");
  });

  test("it returns as soon as one attempt succeeds", async () => {
    let calls = 0;
    const f = createRpcFetch({
      fetchImpl: async () => { calls += 1; return res(calls < 3 ? 429 : 200); },
      maxAttempts: 5, baseDelayMs: 1,
    });
    const out = await f("u", { body: body("getParsedTransaction") });
    assert.equal(calls, 3);
    assert.equal(out.status, 200);
  });

  test("the default attempt count is bounded", () => {
    assert.ok(DEFAULTS.maxAttempts >= 2 && DEFAULTS.maxAttempts <= 6, "unbounded retries are a worse outage than failing");
  });
});
