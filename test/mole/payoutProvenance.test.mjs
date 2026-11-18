// First-payout provenance check.
//
// The owner declined a holder minimum — "any holder should be able to get it" —
// and asked for a check on the first payout instead: who funded this wallet, do
// they play here, do they still hold, is this the same person or a friend.
//
// MOST OF THESE TESTS ARE ABOUT NOT FLAGGING PEOPLE. A check that runs once, on
// the payout that opens someone's account, is the worst possible place for a
// false positive — it lands on a brand new participant who has done nothing
// wrong and has no history to argue with.
import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  checkFirstPayoutProvenance, isFirstPayout, summarizeProvenance,
  VERDICTS, INFRASTRUCTURE_FANOUT,
} from "../../src/mole/payoutProvenance.js";
import * as provenance from "../../src/mole/payoutProvenance.js";

// Synthetic keypairs, generated once. These were real farmer wallets copied out
// of a Discord log, which is a bad habit: it puts a real person's address in the
// repo forever and makes a fixture look meaningful when it is not.
const PAYEE = "7sf9u22pUvCaVN1ntxZCJCgMDN8ede9PUQzkbuVxApBp";
const FUNDER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const EXCHANGE = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";

/** A cluster walk shaped like walletBans.describeCluster() returns. */
function cluster({ funders = [FUNDER], fanout = 0, banned = [], degraded = false, truncated = false } = {}) {
  const members = [{ wallet: PAYEE, depth: 0, via: "self" }];
  for (const f of funders) {
    members.push({ wallet: f, depth: 1, via: `created ${PAYEE}`, weak: false, banned: banned.includes(f), reviewOnly: false });
    for (let i = 0; i < fanout; i += 1) {
      members.push({ wallet: `sibling${i}`, depth: 2, via: `created by ${f}`, weak: false, banned: false });
    }
  }
  return { wallet: PAYEE, degraded, truncatedWalk: truncated, members };
}

const noPayouts = { listPaidWalletOwners: () => [], countPaidPayouts: () => 0 };

const run = (opts) => checkFirstPayoutProvenance({
  userId: "user-1", wallet: PAYEE, db: noPayouts,
  describeCluster: async () => cluster(),
  findLinkedProfileByWallet: () => null,
  ...opts,
});

describe("people who did nothing wrong", () => {
  test("a normal first payout clears", async () => {
    const report = await run({});
    assert.equal(report.verdict, VERDICTS.CLEAR);
    assert.equal(report.score, 0);
  });

  test("funded by an exchange or router clears — that is how people buy tokens", async () => {
    // The false positive that would matter most: a busy wallet that funded lots
    // of others is infrastructure, and being downstream of it is evidence of
    // nothing. Without this the check flags nearly everyone.
    const report = await run({
      describeCluster: async () => cluster({ funders: [EXCHANGE], fanout: INFRASTRUCTURE_FANOUT }),
      db: { listPaidWalletOwners: () => [{ wallet: EXCHANGE, userId: "someone-else", paidTs: 1 }] },
    });
    assert.equal(report.verdict, VERDICTS.CLEAR, "an exchange-funded wallet was flagged");
    assert.equal(report.funders[0].infrastructure, true);
  });

  test("a friend who plays here and bought them tokens clears", async () => {
    // A relationship, recorded so a reviewer can see it, weighted at zero.
    const report = await run({ findLinkedProfileByWallet: () => ({ discordUserId: "a-friend" }) });
    assert.equal(report.verdict, VERDICTS.CLEAR, "having a friend here was treated as abuse");
    assert.ok(report.findings.some((f) => f.signal === "funded_by_known_participant"));
  });

  test("an unattributable funder is not a negative finding", async () => {
    const report = await run({ describeCluster: async () => cluster({ funders: [] }) });
    assert.equal(report.verdict, VERDICTS.CLEAR);
    assert.equal(report.findings.find((f) => f.signal === "no_identifiable_funder").weight, 0);
  });

  test("early counterparties are never treated as parentage", async () => {
    // walletBans.js records this as the mistake v1 of the cluster walk made:
    // on a young wallet, whoever transacted with it early is just a transfer.
    const withWeak = cluster({ funders: [] });
    withWeak.members.push({ wallet: FUNDER, depth: 1, via: `early counterparty of ${PAYEE}`, weak: true });
    const report = await run({
      describeCluster: async () => withWeak,
      db: { listPaidWalletOwners: () => [{ wallet: FUNDER, userId: "user-1", paidTs: 1 }] },
    });
    assert.equal(report.verdict, VERDICTS.CLEAR, "a weak edge was walked as a funding edge");
    assert.equal(report.funders.length, 0);
  });
});

