// Sign in / sync with X — the parts that can be tested without an X app.
//
// The feature is dormant until X_CLIENT_ID, X_CLIENT_SECRET and X_REDIRECT_URI
// all exist. What IS testable now is the shape of the flow, and PKCE is the part
// worth pinning: X requires it, and a wrong challenge fails at the very last
// step of a multi-redirect journey, where it is hardest to debug.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  isXOAuthConfigured, createPkcePair, buildXAuthorizeUrl,
  exchangeXCode, fetchXUser, X_SCOPES,
} from "../../src/mole/xOAuth.js";

const FULL = { X_CLIENT_ID: "cid", X_CLIENT_SECRET: "secret", X_REDIRECT_URI: "https://tunnel.example/x-oauth-callback" };

describe("dormant until fully configured", () => {
  test("nothing set is not configured", () => {
    assert.equal(isXOAuthConfigured({}), false);
  });

  test("a partial configuration is NOT configured", () => {
    // Half-configured must read as off. Advertising X as available and then
    // failing at the token exchange is worse than saying "coming soon".
    assert.equal(isXOAuthConfigured({ X_CLIENT_ID: "cid" }), false);
    assert.equal(isXOAuthConfigured({ X_CLIENT_ID: "cid", X_CLIENT_SECRET: "s" }), false, "no redirect uri");
    assert.equal(isXOAuthConfigured({ X_CLIENT_SECRET: "s", X_REDIRECT_URI: "u" }), false, "no client id");
  });

  test("all three set is configured", () => {
    assert.equal(isXOAuthConfigured(FULL), true);
  });

  test("building an authorize URL without config throws rather than half-working", () => {
    assert.throws(() => buildXAuthorizeUrl({ state: "s", challenge: "c", env: {} }), /x_oauth_not_configured/);
  });
});

describe("PKCE", () => {
  test("the challenge really is S256 of the verifier", () => {
    const { verifier, challenge } = createPkcePair();
    assert.equal(crypto.createHash("sha256").update(verifier).digest("base64url"), challenge);
  });

  test("the verifier length is inside X's 43-128 range", () => {
    assert.ok(createPkcePair().verifier.length >= 43);
    assert.ok(createPkcePair().verifier.length <= 128);
  });

  test("each pair is unique — a reused verifier would defeat the point", () => {
    const seen = new Set(Array.from({ length: 50 }, () => createPkcePair().verifier));
    assert.equal(seen.size, 50);
  });

  test("the authorize URL carries the challenge and declares S256", () => {
    const url = new URL(buildXAuthorizeUrl({ state: "st8", challenge: "chal", env: FULL }));
    assert.equal(url.origin + url.pathname, "https://x.com/i/oauth2/authorize");
    assert.equal(url.searchParams.get("code_challenge"), "chal");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("state"), "st8");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("redirect_uri"), FULL.X_REDIRECT_URI);
  });

  test("the verifier is never put in the authorize URL", () => {
    const { verifier, challenge } = createPkcePair();
    const url = buildXAuthorizeUrl({ state: "s", challenge, env: FULL });
    assert.ok(!url.includes(verifier), 'sending the verifier to the browser would make PKCE decorative');
  });
});

describe("scopes are the minimum that works", () => {
  test("users.read and tweet.read, and no durable access", () => {
    assert.deepEqual(X_SCOPES, ["users.read", "tweet.read"]);
    assert.ok(!X_SCOPES.includes("offline.access"),
      'a refresh token would be a credential to look after for a flow that reads an id once');
    assert.ok(!X_SCOPES.some((s) => /write/.test(s)), 'this must never be able to act on anyone\'s behalf');
  });
});

describe("token exchange", () => {
  test("it sends Basic auth AND the client_id in the body — X needs both", async () => {
    let seen;
    await exchangeXCode({
      code: "abc", verifier: "v", env: FULL,
      fetchImpl: async (url, init) => { seen = { url, init }; return { ok: true, text: async () => '{"access_token":"t"}' }; },
    });
    assert.equal(seen.url, "https://api.x.com/2/oauth2/token");
    assert.match(seen.init.headers.Authorization, /^Basic /);
    assert.equal(Buffer.from(seen.init.headers.Authorization.slice(6), "base64").toString(), "cid:secret");
    const body = new URLSearchParams(seen.init.body.toString());
    assert.equal(body.get("client_id"), "cid", 'sending only Basic auth is the usual cause of an opaque 401');
    assert.equal(body.get("code_verifier"), "v");
    assert.equal(body.get("grant_type"), "authorization_code");
  });

  test("a failure carries the status, and is truncated", async () => {
    await assert.rejects(
      () => exchangeXCode({
        code: "abc", verifier: "v", env: FULL,
        fetchImpl: async () => ({ ok: false, status: 401, text: async () => "x".repeat(5000) }),
      }),
      (error) => /x_token_exchange_failed:401:/.test(error.message) && error.message.length < 300,
    );
  });
});

describe("the identity taken from X is the ID, not the handle", () => {
  test("it reads data.id", async () => {
    const user = await fetchXUser({
      accessToken: "t",
      fetchImpl: async () => ({ ok: true, text: async () => '{"data":{"id":"1699","username":"someone"}}' }),
    });
    assert.equal(user.id, "1699");
    assert.equal(user.username, "someone");
  });

  test("a response with no id is an error, never an empty sync", async () => {
    // Syncing "" would attach an identity nobody owns, and the next empty
    // response would collide with it.
    await assert.rejects(
      () => fetchXUser({ accessToken: "t", fetchImpl: async () => ({ ok: true, text: async () => '{"data":{}}' }) }),
      /x_me_no_id/,
    );
  });
});
