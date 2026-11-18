// HODL balance-rate policy (owner, 2026-11-13): weekly rate by distinct active
// days, 0.100% (0 days) .. 0.150% (7 days); balance counted up to 5,000,000 per
// identity; 2,500 per-person cap and the 10,000 pool kept, proportional scaling
// on overflow; hard ceiling 0.0015 that no vote can exceed. Synthetic holders.
import test from "node:test";
import assert from "node:assert/strict";
import { computeWeeklyAllocation, validateEpoch, buildWeeklySnapshot, LIMITS, DEFAULT_EPOCH_PARAMS, DEFAULT_BALANCE_RATES } from "../../src/mole/hodlEpochs.js";

const WEEK = 7 * 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 10, 17);
const epoch = (over = {}) => ({ id: "E1", startMs: START, endMs: START + 13 * WEEK, ...DEFAULT_EPOCH_PARAMS, balanceRates: [...DEFAULT_BALANCE_RATES], ...over });
const holder = (id, balance, activeDays = 0, povScore = 50) => ({ discordUserId: `10000000000000000${id}`, payoutWallet: `Wallet${id}`, balance, activeDays, povScore });

test("the proposed progression: 0.100% .. 0.150%, ceiling 0.0015", () => {
  assert.deepEqual([...DEFAULT_BALANCE_RATES], [0.001, 0.00105, 0.0011, 0.00115, 0.0012, 0.0013, 0.0014, 0.0015]);
  assert.equal(LIMITS.MAX_COMBINED_RATE_PER_WEEK, 0.0015);
  assert.equal(LIMITS.MAX_QUALIFYING_BALANCE, 5_000_000);
});

test("rate follows distinct active days: 1,000,000 earns 1,000 (0 days) to 1,500 (7 days)", () => {
  const r = computeWeeklyAllocation([0, 1, 2, 3, 4, 5, 6, 7].map((d) => holder(d, 1_000_000, d)), epoch({ weeklyPool: 25_000 }));
  assert.deepEqual(r.allocations.map((a) => a.amount), [1000, 1050, 1100, 1150, 1200, 1300, 1400, 1500]);
  assert.ok(r.allocations.every((a) => a.multiplier === 1), "no PoV tier stacked on top");
});

test("active days are clamped to 0..7 and must be whole days", () => {
  const r = computeWeeklyAllocation([holder(1, 1_000_000, 12), holder(2, 1_000_000, -3), holder(3, 1_000_000, 2.9)], epoch());
  assert.deepEqual(r.allocations.map((a) => a.activeDays), [7, 0, 2]);
});

test("the 2,500 per-person cap binds before the 5,000,000 qualifying-balance cap", () => {
  // 0.10% x 2,500,000 = 2,500 already; 0.15% x 1,666,667 = 2,500.
  const r = computeWeeklyAllocation([holder(1, 2_500_000, 0), holder(2, 1_700_000, 7), holder(3, 4_000_000, 7)], epoch());
  assert.deepEqual(r.allocations.map((a) => a.amount), [2500, 2500, 2500]);
});

test("balance above 5,000,000 counts as 5,000,000", () => {
  const r = computeWeeklyAllocation([holder(1, 50_000_000, 7)], epoch());
  assert.equal(r.allocations[0].rateAmount, 7500, "5,000,000 x 0.15%, before the per-person cap");
  assert.equal(r.allocations[0].amount, 2500);
});

test("the weekly pool is a ceiling: proportional, deterministic scaling when exceeded", () => {
  const many = [1, 2, 3, 4, 5, 6].map((i) => holder(i, 3_000_000, 0)); // 6 x 2,500 = 15,000 > 10,000
  const a = computeWeeklyAllocation(many, epoch());
  const b = computeWeeklyAllocation(many, epoch());
  assert.deepEqual(a.allocations, b.allocations, "same inputs, same outputs");
  assert.ok(a.totalAllocated <= 10_000);
  assert.ok(a.allocations.every((x) => x.amount === 1666));
});

test("unknown or tiny balances earn nothing rather than a guess", () => {
  const r = computeWeeklyAllocation([holder(1, null, 7), holder(2, 999, 7)], epoch());
  assert.deepEqual(r.allocations.map((a) => a.amount), [0, 1]);
});

test("governance can change rates only within the hard ceiling, never above it", () => {
  assert.equal(validateEpoch(epoch()).ok, true);
  const over = epoch({ balanceRates: [0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.0016] });
  assert.equal(validateEpoch(over).ok, false);
  assert.match(validateEpoch(over).errors.join(";"), /MAX_COMBINED_RATE_PER_WEEK/);
  assert.equal(validateEpoch(epoch({ balanceRates: [0.001, 0.0011] })).ok, false, "must list 8 rates");
  assert.equal(validateEpoch(epoch({ balanceRates: [0.0012, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001] })).ok, false, "must not decrease");
  // Even a stored over-ceiling table is clamped at computation time.
  const r = computeWeeklyAllocation([holder(1, 1_000_000, 7)], { ...over, weeklyPool: 25_000 });
  assert.equal(r.allocations[0].amount, 1500);
});

test("epochs without balanceRates keep equal shares (balance is not a multiplier there)", () => {
  const { balanceRates, ...equal } = epoch();
  const r = computeWeeklyAllocation([holder(1, 1_000_000, 7), holder(2, 5_000, 0)], equal);
  assert.notEqual(r.mode, "balance-rate");
  assert.equal(r.allocations[0].amount, r.allocations[1].amount);
});

test("the snapshot records rates, active days and the balance cap, so a paid week stays reproducible", () => {
  const s = buildWeeklySnapshot({ epoch: epoch(), participants: [holder(1, 1_000_000, 3)], takenAtMs: START + 1000 });
  assert.deepEqual(s.params.balanceRates, [...DEFAULT_BALANCE_RATES]);
  assert.equal(s.params.maxQualifyingBalance, 5_000_000);
});
