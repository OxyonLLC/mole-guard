// Pure-function tests for the Version 2.1 Proof of Value engine. These only
// exercise combineProofOfValue/povScale/etc — no quiz/faucet/games/wallet
// storage is touched, matching src/quiz/platform-stats.js's test convention
// of testing the scoring math independent of I/O.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  combineProofOfValue,
  povScale,
  tierForScore,
  tierProgress,
  verificationSubScore,
  computeStreakMultiplier,
  POV_WEIGHTS,
  POV_CURVE_EXPONENT,
  POV_REWARD_MULTIPLIERS,
  TIERS,
} from '../../src/mole/proofOfValue.js';

const EMPTY_SIGNALS = {
  quiz: { lifetimePoints: 0, currentStreak: 0, bestStreak: 0 },
  faucet: { confirmedClaims: 0, totalClaims: 0 },
  games: { totalClaims: 0, totalPayout: 0 },
  verification: { verified: false, wallet: null },
};

describe('proofOfValue: povScale', () => {
  test('zero value is zero', () => {
    assert.equal(povScale(0, 100), 0);
  });

  test('value at the cap is exactly 100', () => {
    assert.equal(povScale(100, 100), 100);
  });

  test('a value beyond the cap is clamped to 100, never over', () => {
    assert.equal(povScale(10_000, 100), 100);
  });

  test('diminishing returns: doubling a small value less than doubles the score', () => {
    const a = povScale(10, 1000);
    const b = povScale(20, 1000);
    assert.ok(b > a);
    assert.ok(b < a * 2);
  });

  test('v2.5 curve is slower than the old sqrt: the exponent is 0.75 and a quarter of the cap scores well under half', () => {
    assert.equal(POV_CURVE_EXPONENT, 0.75);
    // 100 * 0.25^0.75 ≈ 35.36 (the old sqrt gave 50 here)
    const quarter = povScale(25, 100);
    assert.ok(Math.abs(quarter - 35.36) < 0.01);
    assert.ok(quarter < 100 * Math.sqrt(0.25));
  });

  test('two weeks of daily play lands mid-Participant territory, not near the top', () => {
    // 14 of 180 daily faucet claims (~2 weeks of a 6-month cap) ≈ 14.7/100.
    const sub = povScale(14, 180);
    assert.ok(sub > 10 && sub < 20);
  });

  test('a non-positive cap never divides by zero or returns NaN/Infinity', () => {
    assert.equal(povScale(50, 0), 0);
    assert.equal(povScale(50, -10), 0);
  });

  test('negative or garbage input is treated as zero, never a negative score', () => {
    assert.equal(povScale(-50, 100), 0);
    assert.equal(povScale(NaN, 100), 0);
    assert.equal(povScale(undefined, 100), 0);
  });
});

describe('proofOfValue: tierForScore', () => {
  test('bands are contiguous from 0 to 100 with no gaps', () => {
    assert.equal(tierForScore(0), 'Newcomer');
    assert.equal(tierForScore(19), 'Newcomer');
    assert.equal(tierForScore(20), 'Participant');
    assert.equal(tierForScore(44), 'Participant');
    assert.equal(tierForScore(45), 'Contributor');
    assert.equal(tierForScore(69), 'Contributor');
    assert.equal(tierForScore(70), 'Pillar');
    assert.equal(tierForScore(89), 'Pillar');
    assert.equal(tierForScore(90), 'Legend');
    assert.equal(tierForScore(100), 'Legend');
  });
});

describe('proofOfValue: verificationSubScore', () => {
  test('currently verified gets full credit', () => {
    assert.equal(verificationSubScore({ verified: true, wallet: 'abc' }), 100);
  });

  test('a wallet on file but expired gets partial credit, not zero', () => {
    assert.equal(verificationSubScore({ verified: false, wallet: 'abc' }), 40);
  });

  test('never linked gets zero', () => {
    assert.equal(verificationSubScore({ verified: false, wallet: null }), 0);
    assert.equal(verificationSubScore(undefined), 0);
  });
});

describe('proofOfValue: computeStreakMultiplier', () => {
  test('no streak is a 1.0x (no-op) multiplier', () => {
    assert.equal(computeStreakMultiplier(0), 1);
    assert.equal(computeStreakMultiplier(undefined), 1);
  });

  test('a small streak adds a proportional small bonus', () => {
    assert.equal(computeStreakMultiplier(5), 1.025);
  });

  test('the bonus is capped so a huge streak cannot dominate the score', () => {
    assert.equal(computeStreakMultiplier(1000), 1.10);
  });
});

