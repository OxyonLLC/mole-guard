// RPC-fallback JSON-RPC client for the burn-history scanner (see
// burnScanner.js) — NOT a replacement for src/mole/solana.js's Connection-
// based helpers, which back the Transparency Center's live component
// snapshots. Those need exactly one configured endpoint and a single
// timeout; this needs classified, retryable errors and the ability to walk
// an ordered chain of endpoints, which @solana/web3.js's Connection doesn't
// expose cleanly. Raw fetch + manual JSON-RPC gives full control over that
// classification.
//
// RPC fallback order (see docs/burn-history-scanner.md):
//   1. SOLANA_RPC (src/mole/config.js) — this repo's one configured RPC.
//      As of this writing there is no separate paid/private endpoint
//      configured anywhere in this repo (checked config.js, faucet/
//      config.js, and every .env file) — SOLANA_RPC IS the public
//      mainnet-beta endpoint today. This chain is built to slot a real
//      paid endpoint in later (via SOLANA_RPC) without any code changes.
//   2. SOLANA_RPC_FALLBACK (optional env var, not currently set anywhere)
//   3. https://api.mainnet-beta.solana.com — hardcoded last resort.
// Identical URLs are de-duplicated, so pointing SOLANA_RPC at the public
// endpoint (today's reality) never double-hits the same host.
import { getConfig } from "../config.js";

export const PUBLIC_RPC_URL = "https://api.mainnet-beta.solana.com";
export const RPC_LABELS = Object.freeze({
  PRIMARY: "primary-configured-rpc",
  FALLBACK: "configured-fallback-rpc",
  PUBLIC: "solana-public-rpc",
});

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS_PER_ENDPOINT = 3;
const BASE_BACKOFF_MS = 400;
const MAX_BACKOFF_MS = 6_000;

// JSON-RPC error codes that represent a transient node-side condition
// (behind, unhealthy, long-term storage lookup failed) rather than a
// permanent problem with the request itself.
const TRANSIENT_JSONRPC_CODES = new Set([-32005, -32004, -32603]);

export class RpcError extends Error {
  constructor(message, { retryable = false, cause } = {}) {
    super(message);
    this.name = "RpcError";
    this.retryable = retryable;
    if (cause) this.cause = cause;
  }
}

/** Never throws on a missing config — just yields nothing for that slot. */
export function buildRpcChain() {
  const chain = [];
  const seen = new Set();
  const add = (url, label) => {
    const trimmed = String(url || "").trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    chain.push({ url: trimmed, label });
  };
  let primary = PUBLIC_RPC_URL;
  try {
    primary = getConfig().SOLANA_RPC || PUBLIC_RPC_URL;
  } catch {
    // getConfig() can throw if required env vars are missing entirely
    // (e.g. a bare CLI invocation) — fall through to the public endpoint
    // rather than crashing chain construction itself.
  }
  add(primary, RPC_LABELS.PRIMARY);
  add(process.env.SOLANA_RPC_FALLBACK, RPC_LABELS.FALLBACK);
  add(PUBLIC_RPC_URL, RPC_LABELS.PUBLIC);
  warnIfNoRealFallback(chain);
  return chain;
}

let warnedAboutFallback = false;

/**
 * Say so when "failover" is really one provider plus the public endpoint.
 *
 * Found 2026-08-15 while chasing Alchemy 429s: SOLANA_RPC_FALLBACK was set to
 * https://api.mainnet-beta.solana.com, which is byte-identical to the hardcoded
 * last resort — so the de-duplication above silently collapsed a three-tier
 * chain into two, and the only backup was the public endpoint. The public
 * endpoint rate limits harder than the paid one it is meant to rescue, so
 * failing over to it during a 429 storm mostly converts one kind of failure
 * into another.
 *
 * Configuration that looks like redundancy but is not is worse than no
 * redundancy, because nobody goes looking for it. Warned once per process.
 */
