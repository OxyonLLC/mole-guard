// HODL Rewards — turning the world into facts the epoch engine can judge.
//
// hodlEpochs.js is pure and exhaustively tested. This layer is where reality
// gets in: stale mirrors, unreachable RPCs, banned wallets, missing scores. The
// interesting cases are all failures, because a batch payout that quietly
// shrinks looks identical to one where people simply stopped qualifying.
import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { gatherIdentities, summariseExclusions } from "../../src/mole/hodlEligibility.js";
import { DEFAULT_EPOCH_PARAMS, INELIGIBLE } from "../../src/mole/hodlEpochs.js";

const NOW_SEC = Math.floor(Date.UTC(2026, 8, 1) / 1000);
const EPOCH = { id: "E1", ...DEFAULT_EPOCH_PARAMS };

/** A linked-profile record in the shape walletLink normalises to. */
function profile(id, wallet, { expiresIn = 86400 } = {}) {
  return {
    discordUserId: id,
    record: {
      wallet,
      verified_at: NOW_SEC - 100,
      verification_expires_at: NOW_SEC + expiresIn,
      wallets: { verified: { address: wallet, linked_at: NOW_SEC - 100 } },
    },
  };
}

const base = (over = {}) => ({
  epoch: EPOCH,
  nowSec: NOW_SEC,
  listProfiles: () => [profile("u1", "W1"), profile("u2", "W2")],
  getBalance: async () => 5000,
  getPovScore: async () => 50,
  ...over,
});

describe("the ordinary case", () => {
  test("verified holders in good standing qualify", async () => {
    const res = await gatherIdentities(base());
    assert.equal(res.considered, 2);
    assert.equal(res.qualified.length, 2);
    assert.equal(res.excluded.length, 0);
    assert.equal(res.degraded.length, 0);
    assert.deepEqual(res.qualified.map((q) => q.payoutWallet).sort(), ["W1", "W2"]);
  });

  test("one identity yields exactly one payout wallet", async () => {
    // The whole point of qualifying identities rather than addresses: a person
    // with several wallets is still one participant with one share.
    const res = await gatherIdentities(base({
      listProfiles: () => [{
        discordUserId: "u1",
        record: {
          wallet: "PRIMARY",
          verified_at: NOW_SEC - 100,
          verification_expires_at: NOW_SEC + 86400,
          wallets: { verified: { address: "PRIMARY" } },
          wallet_history: ["OLD1", "OLD2", "OLD3"],
        },
      }],
    }));
    assert.equal(res.qualified.length, 1, "wallet history created extra participants");
    assert.equal(res.qualified[0].payoutWallet, "PRIMARY");
  });
});

describe("failures must be visible, never silent", () => {
  test("an unreadable balance excludes AND is reported as degraded", async () => {
    // A shrinking payout list with no explanation is indistinguishable from
    // people genuinely dropping out. The preview has to be able to say so.
    const res = await gatherIdentities(base({
      getBalance: async (w) => { if (w === "W2") throw new Error("RPC 429"); return 5000; },
    }));
    assert.equal(res.qualified.length, 1);
    assert.equal(res.degraded.length, 1);
    assert.equal(res.degraded[0].discordUserId, "u2");
    assert.match(res.degraded[0].reason, /429/);
    assert.ok(res.excluded[0].reasons.includes(INELIGIBLE.BALANCE_UNKNOWN));
  });

  test("a null balance is unknown, not zero", async () => {
    const res = await gatherIdentities(base({ getBalance: async () => null }));
    assert.equal(res.qualified.length, 0);
    for (const row of res.excluded) {
      assert.ok(row.reasons.includes(INELIGIBLE.BALANCE_UNKNOWN),
        `expected balance_unknown, got ${row.reasons}`);
    }
  });

  test("a PoV failure costs the bonus, never eligibility", async () => {
    // Scoring zero is the safe direction — the participant still gets the base
    // share. Dropping them because a score lookup failed would be punishing
    // someone for our outage.
    const res = await gatherIdentities(base({
      getPovScore: async () => { throw new Error("pov store down"); },
    }));
    assert.equal(res.qualified.length, 2);
    assert.deepEqual(res.qualified.map((q) => q.povScore), [0, 0]);
  });
});

