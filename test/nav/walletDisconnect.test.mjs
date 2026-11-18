// Disconnecting from the site — where the control lives, and what it does.
//
// It used to live on the wallet BALANCE CHIP, because there was nowhere else to
// put it. The owner then clicked their own balance and was asked to log out:
// "when i click my balance it asks me to logout." A readout that ends your
// session, sitting between two things people click all day, is a foot-gun. It
// now lives on the account pill, which is a button and says so.
//
// Verified in a real browser during development with a REAL server session
// (a fake token gets cleared on the first 401, which made an earlier version of
// that check pass for the wrong reason): cancel leaves the session untouched,
// confirm clears local storage AND the server no longer accepts the token.
// These source-level tests pin the properties that make that true.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const nav = readFileSync(resolve(repoRoot, "src/public/assets/nav.js"), "utf8");
const fn = nav.slice(nav.indexOf("function performDisconnect"), nav.indexOf("function ensureSignInButton"));
const chip = nav.slice(nav.indexOf("function ensureWalletChip"), nav.indexOf("function performDisconnect"));

describe("wallet disconnect", () => {
  test("it revokes server-side via logout(), never just clears storage", () => {
    assert.match(fn, /auth\.logout\(\)/,
      'clearing localStorage alone leaves the token valid until its TTL — a disconnect that only hides the session');
    assert.ok(!/localStorage\.removeItem/.test(fn),
      'this must go through logout(), which revokes first, rather than reaching into storage itself');
  });

  test("it confirms before acting", () => {
    assert.match(fn, /window\.confirm\(/,
      'it sits in a row of things people click all day; a stray tap must not sign anyone out');
  });

  test("the confirmation reassures rather than warns — nothing is actually lost", () => {
    assert.match(fn, /reconnecting the same wallet/i,
      'play and rewards belong to the account on the server, and the copy should say so');
  });

  test("it does nothing when there is no session helper to call", () => {
    assert.match(fn, /typeof auth\.logout !== 'function'/,
      'a control that offers to disconnect nothing is a control that lies about its own state');
  });
});

describe("the balance chip is a readout again", () => {
  test("clicking your own balance does not sign you out", () => {
    assert.ok(!/addEventListener\('click'/.test(chip),
      'the chip must not carry a click handler — that is what made a balance a logout button');
    assert.ok(!/window\.confirm/.test(chip));
  });

  test("it no longer announces itself to assistive tech as an action", () => {
    assert.ok(!/setAttribute\('role', 'button'\)/.test(chip));
    assert.ok(!/setAttribute\('tabindex', '0'\)/.test(chip));
  });
});

describe("the account pill is where disconnect lives now", () => {
  const pill = nav.slice(nav.indexOf("function ensureSignInButton"), nav.indexOf("function setAccountPillState"));
  const states = nav.slice(nav.indexOf("function setAccountPillState"), nav.indexOf("function refineAccountPill"));

  test("three states, and disconnect is one of them", () => {
    for (const state of ["signin", "sync", "disconnect"]) {
      assert.ok(states.includes(`${state}:`), `missing the ${state} state`);
    }
  });

  test("the disconnect state acts immediately — no provider menu to wade through", () => {
    assert.match(pill, /mode === 'disconnect'.*performDisconnect\(\)/s);
  });

  test("keyboard parity comes free — it is an <a>, not a div wearing role=button", () => {
    assert.match(pill, /createElement\('a'\)/,
      'an anchor is focusable and Enter-activated by the browser, which a div is not');
  });

  test("a signed-in pill asks the server what is left before settling", () => {
    assert.match(pill, /refineAccountPill/,
      'sync is a job with an end; without this the pill offers it forever');
  });
});
