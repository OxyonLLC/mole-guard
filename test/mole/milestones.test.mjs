// Pure-function tests for the Version 2.2 dashboard milestone derivation.
// No I/O — matches the test convention already used for platform-stats.js
// and proofOfValue.js.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeMilestones } from '../../src/mole/milestones.js';

const NONE = {
  verified: false,
  questionWins: 0,
  quizLifetimePoints: 0,
  faucetConfirmedClaims: 0,
  gameTotalClaims: 0,
  povTier: 'Newcomer',
};

function findMilestone(items, id) {
  return items.find((m) => m.id === id);
}

describe('milestones: computeMilestones', () => {
  test('a brand-new user has every milestone unachieved', () => {
    const items = computeMilestones(NONE);
    assert.ok(items.length > 0);
    assert.ok(items.every((m) => m.achieved === false));
  });

  test('each milestone flips independently based on its own signal', () => {
    assert.equal(findMilestone(computeMilestones({ ...NONE, verified: true }), 'wallet_verified').achieved, true);
    assert.equal(findMilestone(computeMilestones({ ...NONE, questionWins: 1 }), 'first_quiz_completed').achieved, true);
    assert.equal(findMilestone(computeMilestones({ ...NONE, faucetConfirmedClaims: 1 }), 'first_faucet_claim').achieved, true);
    assert.equal(findMilestone(computeMilestones({ ...NONE, gameTotalClaims: 1 }), 'first_game_reward').achieved, true);
  });

  test('unrelated signals do not cross-trigger other milestones', () => {
    const items = computeMilestones({ ...NONE, verified: true });
    assert.equal(findMilestone(items, 'first_quiz_completed').achieved, false);
    assert.equal(findMilestone(items, 'first_faucet_claim').achieved, false);
    assert.equal(findMilestone(items, 'first_game_reward').achieved, false);
  });

  test('pov_contributor is achieved for Contributor, Pillar, and Legend tiers, not Newcomer/Participant', () => {
    assert.equal(findMilestone(computeMilestones({ ...NONE, povTier: 'Newcomer' }), 'pov_contributor').achieved, false);
    assert.equal(findMilestone(computeMilestones({ ...NONE, povTier: 'Participant' }), 'pov_contributor').achieved, false);
    assert.equal(findMilestone(computeMilestones({ ...NONE, povTier: 'Contributor' }), 'pov_contributor').achieved, true);
    assert.equal(findMilestone(computeMilestones({ ...NONE, povTier: 'Pillar' }), 'pov_contributor').achieved, true);
    assert.equal(findMilestone(computeMilestones({ ...NONE, povTier: 'Legend' }), 'pov_contributor').achieved, true);
  });

  test('quiz point thresholds are independently achieved as lifetime points cross each one', () => {
    const under = computeMilestones({ ...NONE, quizLifetimePoints: 499 });
    assert.equal(findMilestone(under, 'quiz_points_500').achieved, false);
    assert.equal(findMilestone(under, 'quiz_points_2000').achieved, false);

    const mid = computeMilestones({ ...NONE, quizLifetimePoints: 500 });
    assert.equal(findMilestone(mid, 'quiz_points_500').achieved, true);
    assert.equal(findMilestone(mid, 'quiz_points_2000').achieved, false);

    const high = computeMilestones({ ...NONE, quizLifetimePoints: 2000 });
    assert.equal(findMilestone(high, 'quiz_points_500').achieved, true);
    assert.equal(findMilestone(high, 'quiz_points_2000').achieved, true);
  });

  test('a heavy long-term user has every milestone achieved', () => {
    const items = computeMilestones({
      verified: true,
      questionWins: 500,
      quizLifetimePoints: 50_000,
      faucetConfirmedClaims: 200,
      gameTotalClaims: 300,
      povTier: 'Legend',
      hasContributed: true,
    });
    assert.ok(items.every((m) => m.achieved === true));
  });

  test('missing input fields default safely instead of throwing', () => {
    assert.doesNotThrow(() => computeMilestones());
    assert.doesNotThrow(() => computeMilestones({}));
  });

  test('progress is 0 for an unachieved binary milestone and 1 once achieved (Version 2.3)', () => {
    const before = findMilestone(computeMilestones({ ...NONE, faucetConfirmedClaims: 0 }), 'first_faucet_claim');
    assert.equal(before.progress, 0);
    const after = findMilestone(computeMilestones({ ...NONE, faucetConfirmedClaims: 3 }), 'first_faucet_claim');
    assert.equal(after.progress, 1);
  });

  test('progress for a threshold milestone is the honest fraction toward that threshold (Version 2.3)', () => {
    const items = computeMilestones({ ...NONE, quizLifetimePoints: 250 });
    const m = findMilestone(items, 'quiz_points_500');
    assert.equal(m.achieved, false);
    assert.equal(m.progress, 0.5);
  });

  test('pov_contributor progress derives from proofOfValue.js TIERS\' Contributor floor (45 as of v2.4)', () => {
    const items = computeMilestones({ ...NONE, povTier: 'Newcomer', povScore: 22.5 });
    const m = findMilestone(items, 'pov_contributor');
    assert.equal(m.achieved, false);
    assert.equal(m.progress, 0.5); // 22.5 / 45
  });

  test('cause_contributor (2026-07-19) is unachieved by default and flips independently of every other signal', () => {
    assert.equal(findMilestone(computeMilestones(NONE), 'cause_contributor').achieved, false);
    const withContribution = computeMilestones({ ...NONE, hasContributed: true });
    assert.equal(findMilestone(withContribution, 'cause_contributor').achieved, true);
    // Unrelated milestones must not cross-trigger from hasContributed.
    assert.equal(findMilestone(withContribution, 'wallet_verified').achieved, false);
    assert.equal(findMilestone(withContribution, 'first_quiz_completed').achieved, false);
  });

  test('cause_contributor carries variant:"contribution" so the dashboard can sort/color it distinctly', () => {
    const m = findMilestone(computeMilestones({ ...NONE, hasContributed: true }), 'cause_contributor');
    assert.equal(m.variant, 'contribution');
  });

  test('every milestone has a stable id and a human label', () => {
    const items = computeMilestones(NONE);
    const ids = new Set();
    for (const m of items) {
      assert.equal(typeof m.id, 'string');
      assert.ok(m.id.length > 0);
      assert.equal(ids.has(m.id), false, `duplicate milestone id: ${m.id}`);
      ids.add(m.id);
      assert.equal(typeof m.label, 'string');
      assert.ok(m.label.length > 0);
    }
  });
});
