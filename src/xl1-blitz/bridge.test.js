import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBatch, discordCreatedMs, verifiedWallets, blitzNetworkFor } from './batch.js';
import { tick, review, memoryStore, ATTO_PER_UNIT } from './bridge.js';
import { createBlitzClient } from './blitz-client.js';

const W = c => c.repeat(40);
const T0 = Date.UTC(2026, 11, 1, 13, 0, 5);

test('batching: oldest first, one line per wallet, recipient cap, daily ceiling never skipped ahead', () => {
  const items = [
    { _id: 'a', wallet: W('a'), units: '5000000', claimedAtMs: 1 }, { _id: 'b', wallet: W('b'), units: '2000000', claimedAtMs: 2 },
    { _id: 'c', wallet: W('a'), units: '1000000', claimedAtMs: 3 }, { _id: 'd', wallet: W('d'), units: '1000000', claimedAtMs: 4 },
  ];
  const all = buildBatch(items, { remainingUnits: 10n ** 12n });
  assert.deepEqual(all.transfers, { [W('a')]: '6000000', [W('b')]: '2000000', [W('d')]: '1000000' });
  assert.deepEqual(all.itemIds, ['a', 'b', 'c', 'd']); assert.equal(all.totalUnits, '9000000');
  assert.deepEqual(buildBatch(items, { maxRecipients: 2, remainingUnits: 10n ** 12n }).itemIds, ['a', 'b', 'c'], 'same wallet still fits');
  assert.deepEqual(buildBatch(items, { remainingUnits: 6000000n }).itemIds, ['a'], 'stops at the ceiling, does not skip to smaller later items');
  assert.deepEqual(buildBatch(items, { remainingUnits: 0n }).itemIds, []);
  assert.throws(() => buildBatch([{ _id: 'x', wallet: 'nope', units: '1', claimedAtMs: 0 }], { remainingUnits: 9n }), /wallet_invalid/);
  assert.equal(blitzNetworkFor('beta'), 'sequence'); assert.equal(blitzNetworkFor('mainnet'), 'mainnet');
});

test('Discord fast track: signed GeoHackers records only, age from the Discord ID', () => {
  const old = '175928847299117063'; // created 2016
  assert.ok(discordCreatedMs(old) < Date.UTC(2017, 0, 1));
  const young = String(((BigInt(T0 - 5 * 86400000) - 1420070400000n) << 22n));
  const db = { users: {
    [old]: { discordUserId: old, verificationMethod: 'xl1-jwt', xl1: { ownershipVerified: true, xl1Address: '0x' + 'A'.repeat(40) } },
    [young]: { discordUserId: young, xl1: { mode: 'wallet-signature', source: 'xl1-wallet-signature', xl1Address: W('b') } },
    '999999999999999999': { discordUserId: '999999999999999999', xl1: { mode: 'typed', xl1Address: W('c') } },
  } };
  assert.deepEqual(verifiedWallets(db, T0), [{ address: W('a'), discordAgeOk: true }, { address: W('b'), discordAgeOk: false }]);
});

// A fake Blitz server (the real one is covered by Pulse-Blitz rewards.test.mjs) and a fake chain.
function world({ balanceXl1 = 1000 } = {}) {
  const queue = [], settled = [], walletSync = [];
  const client = {
    claim: async () => ({ items: queue.splice(0) }),
    settle: async input => { settled.push(input); return { status: input.status }; },
    verifiedWallets: async w => { walletSync.push(w); return { updated: w.length }; },
  };
  const chain = { balance: BigInt(balanceXl1) * 10n ** 18n, sent: [], confirmed: new Set(), height: 100 };
  let n = 0;
  const adapter = {
    balance: async () => chain.balance,
    prepareBatch: async transfers => {
      const total = Object.values(transfers).reduce((s, u) => s + BigInt(u), 0n) * ATTO_PER_UNIT;
      return { hash: String(++n).padStart(64, 'f'), transaction: JSON.stringify(transfers), exp: chain.height + 10, requiredAtto: String(total + 10n ** 15n) };
    },
    broadcast: async p => { chain.sent.push(p); },
    confirmed: async p => chain.confirmed.has(p.hash),
    expired: async p => chain.height > p.exp,
  };
  const store = memoryStore();
  const config = { mode: 'live', blitzNetwork: 'sequence', batchMax: 50, dailyCeilingUnits: (500n * 10n ** 6n).toString(), pausedBalanceUnits: (20n * 10n ** 6n).toString(), minDiscordAgeDays: 30 };
  const item = (id, wallet, xl1, extra = {}) => ({ requestId: id, uid: `u-${id}`, status: 'sending', walletAddress: wallet,
    network: 'sequence', amountMillionths: xl1 * 1e6, needsReview: false, reviewReason: '', source: 'blitz', ...extra });
  return { queue, settled, walletSync, chain, adapter, store, config, client, item };
}

