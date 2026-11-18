// Reward-trail evidence outbox (WinLEW Game Evidence on XL1, step B3).
//
// After a payout is PAID, one document per reward is written to an outbox, ready to be
// anchored on XL1 by Oxyon's evidence tooling (oxyon-evidence tools/evidence.mjs, claim type
// winlew.reward.trail). It records the reward DECISION and the payout that settled it:
// game, rule parameters, points, base and multiplier, payout units, payout transaction.
//
// - It never decides, changes or delays a reward: it runs after the payout is final, and a
//   failure here is swallowed by the caller.
// - Members never appear: the player and the reward are salted commitments,
//   sha256(salt | value), and the salt stays in WinLEW's own configuration. The published
//   content passes oxyon-evidence's privacy check (no Discord id, no wallet).
// - Off unless XL1_ARCADE_EVIDENCE is on AND a salt of 32+ characters is set.
// - The score is what the game reported from the browser, bounded by the server; the record
//   says so, because a commitment is not proof that the game was played as reported.
import { createHash } from 'node:crypto';

export const REWARD_TRAIL_SCHEMA = 'winlew.reward.trail.v1';
export const OUTBOX_COLLECTION = 'xl1_arcade_evidence_outbox';

export function evidenceConfig(env = process.env) {
  const on = ['1', 'true', 'yes', 'on'].includes(String(env.XL1_ARCADE_EVIDENCE || '').trim().toLowerCase());
  const salt = String(env.XL1_ARCADE_EVIDENCE_SALT || '');
  return { enabled: on && salt.length >= 32, salt };
}

const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex');
const commit = (salt, value) => sha256(`${salt}|${value}`);
const ms = value => (value ? new Date(value).getTime() : null);

/** The published content for one paid reward. Pure: same job, same salt, same bytes. */
export function rewardTrail(job, { salt }) {
  return {
    schema: REWARD_TRAIL_SCHEMA,
    game: job.game,
    // The chain id is not repeated here: it is 40 hex characters, which the evidence privacy
    // check reads as an address, and the evidence record's subject already names the chain.
    rules: { rewardRate: job.rewardRate ?? null, rateUnits: job.rateUnits ?? null, mode: job.mode, network: job.network },
    rewardCommitment: commit(salt, `reward:${job.sessionId ?? job._id}`),
    playerCommitment: commit(salt, `player:${job.identityId}`),
    rewardDay: job.rewardDay,
    rawScore: job.rawScore ?? null,
    eligiblePoints: job.eligiblePoints ?? null,
    baseUnits: String(job.actualUnits ?? '0'),
    multiplier: job.multiplier ?? 1,
    payoutUnits: String(job.payoutUnits ?? job.actualUnits ?? '0'),
    payout: { transactionHash: job.transactionHash, paidAt: ms(job.paidAt) },
    earnedAt: ms(job.createdAt),
    cashedOutAt: ms(job.cashedAt),
    scoreSource: 'reported by the game in the browser; checked by the server against time and rate bounds',
  };
}

/** Queue a paid reward once (keyed by its session). Returns true when it was queued now. */
export async function enqueueRewardTrail(outbox, job, cfg) {
  if (!cfg?.enabled || job?.status !== 'PAID' || !job.transactionHash) return false;
  const content = rewardTrail(job, cfg);
  const bytes = JSON.stringify(content);
  const res = await outbox.updateOne(
    { _id: `reward:${job.sessionId ?? job._id}` },
    { $setOnInsert: { claimType: 'winlew.reward.trail', state: 'queued', content, contentSha256: sha256(bytes), attempts: 0, createdAt: new Date() } },
    { upsert: true },
  );
  return Boolean(res?.upsertedCount);
}
