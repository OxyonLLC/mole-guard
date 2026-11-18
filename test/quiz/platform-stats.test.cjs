'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const platformStats = require(path.join('..', '..', 'src', 'quiz', 'platform-stats.js'));

describe('platform-stats: applyAnswerToBucket', () => {
  test('starts from an empty bucket when none is given', () => {
    const b = platformStats.applyAnswerToBucket(undefined, { correct: true, points: 100, atMs: 1000 });
    assert.equal(b.points, 100);
    assert.equal(b.correct, 1);
    assert.equal(b.total, 1);
    assert.equal(b.currentStreak, 1);
    assert.equal(b.bestStreak, 1);
    assert.equal(b.lastActiveTs, 1000);
  });

  test('a correct answer extends the streak and adds points', () => {
    let b = platformStats.applyAnswerToBucket(undefined, { correct: true, points: 100, atMs: 1 });
    b = platformStats.applyAnswerToBucket(b, { correct: true, points: 150, atMs: 2 });
    b = platformStats.applyAnswerToBucket(b, { correct: true, points: 225, atMs: 3 });
    assert.equal(b.points, 475);
    assert.equal(b.correct, 3);
    assert.equal(b.total, 3);
    assert.equal(b.currentStreak, 3);
    assert.equal(b.bestStreak, 3);
  });

  test('a wrong answer resets currentStreak but keeps bestStreak and does not add points', () => {
    let b = platformStats.applyAnswerToBucket(undefined, { correct: true, points: 100, atMs: 1 });
    b = platformStats.applyAnswerToBucket(b, { correct: true, points: 100, atMs: 2 });
    b = platformStats.applyAnswerToBucket(b, { correct: false, atMs: 3 });
    assert.equal(b.currentStreak, 0);
    assert.equal(b.bestStreak, 2);
    assert.equal(b.points, 200);
    assert.equal(b.total, 3);
    assert.equal(b.correct, 2);
  });

  test('bestStreak only grows, never shrinks, across a broken-then-resumed streak', () => {
    let b = platformStats.applyAnswerToBucket(undefined, { correct: true, atMs: 1 }); // streak 1
    b = platformStats.applyAnswerToBucket(b, { correct: true, atMs: 2 }); // streak 2, best 2
    b = platformStats.applyAnswerToBucket(b, { correct: false, atMs: 3 }); // streak 0
    b = platformStats.applyAnswerToBucket(b, { correct: true, atMs: 4 }); // streak 1
    assert.equal(b.currentStreak, 1);
    assert.equal(b.bestStreak, 2);
  });

  test('does not mutate the input bucket (pure)', () => {
    const original = platformStats.emptyPlatformBucket();
    const frozenCopy = { ...original };
    platformStats.applyAnswerToBucket(original, { correct: true, points: 50, atMs: 1 });
    assert.deepEqual(original, frozenCopy, 'input bucket must be unchanged');
  });

  test('a negative/garbage points value never subtracts points', () => {
    const b = platformStats.applyAnswerToBucket(undefined, { correct: true, points: -999, atMs: 1 });
    assert.equal(b.points, 0);
  });
});

describe('platform-stats: accuracyOf', () => {
  test('0 total => 0 accuracy (no division by zero)', () => {
    assert.equal(platformStats.accuracyOf(platformStats.emptyPlatformBucket()), 0);
  });
  test('computes correct/total', () => {
    const b = { correct: 3, total: 4 };
    assert.equal(platformStats.accuracyOf(b), 0.75);
  });
});

describe('platform-stats: normalizePlatform', () => {
  test('accepts discord/web (case-insensitive)', () => {
    assert.equal(platformStats.normalizePlatform('Discord'), 'discord');
    assert.equal(platformStats.normalizePlatform('WEB'), 'web');
  });
  test('rejects anything else', () => {
    assert.throws(() => platformStats.normalizePlatform('mobile'));
    assert.throws(() => platformStats.normalizePlatform(''));
  });
});