test('an hourly run pays everyone due in ONE transaction, then tells Blitz paid with that hash', async () => {
  const w = world();
  w.queue.push(w.item('r1', W('a'), 6), w.item('r2', W('b'), 2.5), w.item('r3', W('a'), 1));
  const run = () => tick({ store: w.store, client: w.client, adapter: w.adapter, config: w.config, now: () => T0 });
  const first = await run();
  assert.equal(first.state, 'SUBMITTED'); assert.equal(first.recipients, 2);
  assert.equal(w.chain.sent.length, 1, 'one transaction');
  assert.deepEqual(JSON.parse(w.chain.sent[0].transaction), { [W('a')]: '7000000', [W('b')]: '2500000' });
  assert.equal((await run()).state, 'CONFIRMING');
  assert.equal(w.settled.length, 0, 'never "paid" before the chain confirms');
  w.chain.confirmed.add(w.chain.sent[0].hash);
  await run();
  assert.deepEqual(w.settled.map(s => [s.requestId, s.status, s.txHash]), ['r1', 'r2', 'r3'].map(id => [id, 'paid', w.chain.sent[0].hash]));
  assert.equal((await w.store.item('r1')).status, 'PAID');
  assert.equal((await run()).state, 'IDLE'); assert.equal(w.settled.length, 3, 'settled once');
});

test('crash after signing: the next tick sends the SAME saved bytes; expiry goes to review, never re-signed', async () => {
  const w = world();
  w.queue.push(w.item('r1', W('a'), 3));
  const broadcast = w.adapter.broadcast;
  w.adapter.broadcast = async () => { throw new Error('network down'); };
  await assert.rejects(tick({ store: w.store, client: w.client, adapter: w.adapter, config: w.config, now: () => T0 }));
  const saved = await w.store.openBatch();
  assert.equal(saved.status, 'PREPARED'); assert.ok(saved.prepared.hash);
  w.adapter.broadcast = broadcast;
  let signs = 0; const prepare = w.adapter.prepareBatch; w.adapter.prepareBatch = async t => { signs++; return prepare(t); };
  await tick({ store: w.store, client: w.client, adapter: w.adapter, config: w.config, now: () => T0 });
  assert.equal(w.chain.sent[0].hash, saved.prepared.hash); assert.equal(signs, 0, 'not signed again');
  w.chain.height = 500; // past exp, still not on chain
  assert.equal((await tick({ store: w.store, client: w.client, adapter: w.adapter, config: w.config, now: () => T0 })).state, 'BATCH_REVIEW');
  w.queue.push(w.item('r2', W('b'), 1));
  assert.equal((await tick({ store: w.store, client: w.client, adapter: w.adapter, config: w.config, now: () => T0 })).state, 'BATCH_REVIEW',
    'an unresolved batch blocks all further payments');
  assert.equal(signs, 0);
});

