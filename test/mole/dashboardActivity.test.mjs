// Pure-function tests for the Version 2.2 dashboard recent-activity merge.
// No I/O — record arrays are passed in directly, matching this session's
// established pure-function test convention (platform-stats.js, proofOfValue.js).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecentActivity } from '../../src/mole/dashboardActivity.js';

describe('dashboardActivity: buildRecentActivity', () => {
  test('empty everything produces an empty, non-null items list', () => {
    const result = buildRecentActivity({});
    assert.deepEqual(result.items, []);
  });

  test('only confirmed faucet claims appear, not reserved/failed ones', () => {
    const result = buildRecentActivity({
      faucetClaims: [
        { status: 'confirmed', createdAt: 1000, amountDisplay: '50', source: 'web' },
        { status: 'reserved', createdAt: 2000, amountDisplay: '50', source: 'web' },
        { status: 'known_failed', createdAt: 3000, amountDisplay: '50', source: 'web' },
      ],
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].type, 'faucet_claim');
    assert.equal(result.items[0].at, 1000);
  });

  test('game reward claims are included, using claimedAt (an ISO string)', () => {
    const result = buildRecentActivity({
      gameHistory: [{ game: 'diglew', roundLabel: 'DigLEW Round 1', payout: 12.5, claimedAt: '2026-01-01T00:00:00.000Z' }],
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].type, 'game_reward');
    assert.equal(result.items[0].detail.game, 'diglew');
    assert.equal(result.items[0].at, Date.parse('2026-01-01T00:00:00.000Z'));
  });

  test('quiz redemptions are included, using the ts field (epoch ms)', () => {
    const result = buildRecentActivity({
      quizRedemptions: [{ status: 'paid', amount: 100, ts: 5000 }],
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].type, 'quiz_redemption');
    assert.equal(result.items[0].at, 5000);
  });

  test('items from all three sources are merged and sorted newest-first', () => {
    const result = buildRecentActivity({
      faucetClaims: [{ status: 'confirmed', createdAt: 1000, amountDisplay: '10' }],
      gameHistory: [{ game: 'g', payout: 1, claimedAt: new Date(3000).toISOString() }],
      quizRedemptions: [{ status: 'paid', amount: 1, ts: 2000 }],
    });
    assert.equal(result.items.length, 3);
    assert.deepEqual(result.items.map((i) => i.type), ['game_reward', 'quiz_redemption', 'faucet_claim']);
  });

  test('an item with no valid timestamp is dropped rather than sorted arbitrarily', () => {
    const result = buildRecentActivity({
      gameHistory: [{ game: 'g', payout: 1, claimedAt: 'not-a-real-date' }],
    });
    assert.deepEqual(result.items, []);
  });

  test('respects a custom limit, keeping the newest entries', () => {
    const faucetClaims = Array.from({ length: 20 }, (_, i) => ({ status: 'confirmed', createdAt: i + 1, amountDisplay: '1' }));
    const result = buildRecentActivity({ faucetClaims }, { limit: 5 });
    assert.equal(result.items.length, 5);
    assert.equal(result.items[0].at, 20);
    assert.equal(result.items[4].at, 16);
  });

  test('is pure — same input always produces the same output', () => {
    const input = {
      faucetClaims: [{ status: 'confirmed', createdAt: 1000, amountDisplay: '5' }],
      gameHistory: [{ game: 'g', payout: 1, claimedAt: new Date(500).toISOString() }],
      quizRedemptions: [{ status: 'paid', amount: 1, ts: 2000 }],
    };
    const a = buildRecentActivity(input);
    const b = buildRecentActivity(input);
    assert.deepEqual(a, b);
  });
});
