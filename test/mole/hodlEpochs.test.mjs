// HODL Rewards — the epoch engine.
//
// This decides who gets paid and how much, so it is tested like it decides who
// gets paid and how much. Two properties carry the whole design and are pinned
// hardest: the pool is a CEILING that bonuses cannot enlarge, and a bigger
// balance never buys a bigger share.
import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  LIMITS, DEFAULT_EPOCH_PARAMS, INELIGIBLE, RULES_VERSION,
  validateEpoch, weekIndexFor, isPayoutDay, qualifies,
  povMultiplierFor, computeWeeklyAllocation, buildWeeklySnapshot,
} from "../../src/mole/hodlEpochs.js";

const WEEK = 7 * 24 * 60 * 60 * 1000;
const START = new Date(2026, 8, 1).getTime();   // a Tuesday, LOCAL — getDay() is local
const EPOCH = Object.freeze({
  id: "E1", startMs: START, endMs: START + 13 * WEEK, ...DEFAULT_EPOCH_PARAMS,
});
const NOW_SEC = Math.floor(START / 1000);

const holder = (over = {}) => ({
  discordUserId: "u1", payoutWallet: "W1", verified: true,
  verificationExpiresAtSec: NOW_SEC + 86400, balance: 5000, banned: false, ...over,
});
const crowd = (n, povScore = 0) => Array.from({ length: n }, (_, i) => ({
  discordUserId: `u${i}`, payoutWallet: `W${i}`, povScore,
}));

describe("wealth is a threshold, never a multiplier", () => {
  test("a whale and a minimum holder receive exactly the same", () => {
    // The entire point of the program. If this ever fails, HODL Rewards has
    // become Proof of Wealth and should be switched off until it is fixed.
    const out = computeWeeklyAllocation([
      { discordUserId: "whale", payoutWallet: "W", povScore: 0 },
      { discordUserId: "minnow", payoutWallet: "M", povScore: 0 },
    ], EPOCH);
    const [a, b] = out.allocations;
    assert.equal(a.amount, b.amount, "balance leaked into the share calculation");
  });

  test("balance decides eligibility and nothing else", () => {
    assert.equal(qualifies(holder({ balance: 999 }), EPOCH, { nowSec: NOW_SEC }).qualified, false);
    assert.equal(qualifies(holder({ balance: 1000 }), EPOCH, { nowSec: NOW_SEC }).qualified, true);
    assert.equal(qualifies(holder({ balance: 50e6 }), EPOCH, { nowSec: NOW_SEC }).qualified, true);
  });
});

describe("the pool is a ceiling", () => {
  test("the split never exceeds the weekly pool", () => {
    for (const n of [1, 2, 3, 7, 9, 100, 999]) {
      const out = computeWeeklyAllocation(crowd(n), EPOCH);
      assert.ok(out.totalAllocated <= out.weeklyPool,
        `${n} participants allocated ${out.totalAllocated} from a ${out.weeklyPool} pool`);
    }
  });

  test("PoV bonuses redistribute within the pool, they do not enlarge it", () => {
    // Everyone at the top tier: the pool must not grow by 15%.
    const flat = computeWeeklyAllocation(crowd(10, 0), EPOCH);
    const boosted = computeWeeklyAllocation(crowd(10, 95), EPOCH);
    assert.ok(boosted.totalAllocated <= boosted.weeklyPool);
    assert.ok(Math.abs(boosted.totalAllocated - flat.totalAllocated) <= 10,
      "a universal bonus changed the total paid out — bonuses must be relative");
  });

  test("a high-PoV participant takes a bigger slice of the SAME cake", () => {
    // Nine participants — today's real count, and well under the per-head cap,
    // so the bonus is what separates them.
    const out = computeWeeklyAllocation([
      { discordUserId: "a", payoutWallet: "A", povScore: 95 },
      ...crowd(8, 0),
    ], EPOCH);
    const top = out.allocations.find((x) => x.discordUserId === "a");
    const rest = out.allocations.find((x) => x.discordUserId !== "a");
    assert.ok(top.amount > rest.amount, "the PoV bonus did nothing");
    assert.ok(out.totalAllocated <= out.weeklyPool);
  });

  test("with very few qualifiers the per-head cap flattens the bonus", () => {
    // Documented, not accidental. When two people split 10,000 the cap binds at
    // 2,500 each and the PoV tier cannot lift either of them past it. The cap
    // protecting the pool outranks the bonus rewarding participation.
    const out = computeWeeklyAllocation([
      { discordUserId: "a", payoutWallet: "A", povScore: 95 },
      { discordUserId: "b", payoutWallet: "B", povScore: 0 },
    ], EPOCH);
    const [a, b] = out.allocations;
    assert.equal(a.amount, LIMITS.MAX_PER_PARTICIPANT_WEEK);
    assert.equal(a.amount, b.amount, "the cap should flatten both, not just one");
  });

  test("one qualifier cannot take the whole pool", () => {
    // Without a per-participant cap, a quiet week hands one person 10,000.
    const out = computeWeeklyAllocation(crowd(1), EPOCH);
    assert.equal(out.allocations[0].amount, LIMITS.MAX_PER_PARTICIPANT_WEEK);
    assert.equal(out.undistributed, EPOCH.weeklyPool - LIMITS.MAX_PER_PARTICIPANT_WEEK,
      "the capped remainder must stay in the reserve, not be forced onto someone");
  });

  test("zero qualifiers pays nothing and keeps the pool", () => {
    const out = computeWeeklyAllocation([], EPOCH);
    assert.equal(out.totalAllocated, 0);
    assert.equal(out.allocations.length, 0);
    assert.equal(out.undistributed, EPOCH.weeklyPool);
  });

  test("it stays a slow grind at today's participation", () => {
    // 9 verified wallets, 10,000/wk. A daily faucet claimer earns 10,500/wk;
    // HODL must stay far below that or the brief has been missed.
    const out = computeWeeklyAllocation(crowd(9), EPOCH);
    const each = out.allocations[0].amount;
    assert.ok(each < 1500, `${each}/wk per wallet is not a slow grind`);
    assert.ok(each > 500, `${each}/wk is too small to notice`);
  });

  test("shares shrink as participation grows — the intended dynamic", () => {
    const at9 = computeWeeklyAllocation(crowd(9), EPOCH).allocations[0].amount;
    const at90 = computeWeeklyAllocation(crowd(90), EPOCH).allocations[0].amount;
    const at900 = computeWeeklyAllocation(crowd(900), EPOCH).allocations[0].amount;
    assert.ok(at9 > at90 && at90 > at900);
    assert.ok(at900 >= 0, "large participation must not produce a negative share");
  });
});

