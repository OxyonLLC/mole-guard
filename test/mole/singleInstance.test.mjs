import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { instanceKey, acquireInstanceLock, assertSingleInstance } from '../../src/shared/singleInstance.js';

// Minimal in-memory stand-in for the Mongo collection the guard uses. Only the
// three operations it actually calls, with the same conditional semantics.
function fakeDb(initial = {}) {
  const docs = new Map(Object.entries(initial));
  const col = {
    async findOneAndUpdate(filter, update, opts) {
      const id = filter._id;
      const existing = docs.get(id);
      const expiredOk = !existing
        || existing.expiresAt === null
        || (filter.$or || []).some((c) => c.expiresAt?.$lte && existing.expiresAt <= c.expiresAt.$lte);
      if (existing && !expiredOk) {
        if (opts?.upsert) { const e = new Error('dup'); e.code = 11000; throw e; }
        return null;
      }
      const next = { _id: id, ...(existing || {}), ...update.$set };
      docs.set(id, next);
      return next;
    },
    async findOne(filter) { return docs.get(filter._id) || null; },
    async updateOne(filter, update) {
      const d = docs.get(filter._id);
      if (d && d.holder?.pid === filter['holder.pid']) Object.assign(d, update.$set);
      return { modifiedCount: d ? 1 : 0 };
    },
    async deleteOne(filter) {
      const d = docs.get(filter._id);
      if (d && d.holder?.pid === filter['holder.pid']) docs.delete(filter._id);
      return { deletedCount: 1 };
    },
  };
  return { collection: () => col, _docs: docs };
}

const quietLogger = { warn() {}, error() {} };

afterEach(() => { delete process.env.SINGLE_INSTANCE_GUARD; });

describe('singleInstance: instanceKey', () => {
  test('same service + token always produce the same key', () => {
    assert.equal(instanceKey('winlew-faucet', 'tok'), instanceKey('winlew-faucet', 'tok'));
  });

  test('different tokens do not collide', () => {
    assert.notEqual(instanceKey('winlew-faucet', 'a'), instanceKey('winlew-faucet', 'b'));
  });

  test('the raw token never appears in the key', () => {
    // The key is written to the database; leaking a bot token there would be
    // strictly worse than the bug this guard fixes.
    const token = 'super-secret-discord-token';
    assert.ok(!instanceKey('svc', token).includes(token));
  });
});

describe('singleInstance: acquireInstanceLock', () => {
  test('a first instance acquires the lock', async () => {
    const db = fakeDb();
    const r = await acquireInstanceLock({ service: 'svc', token: 't', db });
    assert.equal(r.ok, true);
    assert.equal(typeof r.release, 'function');
    await r.release();
  });

  test('a SECOND instance is refused while the first is live', async () => {
    const db = fakeDb();
    const first = await acquireInstanceLock({ service: 'svc', token: 't', db });
    assert.equal(first.ok, true);

    // Same host/pid in-process, so simulate a different holder already present.
    db._docs.set(instanceKey('svc', 't'), {
      _id: instanceKey('svc', 't'),
      holder: { host: 'other-box', pid: 999, cwd: '/elsewhere', startedAt: 'x' },
      expiresAt: new Date(Date.now() + 60_000),
    });
    const second = await acquireInstanceLock({ service: 'svc', token: 't', db });
    assert.equal(second.ok, false);
    assert.equal(second.holder.host, 'other-box');
    await first.release();
  });

  test('an EXPIRED lock is taken over — a crashed instance never blocks forever', async () => {
    const db = fakeDb({
      [instanceKey('svc', 't')]: {
        _id: instanceKey('svc', 't'),
        holder: { host: 'dead-box', pid: 1, cwd: '/x', startedAt: 'x' },
        expiresAt: new Date(Date.now() - 1000), // lease already lapsed
      },
    });
    const r = await acquireInstanceLock({ service: 'svc', token: 't', db });
    assert.equal(r.ok, true, 'a stale lock must not be permanent');
    await r.release();
  });

  test('releasing lets the next instance start', async () => {
    const db = fakeDb();
    const first = await acquireInstanceLock({ service: 'svc', token: 't', db });
    await first.release();
    assert.equal(db._docs.size, 0, 'release removes the record');
    const second = await acquireInstanceLock({ service: 'svc', token: 't', db });
    assert.equal(second.ok, true);
    await second.release();
  });

  test('different services never contend, even on one token', async () => {
    const db = fakeDb();
    const a = await acquireInstanceLock({ service: 'faucet', token: 't', db });
    const b = await acquireInstanceLock({ service: 'quiz', token: 't', db });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    await a.release(); await b.release();
  });
});

describe('singleInstance: assertSingleInstance', () => {
  test('FAILS OPEN when the lock backend errors — never takes a bot down over infra', async () => {
    const broken = { collection: () => ({
      async findOneAndUpdate() { throw new Error('mongo exploded'); },
      async findOne() { return null; },
    }) };
    let exited = false;
    const r = await assertSingleInstance({
      service: 'svc', token: 't', db: broken, logger: quietLogger,
      exit: false,
    });
    assert.equal(r.ok, true, 'must start anyway');
    assert.equal(r.degraded, true);
    assert.equal(exited, false);
  });

  test('SINGLE_INSTANCE_GUARD=false bypasses the check entirely', async () => {
    process.env.SINGLE_INSTANCE_GUARD = 'false';
    const db = fakeDb({
      [instanceKey('svc', 't')]: {
        _id: instanceKey('svc', 't'),
        holder: { host: 'other', pid: 999 },
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const r = await assertSingleInstance({ service: 'svc', token: 't', db, logger: quietLogger, exit: false });
    assert.equal(r.ok, true);
    assert.equal(r.bypassed, true);
  });

  test('reports the blocking holder instead of exiting silently', async () => {
    const db = fakeDb({
      [instanceKey('svc', 't')]: {
        _id: instanceKey('svc', 't'),
        holder: { host: 'pm2-box', pid: 42, cwd: '/opt/checkout-a', startedAt: 'then' },
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    let logged = '';
    const r = await assertSingleInstance({
      service: 'svc', token: 't', db, exit: false,
      logger: { warn() {}, error(msg) { logged = msg; } },
    });
    assert.equal(r.ok, false);
    assert.match(logged, /ANOTHER INSTANCE IS ALREADY RUNNING/);
    assert.match(logged, /pm2-box/);
    assert.match(logged, /\/opt\/checkout-a/, 'the cwd tells you WHICH checkout to stop');
  });
});
