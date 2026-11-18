// The nav's THIRD-PARTY LINKS group must never contradict /links/.
//
// Added 2026-08-11 with that group. /links/ already carries all thirteen
// external destinations; the nav carries a curated few for one-click access.
// Two lists of the same URLs is exactly how two lists drift apart — one gets a
// corrected market address and the other keeps the old one. This asserts the
// short list is a strict SUBSET of the long one, so the page stays the source
// of truth and the nav can only ever be a shortcut into it.
//
// It also pins the group order, which was changed deliberately twice (START
// HERE first on 2026-07-28; PLAY & PARTICIPATE first on 2026-08-11). Whichever
// way it points, it should point that way on purpose.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const navSource = readFileSync(resolve(repoRoot, "src/public/assets/nav.js"), "utf8");
const linksPage = readFileSync(resolve(repoRoot, "src/public/links/index.html"), "utf8");

const navGroupsBlock = (() => {
  const start = navSource.indexOf("const NAV_GROUPS = [");
  assert.notEqual(start, -1, "NAV_GROUPS not found — nav.js changed shape");
  const end = navSource.indexOf("\n  ];", start);
  assert.notEqual(end, -1, "end of NAV_GROUPS not found");
  return navSource.slice(start, end);
})();

const groupTitles = [...navGroupsBlock.matchAll(/title: '([^']+)'/g)].map((m) => m[1]);
const navExternal = [...navGroupsBlock.matchAll(/path: '(https?:\/\/[^']+)'/g)].map((m) => m[1]);

test("the nav parsed sanely", () => {
  // Guard the guard: an empty parse would make everything below vacuous.
  assert.ok(groupTitles.length >= 6, `only parsed ${groupTitles.length} groups`);
  assert.ok(navExternal.length >= 5, `only parsed ${navExternal.length} external nav links`);
});

describe("THIRD-PARTY LINKS cannot contradict /links/", () => {
  test("every external URL in the nav also appears on /links/", () => {
    // Compared with HTML entities decoded — /links/ writes &amp; in href
    // attributes, the nav writes a raw &, and the same URL must not look
    // different just because of where it is written.
    const page = linksPage.replace(/&amp;/g, "&");
    const missing = navExternal.filter((u) => !page.includes(u.replace(/&amp;/g, "&")));
    assert.deepEqual(
      missing,
      [],
      `These URLs are in the nav but not on /links/:\n  ${missing.join("\n  ")}\n` +
        `/links/ is the source of truth for external destinations; the nav is a shortcut ` +
        `into it. Add them there first, or correct the nav.`
    );
  });

  test("the group exists and points at the full list", () => {
    assert.ok(groupTitles.includes("THIRD-PARTY LINKS"), "the THIRD-PARTY LINKS group is gone");
    assert.match(
      navGroupsBlock,
      /All external links', path: '\/links\/'/,
      "the group must link to /links/ for the destinations it does not carry."
    );
  });

  test("/links/ is listed exactly once in the whole nav", () => {
    // It used to sit in START HERE as well. One menu, one entry.
    const count = (navGroupsBlock.match(/path: '\/links\/'/g) || []).length;
    assert.equal(count, 1, `/links/ appears ${count} times in NAV_GROUPS — duplication, not discoverability.`);
  });
});

test("group order is what was last decided", () => {
  // Not a style preference: this order was argued three times. If it changes,
  // that should be a decision someone makes, not something a refactor does.
  //
  // 2026-07-28: orientation first (START HERE, then play).
  // 2026-08-11: reversed by the owner — almost everyone arriving already knows
  //   what WinLEW is and came to do something. START HERE -> LEARN & CONNECT,
  //   because it was no longer where anyone starts.
  // 2026-08-21: the first four groups rebuilt around visitor intent. PLAY &
  //   PARTICIPATE -> PLAY & EARN (the column now holds the faucet, HODL
  //   Rewards and the airdrop registry, not just games) and EXPLORE & BUILD ->
  //   BUILD & CONTRIBUTE. LEARN & CONNECT kept its name: the wallet and reward
  //   links that made it inaccurate moved out, so it now describes itself.
  assert.deepEqual(groupTitles.slice(0, 4),
    ["PLAY & EARN", "LEARN & CONNECT", "TRUST & TRANSPARENCY", "BUILD & CONTRIBUTE"],
    "The first four group names/order changed. Change it deliberately or not at all.");
  // 2026-10-03: BEYOND WINLEW renamed OXYON by the owner (same group, same
  // place, same items); the ordering rule is unchanged.
  assert.ok(groupTitles.indexOf("THIRD-PARTY LINKS") < groupTitles.indexOf("OXYON"),
    "THIRD-PARTY LINKS should sit above OXYON.");
});

test("Contact comes before Who We Are", () => {
  // Owner request 2026-08-11: someone looking for a way to reach the project is
  // trying to do something; someone reading Who We Are is browsing.
  const contact = navGroupsBlock.indexOf("path: '/contact/'");
  const who = navGroupsBlock.indexOf("path: '/who-we-are/'");
  assert.ok(contact !== -1 && who !== -1, "Contact or Who We Are is missing from the nav");
  assert.ok(contact < who, "Who We Are moved back above Contact.");
});

