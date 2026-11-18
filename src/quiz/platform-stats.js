'use strict';

// Pure platform-attribution logic for the quiz — no file I/O, no Discord/Express
// dependency. Both the Discord bot (src/quiz/index.js) and the web API
// (src/mole/web.js) call into this through src/quiz/db.js so the rules for
// streaks, accuracy, and leaderboard ranking are defined exactly once.
//
// This tracks INFORMATIONAL per-platform stats only (points/accuracy/streaks
// for the separate Web/Discord leaderboards). It never touches the existing
// payout-eligible `points`/`cycles`/`lifetimePoints` fields in db.js — those
// keep working exactly as before.

const PLATFORMS = ['discord', 'web'];

// Same informational-only pattern as platform stats, one dimension over:
// per-difficulty-tier accuracy for the web quiz's tile picker (Easy/Medium/
// Hard/Sponsor). Reuses emptyPlatformBucket/applyAnswerToBucket/accuracyOf
// as-is below — a tier bucket and a platform bucket are the same shape.
//
// 'sponsor-xyo'/'sponsor-winlew' added 2026-07-18 when the web quiz split
// its single combined "Sponsor Quiz" tile into per-sponsor tiles (so a
// player can choose XYO vs WinLEW questions, not get a random mix) — see
// docs/quiz-web-features.md. The original combined 'sponsor' bucket is kept,
// not removed: existing accumulated accuracy history stays valid and
// readable, it just stops being the bucket new sponsor answers are
// exclusively recorded under (src/mole/web.js now records BOTH the specific
// sponsor bucket and, for continuity, the legacy combined one).
const TIERS = ['easy', 'medium', 'hard', 'sponsor', 'sponsor-xyo', 'sponsor-winlew'];

function emptyTierStats() {
  return {
    easy: emptyPlatformBucket(),
    medium: emptyPlatformBucket(),
    hard: emptyPlatformBucket(),
    sponsor: emptyPlatformBucket(),
    'sponsor-xyo': emptyPlatformBucket(),
    'sponsor-winlew': emptyPlatformBucket(),
  };
}

function normalizeTier(tier) {
  const t = String(tier || '').trim().toLowerCase();
  if (!TIERS.includes(t)) throw new Error(`invalid_tier:${tier}`);
  return t;
}

function emptyPlatformBucket() {
  return {
    points: 0,
    correct: 0,
    total: 0,
    currentStreak: 0,
    bestStreak: 0,
    lastActiveTs: 0,
  };
}

function emptyPlatformStats() {
  return { discord: emptyPlatformBucket(), web: emptyPlatformBucket() };
}

function normalizePlatform(platform) {
  const p = String(platform || '').trim().toLowerCase();
  if (!PLATFORMS.includes(p)) throw new Error(`invalid_platform:${platform}`);
  return p;
}

// Given an existing bucket (or none) and one answer outcome, returns a NEW
// bucket — never mutates the input. A wrong answer resets currentStreak but
// still counts toward `total` (for accuracy).
function applyAnswerToBucket(bucket, { correct, points = 0, atMs = Date.now() } = {}) {
  const b = bucket ? { ...bucket } : emptyPlatformBucket();
  b.total += 1;
  if (correct) {
    b.correct += 1;
    b.points += Math.max(0, Number(points) || 0);
    b.currentStreak += 1;
    b.bestStreak = Math.max(b.bestStreak, b.currentStreak);
  } else {
    b.currentStreak = 0;
  }
  b.lastActiveTs = atMs;
  return b;
}

function accuracyOf(bucket) {
  if (!bucket || !bucket.total) return 0;
  return bucket.correct / bucket.total;
}

// users: the raw `{ [userId]: userRecord }` shape from db.json. Ranks by
// platform points, only including users who have actually played on that
// platform (total > 0) — a user with zero web answers should not appear on
// the web leaderboard just because they exist in the DB from Discord play.
function rankUsersByPlatform(users, platform, limit = 25) {
  const p = normalizePlatform(platform);
  const rows = Object.entries(users || {})
    .map(([userId, user]) => {
      const bucket = user?.platforms?.[p] || emptyPlatformBucket();
      return {
        userId,
        platform: p,
        points: Number(bucket.points || 0),
        correct: Number(bucket.correct || 0),
        total: Number(bucket.total || 0),
        accuracy: accuracyOf(bucket),
        currentStreak: Number(bucket.currentStreak || 0),
        bestStreak: Number(bucket.bestStreak || 0),
        lastActiveTs: Number(bucket.lastActiveTs || 0),
      };
    })
    .filter((row) => row.total > 0)
    .sort((a, b) => b.points - a.points || b.accuracy - a.accuracy || b.total - a.total);

  return rows.slice(0, Math.max(1, Number(limit) || 25)).map((row, i) => ({ rank: i + 1, ...row }));
}

// Aggregate Web vs Discord comparison — platform totals, never individual
// scores. `leader` is whichever platform has more total points; 'tied' if
// equal (including both-zero).
function buildPlatformComparison(users) {
  const totals = {
    discord: { participants: 0, totalAnswers: 0, correctAnswers: 0, totalPoints: 0 },
    web: { participants: 0, totalAnswers: 0, correctAnswers: 0, totalPoints: 0 },
  };

  for (const user of Object.values(users || {})) {
    for (const platform of PLATFORMS) {
      const bucket = user?.platforms?.[platform];
      if (!bucket || !bucket.total) continue;
      const t = totals[platform];
      t.participants += 1;
      t.totalAnswers += Number(bucket.total || 0);
      t.correctAnswers += Number(bucket.correct || 0);
      t.totalPoints += Number(bucket.points || 0);
    }
  }

  const summarize = (t) => ({
    ...t,
    correctRate: t.totalAnswers > 0 ? t.correctAnswers / t.totalAnswers : 0,
  });

  const discord = summarize(totals.discord);
  const web = summarize(totals.web);
  let leader = 'tied';
  if (discord.totalPoints > web.totalPoints) leader = 'discord';
  else if (web.totalPoints > discord.totalPoints) leader = 'web';

  return { discord, web, leader };
}

module.exports = {
  PLATFORMS,
  emptyPlatformBucket,
  emptyPlatformStats,
  normalizePlatform,
  applyAnswerToBucket,
  accuracyOf,
  rankUsersByPlatform,
  buildPlatformComparison,
  TIERS,
  emptyTierStats,
  normalizeTier,
};
