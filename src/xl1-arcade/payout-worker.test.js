import test from 'node:test';
import assert from 'node:assert/strict';
import { processPayout } from './payout-worker.js';
import { getArcadeConfig } from './config.js';

function harness() {
  let job = { _id: 'one', status: 'QUEUED', mode: 'live', actualUnits: '50000', wallet: '1'.repeat(40) };
  const calls = [];
  const adapter = {
    balance: async () => 1000n * 10n ** 18n,
    prepare: async () => { calls.push('prepare'); return { hash: 'hash', transaction: 'signed-bytes', requiredAtto: '50000000000000000', exp: 100 }; },
    confirmed: async () => false, expired: async () => false,
    broadcast: async prepared => { calls.push(`broadcast:${prepared.transaction}`); },
  };
  const config = { pausedBalanceUnits: 20000000n, lowBalanceUnits: 100000000n };
  const run = (extra = {}) => processPayout({ job, adapter, config,
    assertLease: async () => {}, save: async patch => { calls.push(`save:${patch.status}`); job = { ...job, ...patch }; return job; }, ...extra });
  return { run, adapter, calls, job: () => job };
}

test('signed transaction is durable before broadcast', async () => {
  const h = harness(); await h.run();
  assert.deepEqual(h.calls, ['prepare', 'save:PREPARED', 'broadcast:signed-bytes', 'save:SUBMITTED']);
});
test('ambiguous broadcast recovery confirms the original transaction without another transfer', async () => {
  const h = harness();
  h.adapter.broadcast = async () => { throw new Error('response lost'); };
  await assert.rejects(h.run, /response lost/);
  assert.equal(h.job().status, 'PREPARED');
  h.adapter.confirmed = async () => true;
  const recovered = await h.run();
  assert.equal(recovered.status, 'PAID');
  assert.equal(recovered.transactionHash, 'hash');
  assert.equal(h.calls.filter(c => c === 'prepare').length, 1);
});
test('pending transaction retries reuse identical signed bytes', async () => {
  const h = harness(); await h.run(); await h.run();
  assert.equal(h.calls.filter(c => c === 'prepare').length, 1);
  assert.equal(h.calls.filter(c => c === 'broadcast:signed-bytes').length, 2);
});
test('expired pending transaction is held instead of being re-signed', async () => {
  const h = harness(); await h.run(); h.adapter.expired = async () => true;
  assert.equal((await h.run()).status, 'REVIEW');
  await h.run();
  assert.equal(h.calls.filter(c => c.startsWith('broadcast:')).length, 1);
});
test('low balance and kill switch prevent submission', async () => {
  const h = harness(); h.adapter.balance = async () => 1n;
  assert.equal((await h.run()).state, 'LOW_BALANCE');
  assert.equal((await h.run({ enabled: false })).state, 'PAUSED');
  assert.deepEqual(h.calls, []);
});
test('lost lease never broadcasts a prepared transaction', async () => {
  const h = harness();
  await assert.rejects(() => h.run({ assertLease: async () => { throw new Error('lost'); } }), /lost/);
  assert.equal(h.calls.some(c => c.startsWith('broadcast:')), false);
});
test('live mode requires an explicit network, chain, RPC, credential and verification source', () => {
  const env = { XL1_REWARD_MODE: 'live', XL1_REWARD_SIGNER_ADAPTER: 'xl1-sdk' };
  assert.throws(() => getArcadeConfig(env), /XL1_NETWORK_required/);
  Object.assign(env, { XL1_NETWORK: 'beta', XL1_RPC_URL: 'https://example.test/rpc', XL1_CHAIN_ID: '0'.repeat(40), XL1_SENDER_FILE: '/private/sender.js' });
  assert.throws(() => getArcadeConfig(env), /XL1_VERIFICATION_FILE_required/);
  env.XL1_VERIFICATION_FILE = '/private/verified.json';
  assert.equal(getArcadeConfig(env).mode, 'live');
});

test('simulation can never become a payout', async () => {
  const h = harness();
  await assert.rejects(() => h.run({ job: { ...h.job(), mode: 'dry-run' } }), /rejects_simulated/);
  assert.deepEqual(h.calls, []);
});
