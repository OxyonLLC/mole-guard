import crypto from 'node:crypto';
import { buildBatch, utcDay, verifiedWallets } from './batch.js';

// blitz-bridge: pays Oxyon Blitz cash-outs from the GeoHackers reserve, in hourly batches.
// Same guarantees as the arcade worker (payout-worker.js), extended to many recipients per transaction:
// - exactly one unresolved batch at a time per distributor (and the shared distributor lease with the arcade worker);
// - signed bytes and hash are saved BEFORE broadcast; a crash only ever rebroadcasts those same bytes;
// - an expired, unconfirmed batch goes to REVIEW for a human and is never signed again;
// - Blitz is told "paid" only after the transaction is found on chain.
// Storage is injected (`store`), so tests run on memory and the WinLEW PC on MongoDB (mongo-store.js).

export const ATTO_PER_UNIT = 1_000_000_000_000n; // 1 unit = 1 millionth XL1
const WALLET_SYNC_EVERY_MS = 30 * 60000;
const OPEN = ['QUEUED', 'PREPARED', 'SUBMITTED', 'REVIEW'];

export async function tick({ store, client, adapter, config, readVerification, now = Date.now, log = () => {} }) {
  const t = now();
  if (await store.paused()) return { state: 'PAUSED' };

  // Discord-verified wallets → Blitz fast track (every 30 minutes; never blocks payouts).
  if (readVerification && t - ((await store.meta('walletSyncMs')) ?? 0) >= WALLET_SYNC_EVERY_MS) {
    try {
      const wallets = verifiedWallets(await readVerification(), t, config.minDiscordAgeDays);
      for (let i = 0; i < wallets.length; i += 500) await client.verifiedWallets(wallets.slice(i, i + 500));
      await store.setMeta('walletSyncMs', t);
    } catch { log('blitz-bridge: wallet sync skipped this round'); }
  }

  // 1. Finish the open batch before anything else.
  let open = await store.openBatch();
  if (open) {
    if (open.status === 'REVIEW') return { state: 'BATCH_REVIEW', batchId: open._id };
    if (open.status === 'QUEUED') open = await store.saveBatch(open, { status: 'PREPARED', prepared: await adapter.prepareBatch(open.transfers) });
    if (await adapter.confirmed(open.prepared)) {
      await store.saveBatch(open, { status: 'PAID', paidAtMs: t, settled: false });
    } else if (await adapter.expired(open.prepared)) {
      await store.saveBatch(open, { status: 'REVIEW', reason: 'expired_unconfirmed' });
      return { state: 'BATCH_REVIEW', batchId: open._id };
    } else if (open.status === 'PREPARED') {
      if (!(await funded(adapter, config, open.prepared.requiredAtto))) return { state: 'LOW_BALANCE' };
      await adapter.broadcast(open.prepared);
      await store.saveBatch(open, { status: 'SUBMITTED', submittedAtMs: t });
      return { state: 'SUBMITTED', batchId: open._id };
    } else return { state: 'CONFIRMING', batchId: open._id };
  }

  // 2. Tell Blitz what happened: paid batches (one shared transaction hash) and moderator declines.
  for (const b of await store.unsettledPaidBatches()) {
    for (const id of b.itemIds) {
      const item = await store.item(id);
      await client.settle({ uid: item.uid, requestId: id, status: 'paid', txHash: b.prepared.hash });
    }
    await store.updateItems(b.itemIds, { status: 'PAID', txHash: b.prepared.hash }, 'BATCHED');
    await store.saveBatch(b, { settled: true });
  }
  for (const item of await store.items(['DECLINED_PENDING'])) {
    await client.settle({ uid: item.uid, requestId: item._id, status: 'declined', reason: item.declineReason || 'moderator' });
    await store.updateItems([item._id], { status: 'DECLINED' }, 'DECLINED_PENDING');
  }

  // 3. Collect cash-outs whose payout hour has come.
  const { items } = await client.claim(config.batchMax * 2);
  for (const it of items) {
    const status = it.network !== config.blitzNetwork ? 'WRONG_NETWORK' : it.needsReview ? 'REVIEW' : 'READY';
    await store.upsertItem({ _id: it.requestId, uid: it.uid, wallet: it.walletAddress, units: String(it.amountMillionths),
      network: it.network, needsReview: !!it.needsReview, reviewReason: it.reviewReason || '', status, claimedAtMs: t });
  }

  // 4. Build and send one batch.
  const ready = await store.items(['READY']);
  if (!ready.length) return { state: 'IDLE' };
  const remaining = BigInt(config.dailyCeilingUnits) - BigInt(await store.unitsSentOn(utcDay(t)));
  const spec = buildBatch(ready, { maxRecipients: config.batchMax, remainingUnits: remaining > 0n ? remaining : 0n });
  if (!spec.itemIds.length) return { state: 'DAILY_CEILING' };
  if (config.mode !== 'live') {
    log(`blitz-bridge dry-run: would pay ${Object.keys(spec.transfers).length} wallets, ${spec.totalUnits} units, in one transaction`);
    return { state: 'DRY_RUN', batch: spec };
  }
  if (!(await funded(adapter, config, (BigInt(spec.totalUnits) * ATTO_PER_UNIT).toString()))) return { state: 'LOW_BALANCE' };
  const id = `blitz-${utcDay(t)}-${crypto.createHash('sha256').update(spec.itemIds.join(',')).digest('hex').slice(0, 16)}`;
  let batch = await store.insertBatch({ _id: id, ...spec, network: config.blitzNetwork, day: utcDay(t), status: 'QUEUED', revision: 0, createdAtMs: t });
  await store.updateItems(spec.itemIds, { status: 'BATCHED', batchId: id }, 'READY');
  batch = await store.saveBatch(batch, { status: 'PREPARED', prepared: await adapter.prepareBatch(spec.transfers) });
  if (!(await funded(adapter, config, batch.prepared.requiredAtto))) return { state: 'LOW_BALANCE', batchId: id };
  await adapter.broadcast(batch.prepared);
  await store.saveBatch(batch, { status: 'SUBMITTED', submittedAtMs: t });
  return { state: 'SUBMITTED', batchId: id, recipients: Object.keys(spec.transfers).length };
}