describe("bans are honoured from both lists", () => {
  test("a banned wallet is excluded", async () => {
    const res = await gatherIdentities(base({ isWalletBanned: async (w) => w === "W1" }));
    assert.equal(res.qualified.length, 1);
    assert.ok(res.excluded[0].reasons.includes(INELIGIBLE.BANNED));
  });

  test("a banned ACCOUNT is excluded even with a clean wallet", async () => {
    // The fresh-wallet path a wallet ban cannot reach.
    const res = await gatherIdentities(base({ isAccountBanned: async (u) => u === "u2" }));
    assert.equal(res.qualified.length, 1);
    assert.equal(res.qualified[0].discordUserId, "u1");
  });
});

describe("verification", () => {
  test("an expired verification does not qualify", async () => {
    const res = await gatherIdentities(base({
      listProfiles: () => [profile("u1", "W1", { expiresIn: -1 })],
    }));
    assert.equal(res.qualified.length, 0);
    assert.ok(res.excluded[0].reasons.includes(INELIGIBLE.VERIFICATION_EXPIRED));
  });

  test("a profile with no wallet is excluded, not crashed on", async () => {
    const res = await gatherIdentities(base({
      listProfiles: () => [{ discordUserId: "u1", record: { verified_at: NOW_SEC } }],
    }));
    assert.equal(res.qualified.length, 0);
    assert.ok(res.excluded[0].reasons.includes(INELIGIBLE.NO_PAYOUT_WALLET));
  });
});

describe("scale and shape", () => {
  test("zero profiles is a clean empty result, not a crash", async () => {
    const res = await gatherIdentities(base({ listProfiles: () => [] }));
    assert.equal(res.considered, 0);
    assert.deepEqual(res.qualified, []);
    assert.deepEqual(res.excluded, []);
  });

  test("hundreds of profiles are gathered without unbounded concurrency", async () => {
    // The RPC is rate limited and the funding-cluster walks already compete for
    // it. A weekly job has no reason to open 500 sockets at once.
    let inFlight = 0, peak = 0;
    const res = await gatherIdentities(base({
      listProfiles: () => Array.from({ length: 300 }, (_, i) => profile(`u${i}`, `W${i}`)),
      getBalance: async () => {
        inFlight += 1; peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight -= 1;
        return 5000;
      },
    }));
    assert.equal(res.qualified.length, 300);
    assert.ok(peak <= 8, `peak concurrency was ${peak} — balance lookups are unthrottled`);
  });

  test("exclusion reasons are summarised with counts", () => {
    const out = summariseExclusions([
      { reasons: [INELIGIBLE.BELOW_MIN_HOLD] },
      { reasons: [INELIGIBLE.BELOW_MIN_HOLD] },
      { reasons: [INELIGIBLE.NOT_VERIFIED, INELIGIBLE.BELOW_MIN_HOLD] },
    ]);
    assert.deepEqual(out[0], { reason: INELIGIBLE.BELOW_MIN_HOLD, count: 3 });
    assert.equal(out.length, 2);
  });
});

describe("the participant list must be authoritative", () => {
  test("a wallet-only profile never qualifies", async () => {
    // `wallet:<hash>` ids come from the wallet-only sign-in path and have no
    // Discord account behind them — anyone can mint one per wallet they own.
    // Letting them in would hand back the exact Sybil vector that
    // identity-level qualification exists to close.
    const res = await gatherIdentities(base({
      listProfiles: () => [profile("wallet:9fb82d15", "W1"), profile("478228146139693085", "W2")],
    }));
    assert.equal(res.qualified.length, 1);
    assert.equal(res.qualified[0].discordUserId, "478228146139693085");
    assert.ok(res.excluded[0].reasons.includes(INELIGIBLE.WALLET_ONLY_PROFILE));
  });

  test("guest ids are excluded on the same rule", async () => {
    const res = await gatherIdentities(base({ listProfiles: () => [profile("guest:abc123", "W1")] }));
    assert.equal(res.qualified.length, 0);
    assert.ok(res.excluded[0].reasons.includes(INELIGIBLE.WALLET_ONLY_PROFILE));
  });

  test("the result says whether the list was refreshed", async () => {
    // A Tuesday payout decided from a boot-time cache would skip anyone who
    // verified since the worker started. The preview has to admit which list
    // it used rather than presenting a stale one as final.
    const res = await gatherIdentities(base());
    assert.ok("sourceRefreshed" in res, "callers cannot tell whether the list was authoritative");
  });
});

