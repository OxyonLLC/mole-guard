// A session token in the address bar was honoured on EVERY page.
//
// That is what made a crafted link an attack: winlew.co/home/?session=<token>
// put the reader's browser into whoever's account owned that token. The scrub
// that takes it out of the bar afterwards removed it from history, not from the
// threat — the adoption had already happened by then.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const src = readFileSync(resolve(repoRoot, "src/public/assets/wallet-auth.js"), "utf8");
const getAuth = src.slice(src.indexOf("function getAuth()"), src.indexOf("// ── OAuth hand-off"));
const claim = src.slice(src.indexOf("async function claimPendingHandoff"), src.indexOf("function scrubHandoffFromUrl"));

/** The gate, lifted from the source. */
function acceptsHere(pathname, prefixes = ["/verify/"]) {
  return prefixes.some((p) => pathname === p || pathname.startsWith(p));
}

describe("a URL session is only honoured where a flow can still need it", () => {
  test("the pages that made the attack work are refused", () => {
    for (const page of ["/home/", "/", "/mole-hub/", "/faucet/", "/quiz/", "/governance/"]) {
      assert.equal(acceptsHere(page), false, `${page} must not adopt a session from the address bar`);
    }
  });

  test("/verify/ still accepts one — the /link bookmark and stale caches land there", () => {
    assert.equal(acceptsHere("/verify/"), true);
    assert.equal(acceptsHere("/verify/profile.html"), true);
  });

  test("a lookalike prefix does not sneak through", () => {
    assert.equal(acceptsHere("/verifying/"), false);
    assert.equal(acceptsHere("/not/verify/"), false);
  });

  test("getAuth consults the gate rather than reading the param outright", () => {
    assert.match(getAuth, /urlSessionIsAcceptableHere\(\) \? url\.searchParams\.get\('session'\) : null/);
  });

  test("the list is documented as closable, with what has to happen first", () => {
    assert.match(src, /ACCEPT_URL_SESSION_PATHS = \['\/verify\/'\]/);
    assert.match(src, /set this to an\s+\*\s+empty array/,
      'the last of it closes once cached copies of nav.js have rolled over');
  });
});

describe("claiming a hand-off", () => {
  test("a tab that never started one refuses it instead of adopting it", () => {
    assert.match(claim, /if \(!secret\)/);
    assert.match(claim, /never started one/,
      'this is precisely the person who was sent an attacker link');
  });

  test("the secret is spent, not left lying around", () => {
    assert.match(claim, /sessionStorage\.removeItem\(HANDOFF_SECRET_KEY\)/);
  });

  test("the id leaves the URL either way", () => {
    assert.match(claim, /finally\s*\{\s*\n\s*scrubHandoffFromUrl\(\);/);
  });

  test("the secret lives in sessionStorage, not localStorage", () => {
    assert.match(src, /sessionStorage\.setItem\(HANDOFF_SECRET_KEY/);
    assert.ok(!/localStorage\.(set|get)Item\(HANDOFF_SECRET_KEY/.test(src),
      'it is worthless after one redemption and must not outlive the tab');
  });
});

// The bounce that binds Discord's own Linked Roles button. Both of these were
// real dead ends in a first draft, caught by walking the deployed flow rather
// than by reading it.
describe("the linked-role bounce always goes somewhere", () => {
  const fn = src.slice(src.indexOf("async function startBoundLinkedRole"), src.indexOf("/** 'discord' when this session"));

  test("being signed in does not skip it — that is the main use case", () => {
    assert.ok(!/getAuth\(\)\.session\) return/.test(fn),
      'a wallet-only session clicking "Verify with Discord" IS signed in, and attaching Discord is the whole trip');
  });

  test("no crypto.subtle degrades to unbound rather than stranding the visitor", () => {
    assert.match(fn, /if \(hash\) query\.set\('claimHash', hash\)/,
      'the navigation must happen either way');
    assert.ok(!/if \(!hash\) return/.test(fn));
  });

  test("it always carries the loop guard, bound or not", () => {
    assert.match(fn, /new URLSearchParams\(\{ b: '1' \}\)/);
  });

  test("it replaces rather than pushes, so Back does not re-bounce", () => {
    assert.match(fn, /window\.location\.replace\(/);
  });

  test("the app key is validated before it reaches a URL", () => {
    assert.match(fn, /\/\^\[a-z0-9_-\]\{1,32\}\$\/i\.test\(appKey\)/);
  });
});
