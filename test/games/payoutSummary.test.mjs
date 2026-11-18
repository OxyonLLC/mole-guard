import test from 'node:test';
import assert from 'node:assert/strict';
import { describeEmptyPayoutPlan } from '../../src/games/payout-worker.js';

test('empty payout summary distinguishes missing wallets, minimums and holds', () => {
  const message = describeEmptyPayoutPlan({
    skipped: [{ reason: 'no_wallet' }, { reason: 'no_wallet' }, { reason: 'below_min' }],
    held: [{ reason: 'over_max' }, { reason: 'needs_identity_sync' }],
  }, 1500);
  assert.match(message, /2 missing payout wallet/);
  assert.match(message, /1 below 1500 WinLEW minimum/);
  assert.match(message, /1 held above per-user cap/);
  assert.doesNotMatch(message, /No unpaid claims found/);
});

test('empty ledger is reported separately from ineligible claims', () => {
  assert.match(describeEmptyPayoutPlan({ skipped: [], held: [] }, 1500), /No unpaid claims found/);
});
