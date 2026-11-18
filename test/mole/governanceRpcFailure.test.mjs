// Governance v1.1 — controlled RPC-failure validation (gap 3).
//
// Fault injection is dependency-injection-based, not a fake endpoint:
// checkLiveWinlewEligibility()/resolveGovernanceEligibility() accept an
// optional `getBalance` override (default: the real getOwnerTokenSnapshot
// import in src/mole/web.js). Production code always uses the default —
// only this test file ever supplies an override. See
// docs/governance-v1.1-hardening.md.
import 'dotenv/config';

process.env.MONGO_ENABLED = 'false';
delete process.env.MONGO_URI;

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkLiveWinlewEligibility } from '../../src/mole/web.js';

function synthWallet(label) {
  return `__test_wallet_${label}_${Date.now()}_${Math.random().toString(16).slice(2)}__`;
}

const RPC_SECRET_MARKER = 'https://secret-rpc.example.com/v1/abcdef123456';

async function throwingGetBalance() {
  // Simulates the exact failure shape a real RPC timeout/connection-refused
  // would throw — including a URL an attacker would love to see leak.
  const error = new Error(`fetch failed: ${RPC_SECRET_MARKER} timed out after 10000ms`);
  error.stack = `Error: fetch failed\n    at Connection.fetch (${RPC_SECRET_MARKER})`;
  throw error;
}

// Above GOVERNANCE_CONFIG.minWinlewToVote (1,000,000 as of 2026-07-17) so
// these tests keep asserting eligible:true for the reason they claim to
// (cache/recovery behavior), not accidentally failing because the mocked
// balance fell below a threshold that changed independently of this file.
async function workingGetBalance(_walletAddress) {
  return { winlewBalance: 2_000_000 };
}

describe('checkLiveWinlewEligibility — controlled RPC fault injection', () => {
  test('a thrown RPC error resolves to eligible=null, not false (unavailable, not ineligible)', async () => {
    const wallet = synthWallet('a');
    const result = await checkLiveWinlewEligibility(wallet, { getBalance: throwingGetBalance });
    assert.equal(result.eligible, null, 'must be null (unknown), never false (a false negative)');
    assert.notEqual(result.eligible, false);
  });

  test('balance is null on failure, never a false zero', async () => {
    const wallet = synthWallet('b');
    const result = await checkLiveWinlewEligibility(wallet, { getBalance: throwingGetBalance });
    assert.equal(result.balance, null);
    assert.notEqual(result.balance, 0, 'a failed check must never present as a real zero balance');
  });

  test('balanceCheckOk is false and reason identifies the outage without leaking internals', async () => {
    const wallet = synthWallet('c');
    const result = await checkLiveWinlewEligibility(wallet, { getBalance: throwingGetBalance });
    assert.equal(result.balanceCheckOk, false);
    assert.equal(result.reason, 'balance_check_unavailable');
  });

  test('no raw RPC error, stack trace, or secret URL appears anywhere in the returned/serializable result', async () => {
    const wallet = synthWallet('d');
    const result = await checkLiveWinlewEligibility(wallet, { getBalance: throwingGetBalance });
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /secret-rpc\.example\.com/, 'RPC URL must never reach the returned payload');
    assert.doesNotMatch(serialized, /at Connection\.fetch/, 'stack trace must never reach the returned payload');
    assert.doesNotMatch(serialized, /timed out after/, 'raw error message must never reach the returned payload');
  });

  test('a failed check is never cached — an immediate retry re-checks live rather than replaying stale unavailability', async () => {
    const wallet = synthWallet('e');
    const failed = await checkLiveWinlewEligibility(wallet, { getBalance: throwingGetBalance });
    assert.equal(failed.balanceCheckOk, false);
    // Fault "clears" — retry with a working lookup, still well inside the
    // 60s success-cache TTL window that a cached-failure design would have
    // blocked on.
    const recovered = await checkLiveWinlewEligibility(wallet, { getBalance: workingGetBalance });
    assert.equal(recovered.balanceCheckOk, true);
    assert.equal(recovered.eligible, true);
    assert.equal(recovered.balance, 2_000_000);
  });

  test('a successful check IS cached — a second call within the TTL does not re-invoke getBalance', async () => {
    const wallet = synthWallet('f');
    let calls = 0;
    const countingGetBalance = async () => { calls += 1; return { winlewBalance: 2_000_000 }; };
    const first = await checkLiveWinlewEligibility(wallet, { getBalance: countingGetBalance });
    const second = await checkLiveWinlewEligibility(wallet, { getBalance: countingGetBalance });
    assert.equal(first.eligible, true);
    assert.equal(second.eligible, true);
    assert.equal(calls, 1, 'the cached success must be reused, not re-fetched');
  });
});
