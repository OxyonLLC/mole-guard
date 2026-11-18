// HODL balance-rate rewards are computed exactly (owner decision 2026-11-13).
//
// Before: amount = Math.floor(balance * rate) in floating point, so
// 100,000 x 0.0012 = 119.99999999999999 -> 119, one token short. These tests
// pin the exact arithmetic (src/mole/hodlMath.js) for preview, payout and the
// public page, across all eight rates, fractional balances, caps and scaling.
// Synthetic numbers and identities only.
import 'dotenv/config';
import test, { describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hodl-exact-"));
process.env.DATA_DIR = DATA_DIR;
after(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

const { computeWeeklyAllocation, validateEpoch, DEFAULT_EPOCH_PARAMS, DEFAULT_BALANCE_RATES, LIMITS } = await import("../../src/mole/hodlEpochs.js");
const { toUnits, rateToNanos, plainDecimal, rewardForWholeTokens, balanceRateAllocation } = await import("../../src/mole/hodlMath.js");
const { gatherIdentities } = await import("../../src/mole/hodlEligibility.js");

const RATES = [...DEFAULT_BALANCE_RATES];
const NANOS = [1_000_000n, 1_050_000n, 1_100_000n, 1_150_000n, 1_200_000n, 1_300_000n, 1_400_000n, 1_500_000n];
const epoch = { id: "T", ...DEFAULT_EPOCH_PARAMS, weeklyPool: 10_000, balanceRates: RATES };
const one = (balance, activeDays, extra = {}) =>
  computeWeeklyAllocation([{ discordUserId: "1", payoutWallet: "W", balance, activeDays, ...extra }], epoch).allocations[0];
// Independent reference: exact integer maths written out separately from hodlMath.
const ref = (wholeTokens, days) => Number((BigInt(wholeTokens) * NANOS[days]) / 1_000_000_000n);

describe("rates are read exactly", () => {
  test("the eight approved rates are exact nano-units", () => {
    assert.deepEqual(RATES.map(rateToNanos), NANOS);
  });
  test("decimal parsing never goes through a float product", () => {
    assert.equal(toUnits("1257232.417", 6), 1257232417000n);
    assert.equal(toUnits(0.1 + 0.2, 17), 30000000000000004n, "a float's exact printed digits, not a rounded guess");
    assert.equal(plainDecimal(1.5e-7), "0.00000015");
    assert.equal(plainDecimal(1e21), "1000000000000000000000");
    assert.throws(() => toUnits("0.0000000001", 9), /more than 9 decimal places/);
    assert.equal(toUnits("0.0000000001", 9, { mode: "floor" }), 0n);
    assert.throws(() => toUnits(-1, 0));
  });
  test("validateEpoch refuses a rate that cannot be applied exactly", () => {
    const bad = [...RATES]; bad[0] = 0.0010000001; // 10 decimal places
    assert.ok(validateEpoch({ ...epoch, startMs: 0, endMs: 13 * 7 * 86400000, balanceRates: bad }).errors.some((e) => /more than 9 decimal places/.test(e)));
    assert.ok(validateEpoch({ ...epoch, startMs: 0, endMs: 13 * 7 * 86400000 }).ok, "E1's own rates stay valid");
  });
});

describe("all eight participation rates", () => {
  for (let days = 0; days <= 7; days += 1) {
    test(`${days} active days: 100,000 and 1,000,000 WinLEW pay exactly`, () => {
      assert.equal(one(100_000, days).amount, ref(100_000, days));
      assert.equal(one(1_000_000, days).amount, ref(1_000_000, days));
      assert.equal(rewardForWholeTokens(100_000, RATES[days]), ref(100_000, days));
    });
  }
  test("the published examples: 100, 105, 110, 115, 120, 130, 140, 150", () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((d) => one(100_000, d).amount), [100, 105, 110, 115, 120, 130, 140, 150]);
  });
});

