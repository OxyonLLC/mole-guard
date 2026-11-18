// Singleton guard — stops two copies of the same service running against the
// same Discord token.
//
// WHY THIS EXISTS
//
// ecosystem.config.cjs (PM2) and src/runner.js (used by `yarn dev:all`, i.e.
// the Docker image) BOTH start src/faucet/bot.js. If both supervisors are up,
// two clients log in with the same token, both receive every message, and both
// act on it. MIGRATION.md warns about this ("double command replies"); commit
// d8dd1fc was titled "stop double-replying to Discord commands"; and on
// 2026-08-01 a single `!restart` produced two "Restarting bot…" replies,
// confirming it was still live.
//
// It is not cosmetic. Before claimStore's atomic reservation shipped
// (2026-07-10) a duplicate instance meant a duplicate PAYOUT: 28 recorded
// double-drip incidents, 41,500 WinLEW over-paid. See
// docs/faucet-double-drip-incident.md.
//
// Today claimStore's Mongo transaction stops a duplicate from paying twice —
// but that protection is only as good as Mongo being up, because the file
// fallback's lock lives at `${__dirname}/data/claims_v3.json.lock`, which is
// PER-CHECKOUT. Two checkouts get two lockfiles and no mutual exclusion. This
// guard attacks the cause instead of the symptom: the second instance never
// gets as far as serving traffic.
//
// FAIL-OPEN BY DESIGN. If Mongo is unreachable the guard warns loudly and lets
// the service start. Taking a bot down over an infrastructure hiccup would be
// a worse failure than the duplicate it prevents, and claimStore remains the
// money-safety layer either way.
import crypto from 'crypto';
import os from 'os';
import { getMongoDb, isMongoEnabled } from '../lib/mongo.js';

const COLLECTION = 'service_instances';
const DEFAULT_TTL_MS = 90_000;
const DEFAULT_HEARTBEAT_MS = 30_000;

/**
 * Identity of the lock: service name + a fingerprint of the token. Hashing
 * means the token itself is never written to the database, while two services
 * sharing a token still contend for the same key (which is the situation we
 * care about) and different bots never collide.
 */
export function instanceKey(service, token) {
  const fingerprint = crypto.createHash('sha256').update(String(token || '')).digest('hex').slice(0, 16);
  return `${service}:${fingerprint}`;
}

export function describeSelf() {
  return { host: os.hostname(), pid: process.pid, cwd: process.cwd(), startedAt: new Date().toISOString() };
}

/**
 * Attempts to become the single live instance.
 *
 * Returns { ok: true, release } when this process holds the lock, or
 * { ok: false, holder } when another live instance does.
 *
 * Takeover is time-based rather than "is that PID alive": a crashed instance
 * stops heartbeating, its record expires after ttlMs, and the next start takes
 * over cleanly. That avoids the classic failure where a hard kill leaves a
 * stale lock nobody can clear.
 */
export async function acquireInstanceLock({
  service,
  token,
  ttlMs = DEFAULT_TTL_MS,
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
  now = () => Date.now(),
  db = null,
} = {}) {
  if (!service) throw new Error('singleInstance_requires_service_name');

  if (!db && !isMongoEnabled()) {
    return { ok: true, degraded: true, reason: 'mongo_disabled' };
  }

  let database;
  try {
    database = db || (await getMongoDb());
  } catch (error) {
    return { ok: true, degraded: true, reason: `mongo_unavailable:${error?.message || error}` };
  }

  const key = instanceKey(service, token);
  const self = describeSelf();
  const ts = now();
  const col = database.collection(COLLECTION);

  try {
    // Claim only if unheld or expired. The _id uniqueness plus the
    // expiresAt condition makes this atomic without a transaction.
    const res = await col.findOneAndUpdate(
      { _id: key, $or: [{ expiresAt: { $lte: new Date(ts) } }, { expiresAt: null }] },
      { $set: { holder: self, acquiredAt: new Date(ts), expiresAt: new Date(ts + ttlMs) } },
      { upsert: true, returnDocument: 'after' },
    );
    const holder = res?.holder || self;
    if (holder.pid !== self.pid || holder.host !== self.host) {
      return { ok: false, holder };
    }
  } catch (error) {
    // Duplicate key => somebody else holds a live lock.
    if (error?.code === 11000) {
      const existing = await col.findOne({ _id: key }).catch(() => null);
      return { ok: false, holder: existing?.holder || null };
    }
    return { ok: true, degraded: true, reason: `lock_error:${error?.message || error}` };
  }

  const timer = setInterval(() => {
    col.updateOne({ _id: key, 'holder.pid': self.pid, 'holder.host': self.host },
      { $set: { expiresAt: new Date(now() + ttlMs) } })
      .catch(() => { /* a missed beat just shortens our lease; next one recovers */ });
  }, heartbeatMs);
  timer.unref?.();

  const release = async () => {
    clearInterval(timer);
    await col.deleteOne({ _id: key, 'holder.pid': self.pid, 'holder.host': self.host }).catch(() => {});
  };
  return { ok: true, release, key, holder: self };
}

/**
 * Convenience wrapper for a service entry point: acquire, or log why we are
 * refusing to start and exit. Set SINGLE_INSTANCE_GUARD=false to bypass —
 * intended only for deliberately running a second copy during a migration.
 */
export async function assertSingleInstance({ service, token, logger = console, exit = true, ...opts } = {}) {
  if (String(process.env.SINGLE_INSTANCE_GUARD || '').toLowerCase() === 'false') {
    logger.warn(`[singleton] ${service}: guard DISABLED via SINGLE_INSTANCE_GUARD=false`);
    return { ok: true, bypassed: true };
  }

  const result = await acquireInstanceLock({ service, token, ...opts });

  if (result.degraded) {
    logger.warn(
      `[singleton] ${service}: could not verify uniqueness (${result.reason}). ` +
      'Starting anyway — but if a second copy is running, both will act on every command.',
    );
    return result;
  }

  if (!result.ok) {
    const h = result.holder || {};
    logger.error(
      `[singleton] ${service}: ANOTHER INSTANCE IS ALREADY RUNNING — refusing to start.\n` +
      `  holder: host=${h.host} pid=${h.pid} since=${h.startedAt}\n` +
      `  cwd:    ${h.cwd}\n` +
      '  Two copies with one Discord token double-reply to every command, and before\n' +
      '  claimStore\'s atomic lock existed this double-PAID the faucet (see\n' +
      '  docs/faucet-double-drip-incident.md). Usually this means PM2 and Docker are\n' +
      '  both running the service — pick one supervisor.\n' +
      '  Override with SINGLE_INSTANCE_GUARD=false if this is intentional.',
    );
    if (exit) process.exit(1);
  }
  return result;
}
