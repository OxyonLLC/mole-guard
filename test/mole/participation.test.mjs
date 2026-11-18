// Pure-function tests for the Version 2.3 participation/retention signals.
// No I/O — record arrays and timestamps are passed in directly, matching
// this session's established pure-function test convention.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeFaucetStreak, buildWeeklySummary, closestUnachievedMilestone } from '../../src/mole/participation.js';

const DAY_MS = 24 * 60 * 60 * 1000;
// A fixed "now" at UTC noon so day-boundary math in tests is never flaky
// near midnight.
const NOW = Date.UTC(2026, 6, 15, 12, 0, 0); // 2026-07-15T12:00:00Z

describe('participation: computeFaucetStreak', () => {
  test('no claims at all is a zero streak', () => {
    const result = computeFaucetStreak([], { now: NOW });
    assert.equal(result.currentStreakDays, 0);
    assert.equal(result.claimedToday, false);
  });

  test('a single claim today is a 1-day streak', () => {
    const result = computeFaucetStreak([{ status: 'confirmed', createdAt: NOW }], { now: NOW });
    assert.equal(result.currentStreakDays, 1);
    assert.equal(result.claimedToday, true);
  });

  test('claims on 3 consecutive days (today included) is a 3-day streak', () => {
    const claims = [
      { status: 'confirmed', createdAt: NOW },
      { status: 'confirmed', createdAt: NOW - DAY_MS },
      { status: 'confirmed', createdAt: NOW - 2 * DAY_MS },
    ];
    const result = computeFaucetStreak(claims, { now: NOW });
    assert.equal(result.currentStreakDays, 3);
  });

  test('a gap breaks the streak — only the unbroken run counting back from today/yesterday counts', () => {
    const claims = [
      { status: 'confirmed', createdAt: NOW }, // today
      { status: 'confirmed', createdAt: NOW - DAY_MS }, // yesterday
      // gap at NOW - 2*DAY_MS
      { status: 'confirmed', createdAt: NOW - 3 * DAY_MS }, // must not count
    ];
    const result = computeFaucetStreak(claims, { now: NOW });
    assert.equal(result.currentStreakDays, 2);
  });

  test('no claim yet today, but yesterday continues — the streak is still alive (today is not over)', () => {
    const claims = [
      { status: 'confirmed', createdAt: NOW - DAY_MS },
      { status: 'confirmed', createdAt: NOW - 2 * DAY_MS },
    ];
    const result = computeFaucetStreak(claims, { now: NOW });
    assert.equal(result.claimedToday, false);
    assert.equal(result.currentStreakDays, 2);
  });

  test('a streak broken more than a day ago is correctly zero, not stale', () => {
    const claims = [{ status: 'confirmed', createdAt: NOW - 5 * DAY_MS }];
    const result = computeFaucetStreak(claims, { now: NOW });
    assert.equal(result.currentStreakDays, 0);
  });

  test('only confirmed claims count — a reserved/failed claim must not extend the streak', () => {
    const claims = [
      { status: 'reserved', createdAt: NOW },
      { status: 'known_failed', createdAt: NOW - DAY_MS },
    ];
    const result = computeFaucetStreak(claims, { now: NOW });
    assert.equal(result.currentStreakDays, 0);
    assert.equal(result.claimedToday, false);
  });

  test('multiple claims on the same UTC day only count once', () => {
    const claims = [
      { status: 'confirmed', createdAt: NOW },
      { status: 'confirmed', createdAt: NOW - 60_000 },
      { status: 'confirmed', createdAt: NOW - 120_000 },
    ];
    const result = computeFaucetStreak(claims, { now: NOW });
    assert.equal(result.currentStreakDays, 1);
  });
});

describe('participation: buildWeeklySummary', () => {
  test('empty input produces a zeroed, non-null summary', () => {
    const result = buildWeeklySummary({}, { now: NOW });
    assert.equal(result.faucetClaimCount, 0);
    assert.equal(result.gameClaimCount, 0);
    assert.equal(result.windowDays, 7);
  });

  test('only confirmed faucet claims within the window count', () => {
    const result = buildWeeklySummary({
      faucetClaims: [
        { status: 'confirmed', createdAt: NOW, amountDisplay: '10' },
        { status: 'confirmed', createdAt: NOW - 8 * DAY_MS, amountDisplay: '99' }, // outside window
        { status: 'reserved', createdAt: NOW, amountDisplay: '5' }, // not confirmed
      ],
    }, { now: NOW });
    assert.equal(result.faucetClaimCount, 1);
    assert.equal(result.faucetAmount, 10);
  });

  test('game rewards within the window are summed by claimedAt (ISO string)', () => {
    const result = buildWeeklySummary({
      gameHistory: [
        { payout: 5, claimedAt: new Date(NOW).toISOString() },
        { payout: 3, claimedAt: new Date(NOW - DAY_MS).toISOString() },
        { payout: 100, claimedAt: new Date(NOW - 30 * DAY_MS).toISOString() }, // outside window
      ],
    }, { now: NOW });
    assert.equal(result.gameClaimCount, 2);
    assert.equal(result.gamePayout, 8);
  });

  test('a custom window size is respected', () => {
    const result = buildWeeklySummary({
      faucetClaims: [{ status: 'confirmed', createdAt: NOW - 2 * DAY_MS, amountDisplay: '1' }],
    }, { now: NOW, windowMs: DAY_MS }); // 1-day window — the claim is outside it
    assert.equal(result.faucetClaimCount, 0);
  });
});

describe('participation: closestUnachievedMilestone', () => {
  test('returns null when every milestone is already achieved', () => {
    const items = [{ id: 'a', achieved: true, progress: 1 }, { id: 'b', achieved: true, progress: 1 }];
    assert.equal(closestUnachievedMilestone(items), null);
  });

  test('returns null when nothing unachieved has any progress yet', () => {
    const items = [{ id: 'a', achieved: false, progress: 0 }];
    assert.equal(closestUnachievedMilestone(items), null);
  });

  test('picks the unachieved milestone with the highest progress', () => {
    const items = [
      { id: 'far', achieved: false, progress: 0.1 },
      { id: 'close', achieved: false, progress: 0.9 },
      { id: 'done', achieved: true, progress: 1 },
    ];
    assert.equal(closestUnachievedMilestone(items).id, 'close');
  });
});
