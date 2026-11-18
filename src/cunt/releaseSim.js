// Community release controller simulator (§45).
//
// OFF-CHAIN, DETERMINISTIC, NO TRANSACTIONS. It exists to answer one question
// before any release rule is written into a program:
//
//   Which trigger conditions can be gamed, and by whom?
//
// §8 states the danger directly: a release must NOT fire because "300M tokens
// were sold", because that is trivially manufactured by wash trading, circular
// transfers and self-dealing. This module lets that claim be demonstrated
// rather than asserted — `naiveVolumeTrigger` fires in week 1 for an attacker
// with two wallets and no genuine community, while `objectiveTrigger` does not.
//
// Determinism matters: a simulator whose output changes run to run cannot be
// used to justify a decision. The PRNG is a seeded LCG, not Math.random.

const STAGES = [
  { name: "BELLY", amount: 300_000_000 },
  { name: "CRAWL", amount: 200_000_000 },
  { name: "RUN", amount: 200_000_000 },
  { name: "FINAL_TUESDAY", amount: 100_000_000 },
];

/** Seeded LCG (Numerical Recipes constants). Deterministic across runs. */
function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Run a weekly simulation of the Tuesday protocol under a given population.
 *
 * Note `sybilOperators` counts *identities*, not wallets: since the
 * verified-wallet decision (2026-08-08), extra wallets buy nothing, so the
 * attacker's cost is aged verifiable accounts. That is exactly the property the
 * gate was chosen for, and this simulator models the world after it.
 */
export function simulateRelease({
  weeks = 52,
  genuineParticipants = 100,
  claimRate = 0.6,
  sybilOperators = 0,
  sybilClaimRate = 1.0,
  rewardPerClaim = 1000,
  communityBudget = 800_000_000,
  washTradeVolumePerWeek = 0,
  seed = 1,
} = {}) {
  const rand = rng(seed);
  const timeline = [];

  let distributed = 0;
  let reportedVolume = 0;
  const claimsByParticipant = new Map();
  const everClaimed = new Set();

  for (let week = 1; week <= weeks; week++) {
    let weekClaims = 0;
    let sybilClaims = 0;

    // Genuine participants claim probabilistically — real people miss weeks.
    for (let i = 0; i < genuineParticipants; i++) {
      if (rand() < claimRate) {
        const id = `genuine-${i}`;
        claimsByParticipant.set(id, (claimsByParticipant.get(id) || 0) + 1);
        everClaimed.add(id);
        weekClaims++;
      }
    }
    // Sybil identities are automated: they never miss.
    for (let i = 0; i < sybilOperators; i++) {
      if (rand() < sybilClaimRate) {
        const id = `sybil-${i}`;
        claimsByParticipant.set(id, (claimsByParticipant.get(id) || 0) + 1);
        everClaimed.add(id);
        weekClaims++;
        sybilClaims++;
      }
    }

    const paid = Math.min(weekClaims * rewardPerClaim, communityBudget - distributed);
    distributed += paid;

    // Wash trading inflates *volume* without moving a single token out of the
    // treasury or adding a single participant. That divergence is the point.
    reportedVolume += washTradeVolumePerWeek;

    const holdings = [...claimsByParticipant.values()].map((c) => c * rewardPerClaim).sort((a, b) => b - a);
    const top10 = holdings.slice(0, 10).reduce((a, b) => a + b, 0);
    const sybilHeld = [...claimsByParticipant.entries()]
      .filter(([id]) => id.startsWith("sybil-"))
      .reduce((a, [, c]) => a + c * rewardPerClaim, 0);

    timeline.push({
      week,
      distributed,
      remaining: communityBudget - distributed,
      pctDistributed: (distributed / communityBudget) * 100,
      weekClaims,
      sybilClaims,
      uniqueClaimers: everClaimed.size,
      reportedVolume,
      top10Concentration: distributed > 0 ? (top10 / distributed) * 100 : 0,
      sybilShare: distributed > 0 ? (sybilHeld / distributed) * 100 : 0,
      stage: stageFor(distributed),
    });

    if (distributed >= communityBudget) break;
  }

  return { timeline, final: timeline[timeline.length - 1], stages: STAGES };
}

export function stageFor(distributed) {
  let cumulative = 0;
  for (const s of STAGES) {
    cumulative += s.amount;
    if (distributed < cumulative) return s.name;
  }
  return "COMPLETE";
}

/**
 * THE TRIGGER §8 WARNS ABOUT. Fires on reported trading volume.
 *
 * Included so its failure can be demonstrated, not because it is a candidate.
 * Volume is attacker-controlled: wash trading, circular transfers and
 * self-dealing all manufacture it at no cost beyond fees.
 */
export function naiveVolumeTrigger(snapshot, { volumeThreshold = 300_000_000 } = {}) {
  return {
    fires: snapshot.reportedVolume >= volumeThreshold,
    reason: `reportedVolume ${snapshot.reportedVolume} >= ${volumeThreshold}`,
  };
}

/**
 * An objective trigger built only from signals an attacker cannot cheaply
 * manufacture, per §8. Every condition must hold.
 *
 * Deliberately does NOT include volume, price or market cap in any form.
 */
export function objectiveTrigger(snapshot, {
  minUniqueClaimers = 250,
  minElapsedWeeks = 12,
  minPctDistributed = 30,
  maxTop10Concentration = 40,
  maxSybilShare = 25,
} = {}) {
  const checks = [
    ["unique claimers", snapshot.uniqueClaimers >= minUniqueClaimers, `${snapshot.uniqueClaimers} / ${minUniqueClaimers}`],
    ["elapsed weeks", snapshot.week >= minElapsedWeeks, `${snapshot.week} / ${minElapsedWeeks}`],
    ["distribution", snapshot.pctDistributed >= minPctDistributed, `${snapshot.pctDistributed.toFixed(1)}% / ${minPctDistributed}%`],
    ["concentration", snapshot.top10Concentration <= maxTop10Concentration, `${snapshot.top10Concentration.toFixed(1)}% <= ${maxTop10Concentration}%`],
    ["sybil share", snapshot.sybilShare <= maxSybilShare, `${snapshot.sybilShare.toFixed(1)}% <= ${maxSybilShare}%`],
  ];
  return {
    fires: checks.every(([, ok]) => ok),
    failed: checks.filter(([, ok]) => !ok).map(([name, , detail]) => `${name} (${detail})`),
    checks,
  };
}

/** Convenience: the first week a trigger would have fired, or null. */
export function firstFiring(timeline, trigger, opts) {
  for (const snap of timeline) {
    if (trigger(snap, opts).fires) return snap;
  }
  return null;
}
