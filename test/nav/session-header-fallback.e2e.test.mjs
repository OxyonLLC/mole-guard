// The session must travel as a header, and must still work if it cannot.
//
// Content-audit register #28. `?session=` has been deleted from every API call
// site; authentication now depends on the x-winlew-session header, which only
// reaches the backend if winlew.co's hand-uploaded /verify/api-proxy.php
// forwards it. This host has served stale assets before, so hubApiFetch carries
// a fallback: a 401 on a header-carrying request is retried once with
// `?session=`, and only a SUCCESSFUL retry latches for the rest of the page.
//
// Three behaviours worth pinning, because getting any of them wrong is either a
// site-wide auth outage or a silent return to tokens-in-URLs:
//   1. proxy forwards the header  -> no retry, no token in any URL
//   2. proxy drops the header     -> one retry with ?session=, then latched
//   3. session genuinely expired  -> retried once, NOT latched
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PUBLIC_DIR = resolve(repoRoot, "src/public");
const SESSION = "V1StGXR8_Z5jdHi6B-myT";

let server;
let baseUrl;
let browser;
let chromiumAvailable = true;

before(async () => {
  const app = express();
  // A bare page that loads only wallet-auth.js and fetches nothing itself.
  // The latch and the stored session are page state, so driving them through a
  // real page means its load-time traffic has already moved both before the
  // first assertion — that is what made the first version of the latch tests
  // measure timing rather than logic. Served from the test rather than added to
  // src/public, which must not carry test fixtures.
  app.get("/__harness__/blank.html", (_req, res) => {
    res.type("html").send('<!doctype html><meta charset="utf-8"><script src="/assets/wallet-auth.js"></script>');
  });
  app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));
  await new Promise((r) => { server = app.listen(0, "127.0.0.1", r); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch();
  } catch {
    chromiumAvailable = false;
  }
});

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((r) => server.close(r));
});

/**
 * Loads /faucet/ with a session in storage and records every API request.
 * `mode` decides how the fake backend treats the header.
 */
async function open(mode, { path = "/faucet/" } = {}) {
  const page = await browser.newPage();
  const seen = [];

  await page.addInitScript((token) => {
    localStorage.setItem("winlew.verify.session", token);
    localStorage.setItem("winlew.verify.app", "mole");
  }, SESSION);

  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const hasHeader = Boolean(await req.headerValue("x-winlew-session"));
    const hasQuery = url.searchParams.has("session");
    seen.push({ path: url.pathname, hasHeader, hasQuery });

    const authed =
      mode === "header-forwarded" ? hasHeader || hasQuery
      : mode === "header-dropped" ? hasQuery      // proxy strips the header
      : false;                                    // "expired": nothing works

    if (!authed) {
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "session_expired" }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, eligible: false, claims: [], history: [] }),
    });
  });

  await page.goto(`${baseUrl}${path}`, { waitUntil: "networkidle" });
  return { page, seen };
}

async function run(mode) {
  const { page, seen } = await open(mode);
  await page.close();
  return seen;
}

describe("session header, and its deploy-safety fallback", { skip: !chromiumAvailable }, () => {
  test("when the proxy forwards the header, no token ever reaches a URL", async () => {
    const seen = await run("header-forwarded");
    assert.ok(seen.length > 0, "the page made no API calls — the harness is not exercising anything");
    assert.ok(seen.every((r) => r.hasHeader), "some request went out without the session header");
    const leaked = seen.filter((r) => r.hasQuery);
    assert.deepEqual(
      leaked.map((r) => r.path),
      [],
      "a session token reached a URL even though the header was working",
    );
  });

  test("when the proxy drops the header, the retry keeps the site working", async () => {
    const seen = await run("header-dropped");
    assert.ok(
      seen.some((r) => r.hasQuery),
      "no request ever fell back to ?session= — with the header dropped, nobody could authenticate",
    );
    // The very first call must try the clean path: falling back immediately
    // would mean the token is in URLs even on a correctly-deployed site.
    assert.equal(seen[0].hasQuery, false, "the first request used ?session= before trying the header");
  });

  // The latch has to be tested with SEQUENTIAL calls. The first version of the
  // test below used the page's own load-time requests and passed even when the
  // latch was deliberately moved onto the 401 — because /faucet/ issues its
  // calls concurrently, so every one of them starts before any 401 comes back
  // and they all look "clean" whatever the latch does. Timing, not logic. These
  // drive hubApiFetch directly, one awaited call at a time.
  async function driveSequential(mode, count) {
    const { page, seen } = await open(mode, { path: "/__harness__/blank.html" });
    assert.equal(seen.length, 0, "the harness page made API calls of its own — it must not");
    await page.evaluate(async (n) => {
      for (let i = 0; i < n; i += 1) {
        await window.WinLEWAuth.hubApiFetch(`/api/probe/${i}`);
      }
    }, count);
    await page.close();
    return seen;
  }

  test("a working header never latches the fallback on", async () => {
    const seen = await driveSequential("header-forwarded", 3);
    assert.equal(seen.length, 3, `expected 3 requests, saw ${seen.length}`);
    assert.deepEqual(seen.map((r) => r.hasQuery), [false, false, false]);
  });

  test("a dropped header latches after the first successful retry", async () => {
    const seen = await driveSequential("header-dropped", 3);
    // call 1: clean attempt 401s, retried with ?session= and succeeds -> latch
    // calls 2 and 3: go straight to ?session=, no wasted clean attempt
    assert.deepEqual(
      seen.map((r) => r.hasQuery),
      [false, true, true, true],
      "expected one clean attempt, one successful retry, then latched",
    );
  });

  test("an expired session retries once, then stops carrying the dead token", async () => {
    const seen = await driveSequential("expired", 3);
    // Call 1: clean header attempt 401s, retried with ?session= which ALSO
    // 401s. Two refusals mean the token is dead rather than the header being
    // stripped, so hubApiFetch clears it (2026-08-15 — paired 401s on
    // /api/wallet/balance were repeating on every page load from every stale
    // client, and on shared hosting those wasted proxied requests are the
    // scarce resource).
    //
    // Calls 2 and 3 therefore carry no session at all: one attempt each, no
    // retry, no token in a URL. This test previously expected six requests,
    // alternating clean/query forever. Its actual rule — an expired session
    // must never push later requests onto URL tokens — is now satisfied more
    // strongly, because there is no token left to put anywhere.
    assert.deepEqual(
      seen.map((r) => r.hasQuery),
      [false, true, false, false],
      "an expired session should retry exactly once, then stop sending the token",
    );
    assert.ok(
      seen.slice(2).every((r) => !r.hasQuery),
      "a token appeared in a URL after the session was known to be dead",
    );
  });
});