describe("the pattern it was built for", () => {
  test("funded by this same account's earlier payout goes to review", async () => {
    // 2026-08-14 exactly: redeem, move the payout to a fresh wallet, relink.
    const report = await run({
      db: { listPaidWalletOwners: () => [{ wallet: FUNDER, userId: "user-1", paidTs: 1 }] },
    });
    assert.equal(report.verdict, VERDICTS.REVIEW);
    assert.ok(report.findings.some((f) => f.signal === "funded_by_own_earlier_payout"));
  });

  test("funded by a different account's payout goes to review, not refusal", async () => {
    const report = await run({
      db: { listPaidWalletOwners: () => [{ wallet: FUNDER, userId: "someone-else", paidTs: 1 }] },
    });
    assert.equal(report.verdict, VERDICTS.REVIEW);
    // There is no verdict worse than review. A machine does not get the last
    // word on whether a person is paid.
    assert.deepEqual(Object.values(VERDICTS), ["clear", "review"]);
  });

  test("a pass-through wallet that emptied out scores higher than one that held", async () => {
    const paid = { listPaidWalletOwners: () => [{ wallet: FUNDER, userId: "someone-else", paidTs: 1 }] };
    const emptied = await run({ db: paid, getBalance: async () => 0 });
    const holding = await run({ db: paid, getBalance: async () => 5000 });
    assert.ok(emptied.score > holding.score, "emptying out after funding registered as no different");
    assert.ok(emptied.findings.some((f) => f.signal === "funder_emptied_after_funding"));
  });

  test("a banned funder is caught", async () => {
    const report = await run({ describeCluster: async () => cluster({ banned: [FUNDER] }) });
    assert.equal(report.verdict, VERDICTS.REVIEW);
    assert.ok(report.findings.some((f) => f.signal === "funded_by_banned_wallet"));
  });
});

describe("it fails open", () => {
  test("an unreachable chain clears and says so", async () => {
    const report = await run({ describeCluster: async () => { throw new Error("RPC 429"); } });
    assert.equal(report.verdict, VERDICTS.CLEAR, "an RPC outage held someone's first payout");
    assert.equal(report.degraded, true);
    assert.match(report.reason, /cluster_walk_failed/);
  });

  test("a truncated walk clears and is marked degraded", async () => {
    const report = await run({ describeCluster: async () => cluster({ truncated: true }) });
    assert.equal(report.verdict, VERDICTS.CLEAR);
    assert.equal(report.reason, "walk_truncated");
  });

  test("a balance lookup that throws does not change the verdict", async () => {
    const report = await run({ getBalance: async () => { throw new Error("no RPC"); } });
    assert.equal(report.verdict, VERDICTS.CLEAR);
    assert.equal(report.degraded, true);
  });

  test("no wallet is degraded, not suspicious", async () => {
    const report = await checkFirstPayoutProvenance({ userId: "u", wallet: null, db: noPayouts });
    assert.equal(report.verdict, VERDICTS.CLEAR);
    assert.equal(report.reason, "no_wallet");
  });
});

describe("first means first for the PERSON, not the wallet", () => {
  test("a user with no paid payouts is first", () => {
    assert.equal(isFirstPayout({ countPaidPayouts: () => 0 }, "u"), true);
  });

  test("a user who has been paid before is not, whatever wallet they use now", () => {
    // Keying on the wallet would make every new wallet a fresh start — which is
    // the loophole the whole check exists to close.
    assert.equal(isFirstPayout({ countPaidPayouts: () => 3 }, "u"), false);
  });

  test("an unreadable history counts as first", () => {
    assert.equal(isFirstPayout({ countPaidPayouts: () => { throw new Error("db down"); } }, "u"), true);
  });
});

describe("what gets logged", () => {
  test("the summary carries no Discord id", async () => {
    const report = await run({
      db: { listPaidWalletOwners: () => [{ wallet: FUNDER, userId: "user-1", paidTs: 1 }] },
      findLinkedProfileByWallet: () => ({ discordUserId: "999888777" }),
    });
    const line = summarizeProvenance(report);
    assert.ok(!line.includes("999888777"), "a Discord id was put next to a wallet in the log");
    assert.ok(!line.includes("user-1"));
    assert.match(line, /verdict=review/);
  });

  test("zero-weight findings are not reported as signals", async () => {
    const line = summarizeProvenance(await run({ findLinkedProfileByWallet: () => ({ discordUserId: "x" }) }));
    assert.ok(!line.includes("signals="), "an ordinary relationship was logged as a signal");
  });
});

test("there is no switch that makes a first payout hold", () => {
  // The owner's decision: pay the first one instantly, flag it, gate the
  // second. If a `firstPayoutEnforcementEnabled` ever reappears here, someone
  // has quietly reintroduced the three-day wait for new participants.
  assert.equal(provenance.firstPayoutEnforcementEnabled, undefined);
});
