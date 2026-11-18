import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_HOLD_TIERS, MAX_HOLD_MULTIPLIER, cashoutPlan, holdMultiplier, nextTier, parseHoldTiers } from './hold.js';

const H = 3_600_000, D = 24 * H;
const tiers = parseHoldTiers(DEFAULT_HOLD_TIERS);

test('the owner\'s tiers: 24 h x1, 72 h x2, 7 days x5, 30 days x5', () => {
  assert.equal(holdMultiplier(23 * H, tiers), 0);
  assert.equal(holdMultiplier(24 * H, tiers), 1);
  assert.equal(holdMultiplier(71 * H, tiers), 1);
  assert.equal(holdMultiplier(72 * H, tiers), 2);
  assert.equal(holdMultiplier(7 * D, tiers), 5);
  assert.equal(holdMultiplier(30 * D, tiers), 5);
  assert.equal(holdMultiplier(400 * D, tiers), 5);
  assert.deepEqual(nextTier(30 * H, tiers), { multiplier: 2, inMs: 42 * H });
  assert.equal(nextTier(31 * D, tiers), null);
});

test('no setting can pay more than x10, and nonsense is refused', () => {
  assert.equal(MAX_HOLD_MULTIPLIER, 10);
  assert.equal(holdMultiplier(31 * D, parseHoldTiers('24h:1,72h:2,7d:5,30d:10')), 10);
  assert.throws(() => parseHoldTiers('24h:1,30d:11'), /above_max/);
  for (const bad of ['24h:0', '24h:1,72h:1x', '1w:2', '24h:2,72h:1', '24h:1,24h:2']) assert.throws(() => parseHoldTiers(bad), /invalid/, bad);
});

test('a cash-out pays only rewards held 24 h or more, each at its own tier', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  const at = ms => new Date(now.getTime() - ms).toISOString();
  const plan = cashoutPlan([
    { sessionId: 'a', actualUnits: '1000000', createdAt: at(2 * H) },   // 1 XL1, too new
    { sessionId: 'b', actualUnits: '1000000', createdAt: at(30 * H) },  // x1
    { sessionId: 'c', actualUnits: '500000', createdAt: at(4 * D) },    // x2
    { sessionId: 'd', actualUnits: '2000000', createdAt: at(10 * D) },  // x5
    { sessionId: 'e', actualUnits: '0', createdAt: at(10 * D) },        // nothing to pay
  ], now, tiers);
  assert.deepEqual(plan.pay.map(r => [r.sessionId, r.multiplier, String(r.payoutUnits)]), [['b', 1, '1000000'], ['c', 2, '1000000'], ['d', 5, '10000000']]);
  assert.deepEqual(plan.keep.map(r => r.sessionId), ['a']);
  assert.equal(plan.baseUnits, 3_500_000n);
  assert.equal(plan.payoutUnits, 12_000_000n);
  assert.equal(plan.heldUnits, 1_000_000n);
});

test('the daily cap is on base rewards: a month of 2 XL1/day at x5 is at most 300 XL1', () => {
  const now = new Date('2026-12-01T00:00:00Z');
  const rows = Array.from({ length: 30 }, (_, i) => ({ sessionId: `s${i}`, actualUnits: '2000000', createdAt: new Date(now.getTime() - (31 + i) * D).toISOString() }));
  assert.equal(cashoutPlan(rows, now, tiers).payoutUnits, 300_000_000n);
});
