// The governance gate is split in two (2026-08-06):
//
//   minWinlewToVote          — the FREE vote. Any verified wallet with a real
//                              balance gets exactly one. This is the incentive
//                              to verify, and it is the whole of
//                              "one-wallet-one-vote".
//   minWinlewToPurchaseVotes — buying weight ON TOP of that free vote.
//
// Why it exists: the bar was 1 until 2026-07-17, so "verify your wallet and
// you get a free vote" was true and worked as intended. Raising it to
// 1,000,000 made the bar meaningful but silently removed that incentive for
// everyone under a million tokens. Splitting keeps both: a small holder always
// has a voice, and 1,000,000 now gates amplifying one rather than having one.
//
// These tests exist so neither half can be collapsed back into the other by
// accident — that would either disenfranchise small holders again, or hand
// unlimited purchased weight to a wallet holding nothing.
import test from "node:test";
import assert from "node:assert/strict";

import { GOVERNANCE_CONFIG } from "../../src/mole/governanceData.js";

test("the two gates exist and are distinct", () => {
  assert.equal(typeof GOVERNANCE_CONFIG.minWinlewToVote, "number");
  assert.equal(typeof GOVERNANCE_CONFIG.minWinlewToPurchaseVotes, "number");
  assert.ok(
    GOVERNANCE_CONFIG.minWinlewToPurchaseVotes > GOVERNANCE_CONFIG.minWinlewToVote,
    "The purchase floor must be strictly higher than the free-vote floor, or the split " +
      "has collapsed and one of the two intents has been lost."
  );
});

test("the free vote stays reachable for a small holder", () => {
  // The whole point of the 2026-08-06 change. If this floor climbs back into
  // the hundreds of thousands, verifying stops being worth anything to a
  // normal holder and the published promise breaks again.
  assert.ok(
    GOVERNANCE_CONFIG.minWinlewToVote <= 1000,
    `minWinlewToVote is ${GOVERNANCE_CONFIG.minWinlewToVote}. The free vote is the incentive ` +
      `to verify — raising this bar removes it. Change the purchase floor instead.`
  );
});

test("the free vote still requires holding something", () => {
  // Not zero: a verified wallet holding nothing at all should not vote, or the
  // only cost of a sybil vote becomes a Discord account.
  assert.ok(
    GOVERNANCE_CONFIG.minWinlewToVote > 0,
    "minWinlewToVote must be > 0 — a zero floor lets an empty verified wallet vote."
  );
});

test("buying weight still requires a serious holding", () => {
  assert.ok(
    GOVERNANCE_CONFIG.minWinlewToPurchaseVotes >= 1_000_000,
    `minWinlewToPurchaseVotes is ${GOVERNANCE_CONFIG.minWinlewToPurchaseVotes}. The 1,000,000 bar ` +
      `set on 2026-07-17 was a deliberate product decision; it moved to gate amplification, ` +
      `it was not abandoned.`
  );
});

test("one wallet, one vote is still the stated method", () => {
  // Purchased weight sits on top of a single free vote and is separately
  // capped. If this ever became token-weighted the split gate would be moot.
  assert.equal(GOVERNANCE_CONFIG.votingMethod, "one-wallet-one-vote");
});
