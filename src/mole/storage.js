import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getConfig } from "./config.js";
import { getMongoDb, isMongoEnabled } from "../lib/mongo.js";

const DOC_ID = 'global';
const MANAGED_JSON = {
  'linked_wallets.json': {
    collection: () => String(process.env.MOLE_LINKED_WALLETS_COLLECTION || 'mole_linked_wallets').trim(),
    fallback: () => ({}),
  },
  // Synced social identities -> the account they belong to. A bare map, like
  // every managed file here:
  //
  //   { "discord:1220049423548026952": "wallet:94943b30…", "x:1699…": "wallet:94943b30…" }
  //
  // The SHAPE is the uniqueness rule. One provider identity is one key, and a
  // key holds one account, so a Discord or X account cannot belong to two
  // WinLEW accounts by construction rather than by a check somebody might
  // forget to run. See src/mole/syncedIdentities.js.
  'synced_identities.json': {
    collection: () => String(process.env.MOLE_SYNCED_IDENTITIES_COLLECTION || 'mole_synced_identities').trim(),
    fallback: () => ({}),
  },
  // HODL Rewards (v4). Both are bare maps on purpose — every managed file here
  // uses that shape, and isMeaningful() counts top-level keys, so a wrapper like
  // { version, epochs: {} } would look like content while holding none. That is
  // exactly the bug that emptied the faucet ban list on 2026-08-15.
  //
  // hodl_epochs.json    { [epochId]: epoch }
  // hodl_snapshots.json { "<epochId>:<week>": snapshot }  — one per Tuesday,
  //                     append-only, never rewritten once paid.
  'hodl_epochs.json': {
    collection: () => String(process.env.MOLE_HODL_EPOCHS_COLLECTION || 'mole_hodl_epochs').trim(),
    fallback: () => ({}),
  },
  'hodl_snapshots.json': {
    collection: () => String(process.env.MOLE_HODL_SNAPSHOTS_COLLECTION || 'mole_hodl_snapshots').trim(),
    fallback: () => ({}),
  },
  // hodl_checkins.json { "<discordUserId>:<YYYY-MM-DD>": checkin } — one per
  // identity per UTC day, server time only (src/mole/hodlCheckins.js).
  'hodl_checkins.json': {
    collection: () => String(process.env.MOLE_HODL_CHECKINS_COLLECTION || 'mole_hodl_checkins').trim(),
    fallback: () => ({}),
  },
  'oauth_tokens.json': {
    collection: () => String(process.env.MOLE_OAUTH_TOKENS_COLLECTION || 'mole_oauth_tokens').trim(),
    fallback: () => ({}),
  },
  'sessions.json': {
    collection: () => String(process.env.MOLE_SESSIONS_COLLECTION || 'mole_sessions').trim(),
    fallback: () => ({}),
  },
  // Mobile-wrapper session hand-off — { [handoffId]: { claim_hash, session,
  // ... } }, five-minute TTL, deleted on claim. Managed (not a loose file) for
  // the same reason sessions.json is: it holds live session tokens, and a
  // multi-instance deploy that kept them per-process would break the claim on
  // whichever instance didn't take the deposit. See src/mole/nativeHandoff.js.
  'native_handoffs.json': {
    collection: () => String(process.env.MOLE_NATIVE_HANDOFFS_COLLECTION || 'mole_native_handoffs').trim(),
    fallback: () => ({}),
  },
  // Desktop-to-phone hand-off for /verify/ — { [handoffId]: { code_hash,
  // discord_user_id, grant_ttl_sec, ... } }, five-minute TTL, tombstoned on
  // claim. Managed for the same multi-instance reason as native_handoffs.json:
  // the desktop starts the hand-off and the phone claims it, and those two
  // requests need not land on the same process. Note this store holds NO
  // session token — only the Discord identity a fresh one will be minted for.
  // See src/mole/webHandoff.js.
  'web_handoffs.json': {
    collection: () => String(process.env.MOLE_WEB_HANDOFFS_COLLECTION || 'mole_web_handoffs').trim(),
    fallback: () => ({}),
  },
  // Merch orders — { [paypalOrderId]: { productId, totalCents, status, ... } }.
  // The server-priced expectation is written here BEFORE the money moves, and
  // capture checks against it; that record is the whole mechanism, so it is
  // managed (Mongo-mirrored) rather than a loose file that a redeploy could
  // lose. Holds no card data — PayPal never sends any. See
  // src/mole/merchOrders.js.
  'merch_orders.json': {
    collection: () => String(process.env.MOLE_MERCH_ORDERS_COLLECTION || 'mole_merch_orders').trim(),
    fallback: () => ({}),
  },
  // ACCOUNT MERGES — { "<absorbedAccountId>": "<canonicalAccountId>" }.
  //
  // The USER layer. An account is a door (a Discord login, an X login, a
  // wallet); a USER is the person who holds several of them. This map is what
  // says "these two accounts are one person", and every identity question
  // resolves through it first. See src/mole/userAccounts.js.
  //
  // Managed for the same reason linked_wallets.json is: it decides who gets
  // paid, and a redeploy that lost it would silently re-split people into two
  // accounts each — which is exactly the bug it exists to fix.
  'account_merges.json': {
    collection: () => String(process.env.MOLE_ACCOUNT_MERGES_COLLECTION || 'mole_account_merges').trim(),
    fallback: () => ({}),
  },
  // Append-only administrative/accounting evidence for completed and blocked
  // identity merges. Kept private; no public route exposes this mapping.
  'account_merge_audit.json': {
    collection: () => String(process.env.MOLE_ACCOUNT_MERGE_AUDIT_COLLECTION || 'mole_account_merge_audit').trim(),
    fallback: () => ({}),
  },
  'wallet_challenges.json': {
    collection: () => String(process.env.MOLE_WALLET_CHALLENGES_COLLECTION || 'mole_wallet_challenges').trim(),
    fallback: () => ({}),
  },
  // Governance v1 votes — { [proposalId]: { [walletAddress]: { choice,
  // discordUserId, castAtIso, updatedAtIso } } }. Keyed by wallet address so
  // a second vote from the same wallet naturally overwrites the first
  // (one-wallet-one-vote, "latest choice replaces prior" — see
  // src/mole/governanceStore.js and docs/governance-v1.md).
  'governance_votes.json': {
    collection: () => String(process.env.MOLE_GOVERNANCE_VOTES_COLLECTION || 'mole_governance_votes').trim(),
    fallback: () => ({}),
  },
  // Governance v1.1 eligibility snapshots — { [proposalId]: { [walletAddress]:
  // { eligible, balance, balanceCheckOk, snapshotAtIso, recordedAtIso,
  // source } } }. Immutable once recorded: the first successful eligibility
  // check for a wallet on a proposal at/after its snapshotAt boundary is
  // locked in and reused for every later check on that same proposal+wallet
  // — see src/mole/governanceSnapshot.js and docs/governance-v1.1-hardening.md.
  'governance_eligibility_snapshots.json': {
    collection: () => String(process.env.MOLE_GOVERNANCE_SNAPSHOTS_COLLECTION || 'mole_governance_snapshots').trim(),
    fallback: () => ({}),
  },
  // Governance v1.1 community proposal submissions — a review QUEUE, never
  // auto-published into the canonical PROPOSALS set. See
  // src/mole/governanceSubmissions.js and docs/governance-v1.1-hardening.md.
  'governance_submissions.json': {
    collection: () => String(process.env.MOLE_GOVERNANCE_SUBMISSIONS_COLLECTION || 'mole_governance_submissions').trim(),
    fallback: () => ({}),
  },
  // Governance vote-weight pricing (2026-07-28) — rolling 3-day price/
  // market-cap samples, array of { tsIso, priceUsd, marketCapUsd }, pruned
  // to the window on every write. See src/mole/governancePricing.js.
  'governance_price_samples.json': {
    collection: () => String(process.env.MOLE_GOVERNANCE_PRICE_SAMPLES_COLLECTION || 'mole_governance_price_samples').trim(),
    fallback: () => ([]),
  },
  // Governance purchased-vote-weight ledger — { [discordUserId]: {
  // totalAllocatedWinlew, allocations: { [proposalId]: allocatedWinlew } } }.
  // See src/mole/governanceVoteCredits.js for why this exists (prevents one
  // contribution from being double-counted as vote weight on two proposals).
  'governance_vote_credits.json': {
    collection: () => String(process.env.MOLE_GOVERNANCE_VOTE_CREDITS_COLLECTION || 'mole_governance_vote_credits').trim(),
    fallback: () => ({}),
  },
};

