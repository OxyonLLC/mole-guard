// Atomic faucet claim reservation + ledger, shared by the Discord adapter
// (src/faucet/bot.js) and the web adapter (src/mole/web.js's /api/faucet/*
// routes) through src/faucet/service.js.
//
// The core invariant: before any token transfer, atomically reserve BOTH the
// Discord user's cooldown entitlement and the normalized wallet's cooldown
// entitlement. Exactly one of two concurrent competing requests may succeed,
// regardless of whether they came from Discord, the website, or both at
// once, and regardless of whether the Discord bot and the web server are
// running as separate OS processes (they are — see src/runner.js).
//
// Two backends, same async interface:
//   - Mongo (when MONGO_ENABLED/MONGO_URI is set): a `faucet_locks`
//     collection with a unique index on `key`, reserved via a session
//     transaction so a block on either key rolls back both. Safe across
//     multiple hosts/processes.
//   - File (local dev fallback): a single JSON file behind an
//     exclusive-create lockfile (fs.openSync(path, 'wx')), the same pattern
//     already proven in production by src/quiz/db.js's acquireLock/
//     mutateDb. Safe across multiple processes on the SAME host/filesystem
//     — NOT safe across multiple hosts. This is a real limitation, not a
//     pretend one; see docs/faucet-web-expansion.md.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isMongoEnabled, getMongoDb } from '../lib/mongo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// FAUCET_DATA_DIR keeps the same <faucet>/data layout under an isolated root;
// production (unset) is unchanged. Captured at import because FILE_STORE_PATH
// is exported as a constant.
const DATA_DIR = path.join(String(process.env.FAUCET_DATA_DIR || '').trim() || __dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'claims_v3.json');
const LOCK_FILE = `${STORE_FILE}.lock`;

export const CLAIM_STATUSES = Object.freeze({
  RESERVED: 'reserved',
  PROCESSING: 'processing',
  SUBMITTED: 'submitted',
  CONFIRMED: 'confirmed',
  KNOWN_FAILED: 'known_failed',
  RECONCILING: 'reconciling',
  ADMIN_RELEASED: 'administratively_released',
});

function sleepMs(ms) {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

function userKey(discordUserId) {
  return `user:${String(discordUserId)}`;
}
function walletKey(wallet) {
  return `wallet:${String(wallet)}`;
}

// Shared by both backends' getClaimHistoryForUser — `claims` must already be
// this user's claims only, ascending by createdAt.
function summarizeClaimHistory(claims) {
  const confirmed = claims.filter((c) => c.status === CLAIM_STATUSES.CONFIRMED);
  // amountDisplay is a decimal-string snapshot taken at claim time (see
  // claimFaucet() in src/faucet/service.js) — summing the confirmed ones is
  // an accurate "how much this user has actually received" total, distinct
  // from confirmedCount (how many times).
  const totalConfirmedAmount = confirmed.reduce((sum, c) => sum + (Number(c.amountDisplay) || 0), 0);
  return {
    claims,
    count: claims.length,
    confirmedCount: confirmed.length,
    firstClaimAt: claims.length ? claims[0].createdAt : null,
    lastClaimAt: claims.length ? claims[claims.length - 1].createdAt : null,
    lastConfirmedAt: confirmed.length ? confirmed[confirmed.length - 1].createdAt : null,
    totalConfirmedAmount: Number(totalConfirmedAmount.toFixed(4)),
  };
}

// Shared by both backends' getGlobalFaucetStats — `claims` may be the FULL
// store (any status); this filters to CONFIRMED itself, same "confirmed
// means actually sent" standard as summarizeClaimHistory above. Split by
// source ('web'/'discord', the only two values an adapter ever forces — see
// service.js's own doc comment; anything else, e.g. the legacy-migration
// marker rows, buckets into 'other' rather than silently vanishing or
// throwing) for the /faucet/ page's own Web vs Discord comparison, mirroring
// the Quiz page's existing platform-split pattern.
function summarizeGlobalFaucetStats(claims) {
  const confirmed = claims.filter((c) => c.status === CLAIM_STATUSES.CONFIRMED && c.id !== '__migration_marker_v2__');
  const bySource = {};
  let totalAmount = 0;
  let firstClaimAt = null;
  let lastClaimAt = null;
  for (const c of confirmed) {
    const amount = Number(c.amountDisplay) || 0;
    totalAmount += amount;
    const src = c.source === 'web' || c.source === 'discord' ? c.source : 'other';
    if (!bySource[src]) bySource[src] = { count: 0, amount: 0 };
    bySource[src].count += 1;
    bySource[src].amount += amount;
    if (firstClaimAt === null || c.createdAt < firstClaimAt) firstClaimAt = c.createdAt;
    if (lastClaimAt === null || c.createdAt > lastClaimAt) lastClaimAt = c.createdAt;
  }
  for (const key of Object.keys(bySource)) bySource[key].amount = Number(bySource[key].amount.toFixed(4));
  return {
    totalConfirmedCount: confirmed.length,
    totalConfirmedAmount: Number(totalAmount.toFixed(4)),
    bySource,
    firstClaimAt,
    lastClaimAt,
  };
}

// Shared by both backends' getFaucetLeaderboard (2026-07-19) — ranks users by
// total confirmed WinLEW claimed. `source` optionally filters to just
// 'web' or 'discord' claims (mirrors Quiz's topUsersByPlatform split, for
// the /leaderboards/ page's Web/Discord tabs per section) — this is safe
// unlike a per-user identity split, since it's just "which interface did
// this claim come in through," the same field summarizeGlobalFaucetStats
// already buckets by. Omitting `source` combines both, for a single
// "top claimers overall" view.
function summarizeFaucetLeaderboard(claims, limit = 50, source = null) {
  const wantSource = source === 'web' || source === 'discord' ? source : null;
  const confirmed = claims.filter((c) =>
    c.status === CLAIM_STATUSES.CONFIRMED &&
    c.id !== '__migration_marker_v2__' &&
    c.discordUserId &&
    (!wantSource || c.source === wantSource)
  );
  const byUser = new Map();
  for (const c of confirmed) {
    const id = String(c.discordUserId);
    const amount = Number(c.amountDisplay) || 0;
    const entry = byUser.get(id) || { discordUserId: id, totalAmount: 0, claims: 0 };
    entry.totalAmount += amount;
    entry.claims += 1;
    byUser.set(id, entry);
  }
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  return [...byUser.values()]
    .map((e) => ({ ...e, totalAmount: Number(e.totalAmount.toFixed(4)) }))
    .sort((a, b) => b.totalAmount - a.totalAmount)
    .slice(0, safeLimit);
}

// ─────────────────────────── File-mode backend ─────────────────────────────

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function acquireFileLock(timeoutMs = 5000) {
  ensureDataDir();
  const started = Date.now();
  while (true) {
    try {
      return fs.openSync(LOCK_FILE, 'wx');
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (Date.now() - started > timeoutMs) throw new Error('faucet_claim_lock_timeout');
      sleepMs(25);
    }
  }
}

function releaseFileLock(fd) {
  try { if (typeof fd === 'number') fs.closeSync(fd); } catch {}
  try { if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE); } catch {}
}

