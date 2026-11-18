import test from "node:test";
import assert from "node:assert/strict";

import {
  GIVEAWAY_ANNOUNCEMENTS,
  GIVEAWAY_PAYOUTS,
  GIVEAWAY_STATUSES,
  LINK_BASIS,
  giveawayTotals,
  payoutsForAnnouncement,
  unmatchedPayouts,
  announcementSummary,
  validateGiveawayRecords,
  payoutExplorerUrl,
} from "../../src/mole/giveawayRecords.js";

test("the records validate", () => {
  assert.equal(validateGiveawayRecords(), true);
});

test("a payout may never claim an announcement it has no basis for", () => {
  // The rule this whole module exists to enforce. Both directions are wrong:
  // a link with no basis launders a guess into proof, and a basis with no link
  // is a claim about nothing.
  assert.throws(
    () =>
      validateGiveawayRecords(GIVEAWAY_ANNOUNCEMENTS, [
        { ...GIVEAWAY_PAYOUTS[0], announcementId: "launch-day-2024", linkBasis: LINK_BASIS.NONE },
      ]),
    /giveaway_link_without_basis/,
  );
  assert.throws(
    () =>
      validateGiveawayRecords(GIVEAWAY_ANNOUNCEMENTS, [
        { ...GIVEAWAY_PAYOUTS[0], announcementId: null, linkBasis: LINK_BASIS.VERIFIED },
      ]),
    /giveaway_basis_without_link/,
  );
});

test("a payout cannot cite an announcement that does not exist", () => {
  assert.throws(
    () =>
      validateGiveawayRecords(GIVEAWAY_ANNOUNCEMENTS, [
        { ...GIVEAWAY_PAYOUTS[0], announcementId: "invented-2027", linkBasis: LINK_BASIS.VERIFIED },
      ]),
    /giveaway_unknown_announcement/,
  );
});

test("no signature appears twice", () => {
  const seen = new Set();
  for (const p of GIVEAWAY_PAYOUTS) {
    assert.ok(!seen.has(p.signature), `duplicate signature ${p.signature}`);
    seen.add(p.signature);
  }
});

test("every signature is a plausible Solana signature, not an address", () => {
  // A 44-character base58 string is a 32-byte ADDRESS. One was supplied as a
  // "signature" during this work and the RPC rejected it as WrongSize; this
  // stops that class of mistake reaching the page.
  for (const p of GIVEAWAY_PAYOUTS) {
    assert.ok(p.signature.length >= 80, `${p.signature} is too short to be a signature`);
  }
});

test("totals are derived from the rows, never declared", () => {
  const totals = giveawayTotals();
  const sum = GIVEAWAY_PAYOUTS.reduce((acc, p) => acc + BigInt(p.amountBaseUnits), 0n);
  assert.equal(totals.totalBaseUnits, sum.toString());
  assert.equal(totals.payoutCount, GIVEAWAY_PAYOUTS.length);
});

test("the published total matches the reconstructed ledger", () => {
  // 12,228,500 WinLEW to 21 wallets, from the complete walk of the X Faucet
  // Reserve committed at docs/giveaway-records/. An earlier pass said
  // 37,268,500 because it counted a token lock and a bonding-curve account as
  // people. If this number moves without that ledger moving, something is wrong.
  const totals = giveawayTotals();
  assert.equal(totals.totalBaseUnits, "12228500000000");
  assert.equal(totals.distinctWallets, 21);
});

test("unmatched payouts are surfaced rather than hidden", () => {
  const unmatched = unmatchedPayouts();
  assert.ok(unmatched.length > 0, "expected some payouts with no announcement");
  for (const p of unmatched) assert.equal(p.linkBasis, LINK_BASIS.NONE);
});

test("an announcement reports the weakest basis among its payouts", () => {
  // An announcement whose links are all inferred must not read as settled.
  const memes = announcementSummary(
    GIVEAWAY_ANNOUNCEMENTS.find((a) => a.id === "meme-contest-2025"),
  );
  assert.equal(memes.weakestLinkBasis, LINK_BASIS.INFERRED);

  const brz = announcementSummary(
    GIVEAWAY_ANNOUNCEMENTS.find((a) => a.id === "brz-partnership-2025"),
  );
  assert.equal(brz.weakestLinkBasis, LINK_BASIS.VERIFIED);
});

test("a never-triggered giveaway has no payouts attached", () => {
  for (const a of GIVEAWAY_ANNOUNCEMENTS) {
    if (a.status !== GIVEAWAY_STATUSES.NEVER_TRIGGERED) continue;
    assert.equal(
      payoutsForAnnouncement(a.id).length,
      0,
      `${a.id} is marked never-triggered but has payouts`,
    );
  }
});

test("the 2BRZ payout is the one already documented in the news article", () => {
  const [payout] = payoutsForAnnouncement("brz-partnership-2025");
  assert.equal(payout.amountBaseUnits, "500000000000");
  assert.equal(
    payout.signature,
    "57yz552QCvVDNqfg5d5YXqgeqMF8TCLEb39toEmgRN7SDYHUM3PLXPLCT9A4tQzxezSjzAkc5je88oQ2CYFDjr4Y",
  );
  assert.equal(payoutExplorerUrl(payout), `https://solscan.io/tx/${payout.signature}`);
});