describe("governance cannot authorise an unbounded payout", () => {
  test("a pool above the hard ceiling is refused", () => {
    const res = validateEpoch({ ...EPOCH, weeklyPool: LIMITS.MAX_WEEKLY_POOL + 1 });
    assert.equal(res.ok, false);
    assert.match(res.errors.join(" "), /exceeds MAX_WEEKLY_POOL/);
  });

  test("a bonus tier above the ceiling is refused, and clamped anyway", () => {
    const bad = { ...EPOCH, povBonusTiers: [{ minScore: 0, multiplier: 5 }] };
    assert.equal(validateEpoch(bad).ok, false);
    // Belt and braces: even if such an epoch were somehow stored, the runtime
    // clamps it. Validation is a gate, not the only defence.
    assert.equal(povMultiplierFor(100, bad), LIMITS.MAX_POV_BONUS_MULTIPLIER);
  });

  test("a tier may not pay less than the base", () => {
    assert.equal(validateEpoch({ ...EPOCH, povBonusTiers: [{ minScore: 0, multiplier: 0.5 }] }).ok, false);
    assert.equal(povMultiplierFor(0, { povBonusTiers: [{ minScore: 0, multiplier: 0.5 }] }), 1);
  });

  test("nonsense epochs are refused with every reason at once", () => {
    const res = validateEpoch({ weeklyPool: -1, startMs: 100, endMs: 50, minHold: -5, payoutDay: 9 });
    assert.equal(res.ok, false);
    assert.ok(res.errors.length >= 4, `expected several errors, got ${res.errors.length}`);
  });

  test("the approved defaults pass their own validator", () => {
    assert.equal(validateEpoch(EPOCH).ok, true, validateEpoch(EPOCH).errors.join("; "));
    assert.ok(DEFAULT_EPOCH_PARAMS.weeklyPool <= LIMITS.MAX_WEEKLY_POOL);
  });
});