describe('proofOfValue: combineProofOfValue', () => {
  test('a brand-new user with zero activity anywhere scores 0, tier Newcomer', () => {
    const result = combineProofOfValue(EMPTY_SIGNALS);
    assert.equal(result.score, 0);
    assert.equal(result.tier, 'Newcomer');
    assert.equal(result.streakMultiplier, 1);
  });

  test('the four weights sum to 1 (balanced ~25% each, per confirmed product decision)', () => {
    const sum = Object.values(POV_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9);
    assert.equal(POV_WEIGHTS.quiz, 0.25);
    assert.equal(POV_WEIGHTS.faucet, 0.25);
    assert.equal(POV_WEIGHTS.games, 0.25);
    assert.equal(POV_WEIGHTS.verification, 0.25);
  });

  test('a user maxed out on every input scores 100 regardless of streak (clamped, never over 100)', () => {
    const result = combineProofOfValue({
      quiz: { lifetimePoints: 999_999, currentStreak: 999, bestStreak: 999 },
      faucet: { confirmedClaims: 999, totalClaims: 999 },
      games: { totalClaims: 999, totalPayout: 999 },
      verification: { verified: true, wallet: 'abc' },
    });
    assert.equal(result.score, 100);
    assert.equal(result.tier, 'Legend');
  });

  test('activity in only one of the four systems still produces a nonzero, proportionate score', () => {
    const result = combineProofOfValue({
      ...EMPTY_SIGNALS,
      verification: { verified: true, wallet: 'abc' },
    });
    // verification alone contributes its full 25% weight, nothing else does.
    assert.equal(result.baseScore, 25);
    assert.equal(result.score, 25);
  });

  test('the breakdown surfaces a sub-score plus the raw signal for every component', () => {
    const result = combineProofOfValue({
      quiz: { lifetimePoints: 1000, currentStreak: 3, bestStreak: 10 },
      faucet: { confirmedClaims: 5, totalClaims: 6 },
      games: { totalClaims: 10, totalPayout: 42.5 },
      verification: { verified: true, wallet: 'abc' },
    });
    assert.ok(result.breakdown.quiz.subScore > 0);
    assert.equal(result.breakdown.quiz.lifetimePoints, 1000);
    assert.ok(result.breakdown.faucet.subScore > 0);
    assert.equal(result.breakdown.faucet.confirmedClaims, 5);
    assert.ok(result.breakdown.games.subScore > 0);
    assert.equal(result.breakdown.games.totalPayout, 42.5);
    assert.equal(result.breakdown.verification.subScore, 100);
  });

  test('a real streak nudges the final score above the unmultiplied base, without changing the base itself', () => {
    const noStreak = combineProofOfValue({
      ...EMPTY_SIGNALS,
      quiz: { lifetimePoints: 1000, currentStreak: 0, bestStreak: 0 },
    });
    const withStreak = combineProofOfValue({
      ...EMPTY_SIGNALS,
      quiz: { lifetimePoints: 1000, currentStreak: 10, bestStreak: 10 },
    });
    assert.equal(noStreak.baseScore, withStreak.baseScore);
    assert.ok(withStreak.score >= noStreak.score);
    assert.equal(withStreak.streakMultiplier, 1.05);
  });

  test('is pure — the same input always produces the same output, no shared mutable state', () => {
    const input = {
      quiz: { lifetimePoints: 250, currentStreak: 2, bestStreak: 4 },
      faucet: { confirmedClaims: 3, totalClaims: 3 },
      games: { totalClaims: 1, totalPayout: 5 },
      verification: { verified: false, wallet: 'abc' },
    };
    const a = combineProofOfValue(input);
    const b = combineProofOfValue(input);
    assert.deepEqual(a, b);
  });
});

