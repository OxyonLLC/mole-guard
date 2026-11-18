import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { MongoArcadeStore } from './mongo-store.js';
import { ArcadeRewardService } from './reward-engine.js';
import { getArcadeConfig } from './config.js';
import { getMongoClient, closeMongo } from '../lib/mongo.js';

// Against a real MongoDB, in a throwaway database that is dropped at the end:
//   XL1_ARCADE_MONGO_TEST=1 node --test src/xl1-arcade/mongo.integration.test.js
// The per-wallet cap (2026-10-24) is reserved in its own ledger before the account's, so these
// are the cases where a race or a crash could hand out more than the cap, or lose a round.
test('Mongo ledger: account and wallet caps under concurrency, crash recovery, settlement, stale sessions',
  { skip: process.env.XL1_ARCADE_MONGO_TEST !== '1' }, async () => {
    await import('dotenv/config');
    const client = await getMongoClient();
    assert.ok(client, 'MongoDB is required for this integration test');
    const db = client.db(`xl1_arcade_test_${crypto.randomBytes(8).toString('hex')}`);
    try {
      const sessions = db.collection('sessions');
      const days = db.collection('days');
      const walletDays = db.collection('wallet_days');
      const decisions = db.collection('decisions');
      await days.createIndex({ identityId: 1, rewardDay: 1 }, { unique: true });
      const store = new MongoArcadeStore();
      store.collections = async () => ({ sessions, days, walletDays, decisions });
      let now = new Date('2026-09-20T12:00:00Z');
      // 1 XL1 a second, a 10 XL1 cap: a 40 s round asks for 40 and the cap decides.
      const service = new ArcadeRewardService({ store, now: () => now,
        config: getArcadeConfig({ XL1_MIN_DISCORD_AGE_DAYS: '0', XL1_REWARD_PER_POINT: '1', XL1_DAILY_REWARD_CAP: '10' }) });
      const W = 'a'.repeat(40);
      const units = async (id) => BigInt((await walletDays.findOne({ _id: id }))?.totalUnits ?? 0);

      // Four accounts on one wallet (one round each: an account has one active round at a time),
      // every completion sent ten times at once.
      const inputs = [];
      for (const identityId of ['alt-1', 'alt-2', 'alt-3', 'alt-4']) {
        const s = await service.start({ identityId, wallet: W, game: 'diglew' });
        inputs.push({ identityId, sessionId: s._id, nonce: s.nonce, rawScore: 2000 });
      }
      now = new Date(now.getTime() + 40000);
      const results = await Promise.all(Array.from({ length: 40 }, (_, i) => service.complete(inputs[i % 4])));
      const byRound = new Map(results.map(r => [r.sessionId, r]));
      assert.equal(byRound.size, 4, 'every round recorded once');
      const paid = [...byRound.values()].reduce((n, r) => n + BigInt(r.actualUnits), 0n);
      assert.equal(paid, 10_000_000n, 'four accounts on one wallet share one 10 XL1 cap');
      assert.equal(await units(`${W}:2026-09-20`), 10_000_000n, 'the wallet ledger agrees with what was awarded');
      const again = await service.complete(inputs[0]);
      assert.equal(again.actualUnits, byRound.get(inputs[0].sessionId).actualUnits, 'a repeat completion returns the same row');

      // A crash after the wallet share is taken but before the account row is written.
      const W2 = 'b'.repeat(40);
      now = new Date('2026-09-20T23:58:00Z');
      const s = await service.start({ identityId: 'recover-user', wallet: W2, game: 'diglew' });
      now = new Date('2026-09-20T23:58:40Z');
      const input = { identityId: s.identityId, sessionId: s._id, nonce: s.nonce, rawScore: 2000 };
      const originalUpdate = days.findOneAndUpdate.bind(days);
      days.findOneAndUpdate = async () => { throw new Error('injected_write_failure'); };
      await assert.rejects(() => service.complete(input), /injected_write_failure/);
      days.findOneAndUpdate = originalUpdate;
      now = new Date('2026-09-21T03:00:00Z');
      const recovered = await service.complete(input);
      assert.equal(recovered.rewardDay, '2026-09-20', 'the round keeps the day it was played');
      assert.equal(recovered.actualXl1, '10');
      assert.equal((await days.findOne({ identityId: s.identityId })).rewards.length, 1);
      assert.equal(await units(`${W2}:2026-09-20`), 10_000_000n, 'the retry reused its wallet share: nothing taken twice');

      // Settlement: the account's own cap is nearer than the wallet's, so the wallet gets the rest back.
      now = new Date('2026-09-22T10:00:00Z');
      const a1 = await service.start({ identityId: 'settle-user', wallet: 'c'.repeat(40), game: 'diglew' });
      // 25 s, with a score that backs 9 s (DigLEW: 15 points a second): 9 XL1 of the 10.
      now = new Date(now.getTime() + 25000);
      assert.equal((await service.complete({ identityId: 'settle-user', sessionId: a1._id, nonce: a1.nonce, rawScore: 135 })).actualXl1, '9');
      const a2 = await service.start({ identityId: 'settle-user', wallet: 'd'.repeat(40), game: 'diglew' });
      now = new Date(now.getTime() + 40000);
      const r2 = await service.complete({ identityId: 'settle-user', sessionId: a2._id, nonce: a2.nonce, rawScore: 2000 });
      assert.equal(r2.actualXl1, '1', 'the account had 1 XL1 of its cap left');
      assert.equal(await units(`${'d'.repeat(40)}:2026-09-22`), 1_000_000n, 'the wallet was settled down to the 1 XL1 awarded');

      // A crash after the account row is written but before the wallet is settled: the retry settles it.
      const W3 = 'f'.repeat(40);
      now = new Date('2026-09-23T10:00:00Z');
      const c1 = await service.start({ identityId: 'crash-user', wallet: W3, game: 'diglew' });
      now = new Date(now.getTime() + 25000);
      const realSettle = store.settleWallet.bind(store);
      store.settleWallet = async () => { throw new Error('injected_settle_failure'); };
      await assert.rejects(() => service.complete({ identityId: 'crash-user', sessionId: c1._id, nonce: c1.nonce, rawScore: 60 }), /injected_settle_failure/);
      store.settleWallet = realSettle;
      const c1r = await service.complete({ identityId: 'crash-user', sessionId: c1._id, nonce: c1.nonce, rawScore: 60 });
      assert.equal(c1r.actualXl1, '4', '60 points back 4 s (DigLEW: 15 points a second)');
      assert.equal(await units(`${W3}:2026-09-23`), 4_000_000n, 'the retry settled the wallet down to the 4 XL1 awarded');

      // A round that died between its two steps and was never retried: after 15 minutes its share is
      // released when another round on the wallet needs it.
      const W4 = '9'.repeat(40);
      now = new Date('2026-09-24T10:00:00Z');
      const dead = await service.start({ identityId: 'dead-user', wallet: W4, game: 'diglew' });
      await sessions.updateOne({ _id: dead._id }, { $set: { state: 'VALIDATING', reservation: { now } } });
      assert.equal(await store.reserveWallet({ wallet: W4, day: '2026-09-24', sessionId: dead._id, requested: 10_000_000, cap: 10_000_000, now }), 10_000_000);
      now = new Date('2026-09-24T10:20:00Z');
      const live = await service.start({ identityId: 'live-user', wallet: W4, game: 'diglew' });
      now = new Date(now.getTime() + 40000);
      const lr = await service.complete({ identityId: 'live-user', sessionId: live._id, nonce: live.nonce, rawScore: 2000 });
      assert.equal(lr.actualXl1, '10', 'the stalled share came back');
      assert.equal(await units(`${W4}:2026-09-24`), 10_000_000n, 'and the wallet still holds only one cap');

      // Layer 2 on Mongo: a flagged cash-out is FLAGGED, listed once, approved once (QUEUED), and the
      // other decision is refused. The shared wallet below flags both accounts.
      const reviewSvc = new ArcadeRewardService({ store, now: () => now,
        config: { ...getArcadeConfig({ XL1_MIN_DISCORD_AGE_DAYS: '0', XL1_REWARD_PER_POINT: '1', XL1_DAILY_REWARD_CAP: '10' }), mode: 'live' } });
      const W5 = '7'.repeat(40);
      now = new Date('2026-09-25T10:00:00Z');
      for (const who of ['rev-a', 'rev-b']) {
        const s = await reviewSvc.start({ identityId: who, wallet: W5, game: 'diglew' });
        now = new Date(now.getTime() + 25000);
        await reviewSvc.complete({ identityId: who, sessionId: s._id, nonce: s.nonce, rawScore: 60 });
      }
      now = new Date('2026-09-27T10:00:00Z');
      assert.equal((await reviewSvc.cashout('rev-a')).status, 'REVIEW');
      const [rev] = await reviewSvc.reviews();
      assert.equal(rev.identityId, 'rev-a');
      assert.ok(rev.flags.some(f => /other account/.test(f)));
      assert.equal((await days.findOne({ identityId: 'rev-a' })).rewards[0].status, 'FLAGGED');
      assert.equal((await reviewSvc.decide(rev.id, 'approve', '876543210987654321')).rewards, 1);
      assert.equal((await days.findOne({ identityId: 'rev-a' })).rewards[0].status, 'QUEUED', 'arrayFilters matched the cash-out by its exact moment');
      await assert.rejects(() => reviewSvc.decide(rev.id, 'decline', '876543210987654321'), /review_already_decided/);
      assert.equal((await days.findOne({ identityId: 'rev-a' })).rewards[0].elapsedMs, 25000, 'the real round length is recorded');

      // A superseded session cannot reserve anything.
      const old = await service.start({ identityId: 'stale-user', wallet: 'e'.repeat(40), game: 'diglew' });
      await service.start({ identityId: 'stale-user', wallet: 'e'.repeat(40), game: 'diglew' });
      await assert.rejects(() => store.reserveReward({ session: old, requestedUnits: 1n, capUnits: 10n,
        rateUnits: 1n, day: '2026-09-22', status: 'SIMULATED', mode: 'dry-run', now,
        rawScore: 250, eligiblePoints: 1 }), /session_not_active/);
      assert.equal(await days.countDocuments({ identityId: 'stale-user' }), 0);
      assert.equal(await units(`${'e'.repeat(40)}:2026-09-22`), 0n, 'and takes no wallet share');
    } finally {
      await db.dropDatabase();
      await closeMongo();
    }
  });
