// Covers src/mole/logRedaction.js — keeping credentials out of the request log.
//
// The bug: `app.use(morgan("dev"))` logs `:url`, which is req.originalUrl —
// path AND query string. Twenty-plus authenticated GET routes take their
// session token as ?session=…, and pm2 writes the process's stdout to
// logs/<service>.out.log. So every authenticated GET wrote a live session token
// to a file on disk.
//
// This is the third instance of one class found in as many days: the token
// reaching somewhere it was never meant to go. The first two went to Phantom's
// servers. This one is the most durable, because a log file outlives the session
// it records and gets copied around.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { redactUrl, installMorganRedaction, REDACTED, SENSITIVE_QUERY_KEYS } from "../../src/mole/logRedaction.js";

const TOKEN = "V1StGXR8Z5jdHi6BmyT_live_session_do_not_log";

describe("redactUrl: the credentials that were being logged", () => {
  test("hides a session token but keeps the shape of the request", () => {
    const out = redactUrl(`/api/merch/discount?session=${TOKEN}`);
    assert.ok(!out.includes(TOKEN), `token survived: ${out}`);
    // The key stays, so a log still shows the request WAS authenticated — which
    // is the part that is useful when reading a trace.
    assert.equal(out, `/api/merch/discount?session=${REDACTED}`);
  });

  test("covers every real caller found in src/public", () => {
    // Each of these is a live call site that was logging a token.
    const realCalls = [
      "/api/faucet/status?session=",
      "/api/faucet/history?session=",
      "/api/wallet/balance?session=",
      "/api/merch/discount?session=",
      "/api/merch/orders?session=",
      "/api/governance/eligibility/gov-launch-2026?session=",
      "/api/governance/my-vote/gov-launch-2026?session=",
      "/api/governance/submissions/mine?session=",
      "/api/faucet/claim/abc123?session=",
    ];
    for (const base of realCalls) {
      const out = redactUrl(base + TOKEN);
      assert.ok(!out.includes(TOKEN), `token survived on ${base}`);
    }
  });

  test("redacts every sensitive key, not just session", () => {
    for (const key of SENSITIVE_QUERY_KEYS) {
      const out = redactUrl(`/x?${key}=${TOKEN}`);
      assert.ok(!out.includes(TOKEN), `${key} was not redacted`);
    }
  });

  test("matches case-insensitively and by substring", () => {
    for (const key of ["SESSION", "Session", "claimSecret", "claim_secret", "pairingCode", "accessToken", "X-Api-Key"]) {
      const out = redactUrl(`/x?${key}=${TOKEN}`);
      assert.ok(!out.includes(TOKEN), `${key} leaked: ${out}`);
    }
  });

  test("the hand-off id is treated as a credential", () => {
    // A DIRECT hand-off redeems on the id alone for its two-minute life.
    const out = redactUrl("/verify/?h=handoffid_aaaaaaaaaaaaaaaaaaaaaa");
    assert.ok(!out.includes("handoffid_aaaaaaaaaaaaaaaaaaaaaa"), out);
  });
});

describe("redactUrl: leaves everything else alone", () => {
  test("a URL with no query string is untouched", () => {
    assert.equal(redactUrl("/api/health/status"), "/api/health/status");
    assert.equal(redactUrl("/"), "/");
    assert.equal(redactUrl(""), "");
  });

  test("non-sensitive parameters survive verbatim", () => {
    // A log that redacts everything is a log nobody can debug with.
    assert.equal(redactUrl("/api/quiz/play/next?sponsor=xyo"), "/api/quiz/play/next?sponsor=xyo");
    assert.equal(redactUrl("/x?page=2&limit=50"), "/x?page=2&limit=50");
  });

  test("mixed parameters redact only the sensitive one, in place", () => {
    const out = redactUrl(`/x?app=mole&session=${TOKEN}&limit=10`);
    assert.equal(out, `/x?app=mole&session=${REDACTED}&limit=10`);
  });

  test("the path and parameter order are preserved exactly", () => {
    // String-based rather than URL round-tripping on purpose: re-encoding makes
    // the log disagree with what was actually requested.
    const out = redactUrl(`/api/faucet/claim/AbC-123_x?session=${TOKEN}&t=1699999999`);
    assert.ok(out.startsWith("/api/faucet/claim/AbC-123_x?session="));
    assert.ok(out.endsWith("&t=1699999999"));
  });
});

describe("redactUrl: hostile and malformed input", () => {
  test("never throws, whatever it is given", () => {
    for (const input of [null, undefined, "", "?", "??", "/x?", "/x?&&&", "/x?=", "/x?session", "%%%", "/x?a=%E0%A4%A", 12345, {}, []]) {
      assert.doesNotThrow(() => redactUrl(input), `threw on ${String(input)}`);
    }
  });

  test("a bare valueless sensitive key is still redacted", () => {
    assert.equal(redactUrl("/x?session"), `/x?session=${REDACTED}`);
  });

  test("a token hidden in a fragment does not survive", () => {
    const out = redactUrl(`/x?session=${TOKEN}#frag`);
    assert.ok(!out.includes(TOKEN), out);
    assert.ok(out.endsWith("#frag"), out);
  });

  test("a repeated sensitive key is redacted every time", () => {
    const out = redactUrl(`/x?session=${TOKEN}&session=${TOKEN}`);
    assert.equal(out.includes(TOKEN), false, out);
  });
});

describe("installMorganRedaction", () => {
  test("overrides the built-in url token so every format is covered", () => {
    // A bespoke :safeUrl token would protect only the one format someone
    // remembered to change. "dev", "combined" and anything chosen later all
    // resolve :url.
    const registered = {};
    const fakeMorgan = { token: (name, fn) => { registered[name] = fn; } };
    installMorganRedaction(fakeMorgan);
    assert.ok(typeof registered.url === "function", "the built-in :url token was not overridden");

    const logged = registered.url({ originalUrl: `/api/wallet/balance?session=${TOKEN}` });
    assert.ok(!logged.includes(TOKEN), `morgan would log the token: ${logged}`);
  });

  test("falls back to req.url when originalUrl is absent", () => {
    const registered = {};
    installMorganRedaction({ token: (name, fn) => { registered[name] = fn; } });
    const logged = registered.url({ url: `/x?session=${TOKEN}` });
    assert.ok(!logged.includes(TOKEN), logged);
    assert.equal(registered.url({}), "");
  });
});