const caches = new Map();
const persistChains = new Map();
let bootPromise = null;

// Stores that decide WHO OWNS an identity or a balance. A silent Mongo-write
// failure here is the same "points differ depending on how you access the
// platform" bug the reward ledger already fails loudly for (see
// rewardHistory.js's authoritativeDb()) — just one layer down, in the maps
// that resolve identities before a single reward row is ever read.
//
// Deliberately NOT every managed file: sessions/oauth tokens/handoffs/hodl/
// merch/governance stores don't decide ownership, and making every write here
// throw on a Mongo hiccup would turn a transient network blip into an outage
// across unrelated features — a worse regression than the bug this fixes.
const CRITICAL_STORES = new Set([
  'account_merges.json',
  'account_merge_audit.json',
  'linked_wallets.json',
  'synced_identities.json',
]);

// name -> { since, lastError, lastAttemptAt }. Present only while that
// store's last known Mongo persist has not yet been confirmed. Cleared the
// moment a persist for that name succeeds.
const degradedStores = new Map();

/** Read-only snapshot of which critical stores have an unconfirmed Mongo
 *  write right now, for health checks and the reconciliation report. */
export function getStorageSyncHealth() {
  return Array.from(degradedStores, ([name, info]) => ({ name, ...info }));
}

function clone(value) {
  if (value === undefined) return undefined;
  return structuredClone(value);
}

