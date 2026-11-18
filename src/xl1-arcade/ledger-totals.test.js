import assert from 'node:assert/strict';
import test from 'node:test';
import { earnedTotals } from './ledger-totals.js';

// The arcade ledger counts XL1 in millionths (config.js UNITS_PER_XL1).
const XL1 = 1_000_000n;
const row = (status, xl1, day, wallet = 'w1', mode = 'live') => ({ status, actualUnits: String(BigInt(Math.round(xl1 * 1000)) * XL1 / 1000n), rewardDay: day, wallet, mode });

test('held, queued and paid rewards all count as earned, at their base amount', () => {
  const rows = [row('HELD', 0.124, '2026-10-23'), row('HELD', 0.108, '2026-10-23', 'w2'), row('QUEUED', 1, '2026-10-22'), row('PAID', 2, '2026-10-21')];
  assert.deepEqual(earnedTotals(rows, 'live', '2026-10-23'), { earnedTodayXl1: '0.232', earnedLifetimeXl1: '3.232', earnedRewardCount: 4, earnedWallets: 2 });
});

test('paused, zero, simulated and other-mode rows are not earned; dry run earns nothing', () => {
  const rows = [row('PAUSED', 1, '2026-10-23'), row('HELD', 0, '2026-10-23'), row('SIMULATED', 1, '2026-10-23'), row('HELD', 1, '2026-10-23', 'w1', 'dry-run')];
  assert.deepEqual(earnedTotals(rows, 'live', '2026-10-23'), { earnedTodayXl1: '0', earnedLifetimeXl1: '0', earnedRewardCount: 0, earnedWallets: 0 });
  assert.equal(earnedTotals([row('HELD', 1, '2026-10-23', 'w1', 'dry-run')], 'dry-run', '2026-10-23').earnedRewardCount, 0);
});
