// What a PERSON holds, rather than what one of their wallets holds.
//
// WHY THIS EXISTS
//
// Every balance on this site used to be a single wallet's: the dashboard, the
// LewCrew role tiers, the governance threshold. Someone holding 10,000,000
// WinLEW across four wallets saw whichever one they happened to have connected
// and was told they held a quarter of their position. The owner's report of it
// was exact: "I have over 10m between the connected accounts but it only shows
// what account is connected."
//
// This module sums the wallets an identity has VERIFIED (src/mole/walletLink.js,
// `verified_wallets`). Not `wallet_history` — an address someone used once is
// not an address they have proved they still control, and this total decides
// who qualifies for things.
//
// THE PARTIAL-READ RULE, which is the only subtle part.
//
// If one wallet's balance cannot be read, the sum is an UNDERSTATEMENT, never
// an overstatement. So:
//
//   - it may still GRANT something the visible total already clears, because
//     the missing wallet could only add to it, and
//   - it must never REVOKE or refuse on the strength of a total known to be
//     incomplete.
//
// `partial` is set so callers can obey that, and `meetsThreshold()` implements
// it once so nobody has to remember. This mirrors solana.js's stance that
// losing history to a slow RPC is acceptable while a wrong balance is not.

import { getConfig } from "./config.js";
import { getSplBalance } from "./solana.js";
import { listVerifiedWallets } from "./walletLink.js";

/** How many balance reads to have in flight at once — the RPC is rate limited
 *  and a dashboard load has no reason to be greedy. Matches the small bound
 *  hodlEligibility.js uses for the same reason. */
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
 * Every verified wallet of one identity, with its balance, and the sum.
 *
 * @param {object} record            a linked-wallets record
 * @param {object} [deps]
 * @param {function} [deps.getBalance]  async (wallet) => number   (throws on failure)
 * @param {number} [deps.nowSec]
 * @returns {Promise<{total:number, partial:boolean, wallets:Array, counted:number, unreadable:number}>}
 */
export async function getIdentityHoldings(record, { getBalance, nowSec } = {}) {
  const read = getBalance || ((wallet) => getSplBalance(wallet, getConfig().WINLEW_MINT));
  const verified = listVerifiedWallets(record, nowSec);

  if (!verified.length) {
    return { total: 0, partial: false, wallets: [], counted: 0, unreadable: 0 };
  }

  const wallets = await mapLimited(verified, BALANCE_CONCURRENCY, async (entry) => {
    try {
      const balance = Number(await read(entry.wallet));
      // A non-finite "balance" is a failed read wearing a number's clothes.
      if (!Number.isFinite(balance)) return { wallet: entry.wallet, balance: null, error: "balance_not_a_number" };
      return { wallet: entry.wallet, balance, error: null };
    } catch (error) {
      return { wallet: entry.wallet, balance: null, error: error?.message || "balance_unavailable" };
    }
  });

  const readable = wallets.filter((w) => w.error === null);
  return {
    total: readable.reduce((sum, w) => sum + w.balance, 0),
    partial: readable.length !== wallets.length,
    wallets,
    counted: readable.length,
    unreadable: wallets.length - readable.length,
  };
}

/**
 * Does this identity clear a threshold?
 *
 * `true`  — yes, and the answer is safe even on a partial read.
 * `false` — no, on a COMPLETE read.
 * `null`  — unknown: the visible total falls short but part of it is missing,
 *           so refusing would be refusing on evidence we know is incomplete.
 *           Callers decide what to do with an unknown; they must not silently
 *           coerce it to false.
 */
export function meetsThreshold(holdings, threshold) {
  const min = Number(threshold || 0);
  if (!holdings) return null;
  if (holdings.total >= min) return true;
  return holdings.partial ? null : false;
}