test('moderator review: held until approved; declines are reported to Blitz', async () => {
  const w = world();
  w.queue.push(w.item('big', W('a'), 250, { status: 'in_review', needsReview: true, reviewReason: 'large_cashout' }),
    w.item('fast', W('b'), 1, { status: 'in_review', needsReview: true, reviewReason: 'first_payout_discord_fast_track' }));
  const run = () => tick({ store: w.store, client: w.client, adapter: w.adapter, config: w.config, now: () => T0 });
  assert.equal((await run()).state, 'IDLE'); assert.equal(w.chain.sent.length, 0);
  await review(w.store, 'fast', 'approve');
  await review(w.store, 'big', 'decline', 'Duplicate accounts');
  await assert.rejects(review(w.store, 'big', 'approve'), /not_waiting/);
  await run();
  assert.equal(w.chain.sent.length, 1);
  assert.deepEqual(w.settled.find(s => s.requestId === 'big'), { uid: 'u-big', requestId: 'big', status: 'declined', reason: 'Duplicate accounts' });
});

test('pause, daily ceiling, low balance, wrong network and dry-run all stop before signing', async () => {
  const w = world();
  w.store.setPaused(true); w.queue.push(w.item('r1', W('a'), 3));
  assert.equal((await tick({ store: w.store, client: w.client, adapter: w.adapter, config: w.config, now: () => T0 })).state, 'PAUSED');
  w.store.setPaused(false);
  const ceiling = { ...w.config, dailyCeilingUnits: '1000000' };
  assert.equal((await tick({ store: w.store, client: w.client, adapter: w.adapter, config: ceiling, now: () => T0 })).state, 'DAILY_CEILING');
  const poor = world({ balanceXl1: 22 }); poor.queue.push(poor.item('r1', W('a'), 3));
  assert.equal((await tick({ store: poor.store, client: poor.client, adapter: poor.adapter, config: poor.config, now: () => T0 })).state, 'LOW_BALANCE',
    'would dip below the 20 XL1 pause threshold');
  const wrong = world(); wrong.queue.push(wrong.item('m1', W('a'), 3, { network: 'mainnet' }));
  assert.equal((await tick({ store: wrong.store, client: wrong.client, adapter: wrong.adapter, config: wrong.config, now: () => T0 })).state, 'IDLE');
  assert.equal((await wrong.store.item('m1')).status, 'WRONG_NETWORK');
  const dry = world(); dry.queue.push(dry.item('d1', W('a'), 3));
  const r = await tick({ store: dry.store, client: dry.client, adapter: dry.adapter, config: { ...dry.config, mode: 'dry-run' }, now: () => T0 });
  assert.equal(r.state, 'DRY_RUN'); assert.equal(dry.chain.sent.length, 0); assert.equal(dry.settled.length, 0);
  for (const x of [w, poor, wrong, dry]) assert.equal(x.chain.sent.length, 0);
});

test('wallet sync every 30 minutes, never blocking payouts', async () => {
  const w = world();
  const db = { users: { '175928847299117063': { discordUserId: '175928847299117063', verificationMethod: 'xl1-jwt', xl1: { ownershipVerified: true, xl1Address: W('a') } } } };
  const go = t => tick({ store: w.store, client: w.client, adapter: w.adapter, config: w.config, now: () => t, readVerification: async () => db });
  await go(T0); await go(T0 + 60000); await go(T0 + 31 * 60000);
  assert.equal(w.walletSync.length, 2);
  const broken = await tick({ store: w.store, client: w.client, adapter: w.adapter, config: w.config, now: () => T0 + 99 * 60000,
    readVerification: async () => { throw new Error('file missing'); } });
  assert.equal(broken.state, 'IDLE');
});

test('client: https only, token required, errors never include the token', async () => {
  assert.throws(() => createBlitzClient({ apiUrl: 'http://example.com', token: 'k'.repeat(40) }), /https/);
  assert.throws(() => createBlitzClient({ apiUrl: 'https://example.com', token: 'short' }), /token_invalid/);
  const token = 's'.repeat(48);
  const c = createBlitzClient({ apiUrl: 'https://blitz.example', token, fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }) });
  await assert.rejects(c.claim(10), e => /blitz_bridge_http_404_claim/.test(e.message) && !e.message.includes(token));
});
