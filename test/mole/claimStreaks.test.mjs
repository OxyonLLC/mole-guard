// Consecutive-day claim streaks.
//
// This changes how much the faucet pays, and the faucet is the largest outflow
// in the project. The tests care about two things: the curve is bounded, and it
// is forgiving of ordinary human irregularity.
import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  streakBonus, hasTopNotchBadge, streakTransition, nextStreak, evaluateStreak,
  STREAK_TIERS, TOP_NOTCH_BADGE,
} from "../../src/mole/claimStreaks.js";

const DAY = 86_400_000;

describe("the curve", () => {
  test("day one earns one, not thirty", () => {
    assert.equal(streakBonus(1), 1);
    assert.equal(streakBonus(0), 0);
    assert.equal(streakBonus(-5), 0, "a negative streak must not pay");
  });

  test("+1/day for the first thirty days", () => {
    assert.equal(streakBonus(7), 7);
    assert.equal(streakBonus(30), 30);
  });

  test("the rate doubles after day 30, with no cliff", () => {
    // A discontinuity would mean someone's bonus DROPS on the day the rate
    // improves, which reads as a bug however it is explained.
    assert.equal(streakBonus(31), 32);
    for (let d = 2; d <= 60; d += 1) {
      assert.ok(streakBonus(d, { verified: true }) >= streakBonus(d - 1, { verified: true }),
        `the bonus fell between day ${d - 1} and ${d}`);
    }
  });
});

describe("it is bounded, in both directions", () => {
  test("unverified stops at +60", () => {
    assert.equal(streakBonus(45), STREAK_TIERS.UNVERIFIED_CAP);
    assert.equal(streakBonus(500), STREAK_TIERS.UNVERIFIED_CAP);
    assert.equal(streakBonus(100000), STREAK_TIERS.UNVERIFIED_CAP, "an unbounded streak paid an unbounded bonus");
  });

  test("verifying is what carries you past 60", () => {
    // The spec said the bonus caps at 60 AND that a badge waits at 100, which
    // cannot both be true. "Verify and you gain MORE" is the bridge.
    assert.equal(streakBonus(50), 60);
    assert.equal(streakBonus(50, { verified: true }), 70);
    assert.equal(streakBonus(65, { verified: true }), STREAK_TIERS.VERIFIED_CAP);
    assert.equal(streakBonus(9999, { verified: true }), STREAK_TIERS.VERIFIED_CAP);
  });

  test("the badge is reachable, and only by verifying", () => {
    assert.equal(hasTopNotchBadge(9999), false, "an unverified claimer reached a verified-only badge");
    assert.equal(hasTopNotchBadge(65, { verified: true }), true);
    assert.equal(TOP_NOTCH_BADGE.requirement, STREAK_TIERS.VERIFIED_CAP);
  });

  test("the biggest possible bonus is small next to the base drip", () => {
    // 1500/day base. If this ever approaches the drip itself, the faucet has
    // quietly become a streak game.
    assert.ok(STREAK_TIERS.VERIFIED_CAP < 1500 * 0.1,
      `a +${STREAK_TIERS.VERIFIED_CAP} bonus is more than 10% of the drip`);
  });
});

describe("forgiving of ordinary lives", () => {
  const at = (day, hour = 12) => day * DAY + hour * 3_600_000;

  test("claiming earlier the next morning still continues the streak", () => {
    // 9am then 8am the next day is 23 hours apart. Counting 24-hour windows
    // would break the streak and tell someone consistent that they were not.
    assert.equal(streakTransition(at(10, 9), at(11, 8)), "continues");
  });

  test("twice in one day does not double-count", () => {
    assert.equal(streakTransition(at(10, 9), at(10, 20)), "same-day");
    assert.equal(nextStreak(5, "same-day"), 5);
  });

  test("a missed day resets to 1, not 0", () => {
    // The claim being made right now is itself day one of the next streak.
    assert.equal(streakTransition(at(10), at(12)), "broken");
    assert.equal(nextStreak(30, "broken"), 1);
  });

  test("a first-ever claim starts at 1", () => {
    assert.equal(streakTransition(null, at(1)), "first");
    assert.equal(nextStreak(0, "first"), 1);
  });
});

describe("evaluateStreak", () => {
  test("a continuing verified claimer at the cap earns the badge", () => {
    const out = evaluateStreak({ lastClaimMs: 64 * DAY, currentStreak: 64, verified: true, nowMs: 65 * DAY });
    assert.equal(out.transition, "continues");
    assert.equal(out.streak, 65);
    assert.equal(out.bonus, 100);
    assert.equal(out.atCap, true);
    assert.equal(out.badge, TOP_NOTCH_BADGE.id);
  });

  test("a broken streak drops the bonus back to 1", () => {
    const out = evaluateStreak({ lastClaimMs: 10 * DAY, currentStreak: 40, verified: true, nowMs: 20 * DAY });
    assert.equal(out.streak, 1);
    assert.equal(out.bonus, 1);
    assert.equal(out.badge, null);
  });

  test("an unverified claimer is told their own cap, not the verified one", () => {
    const out = evaluateStreak({ lastClaimMs: null, currentStreak: 0, verified: false });
    assert.equal(out.cap, STREAK_TIERS.UNVERIFIED_CAP);
  });
});
