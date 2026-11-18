import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueRewardTrail, evidenceConfig, rewardTrail, REWARD_TRAIL_SCHEMA } from './evidence-outbox.js';

const SALT = 's'.repeat(40);
const job = {
  _id: 'sess-1', sessionId: 'sess-1', identityId: '248525967377694720', wallet: 'a9304753eade52dd22b1a6fc519b571a4dc2653e',
  game: 'molespades', rewardRate: '0.05', rateUnits: '50000', mode: 'live', network: 'mainnet', chainId: '319e667ced10452a117472811130444ded357f26',
  rewardDay: '2026-10-19', rawScore: 1200, eligiblePoints: 48, actualUnits: '2000000', multiplier: 2, payoutUnits: '4000000',
  status: 'PAID', transactionHash: 'f'.repeat(64), paidAt: '2026-10-22T10:00:00Z', createdAt: '2026-10-19T09:00:00Z', cashedAt: '2026-10-22T09:59:00Z',
};

function mockOutbox() {
  const docs = new Map();
  return { docs, async updateOne(filter, update, opts) {
    if (docs.has(filter._id)) return { upsertedCount: 0, matchedCount: 1 };
    if (opts?.upsert) { docs.set(filter._id, { _id: filter._id, ...update.$setOnInsert }); return { upsertedCount: 1, matchedCount: 0 }; }
    return { upsertedCount: 0, matchedCount: 0 };
  } };
}

test('off by default, and off with a short salt', () => {
  assert.equal(evidenceConfig({}).enabled, false);
  assert.equal(evidenceConfig({ XL1_ARCADE_EVIDENCE: 'true', XL1_ARCADE_EVIDENCE_SALT: 'short' }).enabled, false);
  assert.equal(evidenceConfig({ XL1_ARCADE_EVIDENCE: 'true', XL1_ARCADE_EVIDENCE_SALT: SALT }).enabled, true);
});

test('the published content never carries the member or their wallet', () => {
  const c = rewardTrail(job, { salt: SALT });
  const text = JSON.stringify(c);
  assert.equal(c.schema, REWARD_TRAIL_SCHEMA);
  assert.equal(text.includes(job.identityId), false, 'no Discord / WinLEW id');
  assert.equal(text.includes(job.wallet), false, 'no wallet');
  assert.match(c.playerCommitment, /^[0-9a-f]{64}$/);
  // The same rule oxyon-evidence's verifier applies: no 17-20 digit ids, no 40-hex addresses.
  const walk = v => (v && typeof v === 'object' ? Object.values(v).flatMap(walk) : [String(v)]);
  for (const v of walk(c)) {
    assert.equal(/^\d{17,20}$/.test(v), false, `looks like a member id: ${v}`);
    assert.equal(/^(0x)?[0-9a-fA-F]{40}$/.test(v), false, `looks like a wallet: ${v}`);
  }
  assert.equal(c.payout.transactionHash, job.transactionHash);
  assert.equal(c.payoutUnits, '4000000');
  assert.equal(c.multiplier, 2);
});

test('commitments are stable for one salt and change with another', () => {
  assert.deepEqual(rewardTrail(job, { salt: SALT }), rewardTrail(job, { salt: SALT }));
  assert.notEqual(rewardTrail(job, { salt: SALT }).playerCommitment, rewardTrail(job, { salt: 't'.repeat(40) }).playerCommitment);
});

test('queued once per reward, only when paid, and never when off', async () => {
  const on = { enabled: true, salt: SALT };
  const box = mockOutbox();
  assert.equal(await enqueueRewardTrail(box, job, on), true);
  assert.equal(await enqueueRewardTrail(box, job, on), false, 'a second pass does not queue it again');
  assert.equal(box.docs.size, 1);
  const doc = box.docs.get('reward:sess-1');
  assert.equal(doc.state, 'queued');
  assert.match(doc.contentSha256, /^[0-9a-f]{64}$/);
  assert.equal(await enqueueRewardTrail(mockOutbox(), { ...job, status: 'SUBMITTED' }, on), false);
  assert.equal(await enqueueRewardTrail(mockOutbox(), { ...job, transactionHash: null }, on), false);
  assert.equal(await enqueueRewardTrail(mockOutbox(), job, { enabled: false, salt: SALT }), false);
});
