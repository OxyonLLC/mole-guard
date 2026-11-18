import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  foldTransaction,
  emptyTally,
  reconcileAgainstChain,
  FAUCET_ATA,
} from '../../src/mole/evidence/faucetDistributionScanner.js';
import { mergeFaucetScanResult } from '../../src/mole/evidence/faucetDistributionCheckpoint.js';

const OTHER_ATA = 'SomeOtherTokenAccount1111111111111111111111';

function tx({ type = 'transfer', source, destination, account, amount, blockTime = 1_700_000_000, err = null }) {
  return {
    blockTime,
    meta: { err, innerInstructions: [] },
    transaction: {
      message: {
        instructions: [{ parsed: { type, info: { source, destination, account, amount } } }],
      },
    },
  };
}

describe('faucetDistributionScanner: foldTransaction', () => {
  test('counts a transfer OUT of the faucet account as distributed', () => {
    const t = foldTransaction(emptyTally(), tx({ source: FAUCET_ATA, destination: OTHER_ATA, amount: '1500000000' }));
    assert.equal(t.outBaseUnits, 1500000000n);
    assert.equal(t.inBaseUnits, 0n);
    assert.equal(t.payoutCount, 1);
    assert.equal(t.recipients.size, 1);
  });

  test('counts a transfer INTO the faucet account as received, never as distributed', () => {
    const t = foldTransaction(emptyTally(), tx({ source: OTHER_ATA, destination: FAUCET_ATA, amount: '9000000' }));
    assert.equal(t.inBaseUnits, 9000000n);
    assert.equal(t.outBaseUnits, 0n);
    assert.equal(t.payoutCount, 0, 'a top-up is not a payout');
  });

  test('ignores transfers between two unrelated accounts', () => {
    const t = foldTransaction(emptyTally(), tx({ source: OTHER_ATA, destination: 'ThirdParty111', amount: '5' }));
    assert.equal(t.outBaseUnits, 0n);
    assert.equal(t.inBaseUnits, 0n);
  });

  test('a FAILED transaction moves nothing', () => {
    // A reverted transfer sends no tokens; counting it would inflate the
    // published total with payouts that never happened.
    const t = foldTransaction(emptyTally(), tx({ source: FAUCET_ATA, destination: OTHER_ATA, amount: '1500000000', err: { InstructionError: [0, 'x'] } }));
    assert.equal(t.outBaseUnits, 0n);
    assert.equal(t.payoutCount, 0);
  });

  test('deduplicates recipients but not payouts', () => {
    let t = emptyTally();
    t = foldTransaction(t, tx({ source: FAUCET_ATA, destination: OTHER_ATA, amount: '1000000000' }));
    t = foldTransaction(t, tx({ source: FAUCET_ATA, destination: OTHER_ATA, amount: '1000000000' }));
    assert.equal(t.payoutCount, 2, 'two separate payouts');
    assert.equal(t.recipients.size, 1, 'to the same wallet');
    assert.equal(t.outBaseUnits, 2000000000n);
  });

  test('tracks first and last payout times across out-of-order transactions', () => {
    let t = emptyTally();
    t = foldTransaction(t, tx({ source: FAUCET_ATA, destination: OTHER_ATA, amount: '1', blockTime: 2000 }));
    t = foldTransaction(t, tx({ source: FAUCET_ATA, destination: OTHER_ATA, amount: '1', blockTime: 1000 }));
    assert.equal(t.firstPayoutAtMs, 1_000_000);
    assert.equal(t.lastPayoutAtMs, 2_000_000);
  });

  test('a burn from the faucet account is tracked separately from payouts', () => {
    const t = foldTransaction(emptyTally(), tx({ type: 'burn', account: FAUCET_ATA, amount: '7' }));
    assert.equal(t.burnedBaseUnits, 7n);
    assert.equal(t.outBaseUnits, 0n, 'a burn is not a payout to anyone');
  });
});

