import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getMongoDb, isMongoEnabled } from '../lib/mongo.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DOC_ID = 'global';

// Production keeps the faucet bot's files beside this module. FAUCET_DATA_DIR
// (the same override mole/web.js and mole/walletLink.js honour) lets an
// isolated process keep them in a disposable directory. Read per call.
function faucetDataDir() {
  const override = String(process.env.FAUCET_DATA_DIR || '').trim();
  return override ? path.resolve(override) : __dirname;
}

const MANAGED_FILES = {
  'faucet_claims.json': {
    collection: () => String(process.env.FAUCET_CLAIMS_COLLECTION || 'faucet_claims').trim(),
    fallback: () => ({}),
  },
  'wallet_links.json': {
    collection: () => String(process.env.FAUCET_WALLET_LINKS_COLLECTION || 'faucet_wallet_links').trim(),
    fallback: () => ({ version: 1, links: {} }),
    records: (value) => value?.links,
  },
  'registrations.json': {
    collection: () => String(process.env.FAUCET_REGISTRATIONS_COLLECTION || 'faucet_registrations').trim(),
    fallback: () => ({}),
  },
  // NOTE: wallet_linkage.json is deliberately NOT managed here. It is a cache
  // of on-chain funding edges, and registering it meant a Mongo round trip on
  // every wallet scanned: measured 2026-08-01, one cluster walk went from 7.8s
  // to over 200s (it never finished) purely from those writes, on a code path a
  // faucet claim waits behind. Deleting the local file only costs RPC calls to
  // rebuild it, so there is nothing to replicate. See src/faucet/walletLinkage.js.
  //
  // Faucet bans — { version, bans: { [addr]: { reason, bannedBy, reviewOnly,
  // bannedAt } } }. This one IS a source of truth and must be backed up:
  // losing it silently un-bans everyone. See src/faucet/walletBans.js.
  'wallet_bans.json': {
    collection: () => String(process.env.FAUCET_WALLET_BANS_COLLECTION || 'faucet_wallet_bans').trim(),
    fallback: () => ({ version: 1, bans: {} }),
    records: (value) => value?.bans,
  },
  // Discord account bans — { version, bans: { [userId]: { reason, bannedBy,
  // reviewOnly, bannedAt } } }. Same source-of-truth status as wallet_bans.json,
  // and the same `records` accessor so an empty list cannot overwrite a
  // populated one on boot. See src/faucet/userBans.js.
  'user_bans.json': {
    collection: () => String(process.env.FAUCET_USER_BANS_COLLECTION || 'faucet_user_bans').trim(),
    fallback: () => ({ version: 1, bans: {} }),
    records: (value) => value?.bans,
  },
  'ip_bans.json': {
    collection: () => String(process.env.FAUCET_IP_BANS_COLLECTION || 'faucet_ip_bans').trim(),
    fallback: () => ({ version: 1, bans: {}, strikes: {} }),
    // Counts strikes as well as bans. Strikes outlive their ban by design (a
    // 6-month ban expires, the offence history must not), so a file holding
    // only strikes is NOT empty — and treating it as empty would let a remote
    // copy overwrite the offence history, resetting repeat offenders to zero.
    records: (value) => ({ ...(value?.bans || {}), ...(value?.strikes || {}) }),
  },
  'airdrops.json': {
    collection: () => String(process.env.FAUCET_AIRDROPS_COLLECTION || 'faucet_airdrops').trim(),
    fallback: () => ({}),
  },
  'lastTweet.json': {
    collection: () => String(process.env.FAUCET_LAST_TWEET_COLLECTION || 'faucet_last_tweet').trim(),
    fallback: () => ({}),
  },
  'twitterUserId.json': {
    collection: () => String(process.env.FAUCET_TWITTER_USER_COLLECTION || 'faucet_twitter_user').trim(),
    fallback: () => ({}),
  },
  'subscriptions.json': {
    collection: () => String(process.env.FAUCET_SUBSCRIPTIONS_COLLECTION || 'faucet_subscriptions').trim(),
    fallback: () => ({}),
  },
};

const caches = new Map();
const persistChains = new Map();
let bootPromise = null;

function clone(value) {
  if (value === undefined) return undefined;
  return structuredClone(value);
}

export function ensureFaucetDataDir() {
  fs.mkdirSync(faucetDataDir(), { recursive: true });
}

function filePath(name) {
  return path.resolve(faucetDataDir(), name);
}

function readJsonFile(name, fallback) {
  try {
    const target = filePath(name);
    if (!fs.existsSync(target)) return clone(fallback);
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (error) {
    console.warn(`[faucet-storage] read failed for ${name}:`, error?.message || error);
    return clone(fallback);
  }
}

function writeJsonFile(name, value) {
  ensureFaucetDataDir();
  const target = filePath(name);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, target);
}

function isMeaningful(value) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

/**
 * Does this payload hold any actual RECORDS?
 *
 * isMeaningful() alone counts keys on the top-level object, which is wrong for
 * the wrapper-shaped files: `{ version: 1, bans: {} }` has a key, so an empty
 * ban list looked "meaningful" and bootstrapFile() pushed it over a populated
 * remote. Found 2026-08-15 with the live ban list already emptied — a boot on a
 * machine whose local wallet_bans.json had never been written wiped every ban
 * in Mongo, which is exactly the "losing it silently un-bans everyone" this
 * file's own comment warns about.
 *
 * `records` says where the real content lives; files that are bare maps or
 * arrays need no accessor and fall through to isMeaningful().
 */
function hasRecords(name, value) {
  if (value == null) return false;
  const spec = MANAGED_FILES[name];
  const container = spec?.records ? spec.records(value) : value;
  return isMeaningful(container);
}

