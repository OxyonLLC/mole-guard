// Public "earned" totals for the arcade's activity panel (2026-10-23). Pure, so it is testable
// without Mongo; mongo-store.js publicStats() feeds it every reward row.
import { unitsToDecimal } from './config.js';

// Earned: every live reward with a value, whatever its stage (held, queued, sent or paid), at its
// base amount (before the hold multiplier). "Paid" alone stays at 0 until someone cashes out, which
// read as "nobody has earned anything". Dry run earns nothing real, so it has no earned totals.
export function earnedTotals(rows, mode, day) {
  const earned = mode === 'dry-run' ? [] : rows.filter(r => r.mode === mode && !['PAUSED', 'SIMULATED', 'DECLINED'].includes(r.status) && BigInt(r.actualUnits || 0) > 0n);
  const base = list => list.reduce((n, r) => n + BigInt(r.actualUnits || 0), 0n);
  return {
    earnedTodayXl1: unitsToDecimal(base(earned.filter(r => r.rewardDay === day))),
    earnedLifetimeXl1: unitsToDecimal(base(earned)),
    earnedRewardCount: earned.length,
    earnedWallets: new Set(earned.map(r => r.wallet)).size,
  };
}