export function ensureDataDir() {
  const { DATA_DIR } = getConfig();
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function filePath(name) {
  const { DATA_DIR } = getConfig();
  return path.join(DATA_DIR, name);
}

function readJsonFile(file, fallback) {
  try {
    if (!fs.existsSync(file)) return clone(fallback);
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    console.warn('readJson failed:', path.basename(file), e);
    return clone(fallback);
  }
}

function writeJsonFile(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

function getManagedSpec(name) {
  return MANAGED_JSON[name] || null;
}

function readLocalManaged(name) {
  const spec = getManagedSpec(name);
  return readJsonFile(filePath(name), spec ? spec.fallback() : {});
}

function writeLocalManaged(name, value) {
  writeJsonFile(filePath(name), value);
}

async function getManagedCollection(name) {
  const spec = getManagedSpec(name);
  if (!spec || !isMongoEnabled()) return null;
  const db = await getMongoDb();
  if (!db) return null;
  return db.collection(spec.collection());
}

function isMeaningful(value) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

async function bootstrapManagedFile(name) {
  const spec = getManagedSpec(name);
  if (!spec) return;
  const fallback = spec.fallback();
  const localValue = readJsonFile(filePath(name), fallback);
  caches.set(name, clone(localValue));

  const collection = await getManagedCollection(name);
  if (!collection) {
    writeLocalManaged(name, localValue);
    return;
  }

  const existing = await collection.findOne({ _id: DOC_ID }).catch(() => null);
  let payload = localValue;

  if (existing?.payload && typeof existing.payload === 'object') {
    payload = existing.payload;
  } else if (isMeaningful(localValue)) {
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
      console.warn(`[mongo-storage] bootstrap write failed for ${name}:`, error?.message || error);
    });
  }

  caches.set(name, clone(payload));
  writeLocalManaged(name, payload);
}

export async function initMoleStorage() {
  ensureDataDir();
  if (!bootPromise) {
    bootPromise = (async () => {
      for (const name of Object.keys(MANAGED_JSON)) {
        await bootstrapManagedFile(name);
      }
    })().catch((error) => {
      bootPromise = null;
      throw error;
    });
  }
  return bootPromise;
}

function queuePersist(name) {
  if (!getManagedSpec(name) || !isMongoEnabled()) return;
  const next = (persistChains.get(name) || Promise.resolve())
    .then(async () => {
      const collection = await getManagedCollection(name);
      if (!collection) return;
      const payload = clone(caches.get(name) ?? getManagedSpec(name).fallback());
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
      // Confirmed in Mongo: any earlier failure for this store no longer
      // reflects reality.
      degradedStores.delete(name);
    })
    .catch((error) => {
      console.warn(`[mongo-storage] persist failed for ${name}:`, error?.message || error);
      if (CRITICAL_STORES.has(name)) {
        // Loud and grep/alert-able on purpose: this store decides who owns an
        // identity, and the local write it just made is now ahead of Mongo
        // with nothing to say so out loud.
        console.error(
          `[mongo-storage][CRITICAL-PERSIST-FAILED] ${name}: local write is unconfirmed in Mongo`,
          error?.message || error,
        );
        degradedStores.set(name, {
          since: degradedStores.get(name)?.since ?? Date.now(),
          lastError: String(error?.message || error),
          lastAttemptAt: Date.now(),
        });
      }
    });
  persistChains.set(name, next);
}