async function getCollection(name) {
  const spec = MANAGED_FILES[name];
  if (!spec || !isMongoEnabled()) return null;
  const db = await getMongoDb();
  if (!db) return null;
  return db.collection(spec.collection());
}

async function bootstrapFile(name) {
  const spec = MANAGED_FILES[name];
  if (!spec) return;

  const fallback = spec.fallback();
  const localValue = readJsonFile(name, fallback);
  let active = localValue;

  const collection = await getCollection(name);
  if (collection) {
    const existing = await collection.findOne({ _id: DOC_ID }).catch(() => null);
    const remoteValue = existing?.payload;

    const localHas = hasRecords(name, localValue);
    const remoteHas = hasRecords(name, remoteValue);

    if (!localHas && remoteHas) {
      active = remoteValue;
      writeJsonFile(name, active);
    } else if (localHas && !remoteHas) {
      await collection.updateOne(
        { _id: DOC_ID },
        {
          $set: {
            fileName: name,
            payload: localValue,
            source: 'json-migration',
            migratedAt: new Date(),
            updatedAt: new Date(),
          },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true },
      ).catch((error) => {
        console.warn(`[faucet-storage] bootstrap write failed for ${name}:`, error?.message || error);
      });
    } else if (localHas && remoteHas) {
      await collection.updateOne(
        { _id: DOC_ID },
        {
          $set: {
            fileName: name,
            payload: localValue,
            updatedAt: new Date(),
          },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true },
      ).catch(() => {});
    }
  }

  caches.set(name, clone(active));
  writeJsonFile(name, active);
}

export async function initFaucetStorage() {
  ensureFaucetDataDir();
  if (!bootPromise) {
    bootPromise = (async () => {
      for (const name of Object.keys(MANAGED_FILES)) {
        await bootstrapFile(name);
      }
    })().catch((error) => {
      bootPromise = null;
      throw error;
    });
  }
  return bootPromise;
}

function queuePersist(name) {
  if (!MANAGED_FILES[name] || !isMongoEnabled()) return;
  const next = (persistChains.get(name) || Promise.resolve())
    .then(async () => {
      const collection = await getCollection(name);
      if (!collection) return;
      const payload = clone(caches.get(name) ?? MANAGED_FILES[name].fallback());
      await collection.updateOne(
        { _id: DOC_ID },
        {
          $set: {
            fileName: name,
            payload,
            updatedAt: new Date(),
          },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true },
      );
    })
    .catch((error) => {
      console.warn(`[faucet-storage] persist failed for ${name}:`, error?.message || error);
    });
  persistChains.set(name, next);
}

/**
 * Re-reads one managed file from its source of truth, at most once per
 * `maxAgeMs`, replacing the in-process cache.
 *
 * Managed files are cached at boot and only change in the process that writes
 * them. That is fine for a single-writer file and wrong the moment two services
 * share one — the reader serves its boot-time snapshot forever.
 *
 * This class of bug has now been found three times in this codebase: the game
 * payout worker resolving every wallet to null (2026-07-18), the faucet's
 * verification gate refusing verified users (2026-08-02), and wallet_bans.json,
 * where a ban set from Discord would not reach web claims until the web process
 * restarted. The throttle is what makes it usable on a hot path — without it,
 * refreshing per claim is a Mongo round trip per claim.
 */
const refreshedAt = new Map();

export async function refreshManagedJson(name, { maxAgeMs = 30_000 } = {}) {
  const spec = MANAGED_FILES[name];
  if (!spec) return false;

  const last = refreshedAt.get(name) || 0;
  if (Date.now() - last < maxAgeMs) return false;
  refreshedAt.set(name, Date.now());

  const collection = await getCollection(name);
  if (collection) {
    const existing = await collection.findOne({ _id: DOC_ID }).catch(() => null);
    if (!existing?.payload || typeof existing.payload !== 'object') return false;
    caches.set(name, clone(existing.payload));
    writeJsonFile(name, existing.payload);
    return true;
  }

  // No Mongo: the local file is the shared surface, and a sibling process
  // running from the same directory may have written it since boot.
  caches.set(name, clone(readJsonFile(name, spec.fallback())));
  return true;
}

export function loadManagedJson(name, fallback = {}) {
  const spec = MANAGED_FILES[name];
  if (!spec) return readJsonFile(name, fallback);
  if (!caches.has(name)) {
    caches.set(name, clone(readJsonFile(name, spec.fallback())));
  }
  return clone(caches.get(name));
}

export function writeManagedJson(name, value) {
  const spec = MANAGED_FILES[name];
  if (!spec) {
    writeJsonFile(name, value);
    return;
  }
  const next = clone(value ?? spec.fallback());
  caches.set(name, next);
  writeJsonFile(name, next);
  queuePersist(name);
}

/**
 * Await every queued Mongo persist. Call this before process.exit().
 *
 * writeManagedJson() writes local disk synchronously but pushes to Mongo on a
 * background chain. A long-lived worker never notices the difference. A CLI
 * that exits straight after a write kills that chain mid-flight — and because
 * refreshManagedFile() treats Mongo as authoritative, the NEXT run pulls the
 * stale pre-write state back over the correct local file.
 *
 * Found 2026-08-16 on the first live `hodl:pay`. The transfer landed and the
 * local file recorded it confirmed; the following run re-read "submitted,
 * pending" from Mongo and had to re-derive the outcome from the chain. It was
 * recoverable only because reconcile asks the chain before sending. A file with
 * no such backstop would simply have lost the write.
 */
export async function flushManagedWrites() {
  await Promise.allSettled([...persistChains.values()]);
}
