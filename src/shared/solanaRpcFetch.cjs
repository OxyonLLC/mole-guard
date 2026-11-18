// Rate-limit-aware fetch for @solana/web3.js Connections.
//
// Built 2026-08-15 after Alchemy started returning 429s during funding-cluster
// walks. web3.js has its own 429 handling and it is the naive kind: a FIXED
// ~500ms sleep, no jitter, no cap awareness, no Retry-After. Fixed delays make
// concurrent callers synchronise — they all sleep 500ms and all hammer the
// endpoint again at the same instant, which is how a brief burst becomes a
// sustained one.
//
// This replaces it. Set `disableRetryOnRateLimit: true` alongside, or both
// retry loops run and you get the product of the two.
//
// ─────────────────────────────────────────────────────────────────────────
// THE RULE THAT MATTERS MORE THAN THE BACKOFF: NEVER RETRY A SEND.
//
// A retrying fetch wrapped around a Connection retries EVERY JSON-RPC call,
// including sendTransaction. A 429 or a 502 arriving *after* the validator
// already accepted the transaction, followed by an automatic retry, sends the
// tokens twice. That is not hypothetical — it is the same shape as the
// confirmation-timeout bug that could double-pay quiz redemptions, found in
// this repo two days ago.
//
// So the method name is parsed out of the JSON-RPC body first, and anything
// that can move funds is passed through with NO retry at all. If the body
// cannot be parsed, that is also no retry: an unknown call is treated as
// unsafe, because being wrong in that direction only costs a failed read.
// ─────────────────────────────────────────────────────────────────────────

/** Methods that change state. A failed one must surface as a failure so the
 *  caller's own idempotency logic (payout intents, claim reservations) decides
 *  what to do — that logic exists precisely because retrying blindly is unsafe. */
const NEVER_RETRY = new Set(['sendTransaction', 'requestAirdrop']);

const DEFAULTS = Object.freeze({
  maxAttempts: 4,
  baseDelayMs: 300,
  maxDelayMs: 2000,
  // Ceiling on the TOTAL time one call may spend asleep. Without this, honouring
  // a server's Retry-After is an open invitation to hold a request for minutes.
  maxTotalDelayMs: 4000,
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Full jitter: a random point in [0, exponential], not exponential ± a little.
 * Retrying at a *fixed* delay is what makes callers synchronise; spreading them
 * across the whole window is what breaks the lockstep.
 */
function backoffMs(attempt, { baseDelayMs, maxDelayMs }, random = Math.random) {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return Math.round(random() * ceiling);
}

/**
 * Honour Retry-After when the server sends it — it is the endpoint telling us
 * exactly how long it wants, and guessing shorter is how you get rate limited
 * for longer. Accepts both forms in the spec: delta-seconds and an HTTP date.
 */
function retryAfterMs(headers, now = Date.now()) {
  const raw = headers && typeof headers.get === 'function' ? headers.get('retry-after') : null;
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const at = Date.parse(raw);
  if (Number.isFinite(at)) return Math.max(0, at - now);
  return null;
}

/** The JSON-RPC method(s) in a request body. Batches return every method: if
 *  any one of them is unsafe the whole batch is unsafe. */
function methodsOf(body) {
  try {
    const parsed = typeof body === 'string' ? JSON.parse(body) : body;
    if (Array.isArray(parsed)) return parsed.map((x) => String(x?.method || ''));
    if (parsed && typeof parsed === 'object') return [String(parsed.method || '')];
    return null;
  } catch {
    return null;
  }
}

/** Can this request be safely sent again? Unknown means no. */
function isRetryableRequest(init) {
  const methods = methodsOf(init && init.body);
  if (!methods || !methods.length) return false;
  return methods.every((m) => m && !NEVER_RETRY.has(m));
}

function isRetryableStatus(status) {
  // 429 rate limit, plus the transient server-side ones. 5xx from an RPC
  // provider is routinely a load-shedding response, not a real server fault.
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

/**
 * Build a fetch function for Connection's `fetch` option.
 *
 * @param {object} [opts]
 * @param {number} [opts.maxAttempts]  total attempts including the first
 * @param {function} [opts.onRetry]    ({attempt, delayMs, status, method}) => void
 */
function createRpcFetch(opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const impl = cfg.fetchImpl || globalThis.fetch;
  const random = cfg.random || Math.random;

  return async function rpcFetch(input, init) {
    const retryable = isRetryableRequest(init);
    let lastResponse = null;
    let sleptMs = 0;

    for (let attempt = 0; attempt < cfg.maxAttempts; attempt += 1) {
      const res = await impl(input, init);
      if (!isRetryableStatus(res.status) || !retryable || attempt === cfg.maxAttempts - 1) {
        return res;
      }
      lastResponse = res;

      // CAPPED, and this cap is not cosmetic. Retry-After is whatever the
      // provider feels like sending — Alchemy has returned 60 — and obeying it
      // literally meant one RPC call could sleep for minutes. Every one of
      // these calls happens inside an HTTP request that is itself holding a PHP
      // worker on shared hosting, so an unbounded sleep here took the whole
      // website down on 2026-08-15, static files and FTP with it.
      //
      // Waiting the full advised time is the polite thing for a batch job and
      // the wrong thing for a request someone is waiting on. Give up instead:
      // the caller sees a failure it can handle, and the worker is freed.
      const advised = retryAfterMs(res.headers);
      const raw = advised != null ? advised : backoffMs(attempt, cfg, random);
      const remainingBudget = Math.max(0, cfg.maxTotalDelayMs - sleptMs);
      const delayMs = Math.min(raw, cfg.maxDelayMs, remainingBudget);
      // Budget exhausted — stop rather than sleep zero and hammer immediately.
      if (remainingBudget <= 0) return res;
      sleptMs += delayMs;
      if (cfg.onRetry) {
        const methods = methodsOf(init && init.body) || [];
        cfg.onRetry({ attempt, delayMs, status: res.status, method: methods[0] || 'unknown', advised: advised != null, cappedFrom: raw !== delayMs ? raw : null });
      }
      await sleep(delayMs);
    }
    return lastResponse;
  };
}

/**
 * Connection options with the retry behaviour wired up.
 *
 *   new Connection(url, rpcConnectionOptions('confirmed'))
 *
 * disableRetryOnRateLimit is ON here on purpose — it disables WEB3.JS's retry
 * so ours is the only one. Leaving it off would nest the two loops.
 */
function rpcConnectionOptions(commitment = 'confirmed', opts = {}) {
  return {
    commitment,
    disableRetryOnRateLimit: true,
    fetch: createRpcFetch(opts),
  };
}

module.exports = {
  NEVER_RETRY,
  DEFAULTS,
  backoffMs,
  retryAfterMs,
  methodsOf,
  isRetryableRequest,
  isRetryableStatus,
  createRpcFetch,
  rpcConnectionOptions,
};
