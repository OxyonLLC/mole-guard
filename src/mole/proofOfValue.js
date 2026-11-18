import { createRequire } from "module";
import { getRewardSummary } from "./rewardHistory.js";
import { getClaimHistoryForUser } from "../faucet/claimStore.js";
import { getLinkedWalletRecord, getWalletVerificationStatus } from "./walletLink.js";

const require = createRequire(import.meta.url);
const quizDb = require("../quiz/db.js");

// Version 2.1 — Proof of Value: a single, unified, INFORMATIONAL participation
// score across Quiz, Faucet, Games, and Wallet Verification. Never touches any
// payout-eligible field (quiz points/cycles, faucet claims, game payouts) —
// it only reads them. Computed on read (no persisted/synced score field), so
// it can never drift out of sync with the systems that feed it.
//
// Weighting confirmed balanced across all four inputs (~25% each), with a
// small streak-based multiplier layered on top. Both are tunable constants
// below, not hardcoded into the scoring logic itself.
export const POV_WEIGHTS = Object.freeze({
  quiz: 0.25,
  faucet: 0.25,
  games: 0.25,
  verification: 0.25,
});

// Diminishing-returns caps: the value at which a component's sub-score hits
// 100. Chosen from what "strong, sustained participation" looks like for
// each system (faucet/games are cooldown- or round-gated, so their caps are
// much smaller numbers than quiz points). Curve scaling means the first units
// of participation matter most, and no one is hard-capped out of the score.
//
// Version 2.4 (2026-07-19): caps raised ~5-6x and tier floors lifted after
// the owner reached Legend within the first week of playing — the old caps
// (5000/30/50, Legend at 80) measured "showed up," not sustained value.
//
// Version 2.5 (2026-07-30): the v2.4 sqrt curve still front-loaded too hard —
// the owner sat at 67 (upper Contributor) after only two weeks live. Two
// changes, per the owner's "the top should be a ~6-month task" call:
//   1. Curve exponent softened from 0.5 (sqrt) to 0.75 (POV_CURVE_EXPONENT):
//      two weeks of daily everything now lands ~15% per sub-score (was ~28%),
//      i.e. mid-Participant instead of knocking on Contributor's door.
//   2. Caps re-anchored to ~6 months of DAILY participation: faucet 180
//      (one cooldown-gated claim/day), games 1500 (~8 validated claims/day),
//      quiz unchanged at 25000 (already several times any real lifetime total).
// Net effect: Legend (90+) needs ~70% of every cap even with a maxed streak —
// roughly 4-6 months of genuinely daily play across all four systems.
const CAPS = Object.freeze({
  quizLifetimePoints: 25000,
  faucetConfirmedClaims: 180,
  gameClaims: 1500,
});

// Sub-score curve exponent (v2.5): 1 would be fully linear, 0.5 was the old
// sqrt. 0.75 keeps a gentle early boost while making the back half a real
// grind — the last 25 points of a sub-score take ~half the cap.
export const POV_CURVE_EXPONENT = 0.75;

// Max bonus a streak can add on top of the base score, and how much streak
// "credit" each consecutive correct answer is worth toward that cap.
// v2.4: halved both — a single good quiz session (15-20 answers) maxing the
// multiplier made the streak a one-day rubber stamp instead of a habit.
const STREAK_MAX_BONUS = 0.10;
const STREAK_PER_POINT = 0.005;

// Exported so consumers (milestones.js) can derive tier floors from the one
// real list instead of re-declaring a number that then drifts.
export const TIERS = Object.freeze([
  { min: 90, label: "Legend" },
  { min: 70, label: "Pillar" },
  { min: 45, label: "Contributor" },
  { min: 20, label: "Participant" },
  { min: 0, label: "Newcomer" },
]);

export function povScale(value, cap, exponent = POV_CURVE_EXPONENT) {
  const v = Math.max(0, Number(value) || 0);
  if (!(cap > 0)) return 0;
  return Math.min(100, 100 * Math.pow(v / cap, exponent));
}

export function tierForScore(score) {
  return TIERS.find((t) => score >= t.min)?.label || "Newcomer";
}