describe('faucetDistributionScanner: reconcileAgainstChain', () => {
  test('reconciles when in - out - burned equals the live balance', async () => {
    const r = await reconcileAgainstChain(
      { inBaseUnits: 1000n, outBaseUnits: 300n, burnedBaseUnits: 200n },
      { getBalance: async () => '500' },
    );
    assert.equal(r.reconciles, true);
    assert.equal(r.impliedBalanceBaseUnits, '500');
    assert.equal(r.differenceBaseUnits, '0');
  });

  test('does NOT reconcile when transactions are missing from the tally', async () => {
    // The real failure mode: a partial scan under-reports outflow, so the
    // implied balance comes out too high.
    const r = await reconcileAgainstChain(
      { inBaseUnits: 1000n, outBaseUnits: 100n, burnedBaseUnits: 0n },
      { getBalance: async () => '500' },
    );
    assert.equal(r.reconciles, false);
    assert.equal(r.differenceBaseUnits, '400');
  });

  test('a balance lookup returning nothing throws rather than being treated as zero', async () => {
    // Regression: rpcCall resolves to { result }, and reading .value.amount
    // straight off it yielded undefined -> BigInt(0) -> a bogus "live balance
    // of 0" that failed every reconciliation for a non-obvious reason.
    await assert.rejects(
      () => reconcileAgainstChain({ inBaseUnits: 1n, outBaseUnits: 0n, burnedBaseUnits: 0n }, { getBalance: async () => undefined }),
      /Cannot convert|balance/i,
    );
  });
});

describe('faucetDistributionCheckpoint: mergeFaucetScanResult', () => {
  const recon = { liveBalanceBaseUnits: '50', impliedBalanceBaseUnits: '50', reconciles: true };
  const scan = (out, inn, count, recips, first, last) => ({
    ata: FAUCET_ATA,
    owner: 'owner',
    signaturesScanned: 10,
    newestSignature: 'sigNEW',
    tally: {
      outBaseUnits: out, inBaseUnits: inn, burnedBaseUnits: 0n,
      payoutCount: count, recipients: new Set(recips),
      firstPayoutAtMs: first, lastPayoutAtMs: last,
    },
  });

  test('a first-ever scan seeds the checkpoint', () => {
    const m = mergeFaucetScanResult(null, scan(300n, 1000n, 3, ['a', 'b'], 1000, 5000), recon);
    assert.equal(m.totalDistributedBaseUnits, '300');
    assert.equal(m.payoutCount, 3);
    assert.equal(m.distinctRecipients, 2);
    assert.equal(m.reconciles, true);
  });

  test('an incremental scan ACCUMULATES onto the prior checkpoint', () => {
    const first = mergeFaucetScanResult(null, scan(300n, 1000n, 3, ['a', 'b'], 1000, 5000), recon);
    const second = mergeFaucetScanResult(first, scan(150n, 0n, 1, ['b', 'c'], 6000, 7000), recon);
    assert.equal(second.totalDistributedBaseUnits, '450', 'totals add, never replace');
    assert.equal(second.payoutCount, 4);
    assert.equal(second.distinctRecipients, 3, 'recipient sets union — b is not double-counted');
    assert.equal(second.signaturesScanned, 20);
  });

  test('timestamps widen to the outer bounds across scans', () => {
    // NOTE: the scan() helper takes epoch MILLISECONDS directly (unlike
    // foldTransaction, which converts blockTime seconds), so these compare
    // against the raw values.
    const first = mergeFaucetScanResult(null, scan(1n, 0n, 1, ['a'], 5000, 9000), recon);
    const second = mergeFaucetScanResult(first, scan(1n, 0n, 1, ['a'], 1000, 20000), recon);
    assert.equal(Date.parse(second.firstPayoutAtIso), 1000, 'earliest wins');
    assert.equal(Date.parse(second.lastPayoutAtIso), 20000, 'latest wins');
  });
});
