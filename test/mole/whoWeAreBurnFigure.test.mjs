// /who-we-are/ is a static page with no API calls, and it quotes the lifetime
// burn total in prose. That figure moves every time a burn executes, so it goes
// stale silently.
//
// It had: the page said "34.8M+" while burnEvents.js, /burn/ and the whitepaper
// all reported ~49.71M. 34.83M plus the 2026-08-01 burn of 14,878,231.210253 is
// exactly 49,707,077.187484 — the line was simply never updated after that
// burn, understating the project's own record by ~15M.
//
// This test compares the page's rounded claim against the canonical ledger, so
// the next burn fails the suite instead of quietly leaving the page wrong.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { summarizeBurnEvents } from "../../src/mole/burnEvents.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const html = readFileSync(resolve(repoRoot, "src/public/who-we-are/index.html"), "utf8");
// Comments legitimately quote the old wrong figure as the record of the fix.
const prose = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const summary = summarizeBurnEvents();
const confirmed = Number(summary.confirmedBurnedBaseUnits) / 1e6; // 6 decimals

test("the burn ledger is readable", () => {
  assert.ok(confirmed > 1_000_000, `confirmed burn total looks wrong: ${confirmed}`);
});

test("/who-we-are/ quotes a burn total that matches the ledger", () => {
  const claimed = prose.match(/([\d.]+)M\+?\s+WinLEW\s+as of/i);
  assert.ok(claimed, '/who-we-are/ no longer states a burn total in the expected "NN.NM+ WinLEW as of …" form');

  const claimedMillions = Number(claimed[1]);
  const actualMillions = confirmed / 1e6;
  // The page rounds to one decimal and says "+", so it must not overstate and
  // must not trail the real figure by more than a rounding step.
  assert.ok(
    claimedMillions <= actualMillions + 0.05,
    `/who-we-are/ claims ${claimedMillions}M burned but the ledger has ${actualMillions.toFixed(6)}M — never overstate.`
  );
  assert.ok(
    claimedMillions >= actualMillions - 0.1,
    `/who-we-are/ claims ${claimedMillions}M burned but the ledger has ${actualMillions.toFixed(2)}M. ` +
      `A burn has executed since this page was written — update the figure.`
  );
});

test("the 100M target and renounced-authority claims are still stated", () => {
  assert.match(prose, /100M target/i, "the public burn target should stay on the page");
  assert.match(prose, /Mint authority is renounced/i,
    "the renounced mint authority is this page's strongest verifiable claim — verified on-chain 2026-08-05");
});
