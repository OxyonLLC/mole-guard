// XL1 Arcade integrity, layer 2 (owner, 2026-10-24): which cash-outs a moderator should look at
// before they are paid. Pure: the reward service gathers the rows, the store moves the flagged
// cash-out to FLAGGED (never paid until approved), and GeoHackers shows it to moderators.
//
// The thresholds are deliberately loose. A dedicated human player should almost never trip one:
// each looks for a pattern that a script produces and people do not, or for money concentrated
// enough that a second pair of eyes is cheap insurance.
import { GAME_RULES } from './reward-engine.js';

// Round-length uniformity and account youth were tried and dropped (review, 2026-10-24): every
// full round counts exactly the cap and Tunnel Tap rounds are 30 s for everyone, so uniform
// lengths flagged honest players while a script evades it with jitter; and the 30-day earning
// gate already handles new accounts, so "under 60 days" would have flagged every new player.
export const REVIEW_DEFAULTS = Object.freeze({
  minRounds: 10,              // pattern flags need at least this many recent rounds
  minRateShare: 0.8,          // this share of rounds barely clears the game's minimum score rate
  minRateMargin: 1.15,        // "barely" = score per paid second under 115% of the minimum
  capDays: 5,                 // reached the daily cap on this many of the last 7 days
  bigCashoutUnits: 200_000_000n, // 200 XL1 (accounting units are millionths)
});

const seconds = r => Number(r.eligiblePoints) || 0;

/**
 * The flags for one cash-out, as plain sentences a moderator can act on. Empty = pay as normal.
 * @param {object} p
 * @param {string} p.identityId   the player's Discord id
 * @param {Array}  p.pay          the rows being cashed out, with payoutUnits
 * @param {Array}  p.history      the player's reward rows of the last 14 days
 * @param {Array}  p.walletRows   reward rows on the same wallet(s) by any account, last 14 days
 * @param {Date}   p.now
 * @param {bigint} p.capUnits     the daily cap
 */
export function cashoutFlags({ identityId, pay, history, walletRows, now, capUnits, rules = REVIEW_DEFAULTS }) {
  const flags = [];
  const others = new Set(walletRows.filter(r => r.identityId !== identityId).map(r => r.identityId));
  if (others.size) flags.push(`The wallet also earned under ${others.size} other account${others.size === 1 ? '' : 's'} in the last 14 days.`);

  // "Just enough" scoring, against the round's real length (paid seconds are themselves bounded by
  // the score, so dividing by them always gives about the minimum). Rows from before elapsedMs was
  // recorded say nothing either way.
  const rounds = history.filter(r => seconds(r) > 0 && Number(r.elapsedMs) > 0)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 50);
  if (rounds.length >= rules.minRounds) {
    const barely = rounds.filter(r => {
      const min = GAME_RULES[r.game]?.minScorePerSecond;
      return min && Number(r.rawScore) / (Number(r.elapsedMs) / 1000) < min * rules.minRateMargin;
    }).length;
    if (barely / rounds.length >= rules.minRateShare) flags.push(`${barely} of the last ${rounds.length} rounds scored just above the minimum the game accepts for their length.`);
  }

  const byDay = new Map();
  for (const r of history) byDay.set(r.rewardDay, (byDay.get(r.rewardDay) || 0n) + BigInt(r.actualUnits || 0));
  const week = new Set(Array.from({ length: 7 }, (_, i) => new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10)));
  const capped = [...byDay].filter(([day, units]) => week.has(day) && units >= capUnits).length;
  if (capped >= rules.capDays) flags.push(`Reached the daily cap on ${capped} of the last 7 days.`);

  const total = pay.reduce((n, r) => n + BigInt(r.payoutUnits || 0), 0n);
  if (total >= rules.bigCashoutUnits) flags.push(`A large cash-out: ${Number(total) / 1e6} XL1.`);
  return flags;
}

/** A cash-out's review id: the player and the moment they cashed out. */
export const reviewId = (identityId, cashedAt) => `${identityId}:${new Date(cashedAt).getTime()}`;
export function parseReviewId(id) {
  const m = /^(\d{17,20}|[\w.-]{1,64}):(\d{10,16})$/.exec(String(id || ''));
  return m ? { identityId: m[1], cashedAt: new Date(Number(m[2])) } : null;
}