/**
 * Re-reads one managed file from its source of truth, replacing the in-process
 * cache.
 *
 * Managed files are cached at boot (bootstrapManagedFile) and thereafter only
 * change in the process that writes them. That is fine while a file has a
 * single writer, but it silently breaks the moment one service needs to SEE
 * what another service wrote: the reader keeps serving its boot-time snapshot
 * forever.
 *
 * Found 2026-08-02 the hard way. The faucet's verification gate reads
 * linked_wallets.json, which the Mole Guard process writes on `/mole link` — so
 * a user could verify, have it recorded correctly in Mongo, and still be
 * refused by a faucet holding a stale copy until the bot happened to restart.
 *
 * Deliberately explicit rather than a TTL on every read: this is a cross-
 * process freshness problem at a couple of known points, and quietly making
 * every managed read re-fetch would put network latency on hot paths that do
 * not need it.
 */
export async function refreshManagedFile(name) {
  const spec = getManagedSpec(name);
  if (!spec) return false;

  // A critical store with an unconfirmed local write must not be clobbered by
  // a Mongo read that is, by definition, older than what's on disk right now
  // — that is exactly the silent-regression half of the 2026-08-02 bug this
  // function otherwise fixes: the READ side already treats Mongo as
  // authoritative, so a failed WRITE must be able to say "not yet, don't ask".
  if (CRITICAL_STORES.has(name) && degradedStores.has(name)) {
    console.warn(
      `[mongo-storage] refresh skipped for ${name}: unconfirmed pending write, refusing a possibly-stale Mongo read`,
    );
    return false;
  }

  const collection = await getManagedCollection(name);
  if (collection) {
    const existing = await collection.findOne({ _id: DOC_ID }).catch(() => null);
    if (!existing?.payload || typeof existing.payload !== 'object') return false;
    caches.set(name, clone(existing.payload));
    writeLocalManaged(name, existing.payload);
    return true;
  }

  // No Mongo: the local file is the shared source, and a sibling process
  // running from the same directory may have written it since boot.
  caches.set(name, clone(readJsonFile(filePath(name), spec.fallback())));
  return true;
}

export function readJson(name, fallback) {
  const spec = getManagedSpec(name);
  if (spec) {
    if (!caches.has(name)) {
      caches.set(name, clone(readJsonFile(filePath(name), spec.fallback())));
    }
    return clone(caches.get(name));
  }

  const p = filePath(name);
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    console.warn('readJson failed:', name, e);
    return fallback;
  }
}

export function writeJson(name, obj) {
  const spec = getManagedSpec(name);
  if (spec) {
    const value = clone(obj ?? spec.fallback());
    caches.set(name, value);
    writeLocalManaged(name, value);
    queuePersist(name);
    return;
  }

  const p = filePath(name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, p);
}

/**
 * Await every queued Mongo persist. Call this before process.exit().
 *
 * writeJson() writes local disk synchronously but pushes to Mongo on a
 * background chain. A long-lived worker never notices the difference. A CLI
 * that exits straight after a write kills that chain mid-flight — and because
 * refreshManagedFile() treats Mongo as authoritative, the NEXT run pulls the
 * stale pre-write state back over the correct local file.
 *
 * Found 2026-08-16 on the first live `hodl:pay`. The transfer landed and the
 * local file recorded the chunk confirmed; the following run re-read
 * "submitted, pending" from Mongo and had to re-derive the outcome from the
 * chain. It was recoverable only because hodl:pay reconciles against the chain
 * before it sends anything. A file with no such backstop loses the write.
 */
export async function flushManagedWrites() {
  await Promise.allSettled([...persistChains.values()]);
}

// Obfuscate refresh tokens at rest (AES-GCM).
export function obfuscate(s) {
  const { TOKEN_PEPPER } = getConfig();
  const key = crypto.createHash('sha256').update(String(TOKEN_PEPPER)).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(s), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function deobfuscate(b64) {
  const { TOKEN_PEPPER } = getConfig();
  const buf = Buffer.from(String(b64), 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const key = crypto.createHash('sha256').update(String(TOKEN_PEPPER)).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf8');
}
