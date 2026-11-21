import 'dotenv/config';
import crypto from 'node:crypto';
import { getMongoDb, closeMongo } from '../lib/mongo.js';
import { getArcadeConfig } from '../xl1-arcade/config.js';
import { getPayoutConfig } from '../xl1-arcade/payout-config.js';
import { createSignerAdapter } from '../xl1-arcade/signer-adapter.js';
import { processPayout } from '../xl1-arcade/payout-worker.js';
import { enqueueRewardTrail, evidenceConfig, OUTBOX_COLLECTION } from '../xl1-arcade/evidence-outbox.js';

const once = process.argv.includes('--once');
const NAME = 'XL1 worker';
// Never become a silent zombie (incident 2026-11-17: a failing database write in the error path escaped the loop, main()
// gave up, but SDK handles kept the process alive, so pm2 showed "online" for 4 days while nothing ran).
// If no cycle has finished for STALL_MS, exit so pm2 restarts the process.
const STALL_MS = 15 * 60000;
let lastCycleMs = Date.now();
const stallTimer = setInterval(() => {
  if (Date.now() - lastCycleMs > STALL_MS) { console.error('%s: no cycle finished for 15 minutes; exiting so pm2 restarts it.', NAME); process.exit(1); }
}, 60000);
stallTimer.unref();
let stopped = false;
process.on('SIGINT', () => { stopped = true; });
process.on('SIGTERM', () => { stopped = true; });

