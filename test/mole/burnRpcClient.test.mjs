// RPC-fallback client for the backup burn scanner — tests the retry/
// backoff/fallback logic against a mocked global.fetch. Never touches a
// real network call; SOLANA_RPC is set to a placeholder before import so
// this suite has zero dependency on live credentials.
// Set BEFORE loading dotenv/config: dotenv's default (non-override) load
// never clobbers an already-set process.env value, so this wins over
// whatever real SOLANA_RPC the local .env has, and getConfig() still
// validates successfully against every other required var .env provides.
process.env.SOLANA_RPC = "https://example-primary-rpc.invalid";
process.env.SOLANA_RPC_FALLBACK = "https://example-fallback-rpc.invalid";
import "dotenv/config";

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { rpcCall, buildRpcChain, RPC_LABELS, PUBLIC_RPC_URL } from "../../src/mole/evidence/solanaRpcClient.js";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

function jsonResponse(body, { status = 200 } = {}) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

describe("buildRpcChain: ordering and secret safety", () => {
  test("orders primary, then configured fallback, then the public endpoint", () => {
    const chain = buildRpcChain();
    assert.equal(chain[0].label, RPC_LABELS.PRIMARY);
    assert.equal(chain[0].url, "https://example-primary-rpc.invalid");
    assert.equal(chain[1].label, RPC_LABELS.FALLBACK);
    assert.equal(chain[2].label, RPC_LABELS.PUBLIC);
    assert.equal(chain[2].url, PUBLIC_RPC_URL);
  });

  test("de-duplicates identical URLs instead of hitting the same host twice", () => {
    process.env.SOLANA_RPC_FALLBACK = "https://example-primary-rpc.invalid"; // same as primary
    const chain = buildRpcChain();
    assert.equal(chain.length, 2); // primary + public only, fallback collapsed
    process.env.SOLANA_RPC_FALLBACK = "https://example-fallback-rpc.invalid"; // restore for other tests
  });

  test("provider labels never contain a URL, host, or query string", () => {
    for (const label of Object.values(RPC_LABELS)) {
      assert.doesNotMatch(label, /https?:\/\//);
      assert.doesNotMatch(label, /[?&]/);
    }
  });
});

describe("rpcCall: retry and fallback behavior", () => {
  test("retries a 429 on the same endpoint with backoff before succeeding", async () => {
    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      if (calls < 3) return jsonResponse({}, { status: 429 });
      return jsonResponse({ jsonrpc: "2.0", id: 1, result: { ok: true } });
    };
    const { result, rpcLabel } = await rpcCall("getSignaturesForAddress", ["addr"]);
    assert.deepEqual(result, { ok: true });
    assert.equal(rpcLabel, RPC_LABELS.PRIMARY);
    assert.equal(calls, 3);
  });

  test("fails over from the primary to the fallback endpoint on a permanent error", async () => {
    const urlsHit = [];
    global.fetch = async (url) => {
      urlsHit.push(url);
      if (url.includes("primary")) return jsonResponse({}, { status: 400 }); // permanent — must not retry primary
      return jsonResponse({ jsonrpc: "2.0", id: 1, result: "from-fallback" });
    };
    const { result, rpcLabel } = await rpcCall("getTransaction", ["sig"]);
    assert.equal(result, "from-fallback");
    assert.equal(rpcLabel, RPC_LABELS.FALLBACK);
    // exactly one attempt against primary (permanent error = no retry), then fallback answers
    assert.equal(urlsHit.filter((u) => u.includes("primary")).length, 1);
  });

  test("falls through all the way to the public endpoint if both configured endpoints fail", async () => {
    global.fetch = async (url) => {
      if (url.includes("primary") || url.includes("fallback")) return jsonResponse({}, { status: 500 });
      return jsonResponse({ jsonrpc: "2.0", id: 1, result: "from-public" });
    };
    const { result, rpcLabel } = await rpcCall("getTokenSupply", ["mint"]);
    assert.equal(result, "from-public");
    assert.equal(rpcLabel, RPC_LABELS.PUBLIC);
  });

  test("a JSON-RPC error response throws and is classified by error code", async () => {
    global.fetch = async () => jsonResponse({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "invalid params" } });
    await assert.rejects(() => rpcCall("getTransaction", ["bad"], { rpcMode: "primary" }), /jsonrpc_error/);
  });

  test("rpcMode: 'primary' never falls through to other endpoints", async () => {
    let fetchCalls = 0;
    global.fetch = async () => { fetchCalls += 1; return jsonResponse({}, { status: 500 }); };
    await assert.rejects(() => rpcCall("getTransaction", ["sig"], { rpcMode: "primary" }));
    // 3 retries against primary only, never touches fallback/public
    assert.equal(fetchCalls, 3);
  });

  test("never includes the RPC URL or any credential-shaped string in the thrown error message", async () => {
    process.env.SOLANA_RPC = "https://paid-provider.example/rpc?api-key=super-secret-value";
    global.fetch = async () => jsonResponse({}, { status: 500 });
    try {
      await rpcCall("getTransaction", ["sig"], { rpcMode: "primary" });
      assert.fail("expected rpcCall to throw");
    } catch (err) {
      assert.doesNotMatch(err.message, /super-secret-value/);
      assert.doesNotMatch(err.message, /api-key/);
      assert.doesNotMatch(err.message, /https?:\/\//);
    } finally {
      process.env.SOLANA_RPC = "https://example-primary-rpc.invalid";
    }
  });

  test("a network failure (fetch throws) is treated as retryable, not permanent", async () => {
    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      if (calls < 2) throw new Error("ECONNRESET");
      return jsonResponse({ jsonrpc: "2.0", id: 1, result: "recovered" });
    };
    const { result } = await rpcCall("getTransaction", ["sig"], { rpcMode: "primary" });
    assert.equal(result, "recovered");
    assert.ok(calls >= 2);
  });
});
