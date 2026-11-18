// Hold-to-cash-out multipliers for the XL1 Arcade (2026-10-17).
//
// Rewards are earned into a held balance (the daily cap applies to these base amounts). A player
// cashes out when they choose; each reward is multiplied by how long it was held:
//   held 24 h -> x1, 72 h -> x2, 7 days -> x5, 30 days -> x5 (the owner may raise the last to x10
//   after testing). Rewards younger than 24 h stay held. No multiplier can exceed MAX_HOLD_MULTIPLIER,
//   whatever XL1_HOLD_TIERS says. Pure: the store does the reads and the conditional writes.

export const MAX_HOLD_MULTIPLIER = 10;
export const DEFAULT_HOLD_TIERS = '24h:1,72h:2,7d:5,30d:5';
const UNIT_MS = { h: 3_600_000, d: 86_400_000 };

/** "24h:1,72h:2,7d:5,30d:5" -> [{ minMs, multiplier }] ascending; throws on anything else. */
export function parseHoldTiers(spec = DEFAULT_HOLD_TIERS) {
  const tiers = String(spec || DEFAULT_HOLD_TIERS).split(',').map(part => {
    const m = /^\s*(\d+)([hd]):(\d+)\s*$/.exec(part);
    if (!m) throw new Error('XL1_HOLD_TIERS_invalid');
    const multiplier = Number(m[3]);
    if (!Number.isSafeInteger(multiplier) || multiplier < 1) throw new Error('XL1_HOLD_TIERS_invalid');
    if (multiplier > MAX_HOLD_MULTIPLIER) throw new Error('XL1_HOLD_TIERS_above_max');
    return { minMs: Number(m[1]) * UNIT_MS[m[2]], multiplier, label: `${m[1]}${m[2]}` };
  }).sort((a, b) => a.minMs - b.minMs);
  if (!tiers.length) throw new Error('XL1_HOLD_TIERS_invalid');
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i].minMs === tiers[i - 1].minMs || tiers[i].multiplier < tiers[i - 1].multiplier) throw new Error('XL1_HOLD_TIERS_invalid');
  }
  return tiers;
}

/** The multiplier for a reward held `ageMs`, or 0 if it is not cashable yet. */
export function holdMultiplier(ageMs, tiers) {
  let m = 0;
  for (const t of tiers) if (ageMs >= t.minMs) m = t.multiplier;
  return Math.min(m, MAX_HOLD_MULTIPLIER);
}

/** The next tier a reward will reach, or null at the top. */
export function nextTier(ageMs, tiers) {
  const t = tiers.find(x => ageMs < x.minMs);
  return t ? { multiplier: t.multiplier, inMs: t.minMs - ageMs } : null;
}

/**
 * What a cash-out now would do for these held rows ({ sessionId, actualUnits, createdAt }):
 * the rows it pays (with multiplier and payout units) and the rows that stay held.
 */
export function cashoutPlan(rows, now, tiers) {
  const pay = [];
  const keep = [];
  for (const r of rows) {
    const base = BigInt(r.actualUnits || 0);
    if (base <= 0n) continue;
    const ageMs = now.getTime() - new Date(r.createdAt).getTime();
    const multiplier = holdMultiplier(ageMs, tiers);
    if (multiplier > 0) pay.push({ ...r, multiplier, payoutUnits: base * BigInt(multiplier), ageMs });
    else keep.push({ ...r, ageMs, next: nextTier(ageMs, tiers) });
  }
  const sum = (list, key) => list.reduce((n, r) => n + BigInt(r[key]), 0n);
  return { pay, keep, baseUnits: sum(pay, 'actualUnits'), payoutUnits: sum(pay, 'payoutUnits'), heldUnits: sum(keep, 'actualUnits') };
}
