// What a person holds across all their verified wallets.
//
// The interesting cases are all partial reads: a sum missing one wallet is an
// understatement, and the whole module exists to make sure an understatement
// can grant but can never refuse.
import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { getIdentityHoldings, meetsThreshold } from "../../src/mole/identityHoldings.js";

const NOW = 1_800_000_000;
const A = "AX7cMx4GMxwNt72ZqztYh9zqkZspvdxgVAmTBYcHNVhk";
const B = "6Y4MJPHpG66bRizdy99mEZnaaiwvEx9Q1aD6wh8PQB5v";
const C = "23nSNTRJJMqEm8X2MYpnxG4iRtkgPW4yFkwauSsLhaig";

const recordWith = (...wallets) => ({
  verified_wallets: Object.fromEntries(
    wallets.map((w) => [w, { verified_at: NOW - 100, expires_at: NOW + 1000 }]),
  ),
});

const balances = (map) => async (wallet) => {
  if (!(wallet in map)) throw new Error("rpc_unavailable");
  return map[wallet];
};

describe("getIdentityHoldings", () => {
  test("sums every verified wallet", async () => {
    const holdings = await getIdentityHoldings(recordWith(A, B, C), {
      nowSec: NOW,
      getBalance: balances({ [A]: 4_000_000, [B]: 6_000_500, [C]: 0 }),
    });
    assert.equal(holdings.total, 10_000_500);
    assert.equal(holdings.partial, false);
    assert.equal(holdings.counted, 3);
  });

  test("no verified wallet is a total of zero, not an error", async () => {
    const holdings = await getIdentityHoldings({ wallet_history: [A, B] }, { nowSec: NOW });
    assert.equal(holdings.total, 0);
    assert.equal(holdings.partial, false);
    assert.deepEqual(holdings.wallets, []);
  });

  test("one unreadable wallet marks the sum partial without losing the rest", async () => {
    const holdings = await getIdentityHoldings(recordWith(A, B), {
      nowSec: NOW,
      getBalance: balances({ [A]: 1_000_000 }),
    });
    assert.equal(holdings.total, 1_000_000);
    assert.equal(holdings.partial, true);
    assert.equal(holdings.unreadable, 1);
    assert.equal(holdings.wallets.find((w) => w.wallet === B).error, "rpc_unavailable");
  });

  test("a non-finite balance counts as unreadable, not as zero", async () => {
    // getSplBalance sums uiAmounts; a malformed account could yield NaN, and
    // NaN added to a total silently destroys the whole sum.
    const holdings = await getIdentityHoldings(recordWith(A, B), {
      nowSec: NOW,
      getBalance: async (w) => (w === A ? 5_000 : NaN),
    });
    assert.equal(holdings.total, 5_000);
    assert.equal(holdings.partial, true);
  });
});

describe("meetsThreshold: grant on partial, never refuse on partial", () => {
  test("a complete read answers plainly both ways", () => {
    assert.equal(meetsThreshold({ total: 1_000_000, partial: false }, 1_000_000), true);
    assert.equal(meetsThreshold({ total: 999_999, partial: false }, 1_000_000), false);
  });

  test("a partial read that already clears the bar still grants", () => {
    // The missing wallet could only add to the total, so this cannot be wrong.
    assert.equal(meetsThreshold({ total: 2_000_000, partial: true }, 1_000_000), true);
  });

  test("a partial read that falls short answers unknown, not no", () => {
    assert.equal(meetsThreshold({ total: 10, partial: true }, 1_000_000), null,
      "refusing here would refuse on evidence we know is incomplete");
  });

  test("no holdings at all is unknown rather than a confident no", () => {
    assert.equal(meetsThreshold(null, 1_000_000), null);
  });
});
