/**
 * What has one account actually received, across every reward path.
 *
 * Built 2026-08-02 because nothing computed this. Investigating a heavy
 * claimer, the faucet's own counter said 10 while their token account showed
 * 100+ inbound transfers from the project's reserve wallet — the other ~90 were
 * quiz redemptions and game payouts drawn on the same shared keypair. Judging
 * an account on faucet claims alone understates it by an order of magnitude,
 * and there was no single number to look at instead.
 *
 * Three independent stores, deliberately read defensively: one unavailable
 * source degrades that line to `null` rather than failing the whole answer, and
 * the caller is told which. A total that silently omits a source is worse than
 * one that admits a gap — it would read as "this account received less than it
 * did", which is exactly the wrong direction for a number used to decide
 * whether someone is farming.
 *
 * Read-only. Nothing here writes, bans, or gates anything.
 */

import { createRequire } from 'node:module';
import { getClaimHistoryForUser } from '../faucet/claimStore.js';
import { getRewardSummary } from './rewardHistory.js';

const require = createRequire(import.meta.url);

/**
 * Faucet: confirmed claims only — a reserved-but-failed claim paid nobody.
 *
 * getClaimHistoryForUser() already returns a summary rather than a bare array,
 * and it already sums exactly this. Reusing totalConfirmedAmount keeps one
 * definition of "confirmed" and one summation, instead of a second copy here
 * that could quietly disagree with what the dashboard shows the user.
 */
async function faucetTotals(discordUserId) {
  const summary = await getClaimHistoryForUser(discordUserId, 5000);
  return {
    claims: summary.confirmedCount,
    winlew: Number(summary.totalConfirmedAmount || 0),
    firstAt: summary.firstClaimAt || null,
    lastAt: summary.lastConfirmedAt || null,
  };
}

/**
 * Quiz: paid redemptions only, summed on `winlewSent` — what actually left the
 * treasury — rather than `winlewDue`, which is what was owed at request time
 * and may never have been sent.
 */
function quizTotals(discordUserId) {
  // CommonJS, and loaded lazily so a caller that only wants faucet numbers
  // never pulls the quiz database into its process.
  const db = require('../quiz/db.js');
  const rows = db.listRedemptions(String(discordUserId)) || [];
  const paid = rows.filter((r) => (r.status || 'pending') === 'paid');
  return {
    redemptions: paid.length,
    points: paid.reduce((sum, r) => sum + Number(r.amount || 0), 0),
    winlew: paid.reduce((sum, r) => sum + Number(r.winlewSent || 0), 0),
    pending: rows.length - paid.length,
  };
}

/** Games: the Gaming Hub ledger already summarises itself. */
async function gameTotals(discordUserId) {
  const s = await getRewardSummary(discordUserId);
  return {
    claims: s.paidClaims,
    winlew: Number(s.paidPayout || 0),
    pendingWinlew: Number(s.pendingPayout || 0),
    topGames: (s.byGame || []).slice(0, 3).map((g) => `${g.game} (${g.payout})`),
  };
}

/**
 * Everything one Discord account has been paid.
 *
 * Returns `{ discordUserId, faucet, quiz, games, totalWinlew, unavailable }`.
 * `unavailable` names any source that could not be read, and `totalWinlew` then
 * covers only the sources that answered — always read them together.
 */
export async function getLifetimeRewards(discordUserId) {
  const id = String(discordUserId || '');
  const unavailable = [];

  const settle = async (label, fn) => {
    try {
      return await fn();
    } catch (error) {
      unavailable.push(`${label} (${error?.message || 'unreadable'})`);
      return null;
    }
  };

  const [faucet, quiz, games] = await Promise.all([
    settle('faucet', () => faucetTotals(id)),
    settle('quiz', async () => quizTotals(id)),
    settle('games', () => gameTotals(id)),
  ]);

  const totalWinlew = [faucet?.winlew, quiz?.winlew, games?.winlew]
    .reduce((sum, v) => sum + Number(v || 0), 0);

  return {
    discordUserId: id,
    faucet,
    quiz,
    games,
    totalWinlew: Number(totalWinlew.toFixed(6)),
    unavailable,
    complete: unavailable.length === 0,
  };
}
