// Version 2.2 — Dashboard milestones: deterministic, honest badges derived
// directly from data the platform already tracks (quiz, faucet, games,
// verification, Proof of Value). No new achievements storage was added —
// see docs/unified-dashboard.md for why a broader achievements engine is
// explicitly out of scope here and belongs to a later milestone.
//
// Version 2.3 added `progress` (0..1) to each item, reusing the exact same
// raw values already computed for `achieved` — not a second measurement of
// anything, just exposing how close an unmet milestone is, for the
// "you're close to..." dashboard messaging in src/mole/participation.js.
import { tierProgress, TIERS } from "./proofOfValue.js";

const QUIZ_POINT_THRESHOLDS = [
  { id: "quiz_points_500", label: "Quiz Point Milestone: 500+", threshold: 500 },
  { id: "quiz_points_2000", label: "Quiz Point Milestone: 2,000+", threshold: 2000 },
];

const POV_CONTRIBUTOR_TIERS = ["Contributor", "Pillar", "Legend"];
// Derived from proofOfValue.js's own TIERS list — previously a hardcoded 40
// that would have silently drifted when the tier floors were retuned (v2.4
// moved Contributor to 45).
const POV_CONTRIBUTOR_MIN = TIERS.find((t) => t.label === "Contributor").min;

function clamp01(n) {
  return Math.max(0, Math.min(1, Number(n) || 0));
}

/**
 * Pure — takes already-fetched aggregate numbers (no I/O), returns an
 * ordered list of `{id, label, achieved, progress}`. Every entry is
 * deterministic: given the same inputs, the same milestones are achieved
 * every time.
 */
export function computeMilestones({
  verified = false,
  questionWins = 0,
  quizLifetimePoints = 0,
  faucetConfirmedClaims = 0,
  gameTotalClaims = 0,
  povTier = null,
  povScore = 0,
  hasContributed = false,
} = {}) {
  const povContributorAchieved = POV_CONTRIBUTOR_TIERS.includes(povTier);
  const povProgress = povContributorAchieved ? 1 : clamp01(Number(povScore) / POV_CONTRIBUTOR_MIN);

  return [
    // 2026-07-19: a real, verified on-chain contribution (Dev/Faucet/Burn —
    // see src/mole/contributions.js) — deliberately distinct from
    // "pov_contributor" below (Proof of Value's activity-based tier), which
    // is about participation, not money sent. `variant: "contribution"` is
    // additive: renderMilestones() in verify/profile.js sorts this first and
    // gives it a purple treatment; nothing else reads or requires this field.
    { id: "cause_contributor", label: "Contributor", achieved: !!hasContributed, progress: hasContributed ? 1 : 0, variant: "contribution" },
    { id: "wallet_verified", label: "Wallet Verified", achieved: !!verified, progress: verified ? 1 : 0 },
    { id: "first_quiz_completed", label: "First Quiz Completed", achieved: Number(questionWins) >= 1, progress: clamp01(Number(questionWins)) },
    { id: "first_faucet_claim", label: "First Faucet Claim", achieved: Number(faucetConfirmedClaims) >= 1, progress: clamp01(Number(faucetConfirmedClaims)) },
    { id: "first_game_reward", label: "First Game Reward", achieved: Number(gameTotalClaims) >= 1, progress: clamp01(Number(gameTotalClaims)) },
    { id: "pov_contributor", label: "Proof of Value: Contributor Tier or above", achieved: povContributorAchieved, progress: povProgress },
    ...QUIZ_POINT_THRESHOLDS.map((t) => ({
      id: t.id,
      label: t.label,
      achieved: Number(quizLifetimePoints) >= t.threshold,
      progress: clamp01(Number(quizLifetimePoints) / t.threshold),
    })),
  ];
}

// Re-exported so callers that already have a score (not just a tier label)
// can get "points to next tier" without importing proofOfValue.js directly
// — same underlying function, one import path for milestone-adjacent code.
export { tierProgress };
