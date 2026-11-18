// The governance thresholds are stated in prose on several public pages and
// enforced from one place. They have moved twice — 1 → 1,000,000 on
// 2026-07-17, then split in two on 2026-08-06 — so they are exactly the kind
// of figure that goes stale on a page while the code moves on.
//
// This file replaces an earlier version that checked the OLD single-gate rule.
// That version did not fail when the gate was split; it started passing
// vacuously, because the free-vote floor became "1" and `html.includes("1")`
// is true of almost any page. A test that cannot fail is worse than no test,
// so the assertions below are written to be specific about which number means
// what, and there is a guard test proving the check still has teeth.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { GOVERNANCE_CONFIG } from "../../src/mole/governanceData.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => readFileSync(resolve(repoRoot, p), "utf8");

// Comments quote the old wording deliberately as the record of what changed.
const prose = (s) => s.replace(/<!--[\s\S]*?-->/g, " ").replace(/\s+/g, " ");

// Tag-stripped rendered text, for matching phrases a reader actually sees.
// The banned-pattern test below deliberately keeps the RAW html instead, since
// one of its patterns anchors on <strong> markup.
const text = (s) =>
  s.replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const PAGES = {
  "/governance/": prose(read("src/public/governance/index.html")),
  "/governance/rules/": prose(read("src/public/governance/rules/index.html")),
  "/no-thank-you/promotions/": prose(read("src/public/no-thank-you/promotions/index.html")),
};

const purchaseFloor = Number(GOVERNANCE_CONFIG.minWinlewToPurchaseVotes).toLocaleString("en-US");

test("the purchase floor is published wherever the rules are explained", () => {
  for (const [name, html] of Object.entries(PAGES)) {
    assert.ok(
      html.includes(purchaseFloor),
      `${name} does not state the ${purchaseFloor} WinLEW floor for buying extra vote weight.`
    );
  }
});

test("no page claims you need the purchase floor merely to vote", () => {
  // The regression that prompted the 2026-08-06 split: between 2026-07-17 and
  // then, 1,000,000 really was required to vote at all. Now it is not, and a
  // page still saying so would turn away exactly the small holders the free
  // vote exists to include.
  const banned = [
    /you need a[^.]{0,40}verified wallet[^.]{0,40}holding at least 1,000,000/i,
    /Voting needs a verified wallet holding at least 1,000,000/i,
    /holds at least <strong[^>]*>1,000,000<\/strong> WinLEW —? ?(?:raised|Not cheap)/i,
  ];
  for (const [name, html] of Object.entries(PAGES)) {
    for (const pattern of banned) {
      assert.ok(
        !pattern.test(html),
        `${name} still says the ${purchaseFloor} floor is required to vote. Since 2026-08-06 that ` +
          `figure gates BUYING EXTRA WEIGHT; the free vote needs only a verified wallet.`
      );
    }
  }
});

test("the free vote is described as earned by verifying", () => {
  // /no-thank-you/promotions/ is where this was wrong in the other direction
  // before the split — it promised a vote for verifying while the code demanded
  // a million tokens. That promise is true again and should be stated.
  assert.match(
    text(read("src/public/no-thank-you/promotions/index.html")),
    /Verify your wallet\s+and you get a vote/i,
    "The promotions page should say verifying earns a vote — that is what the code now does."
  );
});

test("guard: these checks can actually fail", () => {
  // Proves the assertions above are not vacuous. If the banned patterns stopped
  // matching their own known-bad text, the test above would pass on any page.
  const knownBad = "you need a <a>verified wallet</a> holding at least 1,000,000 WinLEW.";
  const pattern = /you need a[^.]{0,40}verified wallet[^.]{0,40}holding at least 1,000,000/i;
  assert.ok(pattern.test(knownBad), "the banned-phrase pattern no longer matches the wording it was written for");
  assert.ok(purchaseFloor.length > 3, `purchaseFloor "${purchaseFloor}" is too short to be a meaningful substring check`);
});