// v3.4 — the one deliberate exception to "PoV never touches a payout-eligible
// field": a small, capped reward multiplier by tier, applied at each
// system's own payout chokepoint (faucet/service.js, quiz/db.js,
// rewardRules.js), never here. Kept at the same order of magnitude as the
// existing quiz streak bonus (STREAK_MAX_BONUS above, +10%) on purpose — a
// participation nudge, not a wealth multiplier. Newcomer/Participant get
// nothing; the bonus only starts once a user is a genuine Contributor.
export const POV_REWARD_MULTIPLIERS = Object.freeze({
  Legend: 1.12,
  Pillar: 1.08,
  Contributor: 1.05,
  Participant: 1,
  Newcomer: 1,
});

export function povRewardMultiplier(tier) {
  return POV_REWARD_MULTIPLIERS[tier] ?? 1;
}

/**
 * Convenience wrapper for payout call sites: computes this user's live PoV
 * score and returns just the reward multiplier for their current tier.
 * Failure-safe — any lookup error falls back to 1 (no bonus, never a
 * penalty) rather than letting a PoV outage block a real claim.
 */
export async function getPovRewardMultiplier(discordUserId) {
  try {
    const { tier } = await getProofOfValueScore(discordUserId);
    return povRewardMultiplier(tier);
  } catch (err) {
    console.warn("[proofOfValue] getPovRewardMultiplier failed, defaulting to 1:", err?.message || err);
    return 1;
  }
}

// Version 2.3 — "progress toward the next tier" reuses these exact TIERS
// thresholds (the same ones tierForScore() already uses), so it can never
// drift out of sync with what tier a score actually lands in. No second
// set of thresholds, no second scoring notion.
export function tierProgress(score) {
  const s = Math.max(0, Math.min(100, Number(score) || 0));
  const ascending = [...TIERS].sort((a, b) => a.min - b.min);
  const next = ascending.find((t) => t.min > s) || null;
  return {
    tier: tierForScore(s),
    nextTier: next ? next.label : null,
    pointsToNextTier: next ? Number((next.min - s).toFixed(2)) : 0,
  };
}

// verified: full credit. previously verified but now expired: partial credit
// (they did the work once; the signal isn't worth zero just because their
// 90-day cycle lapsed). never linked: zero — nothing to reward yet.
export function verificationSubScore(status) {
  if (status?.verified) return 100;
  if (status?.wallet) return 40;
  return 0;
}

// v4: a SECOND genuine streak signal now exists. The note below used to say the
// quiz was the only system recording consecutive participation — HODL Rewards
// records consecutive qualified weeks, which is the same idea measured weekly
// rather than per answer.
//
// It is folded in HERE rather than as a fifth POV_WEIGHTS entry, and the choice
// matters. A fifth weight would silently dilute quiz, faucet, games and
// verification from 0.25 to 0.20 each — changing everyone's existing score to
// make room for a new program. And it could not go in the `verification` bucket
// either, which was the original plan: verificationSubScore() already returns
// 100 for a verified wallet, and every HODL participant is verified by
// definition, so there is no headroom there at all.
//
// A streak multiplier is where it actually belongs. It shares the SAME capped
// +10% as the quiz streak rather than adding a second bonus on top, so the
// ceiling on the whole score does not move and nobody's number inflates because
// a new program shipped.
//
// WEEKS QUALIFIED, NEVER BALANCE. A wallet holding ten million and a wallet
// holding the minimum earn this at exactly the same rate. Proof of Value, not
// Proof of Wealth — the same rule the payout split obeys.
const HODL_WEEK_CREDIT = 20;

export function computeStreakMultiplier(quizCurrentStreak, hodlConsecutiveWeeks = 0) {
  const quizStreak = Math.max(0, Number(quizCurrentStreak) || 0);
  const hodlWeeks = Math.max(0, Number(hodlConsecutiveWeeks) || 0);

  // Weeks are scarce where answers are plentiful: a quiz streak accrues several
  // times a day, a HODL week once every seven. Each week is therefore worth 20
  // answers' worth of credit, so a full quarter of unbroken qualification
  // reaches the same cap a committed quiz player does — and neither can exceed
  // it, because they share one.
  const credit = quizStreak + hodlWeeks * HODL_WEEK_CREDIT;
  const bonus = Math.min(STREAK_MAX_BONUS, credit * STREAK_PER_POINT);
  return 1 + bonus;
}