describe('proofOfValue: tierProgress (Version 2.3)', () => {
  test('reuses the exact same tier bands tierForScore() uses — no second threshold set', () => {
    assert.equal(tierProgress(0).tier, tierForScore(0));
    assert.equal(tierProgress(55).tier, tierForScore(55));
    assert.equal(tierProgress(100).tier, tierForScore(100));
  });

  test('reports the next tier and exact points remaining', () => {
    const result = tierProgress(30);
    assert.equal(result.tier, 'Participant');
    assert.equal(result.nextTier, 'Contributor');
    assert.equal(result.pointsToNextTier, 15);
  });

  test('at the top tier (Legend), there is no next tier and 0 points remaining', () => {
    const result = tierProgress(95);
    assert.equal(result.tier, 'Legend');
    assert.equal(result.nextTier, null);
    assert.equal(result.pointsToNextTier, 0);
  });

  test('exactly at a tier boundary counts as already in that tier, not "0 points from itself"', () => {
    const result = tierProgress(45);
    assert.equal(result.tier, 'Contributor');
    assert.equal(result.nextTier, 'Pillar');
    assert.equal(result.pointsToNextTier, 25);
  });

  test('out-of-range/garbage scores are clamped, never negative or NaN', () => {
    assert.equal(tierProgress(-50).tier, 'Newcomer');
    assert.equal(tierProgress(-50).pointsToNextTier, 20);
    assert.equal(tierProgress(500).tier, 'Legend');
    assert.equal(tierProgress(NaN).tier, 'Newcomer');
  });
});

// Added 2026-08-05 during the /proof-of-value/ audit, which found the public
// page describing the engine wrongly in two separate ways at once:
//   1. it called the curve "a square-root curve" — true of v2.4, but the
//      exponent was deliberately softened to 0.75 in v2.5 so reaching the top
//      is a ~6-month task, and
//   2. it claimed Proof of Value "never touches a payout-eligible field",
//      while povRewardMultiplier() was already changing what Quiz and Mole Hub
//      claims actually pay.
//
// Both were silent drift: nothing tied the prose to the constants. These tests
// do, by parsing the published page. They are deliberately loose about wording
// and strict about numbers — the page should stay free to be rewritten, but not
// free to state a percentage the engine does not implement.
describe('proofOfValue: the public page cannot drift from the engine', () => {
  const pagePath = new URL('../../src/public/proof-of-value/index.html', import.meta.url);

  // Compare against the RENDERED text, not the markup: the tier ladder splits
  // every label and its range into separate spans, so "Legend" and "90" are
  // adjacent on screen but not in the HTML. Stripping tags also keeps these
  // tests from breaking on harmless restyling. Assertions use ok() rather than
  // match() so a failure reports the claim, not the entire page.
  async function pageText() {
    const { readFileSync } = await import('node:fs');
    return readFileSync(pagePath, 'utf8')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ');
  }

  test('every tier bonus printed on the page matches POV_REWARD_MULTIPLIERS', async () => {
    const text = await pageText();
    for (const [tier, multiplier] of Object.entries(POV_REWARD_MULTIPLIERS)) {
      const pct = Math.round((multiplier - 1) * 100);
      if (pct === 0) continue; // Newcomer/Participant earn no bonus, nothing to print
      assert.ok(
        new RegExp(`${tier}\\s*\\+${pct}%`).test(text),
        `page must state "${tier} +${pct}%" — POV_REWARD_MULTIPLIERS says ${multiplier}`,
      );
    }
  });

  test('the page does not claim the curve is a square root', async () => {
    const text = await pageText();
    if (POV_CURVE_EXPONENT !== 0.5) {
      assert.ok(
        !/square[- ]root/i.test(text),
        `POV_CURVE_EXPONENT is ${POV_CURVE_EXPONENT}, so the page must not call the curve a square root`,
      );
    }
  });

  test('the page does not claim PoV leaves payouts untouched', async () => {
    const text = await pageText();
    if (Object.values(POV_REWARD_MULTIPLIERS).some((m) => m > 1)) {
      assert.ok(
        !/never touches a payout-eligible field/i.test(text),
        'a tier multiplier above 1 changes real payouts, so the page must not deny it',
      );
    }
  });

  test('every tier boundary printed on the page matches TIERS', async () => {
    const text = await pageText();
    for (const { min, label } of TIERS) {
      assert.ok(
        new RegExp(`${label}\\s*${min}`).test(text),
        `page must show "${label}" starting at ${min} — TIERS says that tier begins there`,
      );
    }
  });
});