describe("cases that previously underpaid by one token", () => {
  test("100,000 at 0.12% is 120 (the old formula gave 119)", () => {
    assert.equal(Math.floor(100_000 * 0.0012), 119, "documents the old defect");
    assert.equal(one(100_000, 4).amount, 120);
  });
  test("every whole-token balance up to 200,000 matches exact maths at every rate", () => {
    let previouslyShort = 0;
    for (let days = 0; days <= 7; days += 1) {
      const rows = [];
      for (let b = 1; b <= 200_000; b += 1) rows.push({ balance: b, activeDays: days });
      const { rows: out } = balanceRateAllocation(rows, { rates: RATES, weeklyPool: 1e12, maxPerPerson: 1e12, maxQualifyingBalance: 5_000_000, maxRate: 0.0015 });
      for (let b = 1; b <= 200_000; b += 1) {
        const exact = ref(b, days);
        assert.equal(out[b - 1].amount, exact, `balance ${b}, ${days} days`);
        if (Math.floor(b * RATES[days]) < exact) previouslyShort += 1;
      }
    }
    assert.ok(previouslyShort > 0, `the old float formula was short in ${previouslyShort} cases; all are now exact`);
  });
});

describe("fractional token balances", () => {
  test("the week-1 preview shape is unchanged: 2,500 / 2,500 / 1,382", () => {
    const res = computeWeeklyAllocation([
      { discordUserId: "1", balance: 13_875_295.717, activeDays: 1 },
      { discordUserId: "2", balance: 20_246_899.912, activeDays: 0 },
      { discordUserId: "3", balance: 1_257_232.417, activeDays: 2 },
    ], epoch);
    assert.deepEqual(res.allocations.map((a) => a.amount), [2500, 2500, 1382]);
    assert.equal(res.totalAllocated, 6382);
    assert.equal(res.undistributed, 3618);
  });
  test("exact base units and the equivalent number give the same reward", () => {
    for (const [units, decimals, days] of [["1257232417000", 6, 2], ["99999999999", 6, 4], ["100000000000", 6, 4], ["1", 6, 7], ["4999999999999", 6, 7]]) {
      const n = Number(units) / 10 ** decimals;
      assert.equal(one(n, days, { balanceUnits: units, balanceDecimals: decimals }).amount, one(n, days).amount, `${units}e-${decimals}`);
    }
  });
  test("a balance just under a whole-token boundary rounds down, never up", () => {
    // 99,999.999999 x 0.12% = 119.9999999988 -> 119 ; 100,000 exactly -> 120
    assert.equal(one(99_999.999999, 4, { balanceUnits: "99999999999", balanceDecimals: 6 }).amount, 119);
    assert.equal(one(100_000, 4, { balanceUnits: "100000000000", balanceDecimals: 6 }).amount, 120);
  });
  test("units are recorded on the allocation for audit", () => {
    const a = one(1_257_232.417, 2, { balanceUnits: "1257232417000", balanceDecimals: 6 });
    assert.equal(a.balanceUnits, "1257232417000");
    assert.equal(a.balanceDecimals, 6);
  });
});

describe("caps", () => {
  test("per-person cap: 2,500 at every rate once the reward would exceed it", () => {
    for (let d = 0; d <= 7; d += 1) {
      assert.equal(one(5_000_000, d).amount, 2500);
      assert.equal(one(5_000_000, d).rateAmount, ref(5_000_000, d), "the uncapped figure is exact too");
    }
  });
  test("only 5,000,000 of a balance counts", () => {
    assert.equal(one(50_000_000, 0).rateAmount, 5000);
    assert.equal(one(1_000_000_000, 7).rateAmount, 7500);
  });
  test("the cap boundary is exact: 2,500,000 at the base rate reaches 2,500 precisely", () => {
    assert.equal(one(2_500_000, 0).amount, 2500);
    assert.equal(one(2_499_999.999999, 0, { balanceUnits: "2499999999999", balanceDecimals: 6 }).amount, 2499);
  });
});

