/**
 * On-chain wallet linkage — "who paid to bring this wallet into existence".
 *
 * Built 2026-08-01 after three faucet claims landed within five minutes of
 * each other and two of the wallets turned out to be the same hand: the
 * third wallet's very first transaction was signed and paid for by the
 * second wallet, and three transactions involve both, spanning eight months.
 *
 * Why this signal rather than device fingerprints or geolocation: a Discord
 * `!drip` carries no IP and no GPS, so device signals cannot see the surface
 * most claims arrive on. A funding edge is visible from either surface, is
 * recorded permanently by the chain, and cannot be spoofed after the fact —
 * you cannot change who paid for your account's first transaction. It also
 * survives the specific evasion this is meant to stop: a fresh wallet still
 * has to get its first lamports from somewhere, and that edge is the link.
 *
 * What it does NOT catch, stated plainly so nobody over-trusts it:
 *  - a wallet funded from a centralized exchange withdrawal, which points at
 *    the exchange rather than at the user;
 *  - a wallet funded through a mixer, or through enough hops to exceed the
 *    configured depth;
 *  - two people who genuinely share a funder (a team wallet paying salaries
 *    looks exactly like one person with two wallets).
 * It is evidence for a human to act on, and a blunt block only once someone
 * has been banned deliberately. It is not proof of identity.
 *
 * No key material is reachable from this module — it only reads the chain.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { createRequire } from 'node:module';
const { rpcConnectionOptions } = createRequire(import.meta.url)('../shared/solanaRpcFetch.cjs');
import { getFaucetConfig } from './config.js';
import { loadManagedJson, writeManagedJson } from './storage.js';

const LINKAGE_FILE = 'wallet_linkage.json';

/** Pages of 1000 signatures to walk back before giving up on reaching the
 *  wallet's beginning. A wallet busier than this is almost certainly not a
 *  throwaway, which is what this is looking for. */
const DEFAULT_MAX_PAGES = 3;

/** How many of the oldest transactions to inspect. Only the FIRST yields a
 *  funder; the rest are recorded separately as early counterparties, which are
 *  context for a human and never an edge a ban travels along. */
const DEFAULT_OLDEST_SAMPLES = 3;

/** Bump when the shape or meaning of a cached record changes, so stale records
 *  are re-derived rather than silently reinterpreted. v2 split `funders`
 *  (signer of the first transaction) from `earlyCounterparties` — v1 lumped
 *  both under `funders` and so reported ordinary early transfers as funding. */
const RECORD_SCHEMA = 2;

/** Re-scan a truncated (incomplete) result after this long. A complete scan
 *  is cached indefinitely: the oldest transactions of an account never
 *  change, so the answer cannot either. */
const TRUNCATED_RESCAN_MS = 24 * 60 * 60 * 1000;

let cachedConnection = null;
function getConnection() {
  if (!cachedConnection) cachedConnection = new Connection(getFaucetConfig().rpcUrl, rpcConnectionOptions('confirmed'));
  return cachedConnection;
}

function emptyDb() {
  return { version: 1, wallets: {} };
}

function db() {
  const raw = loadManagedJson(LINKAGE_FILE, emptyDb());
  if (!raw || typeof raw !== 'object' || !raw.wallets) return emptyDb();
  return raw;
}

export function readLinkageRecord(wallet) {
  return db().wallets[String(wallet || '')] || null;
}

export function readLinkageGraph() {
  return db().wallets;
}

function writeLinkageRecord(wallet, record) {
  const d = db();
  d.wallets[String(wallet)] = record;
  writeManagedJson(LINKAGE_FILE, d);
  return record;
}

function isFresh(record) {
  if (!record) return false;
  // A record written under an older meaning of `funders` must be re-derived,
  // not trusted — v1 records name early counterparties as funders.
  if (Number(record.schema || 1) !== RECORD_SCHEMA) return false;
  if (!record.truncated) return true; // complete scans never go stale
  return Date.now() - Number(record.scannedAt || 0) < TRUNCATED_RESCAN_MS;
}

/**
 * Walks back to the oldest signatures this wallet has, bounded by `maxPages`.
 * Returns them oldest-last, exactly as the RPC orders them.
 */
async function fetchSignaturesToOldest(connection, address, maxPages) {
  const pubkey = new PublicKey(address);
  let all = [];
  let before;
  let truncated = false;

  for (let page = 0; page < maxPages; page += 1) {
    const batch = await connection.getSignaturesForAddress(pubkey, { limit: 1000, ...(before ? { before } : {}) });
    if (!batch.length) break;
    all = all.concat(batch);
    before = batch[batch.length - 1].signature;
    if (batch.length < 1000) return { signatures: all, truncated: false };
    if (page === maxPages - 1) truncated = true;
  }
  return { signatures: all, truncated };
}