describe("who qualifies", () => {
  test("a verified holder in good standing does", () => {
    assert.deepEqual(qualifies(holder(), EPOCH, { nowSec: NOW_SEC }), { qualified: true, reasons: [] });
  });

  test("unverified, expired, banned and walletless do not", () => {
    const cases = [
      [{ verified: false, verificationExpiresAtSec: 0 }, INELIGIBLE.NOT_VERIFIED],
      // verified:false WITH a past expiry means it lapsed, not that it never
      // happened — a different problem with a different fix.
      [{ verified: false, verificationExpiresAtSec: NOW_SEC - 1 }, INELIGIBLE.VERIFICATION_EXPIRED],
      [{ verificationExpiresAtSec: NOW_SEC - 1 }, INELIGIBLE.VERIFICATION_EXPIRED],
      [{ banned: true }, INELIGIBLE.BANNED],
      [{ payoutWallet: null }, INELIGIBLE.NO_PAYOUT_WALLET],
      [{ balance: 0 }, INELIGIBLE.BELOW_MIN_HOLD],
    ];
    for (const [over, reason] of cases) {
      const res = qualifies(holder(over), EPOCH, { nowSec: NOW_SEC });
      assert.equal(res.qualified, false, `${reason} should disqualify`);
      assert.ok(res.reasons.includes(reason), `expected ${reason}, got ${res.reasons}`);
    }
  });

  test("an unreadable balance fails CLOSED", () => {
    // Same rule the faucet applies: "cannot verify" must never mean "eligible".
    for (const balance of [undefined, null, NaN, "lots"]) {
      const res = qualifies(holder({ balance }), EPOCH, { nowSec: NOW_SEC });
      assert.equal(res.qualified, false, `balance=${balance} was treated as eligible`);
      assert.ok(res.reasons.includes(INELIGIBLE.BALANCE_UNKNOWN));
    }
  });

  test("every reason is reported, not just the first", () => {
    const res = qualifies({ verified: false, banned: true, balance: 0 }, EPOCH, { nowSec: NOW_SEC });
    assert.ok(res.reasons.length >= 3, `expected several reasons, got ${res.reasons}`);
  });
});

describe("the calendar", () => {
  test("Tuesday is the payout day, and it is a parameter", () => {
    assert.equal(isPayoutDay(EPOCH, new Date(2026, 8, 1)), true);   // a Tuesday
    assert.equal(isPayoutDay(EPOCH, new Date(2026, 8, 2)), false);
    // Changeable without touching code, so the day can gain meaning later.
    assert.equal(isPayoutDay({ ...EPOCH, payoutDay: 5 }, new Date(2026, 8, 4)), true);
  });

  test("week indices are 1-based and stable", () => {
    assert.equal(weekIndexFor(EPOCH, START), 1);
    assert.equal(weekIndexFor(EPOCH, START + WEEK), 2);
    assert.equal(weekIndexFor(EPOCH, START + 12 * WEEK + 1), 13);
    assert.equal(weekIndexFor(EPOCH, START - 1), null, "before an epoch starts there is no week");
  });
});

describe("a snapshot stays true after the epoch changes", () => {
  test("parameters are copied by value, not referenced", () => {
    const epoch = { ...EPOCH, weeklyPool: 10_000, povBonusTiers: [...EPOCH.povBonusTiers] };
    const snap = buildWeeklySnapshot({ epoch, participants: crowd(5), takenAtMs: START });
    epoch.weeklyPool = 25_000;
    epoch.povBonusTiers.push({ minScore: 1, multiplier: 1.15 });
    assert.equal(snap.params.weeklyPool, 10_000, "editing the epoch rewrote a past week");
    assert.equal(snap.params.povBonusTiers.length, DEFAULT_EPOCH_PARAMS.povBonusTiers.length);
  });

  test("a snapshot records enough to reproduce the arithmetic", () => {
    const snap = buildWeeklySnapshot({ epoch: EPOCH, participants: crowd(9), takenAtMs: START });
    for (const field of ["epochId", "weekIndex", "takenAtIso", "params", "qualifiedCount", "baseShare", "allocations", "totalAllocated", "undistributed", "rulesVersion"]) {
      assert.ok(field in snap, `snapshot is missing ${field}`);
    }
    assert.equal(snap.rulesVersion, RULES_VERSION);
    assert.equal(snap.allocations.reduce((s, a) => s + a.amount, 0), snap.totalAllocated);
  });

  test("the same inputs always produce the same snapshot", () => {
    const a = buildWeeklySnapshot({ epoch: EPOCH, participants: crowd(9), takenAtMs: START });
    const b = buildWeeklySnapshot({ epoch: EPOCH, participants: crowd(9), takenAtMs: START });
    assert.deepEqual(a, b, "the snapshot is not deterministic");
  });
});

describe("amounts are payable", () => {
  test("every allocation is a whole number", () => {
    // Fractional tokens cost a transaction fee to move and clutter every
    // record they touch.
    for (const n of [3, 7, 9, 11, 97]) {
      for (const a of computeWeeklyAllocation(crowd(n, 55), EPOCH).allocations) {
        assert.ok(Number.isInteger(a.amount), `${a.amount} is not a whole number`);
      }
    }
  });

  test("no allocation is negative", () => {
    for (const a of computeWeeklyAllocation(crowd(5000), EPOCH).allocations) {
      assert.ok(a.amount >= 0);
    }
  });
});