describe("pool scaling", () => {
  test("five capped participants share a 10,000 pool equally: 2,000 each", () => {
    const people = Array.from({ length: 5 }, (_, i) => ({ discordUserId: String(i), balance: 5_000_000, activeDays: 7 }));
    const res = computeWeeklyAllocation(people, epoch);
    assert.deepEqual(res.allocations.map((a) => a.amount), [2000, 2000, 2000, 2000, 2000]);
    assert.equal(res.totalAllocated, 10_000);
    assert.equal(res.poolScale, 0.8);
  });
  test("scaled amounts are exact floors of capped x pool / total", () => {
    // capped: 2500, 2500, 2500, 2500, 1382.955 (fractional) -> total 11382.955
    const people = [...Array.from({ length: 4 }, (_, i) => ({ discordUserId: String(i), balance: 5_000_000, activeDays: 0 })),
      { discordUserId: "x", balance: 1_257_232.417, activeDays: 2, balanceUnits: "1257232417000", balanceDecimals: 6 }];
    const res = computeWeeklyAllocation(people, epoch);
    // exact reference with integers over a common denominator of 1e15
    const capped = [2500n * 10n ** 15n, 2500n * 10n ** 15n, 2500n * 10n ** 15n, 2500n * 10n ** 15n, 1257232417000n * 1_100_000n];
    const total = capped.reduce((s, c) => s + c, 0n);
    const want = capped.map((c) => Number((c * 10_000n * 10n ** 15n) / (total * 10n ** 15n)));
    assert.deepEqual(res.allocations.map((a) => a.amount), want);
    assert.ok(res.totalAllocated <= 10_000);
  });
  test("the total never exceeds the pool (randomised)", () => {
    let seed = 42; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let trial = 0; trial < 300; trial += 1) {
      const people = Array.from({ length: 1 + Math.floor(rnd() * 40) }, (_, i) => ({
        discordUserId: String(i), activeDays: Math.floor(rnd() * 8),
        balanceUnits: String(Math.floor(rnd() * 9e12)), balanceDecimals: 6, balance: 0,
      }));
      const res = computeWeeklyAllocation(people, epoch);
      assert.ok(res.totalAllocated <= 10_000, `trial ${trial}: ${res.totalAllocated}`);
      for (const a of res.allocations) assert.ok(Number.isInteger(a.amount) && a.amount >= 0 && a.amount <= LIMITS.MAX_PER_PARTICIPANT_WEEK);
    }
  });
});

describe("preview, payout and the public page use the same arithmetic", () => {
  const page = fs.readFileSync(new URL("../../src/public/hodl/index.html", import.meta.url), "utf8");
  const block = page.slice(page.indexOf("/* hodl-exact:start"), page.indexOf("/* hodl-exact:end */"));
  // eslint-disable-next-line no-new-func
  const hodlExact = new Function(`${block}; return hodlExact;`)();

  test("the page's live table matches the backend for all eight rates", () => {
    for (let d = 0; d <= 7; d += 1) {
      assert.equal(hodlExact.reward(100000, RATES[d]), one(100_000, d).amount, `100k, ${d} days`);
      assert.equal(hodlExact.reward(1000000, RATES[d]), one(1_000_000, d).amount, `1M, ${d} days`);
    }
    assert.deepEqual(RATES.map(hodlExact.percent), ["0.100%", "0.105%", "0.110%", "0.115%", "0.120%", "0.130%", "0.140%", "0.150%"]);
    assert.equal(hodlExact.capBalance(2500, RATES[0]), 2_500_000);
  });
  test("the page keeps no floating-point reward formula", () => {
    assert.ok(!/Math\.floor\(100000 \* v\)|Math\.floor\(1000000 \* v\)/.test(page));
  });
  test("preview and payout read exact base units through the same reader", () => {
    for (const f of ["hodl-preview.js", "hodl-pay.js"]) {
      const src = fs.readFileSync(new URL(`../../src/scripts/${f}`, import.meta.url), "utf8");
      assert.match(src, /getBalance: async \(\w+\) => getSplBalanceUnits\(\w+, mint\)/, f);
    }
  });
  test("exact units from several wallets are summed as integers", async () => {
    const NOW_SEC = 1_800_000_000;
    const res = await gatherIdentities({
      epoch: { ...epoch, minHold: 1000 }, nowSec: NOW_SEC,
      listProfiles: () => [{ discordUserId: "100000000000000009", record: {
        wallet: "WA", verified_at: NOW_SEC - 100, verification_expires_at: NOW_SEC + 86400,
        verified_wallets: {
          WA: { verified_at: NOW_SEC - 100, expires_at: NOW_SEC + 86400 },
          WB: { verified_at: NOW_SEC - 50, expires_at: NOW_SEC + 86400 },
        } } }],
      getBalance: async (w) => (w === "WA" ? { units: "50000100000", decimals: 6 } : { units: "49999900000", decimals: 6 }),
      getActiveDays: async () => ({ activeDays: 4, days: [], errors: [] }),
    });
    assert.equal(res.qualified.length, 1);
    assert.equal(res.qualified[0].balanceUnits, "100000000000");
    assert.equal(res.qualified[0].balanceDecimals, 6);
    assert.equal(computeWeeklyAllocation(res.qualified, epoch).allocations[0].amount, 120);
  });
});