test("the primary nav pill leads to the hub, not back to the landing page", () => {
  // 2026-08-11. This pill was { label: 'Home', path: '/' } on 25 entries, which
  // duplicated the brand logo (already href="/") and spent the most valuable
  // slot in the nav on a page the visitor could already reach — while /home/,
  // the 85 KB page that actually shows what has been built, appeared only as one
  // row of the mega-menu. The owner's words: "home isn't on it once, and the
  // home link that is, circles back to the landing page."
  //
  // Reads NAV_SETS, not PAGE_CONFIGS. The first version of this test sliced
  // PAGE_CONFIGS — which does not contain the pills at all — so it failed even
  // against correct code. A guard pointed at the wrong region is the same defect
  // as a guard that matches too much; both stop describing reality.
  const start = navSource.indexOf("const NAV_SETS = {");
  assert.notEqual(start, -1, "NAV_SETS not found — nav.js changed shape");
  const rawEnd = navSource.indexOf("\n  };", start);
  assert.notEqual(rawEnd, -1, "end of NAV_SETS not found — check its indentation");

  // Comments stripped before matching. The explanatory comment ABOVE NAV_SETS
  // quotes the old `{ label: 'Home', path: '/' }` as the record of what was
  // changed, and an earlier version of this test matched that comment and failed
  // against correct code. Judge the code, never the prose describing it.
  const body = navSource.slice(start, rawEnd).replace(/^\s*\/\/.*$/gm, " ");

  assert.equal(
    (body.match(/label: 'Home', path: '\/' \}/g) || []).length,
    0,
    "A primary nav pill labelled 'Home' points at '/'. The logo already goes there; " +
      "this slot should lead to /home/."
  );
  // Resolve the constant before matching. The 26 literal '/home/' paths became
  // `path: HUB_PATH` on 2026-08-15 so the hub has one definition; a parser that
  // only knows the literal then reported ZERO hub pills against code that had
  // more of them than before. Same trap as navRouteCoverage's ABOUT_PATH — a
  // guard has to read the code the way the code is written.
  const hubPath = navSource.match(/const HUB_PATH = '([^']+)'/);
  assert.ok(hubPath, "HUB_PATH constant not found — nav.js changed shape");
  assert.equal(hubPath[1], "/home/", "HUB_PATH no longer points at the hub");

  const hubs = (body.match(/label: 'Hub', path: (?:HUB_PATH|'\/home\/')\s*\}/g) || []).length;
  assert.ok(hubs >= 20, `only ${hubs} nav sets point 'Hub' at the hub — expected every set to.`);

  // Quiz, Faucet and Mole Hub lost their Hub pill to a nav trim and had no way
  // back to /home/ except the logo — the pages people spend the most time on.
  // Restored 2026-08-15 on the owner's report that "/home/ has once again been
  // hidden". Named explicitly because a trim is exactly how they vanish.
  const setsStart = navSource.indexOf("const NAV_SETS = {");
  for (const name of ["quiz", "faucet", "moleHub"]) {
    const at = navSource.indexOf(`\n    ${name}: [`, setsStart);
    assert.notEqual(at, -1, `NAV_SETS.${name} not found`);
    const set = navSource.slice(at, navSource.indexOf("],", at));
    assert.match(set, /id: 'home'/, `NAV_SETS.${name} has no way back to the hub`);
  }
});

// The standalone DexScreener chart link must point at the RAYDIUM pool.
//
// DexScreener hides a pair once its volume reaches zero. Verified 2026-08-12
// against three of its endpoints — token-pairs/v1, latest/dex/tokens and
// search — all of which returned zero pairs for the WinLEW mint while
// GeckoTerminal still listed all three pools. With 24h volume at $0 everywhere,
// DexScreener's page for the primary PumpSwap pool renders "no pair found"; its
// page for the older Raydium pool still draws. The owner confirmed both from a
// real browser, which this machine cannot do — dexscreener.com returns
// Cloudflare 403 to every request from here.
//
// So the generic "see the chart" links deliberately point somewhere other than
// the primary market, and that looks like a mistake to anyone tidying up. It
// is not. Market-SPECIFIC links (the per-pool cards on /home/ and
// /transparency/, which print a pair address and link it) still point at their
// own pool and are not covered here — sending those elsewhere would contradict
// the address printed beside them.
test("the generic DexScreener chart link points at the pool that renders", () => {
  const RAYDIUM = "5nTz6Cq7U54TArLEFMgFUatcZXh5NG9BVrecqMrJ92Lx";
  const PRIMARY = "Hmif58VXfzzjHmWnX7dDcRh6MKwoz5cTw676HbvSgFtL";

  const navChart = navGroupsBlock.match(
    /label: 'Chart — DexScreener[^']*', path: 'https:\/\/dexscreener\.com\/solana\/([1-9A-HJ-NP-Za-km-z]+)'/,
  );
  assert.ok(navChart, "no DexScreener chart entry found in NAV_GROUPS");
  assert.equal(
    navChart[1],
    RAYDIUM,
    `The nav's DexScreener chart points at ${navChart[1]}. It must be the Raydium ` +
      `pool ${RAYDIUM}; ${PRIMARY} renders "no pair found" at zero volume.`,
  );

  // /links/ is the page the nav is a shortcut into, so the two must agree — the
  // subset assertion above would pass if BOTH regressed together.
  assert.ok(
    linksPage.includes(`https://dexscreener.com/solana/${RAYDIUM}`),
    "/links/ no longer offers the Raydium DexScreener chart",
  );
  assert.ok(
    !linksPage.includes(`https://dexscreener.com/solana/${PRIMARY}`),
    "/links/ links DexScreener's primary-pool page, which renders \"no pair found\" at zero volume",
  );
});
