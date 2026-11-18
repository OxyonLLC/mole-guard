/**
 * Faucet ban list, and the cluster walk that makes a ban survive a wallet
 * switch.
 *
 * The point of banning by cluster: banning a single address accomplishes
 * nothing against someone who can generate a new keypair in a second. But a
 * new wallet still has to be funded, and if it is funded from the banned
 * wallet — or from something the banned wallet funded — the chain records
 * that edge permanently. Walking those edges is what turns "banned this
 * address" into "stopped this person".
 *
 * Two deliberate asymmetries:
 *
 *  1. A DIRECT ban is enforced from local state alone and can never be
 *     bypassed by an RPC outage. Cluster expansion needs the chain, so when
 *     the RPC is unreachable it degrades to the direct check and says so.
 *     Failing open there is the deliberate choice: the faucet had a real RPC
 *     outage the same day this was written, and blocking every honest claimer
 *     during one is a worse outcome than briefly missing a cluster match.
 *
 *  2. Reverse edges (wallets this one is already known to have funded) come
 *     from the local cache, so they keep working with no RPC at all.
 *
 * A cluster match is a strong signal, not a proof of identity — two people
 * who share a funder look identical to one person with two wallets. See the
 * limitations listed in walletLinkage.js. `reviewOnly` exists so a ban can be
 * recorded and observed before it starts refusing claims.
 */

import { PublicKey } from '@solana/web3.js';
import { loadManagedJson, writeManagedJson, refreshManagedJson } from './storage.js';
import { getFundersCached, knownFundedBy, readLinkageRecord } from './walletLinkage.js';

const BANS_FILE = 'wallet_bans.json';

/** How many funding hops out from the claiming wallet to look. 2 catches
 *  "banned wallet -> fresh wallet -> another fresh wallet", which is the
 *  realistic evasion; going deeper widens the blast radius of a false match
 *  faster than it catches anyone. */
export const DEFAULT_MAX_DEPTH = 2;

/** Addresses inspected before the walk gives up. A funding graph can fan out
 *  hard — one wallet here had three funders, two of them high-traffic — and a
 *  claim cannot wait on that. */
export const DEFAULT_MAX_NODES = 25;

/** Wall-clock ceiling for the walk on the claim path. Measured 2026-08-01:
 *  ~1-2.5s per uncached wallet against Alchemy, with 429 backoff on top once
 *  the fan-out gets going. */
export const DEFAULT_TIME_BUDGET_MS = 8000;

function emptyDb() {
  return { version: 1, bans: {} };
}

function db() {
  const raw = loadManagedJson(BANS_FILE, emptyDb());
  if (!raw || typeof raw !== 'object' || !raw.bans) return emptyDb();
  return raw;
}

function save(d) {
  writeManagedJson(BANS_FILE, d);
}

function normalize(wallet) {
  return new PublicKey(String(wallet || '').trim()).toBase58();
}

export function banWallet(wallet, { reason = '', bannedBy = '', reviewOnly = false } = {}) {
  const address = normalize(wallet);
  const d = db();
  const existing = d.bans[address];
  d.bans[address] = {
    wallet: address,
    reason: String(reason || '').slice(0, 500),
    bannedBy: String(bannedBy || '').slice(0, 100),
    reviewOnly: Boolean(reviewOnly),
    bannedAt: existing?.bannedAt || Date.now(),
    updatedAt: Date.now(),
  };
  save(d);
  return d.bans[address];
}

export function unbanWallet(wallet) {
  const address = normalize(wallet);
  const d = db();
  if (!d.bans[address]) return false;
  delete d.bans[address];
  save(d);
  return true;
}

export function getBan(wallet) {
  try {
    return db().bans[normalize(wallet)] || null;
  } catch {
    return null; // not a valid address: cannot be banned
  }
}

export function listBans() {
  return Object.values(db().bans).sort((a, b) => Number(b.bannedAt || 0) - Number(a.bannedAt || 0));
}

export function isDirectlyBanned(wallet) {
  const ban = getBan(wallet);
  return Boolean(ban && !ban.reviewOnly);
}

/**
 * Walks funding edges out from `wallet` looking for a banned address.
 *
 * Returns `{ banned, ban, path, degraded, checked }`:
 *  - `path` is the chain of addresses from the claiming wallet to the banned
 *    one, so a human can audit *why* something was refused rather than being
 *    told "computer says no".
 *  - `degraded` means the chain could not be reached, so only local knowledge
 *    (direct bans and cached edges) was consulted.
 */
