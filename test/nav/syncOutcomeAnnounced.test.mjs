// A refusal nobody can see is indistinguishable from a bug.
//
// The OAuth callbacks redirect to wherever the person STARTED, but only
// /verify/profile.html ever rendered `?syncError=`. A real refusal came back to
// /home/ as `?syncError=already_linked` and showed the visitor nothing at all:
// they clicked Sync, went to Discord, approved, returned, and the site behaved
// as though they had never left.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const nav = readFileSync(resolve(repoRoot, "src/public/assets/nav.js"), "utf8");
const fn = nav.slice(nav.indexOf("function announceSyncOutcome"), nav.indexOf("function markActiveLinks"));
const ret = nav.slice(nav.indexOf("function currentPathForReturn"), nav.indexOf("function loadAuthProviders"));

describe("sync outcome is announced wherever it lands", () => {
  test("it runs on every page nav.js builds", () => {
    assert.match(nav, /buildSiteFooter\(\);\s*\n\s*announceSyncOutcome\(\);/);
  });

  test("it stands down on pages that render the message themselves", () => {
    assert.match(fn, /getElementById\('syncStatus'\)/,
      'the profile page owns this message; two copies is worse than one');
  });

  test("already_linked says where the account went, not just that it failed", () => {
    assert.match(fn, /already_linked/);
    assert.match(fn, /sign in to the account that/i);
  });

  test("the message is set as text, never as markup — it came from a URL", () => {
    assert.match(fn, /say\.textContent = text/);
    assert.ok(!/innerHTML/.test(fn), 'a URL-borne value must not reach innerHTML');
  });

  test("it is dismissible", () => {
    assert.match(fn, /aria-label', 'Dismiss'/);
  });

  test("the outcome leaves the address bar, so a reload does not replay it", () => {
    assert.match(fn, /replaceState/);
    assert.match(fn, /params\.delete\('syncError'\)/);
  });
});

describe("the return path does not carry credentials", () => {
  const auth = readFileSync(resolve(repoRoot, "src/public/assets/wallet-auth.js"), "utf8");

  test("one list, in wallet-auth, of what must never travel", () => {
    assert.match(auth, /NEVER_IN_A_RETURN_PATH = \['session', 'app', 'handoff', 'connect', 'synced', 'syncError'\]/,
      'the session is a bearer credential; echoing it through a round trip it plays no part in is a leak');
  });

  test("discordSignInUrl uses it — it was the second producer of the leak", () => {
    const fn = auth.slice(auth.indexOf("function discordSignInUrl"), auth.indexOf("window.WinLEWAuth = {"));
    assert.match(fn, /returnPathHere\(\)/);
    assert.ok(!/window\.location\.pathname \+ window\.location\.search/.test(fn),
      'the raw query string is exactly what carried the token');
  });

  test("nav delegates rather than keeping a second list", () => {
    assert.match(ret, /auth\?\.returnPathHere/,
      'two lists of forbidden parameters is how they drift apart');
  });

  test("the rest of the query survives", () => {
    assert.match(auth, /params\.toString\(\)/,
      'a return path that drops the tab or filter someone was on is its own bug');
  });

  test("both start calls use it", () => {
    const calls = nav.match(/next: currentPathForReturn\(\)/g) || [];
    assert.equal(calls.length, 2, 'sign-in and sync both send a return path');
    assert.ok(!/next: window\.location\.pathname \+ window\.location\.search/.test(nav),
      'the raw query string must not be sent any more');
  });
});
