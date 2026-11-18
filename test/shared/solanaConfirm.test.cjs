const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { confirmSignatureByPolling } = require('../../src/shared/solanaConfirm.cjs');

const SIGNATURE =
  'mk9ggdxsxpnXkwuN3rr9R9CAEKq6CpbYdK8BKs1Hyf5LhNJbivPbd5E6M9aaXCzyJ5ybayDYfdSFSPidTMkVidH';

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

  test('treats block-height expiry as an error', async () => {
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

// ── Added 2026-08-13, reviewing the change that introduced this module ────────
//
// The original timeout was 30s. A Solana blockhash lives ~60-90s, so that fired
// while the transaction was still landable — and all three callers retry on a
// throw (the games worker says so in a comment: "Leave these rows unpaid — they
// retry on the next nightly run"). A transaction that confirms after the
// timeout, followed by a retry, pays twice in real tokens.
//
// These pin the property that makes retrying safe: give up for a reason that
// means the transaction CANNOT land, and when that is not the reason, say so
// loudly and hand back the signature.
describe('giving up safely', () => {
  const { SignatureUnconfirmedError, CONFIRMATION_TIMEOUT_MS } = require('../../src/shared/solanaConfirm.cjs');

  test('the timeout outlives a blockhash, so expiry is what normally stops it', () => {
    // 150 slots at ~400ms is ~60s; observed mainnet ceiling is ~90s. Anything
    // at or under that turns a still-valid transaction into a "failure" the
    // callers will re-send.
    assert.ok(
      CONFIRMATION_TIMEOUT_MS > 90_000,
      `timeout is ${CONFIRMATION_TIMEOUT_MS}ms — a blockhash can outlive that, so this would `
        + 'report a landable transaction as failed and the callers would pay twice',
    );
  });

  test('a timeout is reported as unknown, with the signature, not as a failure', async () => {
    const signature = 'SigThatNeverConfirms1111111111111111111111111';
    const connection = {
      // never confirms, and the blockhash never expires
      getSignatureStatuses: async () => ({ value: [null] }),
      getBlockHeight: async () => 1,
    };

    await assert.rejects(
      () => confirmSignatureByPolling(connection, {
        signature,
        lastValidBlockHeight: 1_000_000,
        pollIntervalMs: 1,
        timeoutMs: 20,
      }),
      (err) => {
        assert.ok(err instanceof SignatureUnconfirmedError, `got ${err.name}`);
        assert.equal(err.signature, signature, 'the signature must survive — losing it is how a payout loses its proof');
        assert.equal(err.unconfirmed, true);
        assert.match(err.message, /may yet land|Do not re-send/i);
        return true;
      },
    );
  });

  test('expiry still throws a plain error — that one IS safe to retry', async () => {
    const connection = {
      getSignatureStatuses: async () => ({ value: [null] }),
      getBlockHeight: async () => 5_000,
    };
    await assert.rejects(
      () => confirmSignatureByPolling(connection, {
        signature: 'Expired1111111111111111111111111111111111111',
        lastValidBlockHeight: 100,
        pollIntervalMs: 1,
      }),
      (err) => {
        assert.ok(!(err instanceof SignatureUnconfirmedError), 'expiry must NOT be confused with unknown');
        assert.match(err.message, /block height exceeded/);
        return true;
      },
    );
  });
});
