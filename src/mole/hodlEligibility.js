// HODL Rewards — gathering who actually qualifies this week.
//
// hodlEpochs.js decides eligibility from facts. This module is where the facts
// come from: linked profiles, verification status, bans, balances and Proof of
// Value. It is the only part of HODL that touches the world, kept apart from the
// arithmetic so the arithmetic stays testable without a chain or a database.
//
// FAIL LOUD, NOT OPEN. A faucet claim that cannot be evaluated should usually
// proceed — refusing an honest claimer over our own outage is the worse error.
// A batch payout is the opposite: if the balance of one participant cannot be
// read, the correct move is to mark that participant unresolved and say so in
// the preview, not to guess. Nobody is waiting at a keyboard for a Tuesday
// batch, so there is no cost to waiting for a clean read, and a wrong read
// either overpays a stranger or silently drops someone who qualified.

import { listLinkedProfiles, getWalletVerificationStatus, listVerifiedWallets, getPayoutWallet } from "./walletLink.js";
import { refreshManagedFile } from "./storage.js";
import { qualifies, DEFAULT_EPOCH_PARAMS } from "./hodlEpochs.js";

/** The managed file holding linked profiles. Pulled from Mongo before a
 *  snapshot, because the local copy is a cache written at boot. */
const LINKS_FILE = "linked_wallets.json";

/** How many balance lookups to have in flight at once. Small on purpose: the
 *  RPC is rate limited, the funding-cluster walks already compete for it, and a
 *  weekly job has no reason to be in a hurry. */
const BALANCE_CONCURRENCY = 4;