async function main() {
  const arcade = getArcadeConfig();
  if (arcade.mode !== 'live') {
    console.log('XL1 worker: dry-run mode; no transactions submitted.');
    return;
  }
  const config = getPayoutConfig();
  const adapter = await createSignerAdapter(config, arcade.distributor);
  const db = await getMongoDb();
  if (!db) throw new Error('xl1_arcade_requires_mongodb');
  const days = db.collection(process.env.XL1_ARCADE_LEDGER_COLLECTION || 'xl1_arcade_reward_days');
  const jobs = db.collection('xl1_arcade_payouts');
  const controls = db.collection('xl1_arcade_worker');
  // Reward-trail evidence (off unless configured): written after a payout is final, never before.
  const evidence = evidenceConfig();
  const outbox = db.collection(OUTBOX_COLLECTION);
  const leaseId = `distributor:${arcade.distributor}`;
  const owner = crypto.randomUUID();
  await controls.updateOne({ _id: leaseId }, { $setOnInsert: { expiresAt: new Date(0) } }, { upsert: true });
  await jobs.createIndex({ status: 1, createdAt: 1 });
  async function tick() {
    const now = new Date();
    const lease = await controls.findOneAndUpdate({ _id: leaseId, expiresAt: { $lte: now } },
      { $set: { owner, expiresAt: new Date(Date.now() + 120000) } }, { returnDocument: 'after' });
    if (!lease) return;
    const assertLease = async () => {
      const result = await controls.updateOne({ _id: leaseId, owner, expiresAt: { $gt: new Date() } },
        { $set: { expiresAt: new Date(Date.now() + 120000) } });
      if (!result.matchedCount) throw new Error('xl1_worker_lease_lost');
    };
    try {
      // Pauses can be changed immediately without restarting the worker.
      const control = await controls.findOne({ _id: 'control' });
      const enabled = arcade.enabled && !control?.paused;
      if (!enabled) { await controls.updateOne({ _id: 'health' }, { $set: { status: 'PAUSED', checkedAt: new Date() } }, { upsert: true }); return; }
      // Reconcile durable payout states whose ledger update was interrupted.
      for await (const paid of jobs.find({ status: { $in: ['PREPARED', 'SUBMITTED', 'REVIEW', 'PAID'] }, ledgerSynced: { $ne: true } })) {
        const synced = await days.updateOne({ 'rewards.sessionId': paid._id }, { $set: {
          'rewards.$.status': paid.status, 'rewards.$.paidAt': paid.paidAt || null,
          'rewards.$.transactionHash': paid.transactionHash,
        } });
        if (!synced.matchedCount) throw new Error('xl1_reward_ledger_missing');
        await jobs.updateOne({ _id: paid._id, revision: paid.revision }, { $set: { ledgerSynced: true } });
        // Evidence can never hold up or undo a payment: a failure here is only logged.
        if (paid.status === 'PAID') await enqueueRewardTrail(outbox, paid, evidence).catch(() => console.error('XL1 reward-trail outbox write failed; the payout is unaffected.'));
      }
      const balanceAtto = String(await adapter.balance());
      await controls.updateOne({ _id: 'health' }, { $set: { checkedAt: new Date(), balanceAtto,
        network: config.network, chainId: config.chainId, status: 'READY',
        lowBalance: BigInt(balanceAtto) < config.lowBalanceUnits * 1000000000000n } }, { upsert: true });
      // A transfer under review blocks further payments from this distributor.
      // Never rebuild an expired transaction automatically: it may have landed.
      let job = await jobs.findOne({ status: { $in: ['PREPARED', 'SUBMITTED', 'REVIEW'] } }, { sort: { createdAt: 1 } });
      if (!job) {
        const pending = await days.aggregate([
          { $match: { 'rewards.status': 'QUEUED' } }, { $unwind: '$rewards' },
          { $match: { 'rewards.status': 'QUEUED', 'rewards.mode': 'live',
            'rewards.actualUnits': { $ne: '0' }, 'rewards.chainId': config.chainId } },
          { $sort: { 'rewards.createdAt': 1 } }, { $limit: 1 },
        ]).next();
        if (!pending) return;
        const reward = pending.rewards;
        await jobs.updateOne({ _id: reward.sessionId }, { $setOnInsert: {
          ...reward, _id: reward.sessionId, revision: 0, status: 'QUEUED',
        } }, { upsert: true });
        job = await jobs.findOne({ _id: reward.sessionId });
      }
      if (job.chainId !== config.chainId) throw new Error('xl1_chain_mismatch');
      const save = async patch => {
        await assertLease();
        const updated = await jobs.findOneAndUpdate({ _id: job._id, revision: job.revision },
          { $set: { ...patch, ledgerSynced: false, updatedAt: new Date() }, $inc: { revision: 1 } }, { returnDocument: 'after' });
        if (!updated) throw new Error('xl1_worker_job_changed');
        job = updated;
        return updated;
      };
      const result = await processPayout({ job, adapter, save, config, assertLease: async () => {
        await assertLease();
        if ((await controls.findOne({ _id: 'control' }))?.paused) throw new Error('xl1_rewards_paused');
      }, enabled });
      await controls.updateOne({ _id: 'health' }, { $set: { status: result.state || result.status, checkedAt: new Date() } });
    } catch {
      // Do not emit upstream SDK errors, URLs or credential-bearing diagnostics.
      console.error('XL1 payout cycle failed; durable transaction state retained for recovery.');
      // These writes can fail for the same reason the cycle did (e.g. the database is unreachable): never let them escape.
      await controls.updateOne({ _id: 'health' }, { $set: { status: 'ERROR', checkedAt: new Date() } }, { upsert: true })
        .catch(() => console.error('XL1 worker: could not record ERROR health (database unreachable?).'));
      if (once) process.exitCode = 1;
    } finally {
      // An unreleased lease simply expires after 120 s.
      await controls.updateOne({ _id: leaseId, owner }, { $set: { expiresAt: new Date(0) } }).catch(() => {});
    }
  }
  do {
    // Acquiring the lease itself can fail (database down): count that as a failed cycle, not a fatal error.
    await tick().catch(() => console.error('XL1 payout cycle failed before it started (lease); retrying.'));
    lastCycleMs = Date.now();
    if (!once && !stopped) await new Promise(resolve => setTimeout(resolve, 10000));
  } while (!once && !stopped);
}

main().catch(() => { console.error('XL1 worker startup failed; check server-only configuration.'); process.exitCode = 1; })
  // Exit for real, so pm2 restarts a failed worker (SDK handles would otherwise keep a dead loop "online").
  .finally(async () => { await closeMongo().catch(() => {}); process.exit(process.exitCode ?? 0); });
