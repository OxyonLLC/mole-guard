// Single source of truth for "how do PoV and Contribute reward multipliers
// combine, and what's the hard ceiling" — each payout chokepoint calls
// getCombinedRewardMultiplier() instead of independently
// fetching+multiplying+capping, so this policy can never drift between them.
//
// Actual callers, verified 2026-08-05:
//   • quiz    — src/quiz/db.js:51
//   • games   — src/mole/web.js:2996 (into validateRewardClaim's rewardMultiplier)
//   • faucet  — DOES NOT APPLY IT. The header here used to claim "faucet
//     service.js" was a caller; it is not, and nothing under src/faucet/ so
//     much as mentions a multiplier. The faucet pays a flat DRIP_AMOUNT
//     (config.js:25) to every claimant regardless of tier. That is a
//     reasonable design — an equal-drip faucet is the one place tier bonuses
//     would feel least fair — but it must not be described as integrated when
//     it isn't. /proof-of-value/ now states the same split publicly.
//
//     STILL TRUE IN v4, with one clarification. The faucet applies no TIER
//     multiplier and the reasoning above stands. It does now have a
//     consecutive-day STREAK bonus (src/mole/claimStreaks.js), which is a
//     different mechanism answering a different question: not "how highly
//     ranked are you" but "did you turn up again". Rank and holdings still buy
//     nothing at the faucet.
//
// Both source multipliers (src/mole/proofOfValue.js's getPovRewardMultiplier,
// src/mole/contributions.js's getContributionRewardMultiplier) are
// individually small and capped (max 1.12 and 1.05 respectively) and already
// fail safe to 1 on error. MAX_COMBINED_REWARD_MULTIPLIER is a second,
// independent ceiling on top of that product — belt-and-suspenders so a
// future change to either source multiplier's own cap can't silently widen
// the combined ceiling without a deliberate change here too.
import { getPovRewardMultiplier } from "../mole/proofOfValue.js";
import { getContributionRewardMultiplier } from "../mole/contributions.js";

export const MAX_COMBINED_REWARD_MULTIPLIER = 1.25;

/**
 * Live, uncached, failure-safe combined multiplier for one user — stacks
 * PoV's tier bonus and Contribute's Clout bonus multiplicatively, then
 * clamps to MAX_COMBINED_REWARD_MULTIPLIER. Never below 1 (no penalty).
 */
export async function getCombinedRewardMultiplier(discordUserId) {
  const [povMultiplier, contributionMultiplier] = await Promise.all([
    getPovRewardMultiplier(discordUserId),
    getContributionRewardMultiplier(discordUserId),
  ]);
  const combined = Math.max(1, povMultiplier) * Math.max(1, contributionMultiplier);
  return Math.min(MAX_COMBINED_REWARD_MULTIPLIER, combined);
}
