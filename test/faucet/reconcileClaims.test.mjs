import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchClaimToTransfers,
  planReconciliation,
  summarizePlan,
  deriveRecipientAta,
  MATCH,
} from '../../src/faucet/reconcileClaims.js';

const MINT = 'DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump';
const WALLET_A = 'D8oJSdqoYk6heQsf36217mDm3Yf95umjnXaJiLYA5ZEz';
const WALLET_B = '64SpqFh68V3Yn5qa43Hfc8esnQhj3LHi2kJs7umR3kTp';
const ATA_A = deriveRecipientAta(WALLET_A, MINT);
const ATA_B = deriveRecipientAta(WALLET_B, MINT);

const T0 = Date.parse('2026-07-20T12:00:00Z');
const DRIP = '1500000000';

const claim = (over = {}) => ({
  id: 'claim-1', wallet: WALLET_A, mint: MINT, amountBaseUnits: DRIP,
  createdAt: T0, status: 'reconciling', source: 'discord', ...over,
});
const xfer = (over = {}) => ({
  signature: 'sig-1', blockTimeMs: T0 + 60_000, destinationAta: ATA_A, amountBaseUnits: DRIP, ...over,
});

describe('reconcileClaims: deriveRecipientAta', () => {
  test('derives the same ATA the faucet actually pays into', () => {
    // Cross-check against a known real pair: the faucet reserve's own ATA,
    // observed on-chain as Hghcb294... for this mint.
    assert.equal(
      deriveRecipientAta('FcEtZqVowuhF2hdysy7qxJYRhu1eNZ8ws2JqHUDmPPjE', MINT),
      'Hghcb294nXPWmXtGtV7MAXx4M4NxXF26zDahFFSyUUqG',
    );
  });

  test('different wallets derive different ATAs', () => {
    assert.notEqual(ATA_A, ATA_B);
  });
});

describe('reconcileClaims: matchClaimToTransfers', () => {
  test('matches a single transfer with the right wallet, amount and timing', () => {
    const r = matchClaimToTransfers(claim(), [xfer()]);
    assert.equal(r.status, MATCH.MATCHED);
    assert.equal(r.transfer.signature, 'sig-1');
  });

  test('does NOT match a transfer to a different wallet', () => {
    const r = matchClaimToTransfers(claim(), [xfer({ destinationAta: ATA_B })]);
    assert.equal(r.status, MATCH.NONE);
  });

  test('does NOT match a different amount — near-misses are other payouts', () => {
    // A quiz or game reward from the same wallet must never be credited as
    // someone's faucet claim.
    const r = matchClaimToTransfers(claim(), [xfer({ amountBaseUnits: '1000000000' })]);
    assert.equal(r.status, MATCH.NONE);
  });

  test('does NOT match a transfer outside the time window', () => {
    const r = matchClaimToTransfers(claim(), [xfer({ blockTimeMs: T0 + 5 * 60 * 60 * 1000 })]);
    assert.equal(r.status, MATCH.NONE);
  });

  test('matches just inside the window, on either side', () => {
    const w = 2 * 60 * 60 * 1000;
    assert.equal(matchClaimToTransfers(claim(), [xfer({ blockTimeMs: T0 + w })]).status, MATCH.MATCHED);
    assert.equal(matchClaimToTransfers(claim(), [xfer({ blockTimeMs: T0 - w })]).status, MATCH.MATCHED);
  });

  test('REFUSES a signature already credited to another claim', () => {
    // The double-credit guard: one on-chain payout must never satisfy two
    // claims.
    const r = matchClaimToTransfers(claim(), [xfer()], { alreadyCreditedSignatures: new Set(['sig-1']) });
    assert.equal(r.status, MATCH.NONE);
  });

  test('two identical candidate transfers are AMBIGUOUS, never auto-picked', () => {
    const r = matchClaimToTransfers(claim(), [xfer(), xfer({ signature: 'sig-2', blockTimeMs: T0 + 120_000 })]);
    assert.equal(r.status, MATCH.AMBIGUOUS);
    assert.equal(r.candidates.length, 2);
  });

  test('a claim missing required fields never matches', () => {
    assert.equal(matchClaimToTransfers(claim({ wallet: null }), [xfer()]).status, MATCH.NONE);
    assert.equal(matchClaimToTransfers(claim({ createdAt: 0 }), [xfer()]).status, MATCH.NONE);
  });
});

describe('reconcileClaims: planReconciliation', () => {
  test('plans a confirm when a payout is found', () => {
    const plan = planReconciliation([claim()], [xfer()], { now: T0 + 86400000 });
    assert.equal(plan.length, 1);
    assert.equal(plan[0].action, 'confirm');
    assert.equal(plan[0].transfer.signature, 'sig-1');
  });

  test('plans a release when nothing is found and the claim is old', () => {
    const plan = planReconciliation([claim()], [], { now: T0 + 48 * 3600 * 1000 });
    assert.equal(plan[0].action, 'release');
    assert.equal(plan[0].reason, 'confirmed_not_sent');
  });

  test('does NOT release a recent claim — a slow confirmation may still land', () => {
    // Releasing early would free the cooldown and hand out a second drip for
    // the same claim window.
    const plan = planReconciliation([claim()], [], { now: T0 + 60_000 });
    assert.equal(plan[0].action, 'review');
    assert.equal(plan[0].reason, 'no_match_but_too_recent');
  });

  test('never assigns one transfer to two claims in the same run', () => {
    const older = claim({ id: 'older', createdAt: T0 });
    const newer = claim({ id: 'newer', createdAt: T0 + 60_000 });
    // `now` is 48h out so BOTH claims are past the 24h release threshold —
    // otherwise the newer one lands in `review` for being too recent and this
    // test would pass for the wrong reason.
    const plan = planReconciliation([newer, older], [xfer()], { now: T0 + 48 * 3600 * 1000 });

    const confirms = plan.filter((p) => p.action === 'confirm');
    assert.equal(confirms.length, 1, 'only one claim can be credited with the single transfer');
    assert.equal(confirms[0].claim.id, 'older', 'the earlier claim wins, deterministically');
    // The other must not be silently dropped.
    assert.equal(plan.find((p) => p.claim.id === 'newer').action, 'release');
  });

  test('ambiguity is surfaced for review, never applied', () => {
    const plan = planReconciliation([claim()], [xfer(), xfer({ signature: 'sig-2' })], { now: T0 + 86400000 });
    assert.equal(plan[0].action, 'review');
    assert.equal(plan[0].reason, 'multiple_candidates');
  });

  test('summarizePlan counts each action bucket', () => {
    const plan = [
      { action: 'confirm' }, { action: 'confirm' }, { action: 'release' }, { action: 'review' },
    ];
    assert.deepEqual(summarizePlan(plan), { confirm: 2, release: 1, review: 1, total: 4 });
  });
});
