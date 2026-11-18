// Multi-wallet identities (2026-08-20).
//
// The rule these tests pin, in the owner's words: "one claim per person, no
// matter how many wallets they have", with payouts going to "a select wallet
// ... or the last wallet verified with". That only works if an identity can
// hold several verified wallets at once, which it could not before.
//
// DATA_DIR is redirected to a temp directory BEFORE importing walletLink,
// because storage.js resolves it once through getConfig(). Writing to the real
// data directory from a test would overwrite live link records.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "winlew-multiwallet-"));
process.env.DATA_DIR = TMP;
process.env.MONGODB_URI = "";

const { listVerifiedWallets, getPayoutWallet, WALLET_VERIFICATION_TTL_SEC } = await import("../../src/mole/walletLink.js");

const NOW = 1_800_000_000;
const A = "AX7cMx4GMxwNt72ZqztYh9zqkZspvdxgVAmTBYcHNVhk";
const B = "6Y4MJPHpG66bRizdy99mEZnaaiwvEx9Q1aD6wh8PQB5v";
const C = "23nSNTRJJMqEm8X2MYpnxG4iRtkgPW4yFkwauSsLhaig";

describe("listVerifiedWallets: migration from the single-wallet shape", () => {
  test("an old record's one verified wallet survives as the only entry", () => {
    const record = {
      wallet: A,
      last_verified_wallet: A,
      verified_at: NOW - 100,
      verification_expires_at: NOW + 1000,
      wallet_history: [A],
    };
    const list = listVerifiedWallets(record, NOW);
    assert.equal(list.length, 1);
    assert.equal(list[0].wallet, A);
  });

  test("wallet_history is NOT retroactively verified", () => {
    // B and C were replaced at some point. Their proof is old and nobody
    // re-signed for them, so counting them would invent verification that
    // never happened — and this list decides who gets paid.
    const record = {
      wallet: A,
      last_verified_wallet: A,
      verified_at: NOW - 100,
      verification_expires_at: NOW + 1000,
      wallet_history: [A, B, C],
    };
    const list = listVerifiedWallets(record, NOW).map((entry) => entry.wallet);
    assert.deepEqual(list, [A]);
  });

  test("an expired wallet drops out of the list", () => {
    const record = {
      verified_wallets: {
        [A]: { verified_at: NOW - 10, expires_at: NOW + 10 },
        [B]: { verified_at: NOW - 5000, expires_at: NOW - 1 },
      },
    };
    assert.deepEqual(listVerifiedWallets(record, NOW).map((e) => e.wallet), [A]);
  });

  test("most recently verified comes first", () => {
    const record = {
      verified_wallets: {
        [A]: { verified_at: NOW - 900, expires_at: NOW + 10 },
        [B]: { verified_at: NOW - 100, expires_at: NOW + 10 },
        [C]: { verified_at: NOW - 500, expires_at: NOW + 10 },
      },
    };
    assert.deepEqual(listVerifiedWallets(record, NOW).map((e) => e.wallet), [B, C, A]);
  });
});

describe("getPayoutWallet: one address, chosen honestly", () => {
  const threeVerified = {
    verified_wallets: {
      [A]: { verified_at: NOW - 900, expires_at: NOW + 10 },
      [B]: { verified_at: NOW - 100, expires_at: NOW + 10 },
      [C]: { verified_at: NOW - 500, expires_at: NOW + 10 },
    },
  };

  test("defaults to the last wallet verified with", () => {
    assert.equal(getPayoutWallet(threeVerified, NOW), B);
  });

  test("an explicit nomination wins over recency", () => {
    const record = { ...threeVerified, wallets: { payout: { address: C, source: "user-selected" } } };
    assert.equal(getPayoutWallet(record, NOW), C);
  });

  test("a nomination that has since EXPIRED falls back instead of paying it", () => {
    const record = {
      verified_wallets: { [A]: { verified_at: NOW - 10, expires_at: NOW + 10 } },
      wallets: { payout: { address: B, source: "user-selected" } },
    };
    assert.equal(getPayoutWallet(record, NOW), A);
  });

  test("no verified wallet means no payout address, not a guess", () => {
    assert.equal(getPayoutWallet({ wallet_history: [A, B] }, NOW), null);
    assert.equal(getPayoutWallet(null, NOW), null);
  });
});

describe("the TTL is unchanged", () => {
  test("each wallet gets its own clock of the same length", () => {
    assert.equal(WALLET_VERIFICATION_TTL_SEC, 91 * 24 * 60 * 60);
  });
});