// Never dip below the pause threshold (DISTRIBUTOR_PAYOUT_PAUSED_THRESHOLD), like the arcade worker.
async function funded(adapter, config, requiredAtto) {
  const balance = await adapter.balance();
  return balance >= BigInt(config.pausedBalanceUnits) * ATTO_PER_UNIT + BigInt(requiredAtto);
}

/** Moderator decisions on held Blitz cash-outs (first fast-track payout, 200+ XL1). */
export async function review(store, requestId, decision, reason = '') {
  const item = await store.item(requestId);
  if (!item || item.status !== 'REVIEW') throw new Error('blitz_review_item_not_waiting');
  if (decision === 'approve') return store.updateItems([requestId], { status: 'READY', approvedAt: new Date() }, 'REVIEW');
  if (decision === 'decline') return store.updateItems([requestId], { status: 'DECLINED_PENDING', declineReason: String(reason).slice(0, 200) }, 'REVIEW');
  throw new Error('blitz_review_decision_invalid');
}

/** In-memory store with the same contract as the MongoDB one (tests, and a reference for mongo-store.js). */
export function memoryStore() {
  const batches = new Map(), items = new Map(), meta = new Map(); let paused = false;
  const clone = v => structuredClone(v);
  return {
    _batches: batches, _items: items, setPaused: v => { paused = v; },
    async paused() { return paused; },
    async meta(k) { return meta.get(k); }, async setMeta(k, v) { meta.set(k, v); },
    async openBatch() { return clone([...batches.values()].filter(b => OPEN.includes(b.status)).sort((a, b) => a.createdAtMs - b.createdAtMs)[0] ?? null); },
    async unsettledPaidBatches() { return [...batches.values()].filter(b => b.status === 'PAID' && !b.settled).map(clone); },
    async insertBatch(b) { if (batches.has(b._id)) throw new Error('blitz_batch_exists'); batches.set(b._id, clone(b)); return clone(b); },
    async saveBatch(b, patch) {
      const cur = batches.get(b._id);
      if (!cur || cur.revision !== b.revision) throw new Error('blitz_batch_changed');
      const next = { ...cur, ...clone(patch), revision: cur.revision + 1 }; batches.set(b._id, next); return clone(next);
    },
    async upsertItem(it) { if (!items.has(it._id)) items.set(it._id, clone(it)); },
    async item(id) { return clone(items.get(id) ?? null); },
    async items(statuses) { return [...items.values()].filter(i => statuses.includes(i.status)).map(clone); },
    async updateItems(ids, patch, fromStatus) {
      for (const id of ids) { const cur = items.get(id); if (cur && cur.status === fromStatus) items.set(id, { ...cur, ...clone(patch) }); }
    },
    async unitsSentOn(day) {
      return [...batches.values()].filter(b => b.day === day && ['QUEUED', 'PREPARED', 'SUBMITTED', 'PAID', 'REVIEW'].includes(b.status))
        .reduce((n, b) => n + BigInt(b.totalUnits), 0n).toString();
    },
  };
}