describe('platform-stats: rankUsersByPlatform', () => {
  const users = {
    alice: { platforms: { web: { points: 300, correct: 3, total: 4, currentStreak: 1, bestStreak: 2, lastActiveTs: 10 }, discord: platformStats.emptyPlatformBucket() } },
    bob: { platforms: { web: { points: 500, correct: 5, total: 5, currentStreak: 5, bestStreak: 5, lastActiveTs: 20 }, discord: platformStats.emptyPlatformBucket() } },
    carol: { platforms: { web: platformStats.emptyPlatformBucket(), discord: { points: 100, correct: 1, total: 1, currentStreak: 1, bestStreak: 1, lastActiveTs: 30 } } },
  };

  test('ranks by points descending, only including players who answered on that platform', () => {
    const web = platformStats.rankUsersByPlatform(users, 'web', 10);
    assert.equal(web.length, 2, 'carol never played web, must not appear');
    assert.equal(web[0].userId, 'bob');
    assert.equal(web[0].rank, 1);
    assert.equal(web[1].userId, 'alice');
    assert.equal(web[1].rank, 2);
  });

  test('a separate platform (discord) leaderboard is independent of web', () => {
    const discord = platformStats.rankUsersByPlatform(users, 'discord', 10);
    assert.equal(discord.length, 1);
    assert.equal(discord[0].userId, 'carol');
  });

  test('respects the limit', () => {
    const web = platformStats.rankUsersByPlatform(users, 'web', 1);
    assert.equal(web.length, 1);
    assert.equal(web[0].userId, 'bob');
  });
});

describe('platform-stats: buildPlatformComparison', () => {
  test('aggregates totals per platform and never mixes them', () => {
    const users = {
      a: { platforms: { web: { points: 100, correct: 2, total: 2, currentStreak: 0, bestStreak: 0, lastActiveTs: 1 }, discord: { points: 50, correct: 1, total: 2, currentStreak: 0, bestStreak: 0, lastActiveTs: 1 } } },
      b: { platforms: { web: { points: 200, correct: 1, total: 2, currentStreak: 0, bestStreak: 0, lastActiveTs: 1 }, discord: platformStats.emptyPlatformBucket() } },
    };
    const cmp = platformStats.buildPlatformComparison(users);
    assert.equal(cmp.web.participants, 2);
    assert.equal(cmp.web.totalPoints, 300);
    assert.equal(cmp.web.totalAnswers, 4);
    assert.equal(cmp.web.correctAnswers, 3);
    assert.equal(cmp.web.correctRate, 0.75);

    assert.equal(cmp.discord.participants, 1);
    assert.equal(cmp.discord.totalPoints, 50);
    assert.equal(cmp.discord.correctRate, 0.5);

    assert.equal(cmp.leader, 'web');
  });

  test('empty DB produces zeroed, tied comparison (no crash)', () => {
    const cmp = platformStats.buildPlatformComparison({});
    assert.equal(cmp.web.participants, 0);
    assert.equal(cmp.discord.participants, 0);
    assert.equal(cmp.leader, 'tied');
  });
});

describe('platform-stats: tiers (easy/medium/hard/sponsor/sponsor-xyo/sponsor-winlew)', () => {
  test('emptyTierStats has exactly the six tiers (sponsor-xyo/sponsor-winlew added 2026-07-18 for the per-sponsor tile split), each a zeroed bucket', () => {
    const stats = platformStats.emptyTierStats();
    assert.deepEqual(Object.keys(stats).sort(), ['easy', 'hard', 'medium', 'sponsor', 'sponsor-winlew', 'sponsor-xyo']);
    for (const tier of platformStats.TIERS) {
      assert.equal(stats[tier].total, 0);
      assert.equal(stats[tier].correct, 0);
    }
  });

  test('normalizeTier accepts all six known tiers (case-insensitive)', () => {
    assert.equal(platformStats.normalizeTier('Easy'), 'easy');
    assert.equal(platformStats.normalizeTier('SPONSOR'), 'sponsor');
    assert.equal(platformStats.normalizeTier('Sponsor-XYO'), 'sponsor-xyo');
    assert.equal(platformStats.normalizeTier('SPONSOR-WINLEW'), 'sponsor-winlew');
  });

  test('normalizeTier rejects anything else', () => {
    assert.throws(() => platformStats.normalizeTier('impossible'));
    assert.throws(() => platformStats.normalizeTier(''));
  });

  test('applyAnswerToBucket works identically for tier buckets (same shape as platform buckets)', () => {
    let b = platformStats.emptyTierStats().hard;
    b = platformStats.applyAnswerToBucket(b, { correct: true, points: 225, atMs: 1 });
    b = platformStats.applyAnswerToBucket(b, { correct: false, atMs: 2 });
    assert.equal(b.total, 2);
    assert.equal(b.correct, 1);
    assert.equal(platformStats.accuracyOf(b), 0.5);
  });
});