// ── HODL consistency as a streak signal (v4) ─────────────────────────────────
//
// The spec asked that qualifying for HODL feed Proof of Value, with an explicit
// warning: DO NOT make wallet balance the score. These tests exist to enforce
// that, and to enforce that adding a new program did not quietly change what
// everyone else's score already was.
describe("HODL Rewards feed the streak, not a new weight", () => {
  const base = () => ({
    quiz: { lifetimePoints: 500, currentStreak: 0 },
    faucet: { confirmedClaims: 10 },
    games: { totalClaims: 5 },
    verification: { verified: true },
  });

  test("the four existing weights are untouched", () => {
    // A fifth weight would have diluted quiz/faucet/games/verification from
    // 0.25 to 0.20 each — changing everyone's existing score to make room for a
    // new program.
    const out = combineProofOfValue(base());
    assert.deepEqual(out.weights, { quiz: 0.25, faucet: 0.25, games: 0.25, verification: 0.25 });
  });

  test("a user with no HODL history scores exactly what they always did", () => {
    const before = combineProofOfValue(base());
    const withEmpty = combineProofOfValue({ ...base(), hodl: { consecutiveWeeks: 0, qualifiedWeeks: 0 } });
    assert.equal(before.score, withEmpty.score, "shipping HODL changed a non-participant's score");
    assert.equal(before.streakMultiplier, 1);
  });

  test("consecutive qualified weeks raise the multiplier", () => {
    const none = combineProofOfValue({ ...base(), hodl: { consecutiveWeeks: 0 } });
    const some = combineProofOfValue({ ...base(), hodl: { consecutiveWeeks: 4 } });
    assert.ok(some.streakMultiplier > none.streakMultiplier);
  });

  test("BALANCE IS NOT AN INPUT — only weeks are", () => {
    // The spec's explicit warning. If a balance ever reaches this function,
    // Proof of Value has become Proof of Wealth.
    const poor = combineProofOfValue({ ...base(), hodl: { consecutiveWeeks: 6, balance: 1_000 } });
    const rich = combineProofOfValue({ ...base(), hodl: { consecutiveWeeks: 6, balance: 50_000_000 } });
    assert.equal(poor.score, rich.score, "a bigger balance produced a bigger Proof of Value score");
  });

  test("quiz and HODL share ONE cap and cannot stack past it", () => {
    // Two streak signals must not become two bonuses. The ceiling on the whole
    // score does not move because a new program exists.
    const quizMax = combineProofOfValue({ ...base(), quiz: { lifetimePoints: 500, currentStreak: 100 } });
    const both = combineProofOfValue({
      ...base(), quiz: { lifetimePoints: 500, currentStreak: 100 }, hodl: { consecutiveWeeks: 52 },
    });
    assert.equal(both.streakMultiplier, quizMax.streakMultiplier, "the two streaks stacked");
    assert.ok(both.streakMultiplier <= 1.1, `multiplier ${both.streakMultiplier} exceeded the +10% cap`);
  });

  test("a full quarter of qualification reaches the cap, and no further", () => {
    const quarter = combineProofOfValue({ ...base(), hodl: { consecutiveWeeks: 13 } });
    const forever = combineProofOfValue({ ...base(), hodl: { consecutiveWeeks: 500 } });
    assert.equal(quarter.streakMultiplier, 1.1);
    assert.equal(forever.streakMultiplier, 1.1, "unbounded weeks produced an unbounded bonus");
  });

  test("the score is still capped at 100 overall", () => {
    const out = combineProofOfValue({
      quiz: { lifetimePoints: 1e9, currentStreak: 1e6 },
      faucet: { confirmedClaims: 1e6 }, games: { totalClaims: 1e6 },
      verification: { verified: true }, hodl: { consecutiveWeeks: 1e6 },
    });
    assert.ok(out.score <= 100);
  });

  test("HODL is reported in the breakdown without a weighted sub-score", () => {
    const out = combineProofOfValue({ ...base(), hodl: { consecutiveWeeks: 3, qualifiedWeeks: 5 } });
    assert.equal(out.breakdown.hodl.consecutiveWeeks, 3);
    assert.equal(out.breakdown.hodl.qualifiedWeeks, 5);
    assert.ok(!("subScore" in out.breakdown.hodl), "HODL must not become a weighted bucket");
    assert.match(out.streakSource, /hodl/);
  });
});
