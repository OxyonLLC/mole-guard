// MongoDB implementation of the blitz-bridge store (same contract as memoryStore in bridge.js).
// Collections: xl1_blitz_items (one per Blitz cash-out), xl1_blitz_batches (one per XL1 transaction).
// Pausing uses the arcade's own switch: xl1_arcade_worker { _id: 'control', paused: true } stops BOTH.
const OPEN = ['QUEUED', 'PREPARED', 'SUBMITTED', 'REVIEW'];

export async function createMongoBlitzStore(db) {
  const items = db.collection('xl1_blitz_items'), batches = db.collection('xl1_blitz_batches');
  const controls = db.collection('xl1_arcade_worker'), meta = db.collection('xl1_blitz_meta');
  await items.createIndex({ status: 1, claimedAtMs: 1 });
  await batches.createIndex({ status: 1, createdAtMs: 1 });
  await batches.createIndex({ day: 1, status: 1 });
  return {
    async paused() { return (await controls.findOne({ _id: 'control' }))?.paused === true || (await controls.findOne({ _id: 'blitz-control' }))?.paused === true; },
    async meta(k) { return (await meta.findOne({ _id: k }))?.value; },
    async setMeta(k, value) { await meta.updateOne({ _id: k }, { $set: { value } }, { upsert: true }); },
    openBatch: () => batches.findOne({ status: { $in: OPEN } }, { sort: { createdAtMs: 1 } }),
    unsettledPaidBatches: () => batches.find({ status: 'PAID', settled: { $ne: true } }).toArray(),
    async insertBatch(b) { await batches.insertOne(b); return b; },
    async saveBatch(b, patch) {
      const next = await batches.findOneAndUpdate({ _id: b._id, revision: b.revision },
        { $set: { ...patch, updatedAt: new Date() }, $inc: { revision: 1 } }, { returnDocument: 'after' });
      if (!next) throw new Error('blitz_batch_changed');
      return next;
    },
    async upsertItem(it) { await items.updateOne({ _id: it._id }, { $setOnInsert: { ...it, createdAt: new Date() } }, { upsert: true }); },
    item: id => items.findOne({ _id: id }),
    items: statuses => items.find({ status: { $in: statuses } }).sort({ claimedAtMs: 1 }).toArray(),
    async updateItems(ids, patch, fromStatus) {
      await items.updateMany({ _id: { $in: ids }, status: fromStatus }, { $set: { ...patch, updatedAt: new Date() } });
    },
    async unitsSentOn(day) {
      const rows = await batches.find({ day, status: { $in: ['QUEUED', 'PREPARED', 'SUBMITTED', 'PAID', 'REVIEW'] } }, { projection: { totalUnits: 1 } }).toArray();
      return rows.reduce((n, r) => n + BigInt(r.totalUnits), 0n).toString();
    },
  };
}