function emptyStore() {
  return { version: 3, claims: {}, locks: {}, requestIndex: {}, meta: { migratedV2At: null, migratedV2Counts: null } };
}

function readStoreUnlocked() {
  ensureDataDir();
  if (!fs.existsSync(STORE_FILE)) return emptyStore();
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    return {
      version: 3,
      claims: raw.claims && typeof raw.claims === 'object' ? raw.claims : {},
      locks: raw.locks && typeof raw.locks === 'object' ? raw.locks : {},
      requestIndex: raw.requestIndex && typeof raw.requestIndex === 'object' ? raw.requestIndex : {},
      meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : { migratedV2At: null, migratedV2Counts: null },
    };
  } catch {
    return emptyStore();
  }
}

function writeStoreAtomic(store) {
  ensureDataDir();
  const tmp = `${STORE_FILE}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, STORE_FILE);
}

function mutateFileStore(mutator) {
  const fd = acquireFileLock();
  try {
    const store = readStoreUnlocked();
    const result = mutator(store);
    writeStoreAtomic(store);
    return result;
  } finally {
    releaseFileLock(fd);
  }
}

function fileReserveClaim(params) {
  return mutateFileStore((store) => {
    const now = Date.now();

    if (params.requestId && store.requestIndex[params.requestId]) {
      const existingId = store.requestIndex[params.requestId];
      const existing = store.claims[existingId];
      // A replay must belong to the CALLER. See mongoReserveClaim for why.
      if (existing && String(existing.discordUserId) !== String(params.discordUserId)) {
        return { ok: false, reason: 'request_id_conflict' };
      }
      if (existing) return { ok: true, replay: true, claim: { ...existing } };
    }

    const uKey = userKey(params.discordUserId);
    const wKey = walletKey(params.wallet);

    const userLock = store.locks[uKey];
    if (userLock && Number(userLock.expiresAt) > now) {
      const blockingClaim = store.claims[userLock.claimId];
      return {
        ok: false,
        reason: 'cooldown',
        blockedBy: 'user',
        nextEligibleAt: Number(userLock.expiresAt),
        lastClaimSource: blockingClaim?.source || null,
      };
    }
    const walletLock = store.locks[wKey];
    if (walletLock && Number(walletLock.expiresAt) > now) {
      const blockingClaim = store.claims[walletLock.claimId];
      return {
        ok: false,
        reason: 'cooldown',
        blockedBy: 'wallet',
        nextEligibleAt: Number(walletLock.expiresAt),
        lastClaimSource: blockingClaim?.source || null,
      };
    }

    const id = crypto.randomUUID();
    const claim = {
      id,
      discordUserId: String(params.discordUserId),
      wallet: params.wallet,
      source: params.source,
      amountBaseUnits: String(params.amountBaseUnits),
      amountDisplay: params.amountDisplay,
      mint: params.mint,
      cooldownMs: params.cooldownMs,
      createdAt: now,
      reservedAt: now,
      status: CLAIM_STATUSES.RESERVED,
      signature: null,
      lastUpdateAt: now,
      failureCategory: null,
    };
    if (params.requestId) claim.requestId = params.requestId;

    store.claims[id] = claim;
    const expiresAt = now + params.cooldownMs;
    store.locks[uKey] = { claimId: id, expiresAt };
    store.locks[wKey] = { claimId: id, expiresAt };
    if (params.requestId) store.requestIndex[params.requestId] = id;

    return { ok: true, replay: false, claim: { ...claim } };
  });
}

function fileUpdateClaim(claimId, patch) {
  return mutateFileStore((store) => {
    const claim = store.claims[claimId];
    if (!claim) return null;
    Object.assign(claim, patch, { lastUpdateAt: Date.now() });
    return { ...claim };
  });
}

function fileTakeReservedClaimForProcessing(claimId) {
  return mutateFileStore((store) => {
    const claim = store.claims[claimId];
    if (!claim || claim.status !== CLAIM_STATUSES.RESERVED) return null;
    claim.status = CLAIM_STATUSES.PROCESSING;
    claim.lastUpdateAt = Date.now();
    return { ...claim };
  });
}

function fileGetClaimById(claimId) {
  const store = readStoreUnlocked();
  const claim = store.claims[claimId];
  return claim ? { ...claim } : null;
}

function fileListClaimsByStatus(status, limit = 50) {
  const store = readStoreUnlocked();
  return Object.values(store.claims)
    .filter((c) => c.status === status)
    .sort((a, b) => a.reservedAt - b.reservedAt)
    .slice(0, limit)
    .map((c) => ({ ...c }));
}

/** Every claim since `since`, oldest first — the input the co-timing review
 *  reads. Deliberately unfiltered by status: a claim that failed still says
 *  when someone tried. */
function fileListClaimsSince(since = 0, limit = 5000) {
  const store = readStoreUnlocked();
  return Object.values(store.claims)
    .filter((c) => c.id !== '__migration_marker_v2__' && Number(c.createdAt || 0) >= since)
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
    .slice(-limit)
    .map((c) => ({ ...c }));
}

function fileGetStatusForKey(key) {
  const store = readStoreUnlocked();
  const lock = store.locks[key];
  if (!lock) return { blocked: false, nextEligibleAt: null, lastClaim: null };
  const claim = store.claims[lock.claimId] || null;
  const now = Date.now();
  return {
    blocked: Number(lock.expiresAt) > now,
    nextEligibleAt: Number(lock.expiresAt),
    lastClaim: claim,
  };
}

function fileGetClaimHistoryForUser(discordUserId, limit = 500) {
  const store = readStoreUnlocked();
  const id = String(discordUserId);
  const claims = Object.values(store.claims)
    .filter((c) => String(c.discordUserId) === id)
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-limit)
    .map((c) => ({ ...c }));
  return summarizeClaimHistory(claims);
}

function fileGetGlobalFaucetStats() {
  const store = readStoreUnlocked();
  return summarizeGlobalFaucetStats(Object.values(store.claims));
}

function fileGetFaucetLeaderboard(limit, source) {
  const store = readStoreUnlocked();
  return summarizeFaucetLeaderboard(Object.values(store.claims), limit, source);
}

function fileReleaseAdministratively(claimId, reason) {
  return mutateFileStore((store) => {
    const claim = store.claims[claimId];
    if (!claim) return { ok: false, error: 'claim_not_found' };
    claim.status = CLAIM_STATUSES.ADMIN_RELEASED;
    claim.failureCategory = reason || 'administrative_release';
    claim.lastUpdateAt = Date.now();
    for (const [key, lock] of Object.entries(store.locks)) {
      if (lock.claimId === claimId) delete store.locks[key];
    }
    return { ok: true, claim: { ...claim } };
  });
}

function fileMigrateLegacyV2({ legacyClaims, cooldownMs, sourceLabel }) {
  return mutateFileStore((store) => {
    if (store.meta.migratedV2At) {
      return { ok: true, alreadyMigrated: true, migratedAt: store.meta.migratedV2At, counts: store.meta.migratedV2Counts };
    }

    const counts = { wallets: 0, users: 0 };
    const legacyWallets = legacyClaims?.wallets && typeof legacyClaims.wallets === 'object' ? legacyClaims.wallets : {};
    const legacyUsers = legacyClaims?.users && typeof legacyClaims.users === 'object' ? legacyClaims.users : {};

    const toMs = (t) => {
      const n = Number(t);
      if (!Number.isFinite(n) || n <= 0) return 0;
      // Legacy timestamps under ~13 digits are almost certainly seconds, not ms.
      return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
    };

    for (const [wallet, ts] of Object.entries(legacyWallets)) {
      const ms = toMs(ts);
      if (!ms) continue;
      const key = walletKey(wallet);
      const expiresAt = ms + cooldownMs;
      const existing = store.locks[key];
      if (existing && Number(existing.expiresAt) >= expiresAt) continue; // never move a lock earlier
      const id = crypto.randomUUID();
      store.claims[id] = {
        id, discordUserId: null, wallet, source: sourceLabel, amountBaseUnits: null,
        amountDisplay: null, mint: null, cooldownMs, createdAt: ms, reservedAt: ms,
        status: CLAIM_STATUSES.CONFIRMED, signature: null, lastUpdateAt: ms,
        failureCategory: null,
      };
      store.locks[key] = { claimId: id, expiresAt };
      counts.wallets += 1;
    }

    for (const [discordUserId, ts] of Object.entries(legacyUsers)) {
      const ms = toMs(ts);
      if (!ms) continue;
      const key = userKey(discordUserId);
      const expiresAt = ms + cooldownMs;
      const existing = store.locks[key];
      if (existing && Number(existing.expiresAt) >= expiresAt) continue;
      const id = crypto.randomUUID();
      store.claims[id] = {
        id, discordUserId, wallet: null, source: sourceLabel, amountBaseUnits: null,
        amountDisplay: null, mint: null, cooldownMs, createdAt: ms, reservedAt: ms,
        status: CLAIM_STATUSES.CONFIRMED, signature: null, lastUpdateAt: ms,
        failureCategory: null,
      };
      store.locks[key] = { claimId: id, expiresAt };
      counts.users += 1;
    }

    store.meta.migratedV2At = Date.now();
    store.meta.migratedV2Counts = counts;
    return { ok: true, alreadyMigrated: false, migratedAt: store.meta.migratedV2At, counts };
  });
}

// ─────────────────────────── Mongo-mode backend ────────────────────────────

let mongoIndexesEnsured = false;
async function getMongoCollections() {
  const db = await getMongoDb();
  if (!db) return null;
  const locks = db.collection('faucet_locks');
  const claims = db.collection('faucet_claims');
  if (!mongoIndexesEnsured) {
    await Promise.all([
      locks.createIndex({ key: 1 }, { unique: true }),
      claims.createIndex({ id: 1 }, { unique: true }),
      claims.createIndex({ requestId: 1 }, { unique: true, sparse: true }),
    ]).catch((err) => {
      // Index creation racing with another process is fine — just log once.
      console.warn('[faucet] index ensure warning:', err?.message || err);
    });
    mongoIndexesEnsured = true;
  }
  return { db, locks, claims };
}

async function mongoReserveClaim(params) {
  const cols = await getMongoCollections();
  const now = Date.now();

  if (params.requestId) {
    const existing = await cols.claims.findOne({ requestId: params.requestId });
    // A REPLAY MUST BELONG TO THE CALLER. Without this check, presenting
    // somebody else's requestId returns THEIR claim — id, status, amount and
    // transaction signature — to whoever asked. That is not theoretical: the
    // Discord adapter uses `message.id` as the requestId, and a Discord
    // message id is public to everyone who can see the channel, so anyone
    // could replay a stranger's `!drip` and read back the transaction, which
    // in turn names the recipient wallet on-chain.
    //
    // /api/faucet/claim/:id already refuses to serve a claim the session does
    // not own ("so a claim ID can never expose another user's record"); this
    // is the same rule on the path that route's sibling forgot.
    if (existing && String(existing.discordUserId) !== String(params.discordUserId)) {
      return { ok: false, reason: 'request_id_conflict' };
    }
    if (existing) return { ok: true, replay: true, claim: existing };
  }

  const id = crypto.randomUUID();
  const expiresAt = now + params.cooldownMs;
  const uKey = userKey(params.discordUserId);
  const wKey = walletKey(params.wallet);

  const claim = {
    id,
    discordUserId: String(params.discordUserId),
    wallet: params.wallet,
    source: params.source,
    amountBaseUnits: String(params.amountBaseUnits),
    amountDisplay: params.amountDisplay,
    mint: params.mint,
    cooldownMs: params.cooldownMs,
    createdAt: now,
    reservedAt: now,
    status: CLAIM_STATUSES.RESERVED,
    signature: null,
    lastUpdateAt: now,
    failureCategory: null,
  };
  if (params.requestId) claim.requestId = params.requestId;

  const client = cols.db.client ?? (await (await import('../lib/mongo.js')).getMongoClient());
  const session = client.startSession();
  let blocked = null;
  try {
    await session.withTransaction(async () => {
      try {
        await cols.locks.updateOne(
          { key: uKey, expiresAt: { $lte: now } },
          { $set: { key: uKey, claimId: id, expiresAt, updatedAt: now } },
          { upsert: true, session }
        );
      } catch (err) {
        if (isDuplicateKeyError(err)) { blocked = { key: 'user', keyValue: uKey }; throw new AbortReservation(); }
        throw err;
      }
      try {
        await cols.locks.updateOne(
          { key: wKey, expiresAt: { $lte: now } },
          { $set: { key: wKey, claimId: id, expiresAt, updatedAt: now } },
          { upsert: true, session }
        );
      } catch (err) {
        if (isDuplicateKeyError(err)) { blocked = { key: 'wallet', keyValue: wKey }; throw new AbortReservation(); }
        throw err;
      }
      await cols.claims.insertOne(claim, { session });
    });
  } catch (err) {
    if (!(err instanceof AbortReservation)) throw err;
  } finally {
    await session.endSession();
  }

  if (blocked) {
    const lock = await cols.locks.findOne({ key: blocked.keyValue });
    const blockingClaim = lock ? await cols.claims.findOne({ id: lock.claimId }) : null;
    return {
      ok: false,
      reason: 'cooldown',
      blockedBy: blocked.key,
      nextEligibleAt: lock ? Number(lock.expiresAt) : null,
      lastClaimSource: blockingClaim?.source || null,
    };
  }

  return { ok: true, replay: false, claim };
}

class AbortReservation extends Error {}
function isDuplicateKeyError(err) {
  return err && (err.code === 11000 || /E11000/.test(String(err.message || '')));
}

async function mongoUpdateClaim(claimId, patch) {
  const cols = await getMongoCollections();
  const res = await cols.claims.findOneAndUpdate(
    { id: claimId },
    { $set: { ...patch, lastUpdateAt: Date.now() } },
    { returnDocument: 'after' }
  );
  return res?.value || res || null;
}

async function mongoTakeReservedClaimForProcessing(claimId) {
  const cols = await getMongoCollections();
  const res = await cols.claims.findOneAndUpdate(
    { id: claimId, status: CLAIM_STATUSES.RESERVED },
    { $set: { status: CLAIM_STATUSES.PROCESSING, lastUpdateAt: Date.now() } },
    { returnDocument: 'after' }
  );
  return res?.value || res || null;
}

async function mongoGetClaimById(claimId) {
  const cols = await getMongoCollections();
  return cols.claims.findOne({ id: claimId });
}

async function mongoListClaimsByStatus(status, limit = 50) {
  const cols = await getMongoCollections();
  return cols.claims.find({ status }).sort({ reservedAt: 1 }).limit(limit).toArray();
}

async function mongoListClaimsSince(since = 0, limit = 5000) {
  const cols = await getMongoCollections();
  return cols.claims
    .find({ createdAt: { $gte: since }, id: { $ne: '__migration_marker_v2__' } })
    .sort({ createdAt: 1 })
    .limit(limit)
    .toArray();
}

async function mongoGetStatusForKey(key) {
  const cols = await getMongoCollections();
  const lock = await cols.locks.findOne({ key });
  if (!lock) return { blocked: false, nextEligibleAt: null, lastClaim: null };
  const claim = await cols.claims.findOne({ id: lock.claimId });
  const now = Date.now();
  return { blocked: Number(lock.expiresAt) > now, nextEligibleAt: Number(lock.expiresAt), lastClaim: claim || null };
}

async function mongoGetClaimHistoryForUser(discordUserId, limit = 500) {
  const cols = await getMongoCollections();
  // Sort newest-first to apply the limit to the most RECENT claims (matching
  // fileGetClaimHistoryForUser's `.slice(-limit)` semantics), then reverse
  // back to oldest-first for the returned shape. Sorting ascending and
  // limiting directly would keep the oldest claims instead once a user
  // exceeds `limit` — silently dropping their most recent activity.
  const claims = await cols.claims
    .find({ discordUserId: String(discordUserId) })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
  claims.reverse();
  return summarizeClaimHistory(claims);
}

async function mongoGetGlobalFaucetStats() {
  const cols = await getMongoCollections();
  // Filter to CONFIRMED at the query level (cheaper than pulling every
  // reserved/failed/pending row just to discard it) — summarizeGlobalFaucetStats
  // still re-checks status itself so file/mongo share one definition of
  // "confirmed" rather than trusting the query alone.
  const claims = await cols.claims.find({ status: CLAIM_STATUSES.CONFIRMED }).toArray();
  return summarizeGlobalFaucetStats(claims);
}

async function mongoGetFaucetLeaderboard(limit, source) {
  const cols = await getMongoCollections();
  const claims = await cols.claims.find({ status: CLAIM_STATUSES.CONFIRMED }).toArray();
  return summarizeFaucetLeaderboard(claims, limit, source);
}

async function mongoReleaseAdministratively(claimId, reason) {
  const cols = await getMongoCollections();
  const claim = await cols.claims.findOne({ id: claimId });
  if (!claim) return { ok: false, error: 'claim_not_found' };
  await cols.claims.updateOne(
    { id: claimId },
    { $set: { status: CLAIM_STATUSES.ADMIN_RELEASED, failureCategory: reason || 'administrative_release', lastUpdateAt: Date.now() } }
  );
  await cols.locks.deleteMany({ claimId });
  const updated = await cols.claims.findOne({ id: claimId });
  return { ok: true, claim: updated };
}

async function mongoMigrateLegacyV2({ legacyClaims, cooldownMs, sourceLabel }) {
  const cols = await getMongoCollections();
  const marker = await cols.claims.findOne({ id: '__migration_marker_v2__' });
  if (marker) return { ok: true, alreadyMigrated: true, migratedAt: marker.createdAt, counts: marker.counts };

  const counts = { wallets: 0, users: 0 };
  const toMs = (t) => {
    const n = Number(t);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
  };

  const legacyWallets = legacyClaims?.wallets && typeof legacyClaims.wallets === 'object' ? legacyClaims.wallets : {};
  const legacyUsers = legacyClaims?.users && typeof legacyClaims.users === 'object' ? legacyClaims.users : {};

  for (const [wallet, ts] of Object.entries(legacyWallets)) {
    const ms = toMs(ts);
    if (!ms) continue;
    const key = walletKey(wallet);
    const expiresAt = ms + cooldownMs;
    const id = crypto.randomUUID();
    await cols.claims.insertOne({
      id, discordUserId: null, wallet, source: sourceLabel, amountBaseUnits: null,
      amountDisplay: null, mint: null, cooldownMs, createdAt: ms, reservedAt: ms,
      status: CLAIM_STATUSES.CONFIRMED, signature: null, lastUpdateAt: ms,
      failureCategory: null,
    });
    await cols.locks.updateOne(
      { key, expiresAt: { $lt: expiresAt } },
      { $set: { key, claimId: id, expiresAt, updatedAt: Date.now() } },
      { upsert: true }
    ).catch(() => {}); // a newer lock already covering this key wins; ignore duplicate races here
    counts.wallets += 1;
  }

  for (const [discordUserId, ts] of Object.entries(legacyUsers)) {
    const ms = toMs(ts);
    if (!ms) continue;
    const key = userKey(discordUserId);
    const expiresAt = ms + cooldownMs;
    const id = crypto.randomUUID();
    await cols.claims.insertOne({
      id, discordUserId, wallet: null, source: sourceLabel, amountBaseUnits: null,
      amountDisplay: null, mint: null, cooldownMs, createdAt: ms, reservedAt: ms,
      status: CLAIM_STATUSES.CONFIRMED, signature: null, lastUpdateAt: ms,
      failureCategory: null,
    });
    await cols.locks.updateOne(
      { key, expiresAt: { $lt: expiresAt } },
      { $set: { key, claimId: id, expiresAt, updatedAt: Date.now() } },
      { upsert: true }
    ).catch(() => {});
    counts.users += 1;
  }

  const migratedAt = Date.now();
  await cols.claims.insertOne({ id: '__migration_marker_v2__', createdAt: migratedAt, counts, status: 'marker' });
  return { ok: true, alreadyMigrated: false, migratedAt, counts };
}

// ───────────────────────────── Public interface ─────────────────────────────

/**
 * Atomically reserve a faucet claim for (discordUserId, wallet). Returns
 * `{ok:true, claim, replay}` on success (replay=true means this exact
 * requestId was already accepted — the existing claim is returned, no new
 * reservation made), or `{ok:false, reason:'cooldown', blockedBy, nextEligibleAt,
 * lastClaimSource}` if either key already has a live reservation.
 */
export async function reserveClaim(params) {
  if (!params?.discordUserId) throw new Error('discordUserId_required');
  if (!params?.wallet) throw new Error('wallet_required');
  if (!params?.source) throw new Error('source_required');
  if (!params?.cooldownMs || params.cooldownMs <= 0) throw new Error('cooldownMs_required');

  return isMongoEnabled() ? mongoReserveClaim(params) : fileReserveClaim(params);
}

export async function markProcessing(claimId) {
  const patch = { status: CLAIM_STATUSES.PROCESSING };
  return isMongoEnabled() ? mongoUpdateClaim(claimId, patch) : fileUpdateClaim(claimId, patch);
}

/**
 * Atomically claims a RESERVED row for the web payout worker.
 *
 * Returns the updated claim when this caller won the transition, or null when
 * another worker already took it. This is the inter-process guard the plain
 * in-memory `running` flag in payout-worker.js cannot provide.
 */
export async function takeReservedClaimForProcessing(claimId) {
  return isMongoEnabled()
    ? mongoTakeReservedClaimForProcessing(claimId)
    : fileTakeReservedClaimForProcessing(claimId);
}

/**
 * Statuses that mean money has, or may have, left the treasury for a claim.
 * `reconciling` counts: it exists precisely because the outcome is unknown,
 * and "unknown" must be treated as paid when the question is whether to pay
 * AGAIN.
 */
const PAID_OR_MAYBE_PAID = [CLAIM_STATUSES.SUBMITTED, CLAIM_STATUSES.CONFIRMED, CLAIM_STATUSES.RECONCILING];

/** The window a claim's own cooldown implies, mirroring the lock semantics in
 *  reserveClaim: a prior claim blocks when it landed strictly INSIDE the
 *  window, so a claim exactly one cooldown old is fine. */
function duplicateWindowStart(claim) {
  const anchor = Number(claim?.reservedAt || claim?.createdAt || Date.now());
  const raw = Number(claim?.cooldownMs);
  // A corrupt cooldown must not open the gate. Fall back to the faucet's real
  // 24h cooldown rather than checking nothing at all.
  const cooldownMs = Number.isFinite(raw) && raw > 0 ? raw : 86_400_000;
  return anchor - cooldownMs;
}

/**
 * The LAST gate before the treasury moves — a second, independent check that
 * this claim is not about to pay a wallet or a user who was already paid
 * inside the same cooldown.
 *
 * WHY A SECOND GATE. reserveClaim's lock is the primary defence and it is
 * atomic, but it protects the RESERVATION, not the PAYOUT, and the two are
 * separated in time and process for web claims. Anything that puts a second
 * reserved row on the same wallet inside one cooldown — a lock deleted by a
 * mistaken administrative release, a claim reserved while Mongo was
 * unreachable and the per-checkout file store had no shared lock, an operator
 * clearing faucet_locks by hand — currently ends with the worker happily
 * paying it. On 2026-08-16 one wallet was paid 1,500 WinLEW 21.99h into a 24h
 * cooldown and nothing in the payout path objected.
 *
 * This closes that class outright: it re-derives the answer from the CLAIM
 * ROWS, which are the durable record, instead of trusting a lock that may have
 * been removed since. Returns the offending claim, or null when the payout is
 * safe to make.
 */
export async function findDuplicatePaidClaim(claim) {
  if (!claim?.id) return null;
  const since = duplicateWindowStart(claim);
  const wallet = claim.wallet ? String(claim.wallet) : null;
  const user = claim.discordUserId ? String(claim.discordUserId) : null;
  if (!wallet && !user) return null;

  const identity = [];
  if (wallet) identity.push({ wallet });
  if (user) identity.push({ discordUserId: user });

  if (isMongoEnabled()) {
    const cols = await getMongoCollections();
    const rows = await cols.claims
      .find({
        id: { $ne: claim.id },
        status: { $in: PAID_OR_MAYBE_PAID },
        createdAt: { $gt: since },
        $or: identity,
      })
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray();
    return rows[0] || null;
  }

  const store = readStoreUnlocked();
  let newest = null;
  for (const row of Object.values(store.claims)) {
    if (!row || row.id === claim.id) continue;
    if (!PAID_OR_MAYBE_PAID.includes(row.status)) continue;
    if (Number(row.createdAt || 0) <= since) continue;
    const sameWallet = wallet && String(row.wallet) === wallet;
    const sameUser = user && String(row.discordUserId) === user;
    if (!sameWallet && !sameUser) continue;
    if (!newest || Number(row.createdAt || 0) > Number(newest.createdAt || 0)) newest = row;
  }
  return newest ? { ...newest } : null;
}

export async function markSubmitted(claimId, signature) {
  const patch = { status: CLAIM_STATUSES.SUBMITTED, signature };
  return isMongoEnabled() ? mongoUpdateClaim(claimId, patch) : fileUpdateClaim(claimId, patch);
}

export async function markConfirmed(claimId) {
  const patch = { status: CLAIM_STATUSES.CONFIRMED };
  return isMongoEnabled() ? mongoUpdateClaim(claimId, patch) : fileUpdateClaim(claimId, patch);
}

export async function markFailed(claimId, failureCategory) {
  const patch = { status: CLAIM_STATUSES.KNOWN_FAILED, failureCategory: failureCategory || 'unknown' };
  return isMongoEnabled() ? mongoUpdateClaim(claimId, patch) : fileUpdateClaim(claimId, patch);
}

/**
 * `signature` is optional and only set when the transfer actually reached the
 * network — a claim can also land here with none (an error whose shape says
 * "maybe sent" but that carried no signature). Never overwrite a stored
 * signature with an empty one.
 */
export async function markReconciling(claimId, signature) {
  const patch = { status: CLAIM_STATUSES.RECONCILING };
  if (signature) patch.signature = signature;
  return isMongoEnabled() ? mongoUpdateClaim(claimId, patch) : fileUpdateClaim(claimId, patch);
}

export async function getClaimById(claimId) {
  return isMongoEnabled() ? mongoGetClaimById(claimId) : fileGetClaimById(claimId);
}

/** Used by the payout worker to find claims awaiting execution/retry. */
export async function listClaimsByStatus(status, limit = 50) {
  return isMongoEnabled() ? mongoListClaimsByStatus(status, limit) : fileListClaimsByStatus(status, limit);
}

/**
 * Lifetime confirmed claims for a wallet and for a Discord account, counted
 * separately — the verification gate takes whichever is higher.
 *
 * Both are needed. Legacy migrated claims carry `discordUserId: null`, so a
 * per-account count alone silently forgets them; and a per-wallet count alone
 * is reset for free by generating a new keypair. Counting both means the
 * cheaper evasion has to beat the stricter number.
 */
export async function countClaimsForGate({ wallet, discordUserId } = {}) {
  const walletKeyStr = wallet ? String(wallet) : null;
  const userKeyStr = discordUserId ? String(discordUserId) : null;

  if (isMongoEnabled()) {
    const cols = await getMongoCollections();
    const base = { status: CLAIM_STATUSES.CONFIRMED };
    const [byWallet, byUser] = await Promise.all([
      walletKeyStr ? cols.claims.countDocuments({ ...base, wallet: walletKeyStr }) : 0,
      userKeyStr ? cols.claims.countDocuments({ ...base, discordUserId: userKeyStr }) : 0,
    ]);
    return { byWallet, byUser, highest: Math.max(byWallet, byUser) };
  }

  const store = readStoreUnlocked();
  let byWallet = 0;
  let byUser = 0;
  for (const claim of Object.values(store.claims)) {
    if (claim.status !== CLAIM_STATUSES.CONFIRMED) continue;
    if (walletKeyStr && claim.wallet === walletKeyStr) byWallet += 1;
    if (userKeyStr && String(claim.discordUserId) === userKeyStr) byUser += 1;
  }
  return { byWallet, byUser, highest: Math.max(byWallet, byUser) };
}

export async function listClaimsSince(since = 0, limit = 5000) {
  return isMongoEnabled() ? mongoListClaimsSince(since, limit) : fileListClaimsSince(since, limit);
}

export async function getStatusForUser(discordUserId) {
  const key = userKey(discordUserId);
  return isMongoEnabled() ? mongoGetStatusForKey(key) : fileGetStatusForKey(key);
}

export async function getStatusForWallet(wallet) {
  const key = walletKey(wallet);
  return isMongoEnabled() ? mongoGetStatusForKey(key) : fileGetStatusForKey(key);
}

/**
 * Full claim history for one user, oldest-first (capped at `limit`), plus a
 * summary (count, confirmedCount, first/last claim timestamps). Used by the
 * Proof of Value engine to score faucet participation — no such aggregate
 * existed before (the store only indexed by claim id and status).
 */
export async function getClaimHistoryForUser(discordUserId, limit = 500) {
  return isMongoEnabled()
    ? mongoGetClaimHistoryForUser(discordUserId, limit)
    : fileGetClaimHistoryForUser(discordUserId, limit);
}

/**
 * Global, all-users faucet distribution totals — confirmed claims only, split
 * by source (web/discord) for the /faucet/ page's "Web vs Discord" comparison
 * and its running "how much has been given away" total. Added 2026-07-18.
 */
export async function getGlobalFaucetStats() {
  return isMongoEnabled() ? mongoGetGlobalFaucetStats() : fileGetGlobalFaucetStats();
}

/**
 * Per-user faucet leaderboard — total confirmed WinLEW claimed, ranked
 * descending. `source` optionally restricts to 'web' or 'discord' claims
 * (mirrors Quiz's platform leaderboard split); omit it for a combined
 * "top claimers overall" view. Added 2026-07-19 for the /leaderboards/ page.
 */
export async function getFaucetLeaderboard(limit = 50, source = null) {
  return isMongoEnabled() ? mongoGetFaucetLeaderboard(limit, source) : fileGetFaucetLeaderboard(limit, source);
}

/** Admin recovery: force-clears both locks for a claim and marks it released. */
/**
 * Cancels a claim and gives its cooldown back by deleting both locks.
 *
 * FAIL CLOSED ON A SIGNATURE. Releasing the cooldown of a claim that already
 * carries a transaction signature would hand a free second drip to whoever
 * triggered the failure: the signature is proof the network saw the transfer,
 * so "it failed" cannot be taken at face value. The automatic callers
 * (payout-worker.js and service.js's inline Discord payout) therefore cannot
 * release such a claim at all.
 *
 * `force` exists for exactly one caller: `npm run faucet:reconcile`, which
 * releases only AFTER checking the chain and finding no transfer — a human
 * reading a plan, not an error handler guessing.
 */
export async function releaseReservationAdministratively(claimId, reason, { force = false } = {}) {
  if (!force) {
    const existing = await getClaimById(claimId);
    if (existing?.signature && existing.signature !== 'DRY_RUN_NO_SIGNATURE') {
      return { ok: false, error: 'refused_signature_present', claim: existing };
    }
  }
  return isMongoEnabled() ? mongoReleaseAdministratively(claimId, reason) : fileReleaseAdministratively(claimId, reason);
}

/**
 * Idempotent one-time import of the legacy version-2 `faucet_claims.json`
 * shape ({version:2, wallets:{addr:ms}, users:{id:ms}}) into this store, so
 * historical cooldowns keep being enforced. Safe to call on every boot —
 * a no-op after the first successful run.
 */
export async function migrateLegacyV2IfNeeded({ legacyClaims, cooldownMs, sourceLabel = 'discord-legacy' }) {
  return isMongoEnabled()
    ? mongoMigrateLegacyV2({ legacyClaims, cooldownMs, sourceLabel })
    : fileMigrateLegacyV2({ legacyClaims, cooldownMs, sourceLabel });
}

// File-mode store path — exposed so tests/ops scripts know exactly what to
// back up or clean up without duplicating path-construction logic.
export const FILE_STORE_PATH = STORE_FILE;
export const FILE_LOCK_PATH = LOCK_FILE;