function warnIfNoRealFallback(chain) {
  if (warnedAboutFallback) return;
  const privateEndpoints = chain.filter((e) => e.url !== PUBLIC_RPC_URL);
  if (privateEndpoints.length >= 2) return;
  warnedAboutFallback = true;
  console.warn(
    '[rpc] only one non-public endpoint is configured — SOLANA_RPC_FALLBACK is unset or duplicates ' +
    'the public endpoint, so a rate-limited primary falls back to api.mainnet-beta.solana.com, ' +
    'which rate limits harder. Point SOLANA_RPC_FALLBACK at a second provider for real failover.',
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt) {
  const base = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  return base + Math.random() * base * 0.3; // full base + up to 30% jitter
}

async function rpcCallOnce(url, method, params, { timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
  } catch (err) {
    const isAbort = err?.name === "AbortError";
    throw new RpcError(`${isAbort ? "timeout" : "network_failure"}:${method}`, { retryable: true, cause: err });
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 429) throw new RpcError(`rate_limited:${method}`, { retryable: true });
  if (res.status >= 500) throw new RpcError(`server_error:${method}:${res.status}`, { retryable: true });
  if (!res.ok) throw new RpcError(`http_error:${method}:${res.status}`, { retryable: false });

  let body;
  try {
    body = await res.json();
  } catch (err) {
    throw new RpcError(`invalid_json:${method}`, { retryable: true, cause: err });
  }

  if (body?.error) {
    const retryable = TRANSIENT_JSONRPC_CODES.has(body.error.code);
    throw new RpcError(`jsonrpc_error:${method}:${body.error.code}:${body.error.message}`, { retryable });
  }

  return body?.result;
}

/**
 * Calls `method` against the configured RPC chain, retrying transient
 * failures with exponential backoff + jitter on the same endpoint before
 * moving on, and skipping straight to the next endpoint on a permanent
 * error. Returns `{ result, rpcLabel }` — never just the raw result — so
 * callers can report which source actually answered without ever handling
 * or logging the URL itself.
 */
export async function rpcCall(method, params, { timeoutMs = DEFAULT_TIMEOUT_MS, rpcMode = "auto", onAttempt } = {}) {
  const fullChain = buildRpcChain();
  const chain = rpcMode === "fallback" ? fullChain.slice(1) : rpcMode === "primary" ? fullChain.slice(0, 1) : fullChain;
  if (!chain.length) throw new RpcError("no_rpc_endpoints_configured", { retryable: false });

  let lastErr;
  for (const endpoint of chain) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_ENDPOINT; attempt++) {
      try {
        const result = await rpcCallOnce(endpoint.url, method, params, { timeoutMs });
        onAttempt?.({ endpointLabel: endpoint.label, attempt, ok: true });
        return { result, rpcLabel: endpoint.label };
      } catch (err) {
        lastErr = err;
        onAttempt?.({ endpointLabel: endpoint.label, attempt, ok: false, error: err.message, retryable: !!err.retryable });
        if (!err.retryable) break; // permanent — don't burn retries, try the next endpoint
        if (attempt < MAX_ATTEMPTS_PER_ENDPOINT - 1) await sleep(backoffDelay(attempt));
      }
    }
  }
  throw new RpcError(`all_rpc_endpoints_failed:${method}:${lastErr?.message || "unknown"}`, { retryable: false, cause: lastErr });
}

export async function getSignaturesForAddressRpc(address, { before, until, limit = 1000, commitment = "finalized", rpcMode, timeoutMs } = {}) {
  const opts = { limit, commitment };
  if (before) opts.before = before;
  if (until) opts.until = until;
  return rpcCall("getSignaturesForAddress", [address, opts], { rpcMode, timeoutMs });
}

export async function getTransactionRpc(signature, { commitment = "finalized", rpcMode, timeoutMs } = {}) {
  return rpcCall(
    "getTransaction",
    [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment }],
    { rpcMode, timeoutMs },
  );
}

export async function getTokenSupplyRpc(mint, { rpcMode, timeoutMs } = {}) {
  return rpcCall("getTokenSupply", [mint], { rpcMode, timeoutMs });
}
