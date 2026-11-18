process.env.MONGO_ENABLED = 'false';
process.env.MONGO_URI = '';

// Guards the "show the proof" property of the faucet.
//
// Background: dripTokens() used spl-token's transfer(), which sends AND
// confirms in one call. A confirmation timeout — the RPC being slow, not the
// transfer failing — threw with the signature buried inside the library, so the
// caller had no handle on a transaction that had usually already landed. !drip
// could only say "still being verified" with no link, and the claim was parked
// in `reconciling` for a manual check it didn't need. Verified on 2026-08-01:
// three claims reported that way were all finalized on-chain with err=null.
//
// These tests pin the two halves of the fix: a submitted-but-unconfirmed
// transfer always carries its signature out, and the presence of a signature is
// what classifies a failure as uncertain (so the cooldown is never wrongly
// released for a transfer that did reach the network).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { PayoutUnconfirmedError, confirmSignatureByPolling } from '../../src/faucet/faucet.js';
import { categorizeTransferError, signatureFromTransferError } from '../../src/faucet/payoutExecutor.js';

const SIGNATURE =
  'mk9ggdxsxpnXkwuN3rr9R9CAEKq6CpbYdK8BKs1Hyf5LhNJbivPbd5E6M9aaXCzyJ5ybayDYfdSFSPidTMkVidH';

describe('PayoutUnconfirmedError', () => {
  test('carries the signature, which is the whole point of it existing', () => {
    const err = new PayoutUnconfirmedError('transfer submitted but not confirmed', SIGNATURE);
    assert.equal(err.signature, SIGNATURE);
    assert.equal(err.name, 'PayoutUnconfirmedError');
    assert.ok(err instanceof Error);
  });

  test('preserves the underlying cause and any on-chain error', () => {
    const cause = new Error('block height exceeded');
    const withCause = new PayoutUnconfirmedError('timed out', SIGNATURE, { cause });
    assert.equal(withCause.cause, cause);

    const onChain = new PayoutUnconfirmedError('reverted', SIGNATURE, { onChainError: { InstructionError: [0, 'X'] } });
    assert.deepEqual(onChain.onChainError, { InstructionError: [0, 'X'] });
  });
});

describe('confirmSignatureByPolling', () => {
  test('confirms by polling HTTP RPC methods and never calls confirmTransaction', async () => {
    let statusCalls = 0;
    let confirmTransactionCalls = 0;
    const connection = {
      async getSignatureStatuses() {
        statusCalls += 1;
        return {
          value: [statusCalls === 1
            ? { confirmationStatus: 'processed', confirmations: 1, err: null, slot: 123 }
            : { confirmationStatus: 'confirmed', confirmations: 0, err: null, slot: 124 }],
        };
      },
      async getBlockHeight() {
        return 100;
      },
      async confirmTransaction() {
        confirmTransactionCalls += 1;
        throw new Error('should_not_be_called');
      },
    };

    const result = await confirmSignatureByPolling(connection, {
      signature: SIGNATURE,
      lastValidBlockHeight: 200,
      pollIntervalMs: 0,
      timeoutMs: 1_000,
    });

    assert.deepEqual(result, { value: { err: null } });
    assert.equal(statusCalls, 2);
    assert.equal(confirmTransactionCalls, 0);
  });

  test('surfaces on-chain status errors from polling', async () => {
    const connection = {
      async getSignatureStatuses() {
        return { value: [{ confirmationStatus: 'confirmed', confirmations: 0, err: { InstructionError: [0, 'x'] }, slot: 123 }] };
      },
      async getBlockHeight() {
        return 100;
      },
    };

    const result = await confirmSignatureByPolling(connection, {
      signature: SIGNATURE,
      lastValidBlockHeight: 200,
      pollIntervalMs: 0,
      timeoutMs: 1_000,
    });

    assert.deepEqual(result, { value: { err: { InstructionError: [0, 'x'] } } });
  });

  test('treats block-height expiry as an uncertain post-submission failure', async () => {
    const connection = {
      async getSignatureStatuses() {
        return { value: [null] };
      },
      async getBlockHeight() {
        return 201;
      },
    };

    await assert.rejects(
      () => confirmSignatureByPolling(connection, {
        signature: SIGNATURE,
        lastValidBlockHeight: 200,
        pollIntervalMs: 0,
        timeoutMs: 1_000,
      }),
      /block height exceeded/i,
    );
  });
});

describe('categorizeTransferError', () => {
  test('a signature alone makes a failure uncertain, whatever the message says', () => {
    // The regex below would call this 'failed'. It reached the network, so it
    // must not be — releasing the cooldown here would let a landed transfer be
    // claimed a second time.
    const err = new PayoutUnconfirmedError('something nobody has ever seen before', SIGNATURE);
    assert.equal(categorizeTransferError(err), 'uncertain');
  });

  test('still recognises the known uncertain error shapes without a signature', () => {
    for (const msg of [
      'Transaction was not confirmed in 30.00 seconds',
      'block height exceeded',
      'TransactionExpiredBlockheightExceededError',
      'blockhash not found',
      'request timeout',
    ]) {
      assert.equal(categorizeTransferError(new Error(msg)), 'uncertain', msg);
    }
  });

  test('pre-submission failures stay failed, so the cooldown is released', () => {
    for (const msg of [
      'treasury_not_configured',
      'Invalid public key input',
      'fetch failed',
      'insufficient funds',
    ]) {
      assert.equal(categorizeTransferError(new Error(msg)), 'failed', msg);
    }
  });

  test('an empty or absent signature does not fake certainty', () => {
    assert.equal(categorizeTransferError({ signature: '', message: 'insufficient funds' }), 'failed');
    assert.equal(categorizeTransferError(undefined), 'failed');
    assert.equal(categorizeTransferError(null), 'failed');
  });
});

describe('signatureFromTransferError', () => {
  test('returns the signature when one exists', () => {
    assert.equal(signatureFromTransferError(new PayoutUnconfirmedError('x', SIGNATURE)), SIGNATURE);
  });

  test('returns empty string rather than undefined for everything else', () => {
    assert.equal(signatureFromTransferError(new Error('nope')), '');
    assert.equal(signatureFromTransferError(undefined), '');
    assert.equal(signatureFromTransferError({ signature: 12345 }), '');
  });
});