/**
 * Splits the wallets around an account's beginning into two very different
 * things, because conflating them produces false accusations:
 *
 *  - `funders` — signers of its very FIRST transaction. Whoever paid to bring
 *    the account into existence. This is the edge a ban may travel along.
 *    (The first transaction really is the funding one: getSignaturesForAddress
 *    includes transactions where the address is merely a recipient, so an
 *    incoming transfer to a brand-new address is itself its oldest entry.)
 *
 *  - `earlyCounterparties` — signers of the next few transactions. Context for
 *    a human, nothing more. On a young wallet these are ordinary transfers, and
 *    v1 of this module reported them as funders: it made a wallet that merely
 *    sent tokens early look like the account's parent. Observed 2026-08-02,
 *    where it wrongly presented one claimant as having created another's
 *    wallet when a third address actually did.
 */
export async function discoverFunders(wallet, {
  connection = getConnection(),
  maxPages = DEFAULT_MAX_PAGES,
  oldestSamples = DEFAULT_OLDEST_SAMPLES,
} = {}) {
  const address = new PublicKey(wallet).toBase58();

  const { signatures, truncated } = await fetchSignaturesToOldest(connection, address, maxPages);
  if (!signatures.length) {
    return { wallet: address, funders: [], scannedSignatures: 0, truncated: false, oldestAt: null };
  }

  // A truncated scan never reached the wallet's beginning, so its "oldest"
  // signatures are just the oldest of the newest few thousand — whoever signed
  // those is an arbitrary recent counterparty, NOT whoever funded the account.
  // Treating that as a funding edge would manufacture false links between
  // strangers who happen to have touched the same busy address, and a false
  // link here means a wrongly refused claim. Report no funders instead.
  //
  // Wallets busy enough to truncate (exchanges, market makers, programs) are
  // also precisely the ones that would pull unrelated people into one cluster,
  // so declining to guess costs nothing this is meant to catch: the throwaway
  // wallets this exists to link have a handful of transactions, not thousands.
  if (truncated) {
    const oldestEntry = signatures[signatures.length - 1];
    return {
      schema: RECORD_SCHEMA,
      wallet: address,
      funders: [],
      earlyCounterparties: [],
      scannedSignatures: signatures.length,
      truncated: true,
      oldestAt: oldestEntry?.blockTime ? oldestEntry.blockTime * 1000 : null,
    };
  }

  // Oldest first: [0] is the account's very first transaction.
  const oldest = signatures.slice(-oldestSamples).reverse();

  async function signersOf(entry) {
    const tx = await connection.getParsedTransaction(entry.signature, {
      maxSupportedTransactionVersion: 0,
    });
    const keys = tx?.transaction?.message?.accountKeys || [];
    return keys
      .filter((key) => key.signer)
      .map((key) => String(key.pubkey?.toBase58 ? key.pubkey.toBase58() : key.pubkey || ''))
      .filter((pubkey) => pubkey && pubkey !== address);
  }

  const funders = new Set(await signersOf(oldest[0]));

  const earlyCounterparties = new Set();
  for (const entry of oldest.slice(1)) {
    for (const signer of await signersOf(entry)) {
      if (!funders.has(signer)) earlyCounterparties.add(signer);
    }
  }

  const oldestEntry = signatures[signatures.length - 1];
  return {
    schema: RECORD_SCHEMA,
    wallet: address,
    funders: [...funders],
    earlyCounterparties: [...earlyCounterparties],
    scannedSignatures: signatures.length,
    truncated,
    oldestAt: oldestEntry?.blockTime ? oldestEntry.blockTime * 1000 : null,
  };
}

/**
 * Cached `discoverFunders`. Returns `{ ...record, cached }`, and on RPC
 * failure returns a stale record if one exists, or an `error` record — never
 * throws. Callers decide what a missing answer means; the faucet treats it as
 * "don't block", see walletBans.js.
 */
export async function getFundersCached(wallet, options = {}) {
  const address = new PublicKey(wallet).toBase58();
  const existing = readLinkageRecord(address);
  if (isFresh(existing) && !options.force) return { ...existing, cached: true };

  try {
    const discovered = await discoverFunders(address, options);
    const record = { ...discovered, scannedAt: Date.now(), error: null };
    writeLinkageRecord(address, record);
    return { ...record, cached: false };
  } catch (err) {
    // A stale record is only reusable if it was written under the current
    // meaning of `funders`; a v1 record would reintroduce the false edges.
    if (existing && Number(existing.schema || 1) === RECORD_SCHEMA) {
      return { ...existing, cached: true, stale: true, error: err?.message || 'rpc_error' };
    }
    return {
      schema: RECORD_SCHEMA,
      wallet: address,
      funders: [],
      earlyCounterparties: [],
      scannedSignatures: 0,
      truncated: true,
      oldestAt: null,
      scannedAt: 0,
      error: err?.message || 'rpc_error',
      cached: false,
    };
  }
}

/**
 * Wallets already known to have been funded BY this one, read from whatever
 * has been scanned before. Purely local — this is the reverse of the funder
 * edge and needs no RPC, which is what lets a ban still bite when the chain
 * is unreachable.
 */
export function knownFundedBy(wallet) {
  const address = String(wallet || '');
  const graph = readLinkageGraph();
  return Object.entries(graph)
    .filter(([, record]) => Array.isArray(record?.funders) && record.funders.includes(address))
    .map(([child]) => child);
}

export const __testing = { LINKAGE_FILE, isFresh, TRUNCATED_RESCAN_MS };