export async function findBannedLink(wallet, {
  maxDepth = DEFAULT_MAX_DEPTH,
  force = false,
  maxNodes = DEFAULT_MAX_NODES,
  timeBudgetMs = DEFAULT_TIME_BUDGET_MS,
} = {}) {
  let address;
  try {
    address = normalize(wallet);
  } catch {
    return { banned: false, ban: null, path: [], degraded: false, checked: 0 };
  }

  // Bans are set from Discord (the faucet bot) and enforced from BOTH the bot
  // and the website (the web process, via the shared eligibility check). Each
  // caches this file at boot, so without a refresh a ban issued in Discord
  // would not reach web claims until the web process happened to restart —
  // a ban that silently only half-applies is worse than no ban. Throttled, so
  // this costs one Mongo read per 30s rather than one per claim.
  await refreshManagedJson(BANS_FILE).catch(() => {});

  const direct = getBan(address);
  if (direct && !direct.reviewOnly) {
    return { banned: true, ban: direct, path: [address], degraded: false, checked: 1 };
  }

  // Nothing to match against: skip the graph walk entirely rather than
  // spending seconds of RPC on every claim to prove a negative. This is the
  // normal case — the ban list is empty until a mod bans someone — and without
  // it the check would add its full latency to every drip for no benefit.
  if (!Object.keys(db().bans).length) {
    return { banned: false, ban: null, path: [], degraded: false, checked: 1 };
  }

  const seen = new Set([address]);
  let frontier = [[address]];
  let degraded = false;
  let checked = 1;
  const startedAt = Date.now();

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const next = [];
    for (const path of frontier) {
      // Hard budgets. A claim must not hang behind a fan-out into busy
      // wallets, and the RPC starts returning 429s long before an unbounded
      // walk would finish. Running out of budget is reported as degraded —
      // the same "we could not fully check" signal as an RPC failure, never a
      // silent "clean".
      if (checked >= maxNodes || Date.now() - startedAt > timeBudgetMs) {
        degraded = true;
        return { banned: false, ban: null, path: [], degraded, checked };
      }

      const current = path[path.length - 1];

      const linkage = await getFundersCached(current, { force: force && depth === 0 });
      if (linkage.error) degraded = true;
      // A truncated scan contributes no edges (see walletLinkage.js) — the
      // wallet is too busy for its funder to be identifiable, so we cannot
      // say it is clean either.
      if (linkage.truncated) degraded = true;

      // Forward: who funded this wallet. Reverse: who this wallet funded,
      // from local cache only — that half keeps working with no RPC.
      const neighbours = [...new Set([...(linkage.funders || []), ...knownFundedBy(current)])];

      for (const neighbour of neighbours) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        checked += 1;
        const ban = getBan(neighbour);
        if (ban && !ban.reviewOnly) {
          return { banned: true, ban, path: [...path, neighbour], degraded, checked };
        }
        next.push([...path, neighbour]);
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }

  return { banned: false, ban: null, path: [], degraded, checked };
}

/**
 * Everything known to be connected to `wallet`, for an admin to look at
 * before deciding anything. Read-only, and marks which members are banned.
 */
export async function describeCluster(wallet, {
  maxDepth = DEFAULT_MAX_DEPTH,
  maxNodes = DEFAULT_MAX_NODES,
  // Looser than the claim path: this is admin-initiated and the caller warns
  // that it reads the chain. Still bounded — a mod typing a command must not
  // be able to wedge the bot behind an unbounded graph walk.
  timeBudgetMs = 45_000,
} = {}) {
  const address = normalize(wallet);
  const members = new Map([[address, { wallet: address, depth: 0, via: 'self' }]]);
  let frontier = [address];
  let degraded = false;
  let truncatedWalk = false;
  const startedAt = Date.now();

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const next = [];
    for (const current of frontier) {
      if (members.size >= maxNodes || Date.now() - startedAt > timeBudgetMs) {
        truncatedWalk = true;
        degraded = true;
        break;
      }
      const linkage = await getFundersCached(current);
      if (linkage.error) degraded = true;
      for (const funder of linkage.funders || []) {
        if (members.has(funder)) continue;
        members.set(funder, { wallet: funder, depth, via: `created ${current}`, weak: false });
        next.push(funder);
      }
      for (const child of knownFundedBy(current)) {
        if (members.has(child)) continue;
        members.set(child, { wallet: child, depth, via: `created by ${current}`, weak: false });
        next.push(child);
      }
      // Shown for context, never expanded and never a path a ban travels.
      // These are just whoever transacted with the wallet early on — on a young
      // account, ordinary transfers. Treating them as parentage is exactly the
      // mistake v1 made.
      for (const other of linkage.earlyCounterparties || []) {
        if (members.has(other)) continue;
        members.set(other, { wallet: other, depth, via: `early counterparty of ${current}`, weak: true });
      }
    }
    frontier = next;
    if (truncatedWalk || !frontier.length) break;
  }

  return {
    wallet: address,
    degraded,
    truncatedWalk,
    members: [...members.values()].map((m) => {
      const ban = getBan(m.wallet);
      const record = readLinkageRecord(m.wallet);
      return {
        ...m,
        banned: Boolean(ban),
        reviewOnly: Boolean(ban?.reviewOnly),
        banReason: ban?.reason || null,
        scanTruncated: Boolean(record?.truncated),
      };
    }),
  };
}

export const __testing = { BANS_FILE };