/**
 * Pure combination step — takes already-fetched raw signals and returns the
 * full score breakdown. No I/O in here, so it's directly unit-testable
 * without touching quiz/faucet/games/verification storage.
 */
export function combineProofOfValue({ quiz, faucet, games, verification, hodl }) {
  const quizSubScore = povScale(quiz?.lifetimePoints, CAPS.quizLifetimePoints);
  const faucetSubScore = povScale(faucet?.confirmedClaims, CAPS.faucetConfirmedClaims);
  const gamesSubScore = povScale(games?.totalClaims, CAPS.gameClaims);
  const verificationSub = verificationSubScore(verification);

  const baseScore =
    quizSubScore * POV_WEIGHTS.quiz +
    faucetSubScore * POV_WEIGHTS.faucet +
    gamesSubScore * POV_WEIGHTS.games +
    verificationSub * POV_WEIGHTS.verification;

  const streakMultiplier = computeStreakMultiplier(quiz?.currentStreak, hodl?.consecutiveWeeks);
  const score = Math.round(Math.min(100, baseScore * streakMultiplier));

  return {
    score,
    tier: tierForScore(score),
    baseScore: Number(baseScore.toFixed(2)),
    streakMultiplier: Number(streakMultiplier.toFixed(3)),
    streakSource: hodl?.consecutiveWeeks > 0 ? "quiz_streak+hodl_weeks" : "quiz_current_streak",
    weights: POV_WEIGHTS,
    breakdown: {
      quiz: { subScore: Number(quizSubScore.toFixed(2)), ...quiz },
      faucet: { subScore: Number(faucetSubScore.toFixed(2)), ...faucet },
      games: { subScore: Number(gamesSubScore.toFixed(2)), ...games },
      verification: { subScore: verificationSub, ...verification },
      // Reported for transparency, with no sub-score of its own — HODL moves
      // the streak multiplier, not one of the four weighted buckets.
      hodl: {
        consecutiveWeeks: Number(hodl?.consecutiveWeeks || 0),
        qualifiedWeeks: Number(hodl?.qualifiedWeeks || 0),
      },
    },
  };
}

export function quizSignalsForUser(discordUserId) {
  const userId = String(discordUserId);
  const user = quizDb.getUser(userId);
  const platforms = quizDb.getUserPlatformStats(userId);
  const currentStreak = Math.max(
    Number(platforms?.discord?.currentStreak || 0),
    Number(platforms?.web?.currentStreak || 0)
  );
  const bestStreak = Math.max(
    Number(platforms?.discord?.bestStreak || 0),
    Number(platforms?.web?.bestStreak || 0)
  );
  return {
    lifetimePoints: Number(user?.lifetimePoints || 0),
    currentStreak,
    bestStreak,
  };
}

/**
 * Fetches this user's live signals from all four systems and returns the
 * combined Proof of Value score. Safe to call for a user with no history in
 * any system — every underlying lookup already returns a sane empty shape.
 */
export async function getProofOfValueScore(discordUserId) {
  const userId = String(discordUserId);

  const [faucetHistory, gameSummary] = await Promise.all([
    getClaimHistoryForUser(userId),
    getRewardSummary(userId),
  ]);

  const quiz = quizSignalsForUser(userId);
  const linked = getLinkedWalletRecord(userId);
  const verificationStatus = getWalletVerificationStatus(linked);

  return combineProofOfValue({
    quiz,
    faucet: {
      confirmedClaims: faucetHistory.confirmedCount,
      totalClaims: faucetHistory.count,
      lastClaimAt: faucetHistory.lastConfirmedAt,
    },
    games: {
      totalClaims: gameSummary.totalClaims,
      totalPayout: gameSummary.totalPayout,
    },
    verification: {
      verified: verificationStatus.verified,
      wallet: verificationStatus.wallet,
      verifiedAt: verificationStatus.verified_at,
      expiresAt: verificationStatus.expires_at,
    },
  });
}