// ── The holding is the person's, the payment is one wallet's (2026-08-20) ──
describe("multi-wallet identities", () => {
  const NOW = Math.floor(Date.now() / 1000);
  const verified = (...wallets) => ({
    verified_wallets: Object.fromEntries(
      wallets.map((w) => [w, { verified_at: NOW - 100, expires_at: NOW + 100_000 }]),
    ),
    wallets: { verified: { address: wallets[0] } },
    last_verified_wallet: wallets[0],
    verified_at: NOW - 100,
    verification_expires_at: NOW + 100_000,
  });

  const oneProfile = (record, overrides = {}) => ({
    epoch: { ...DEFAULT_EPOCH_PARAMS, minHold: 1000 },
    listProfiles: () => [{ discordUserId: "u1", record }],
    getPovScore: async () => 0,
    ...overrides,
  });

  test("a holding split across wallets still clears the minimum", async () => {
    // 600 + 600 is 1,200 — the person holds over the minimum, and measuring
    // only the payout wallet would have excluded a real holder for tidying up.
    const res = await gatherIdentities(oneProfile(verified("W1", "W2"), {
      getBalance: async () => 600,
    }));
    assert.equal(res.qualified.length, 1);
    assert.equal(res.qualified[0].balance, 1200);
  });

  test("payment still goes to exactly one wallet", async () => {
    const res = await gatherIdentities(oneProfile(verified("W1", "W2"), {
      getBalance: async () => 5000,
    }));
    assert.equal(res.qualified[0].payoutWallet, "W1", "the most recently verified wallet, not a list");
  });

  test("a nominated payout wallet is honoured over recency", async () => {
    const record = { ...verified("W1", "W2"), wallets: { verified: { address: "W1" }, payout: { address: "W2" } } };
    const res = await gatherIdentities(oneProfile(record, { getBalance: async () => 5000 }));
    assert.equal(res.qualified[0].payoutWallet, "W2");
  });

  test("a partial read that already clears the bar still qualifies", async () => {
    const res = await gatherIdentities(oneProfile(verified("W1", "W2"), {
      getBalance: async (w) => { if (w === "W2") throw new Error("RPC 429"); return 5000; },
    }));
    assert.equal(res.qualified.length, 1, "the unread wallet could only ADD to the total");
    assert.equal(res.qualified[0].balance, 5000);
    assert.equal(res.degraded.length, 1, "and it is still reported, because the number shown is not the whole picture");
  });

  test("a partial read that falls short is unknown, not a low balance", async () => {
    const res = await gatherIdentities(oneProfile(verified("W1", "W2"), {
      getBalance: async (w) => { if (w === "W2") throw new Error("RPC 429"); return 10; },
    }));
    assert.equal(res.qualified.length, 0);
    assert.ok(res.excluded[0].reasons.includes(INELIGIBLE.BALANCE_UNKNOWN),
      "10 is not their balance — it is the part of their balance we could read, so the verdict must be unknown");
    assert.equal(res.degraded.length, 1);
  });

  test("a ban on ANY verified wallet disqualifies, not just the paid one", async () => {
    // Otherwise the cheapest possible bypass of the blocklist is to nominate a
    // different wallet of your own.
    const res = await gatherIdentities(oneProfile(verified("W1", "W2"), {
      getBalance: async () => 5000,
      isWalletBanned: async (w) => w === "W2",
    }));
    assert.equal(res.qualified.length, 0);
    assert.ok(res.excluded[0].reasons.includes(INELIGIBLE.BANNED));
  });
});