async function mapLimited(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Everyone who could conceivably qualify, with the facts needed to decide.
 *
 * Dependencies are injected so this can be exercised without a chain, a Mongo
 * connection or a Discord bot — the preview CLI wires the real ones.
 *
 * @param {object} deps
 * @param {object} deps.epoch
 * @param {function} deps.getBalance        async (wallet) => number | { units, decimals } | null  (units = exact base units, used for payout maths)
 * @param {function} [deps.isWalletBanned]  async (wallet) => boolean
 * @param {function} [deps.isAccountBanned] async (discordUserId) => boolean
 * @param {function} [deps.getPovScore]     async (discordUserId) => number
 * @param {function} [deps.listProfiles]
 */
export async function gatherIdentities({
  epoch = DEFAULT_EPOCH_PARAMS,
  getBalance,
  isWalletBanned = async () => false,
  isAccountBanned = async () => false,
  getPovScore = async () => 0,
  // Owner policy 2026-11-13: distinct UTC participation days (0-7) in the 7 days
  // before the snapshot, from hodlActiveDays.makeActiveDaysReader. Default 0 =
  // the base rate.
  getActiveDays = async () => ({ activeDays: 0 }),
  listProfiles = listLinkedProfiles,
  nowSec = Math.floor(Date.now() / 1000),
} = {}) {
  // Pull the authoritative copy first. readJson() serves a cache populated at
  // boot, so a long-running worker would decide a Tuesday payout from whatever
  // the population looked like when the process started — and a participant who
  // verified on Monday would be silently skipped.
  //
  // Measured 2026-08-16: the local mirror held 7 profiles while Mongo held 9.
  // Failure to refresh is recorded, never fatal: an out-of-date list still pays
  // real people, but the preview has to admit which list it used.
  let refreshed = true;
  try {
    refreshed = await refreshManagedFile(LINKS_FILE);
  } catch (error) {
    refreshed = false;
  }

  // `degraded` is strictly about PER-PARTICIPANT read failures. Whether the
  // list itself was refreshed is a different kind of fact and travels
  // separately as sourceRefreshed — mixing them made "2 profiles could not be
  // read" and "the whole list might be stale" indistinguishable in the preview,
  // and they call for different responses.
  const profiles = listProfiles();
  const degraded = [];
  const activityReadFailures = [];

  const rows = await mapLimited(profiles, BALANCE_CONCURRENCY, async ({ discordUserId, record }) => {
    const status = getWalletVerificationStatus(record, nowSec);
    // ONE payout wallet per identity — their nomination if they made one, else
    // the wallet they most recently verified with. A person with several
    // wallets is still one participant; that is the whole point of qualifying
    // identities rather than addresses (spec §12).
    const payoutWallet = getPayoutWallet(record, nowSec) || status.wallet || null;

    // THE HOLDING IS THE PERSON'S, THE PAYMENT IS ONE WALLET'S (2026-08-20).
    // Before multi-wallet verification these were the same number. Now someone
    // holding 1,000 across two wallets holds 1,000, and measuring only the
    // payout wallet would disqualify a real holder for tidying their funds.
    const verifiedWallets = listVerifiedWallets(record, nowSec).map((entry) => entry.wallet);
    const walletsToRead = verifiedWallets.length ? verifiedWallets : (payoutWallet ? [payoutWallet] : []);

    let balance = null;
    let balanceUnits = null;
    let balanceDecimals = null;
    let banned = false;

    if (payoutWallet) {
      try {
        // EVERY verified wallet is checked against the ban list, not just the
        // one being paid — otherwise a banned wallet is evaded by nominating a
        // clean one, which is the cheapest possible bypass of the blocklist.
        const [balances, walletBans, aBan] = await Promise.all([
          Promise.all(walletsToRead.map(async (address) => {
            try {
              // null/undefined is "could not read", and Number(null) is 0 —
              // the exact coercion that would turn an unknown balance into a
              // confident zero. Checked before conversion, deliberately.
              const raw = await getBalance(address);
              if (raw === null || raw === undefined) return null;
              // Exact form { units, decimals } (base units, for payout maths), or a plain number.
              if (typeof raw === "object" && raw.units !== undefined && raw.units !== null) {
                const decimals = Number(raw.decimals);
                if (!/^\d+$/.test(String(raw.units)) || !Number.isInteger(decimals) || decimals < 0) return null;
                return { units: BigInt(raw.units), decimals, value: Number(raw.units) / 10 ** decimals };
              }
              const value = Number(raw);
              return Number.isFinite(value) ? value : null;
            } catch (error) {
              degraded.push({ discordUserId, wallet: address, reason: error?.message || "lookup_failed" });
              return null;
            }
          })),
          Promise.all(walletsToRead.map((address) => isWalletBanned(address))),
          isAccountBanned(discordUserId),
        ]);

        const readable = balances.filter((value) => value !== null);
        const exact = readable.length > 0 && readable.every((v) => typeof v === "object")
          && readable.every((v) => v.decimals === readable[0].decimals);
        if (exact) {
          const units = readable.reduce((sum, v) => sum + v.units, 0n);
          balanceUnits = units.toString();
          balanceDecimals = readable[0].decimals;
        }
        const total = exact
          ? Number(balanceUnits) / 10 ** balanceDecimals
          : readable.reduce((sum, v) => sum + (typeof v === "object" ? v.value : v), 0);
        const complete = readable.length === balances.length;

        // A partial sum UNDERSTATES the holding, so it may qualify someone it
        // already covers, but it must never disqualify. Falling short on an
        // incomplete read stays `null` — BALANCE_UNKNOWN — which is recorded in
        // `degraded` and visible in the preview, rather than a low number that
        // looks like a person who simply stopped holding.
        const minHold = Number(epoch?.minHold ?? 0);
        balance = complete || total >= minHold ? total : null;
        if (balance === null) { balanceUnits = null; balanceDecimals = null; }
        banned = Boolean(walletBans.some(Boolean) || aBan);
      } catch (error) {
        // Recorded, never swallowed. An unread balance becomes BALANCE_UNKNOWN
        // in qualifies(), which disqualifies — but the preview has to show that
        // it happened, or a silently shrinking payout list looks like people
        // simply stopped qualifying.
        degraded.push({ discordUserId, reason: error?.message || "lookup_failed" });
        balance = null;
      }
    }

    let povScore = 0;
    try {
      povScore = Number(await getPovScore(discordUserId)) || 0;
    } catch {
      // A PoV failure costs a bonus, never eligibility. Scoring zero is the
      // safe direction: the participant still gets the base share.
      povScore = 0;
    }

    let activeDays = 0;
    let activeDayList = [];
    let activityErrors = [];
    try {
      const r = await getActiveDays(discordUserId);
      activeDays = Math.min(7, Math.max(0, Math.floor(Number(r?.activeDays) || 0)));
      activeDayList = Array.isArray(r?.days) ? r.days : [];
      activityErrors = Array.isArray(r?.errors) ? r.errors.map(String) : [];
    } catch (error) {
      activeDays = 0;
      activityErrors = [`active_days: ${error?.message || "read_failed"}`];
    }
    // NEVER silent: a failed activity read would pay a lower rate than earned.
    // It does not change eligibility, but it is recorded in `degraded` and in
    // `activityReadFailures`, which hodl-preview flags and hodl-pay refuses on.
    if (activityErrors.length) {
      activityReadFailures.push({ discordUserId, errors: activityErrors });
      degraded.push({ discordUserId, reason: `activity_read_failed: ${activityErrors.join("; ")}` });
    }

    const identity = {
      discordUserId,
      payoutWallet,
      verified: Boolean(status.verified),
      verificationExpiresAtSec: Number(status.expires_at || 0),
      balance,
      balanceUnits,
      balanceDecimals,
      banned,
      povScore,
      activeDays,
      activeDayList,
    };
    return { identity, verdict: qualifies(identity, epoch, { nowSec }) };
  });

  const qualified = rows.filter((r) => r.verdict.qualified);
  const excluded = rows.filter((r) => !r.verdict.qualified);

  return {
    epochId: epoch?.id || null,
    sourceRefreshed: refreshed,
    considered: rows.length,
    qualified: qualified.map((r) => ({
      discordUserId: r.identity.discordUserId,
      payoutWallet: r.identity.payoutWallet,
      povScore: r.identity.povScore,
      balance: r.identity.balance,
      ...(r.identity.balanceUnits !== null ? { balanceUnits: r.identity.balanceUnits, balanceDecimals: r.identity.balanceDecimals } : {}),
      activeDays: r.identity.activeDays,
      activeDayList: r.identity.activeDayList,
    })),
    excluded: excluded.map((r) => ({
      discordUserId: r.identity.discordUserId,
      reasons: r.verdict.reasons,
    })),
    degraded,
    activityReadFailures,
  };
}

/** Reasons grouped with counts, for the preview's summary line. */
export function summariseExclusions(excluded = []) {
  const counts = new Map();
  for (const row of excluded) {
    for (const reason of row.reasons || []) counts.set(reason, (counts.get(reason) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count }));
}
