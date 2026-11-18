// The USER layer — one person, several accounts, many wallets.
//
// THE MODEL, in the owner's words: "USER > ACCOUNT(S) > WALLET".
//
//   USER      the person. Has no login of its own; it is whatever set of
//             accounts have been proved to belong to the same human.
//   ACCOUNT   a door they came in through — a Discord login, an X login, or a
//             wallet-rooted account minted before either was attached.
//   WALLET    an address they signed with. As many as they like.
//
// WHAT WAS WRONG BEFORE THIS FILE. `accountId` was the top of the tree, so a
// person who signed in with Discord and a person who signed in with X were two
// people even when they were the same person. Two consequences, both reported
// from the live site:
//
//   1. "ALREADY LINKED" with no way forward. Syncing X to the Discord account
//      was refused because that X login already rooted an account of its own.
//      The refusal was correct about the FACT and wrong about the CONCLUSION:
//      somebody who can authenticate both sides is not two people, they are one
//      person holding two doors.
//   2. Two claims inside one cooldown. The faucet checks every wallet the same
//      person has verified — but "the same person" meant "the same account", so
//      the wallet on the Discord account and the wallet on the X account never
//      saw each other, and both claimed.
//
// SO THE RULE IS: proving two accounts merges them, it does not refuse them.
// Nothing here weakens the anti-sybil argument, because merging REMOVES an
// identity rather than creating one — two claim slots become one.
//
// ONE WALLET STILL GETS PAID. Many wallets per user is the point; many payouts
// is not. `getPayoutWallet()` in walletLink.js answers for the merged record,
// so a user has exactly one payout address no matter how many doors and wallets
// they hold.
//
// THE STORE is a plain alias map, absorbed -> canonical:
//
//   { "x:9f2c…": "248525967377694720", "wallet:1a4b…": "248525967377694720" }
//
// Chains are allowed (A -> B -> C) because merges happen one at a time and a
// canonical account can itself later be absorbed. Every read follows the chain
// to its end, with a hop cap, so a corrupted store can never hang a request.

import { readJson, writeJson } from "./storage.js";

const FILE = "account_merges.json";

/** Depth cap for alias chains. Merges are rare and chains are short; anything
 *  deeper than this is corruption, and a corrupted store must degrade to "no
 *  merge" rather than loop forever inside a payout run. */
const MAX_HOPS = 16;

/** How much an account id is worth as the canonical one. Higher wins.
 *
 *  A Discord snowflake outranks everything because it is the id the whole
 *  codebase already speaks — the bot, the faucet's claim keys, the linked-role
 *  metadata — so keeping it as the survivor means those stores keep resolving
 *  without a rewrite. An X-rooted account outranks a wallet-rooted one for the
 *  same reason it can be paid: a social login is evidence of a person, a wallet
 *  is not. */
export function accountRank(accountId) {
  const id = String(accountId || "").trim();
  if (!id) return -1;
  if (/^\d{5,25}$/.test(id)) return 3;
  if (id.startsWith("x:")) return 2;
  if (id.startsWith("wallet:")) return 1;
  return 0;
}

function db() {
  try {
    const raw = readJson(FILE, {});
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch (error) {
    // Same fail-soft contract as syncedIdentities.js: this is read from inside
    // payout planning, and an exception there takes down a whole batch instead
    // of one row. An unreadable store means "nobody is merged", which is the
    // behaviour that existed before this file and is never worse than that.
    console.warn("[user-accounts] merge store unreadable, treating as empty:", error?.message || error);
    return {};
  }
}

/**
 * The canonical account id for this account — the USER's id.
 *
 * Returns the input unchanged when it has never been merged, so every caller
 * can wrap its lookups in this without caring whether merges exist at all.
 */
export function resolveAccountId(accountId, aliases = null) {
  const start = String(accountId || "").trim();
  if (!start) return start;
  const map = aliases || db();
  let current = start;
  const seen = new Set([current]);
  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    const next = String(map[current] || "").trim();
    if (!next || next === current) return current;
    // A cycle (A -> B -> A) can only come from a corrupted or hand-edited
    // store. Stopping at the highest-ranked id seen keeps the answer STABLE
    // across calls, which matters more than which id wins: an answer that
    // flip-flops would move somebody's payouts between reads.
    if (seen.has(next)) {
      return Array.from(seen).sort((a, b) => accountRank(b) - accountRank(a) || a.localeCompare(b))[0];
    }
    seen.add(next);
    current = next;
  }
  return current;
}

/** True when this account has been absorbed into another. */
export function isMergedAway(accountId) {
  const id = String(accountId || "").trim();
  return !!id && resolveAccountId(id) !== id;
}

/**
 * Every account id that belongs to this user, canonical first.
 *
 * This is the list any store keyed by account id must sweep to answer a
 * question about the PERSON — the faucet's cooldown is the first caller, and it
 * is the one the "two claims in 24h" report came from: the second claim was
 * recorded under an id the first claim's check never looked at.
 */
export function listAccountIdsForUser(accountId) {
  const map = db();
  const canonical = resolveAccountId(accountId, map);
  if (!canonical) return [];
  const out = [canonical];
  for (const key of Object.keys(map)) {
    const id = String(key || "").trim();
    if (!id || id === canonical) continue;
    if (resolveAccountId(id, map) === canonical) out.push(id);
  }
  return out;
}

/** Which of two accounts should survive a merge. See accountRank(). Ties keep
 *  `a`, the account the caller is already working with, so a repeated merge is
 *  idempotent rather than swapping the survivor back and forth. */
export function preferredCanonical(a, b) {
  const idA = String(a || "").trim();
  const idB = String(b || "").trim();
  if (!idA) return idB;
  if (!idB) return idA;
  return accountRank(idB) > accountRank(idA) ? idB : idA;
}

/**
 * Record that two accounts are one person.
 *
 * ALIAS ONLY — this writes the map and nothing else. Moving the identities and
 * folding the wallet records together is accountMerge.js's job, because those
 * touch stores this module must not import (walletLink.js imports THIS one).
 *
 * Returns the survivor and the absorbed id. Merging an account with itself, or
 * re-merging two accounts already joined, is a no-op success: OAuth callbacks
 * arrive twice, and a double click must not be an error.
 */
export function linkAccounts(a, b) {
  const map = db();
  const left = resolveAccountId(a, map);
  const right = resolveAccountId(b, map);
  if (!left || !right) throw new Error("account_id_required");
  if (left === right) return { userId: left, absorbed: null, changed: false };

  const userId = preferredCanonical(left, right);
  const absorbed = userId === left ? right : left;
  map[absorbed] = userId;
  writeJson(FILE, map);
  return { userId, absorbed, changed: true };
}

/**
 * Undo one merge.
 *
 * Exists for the same reason the ban list has an appeal: a merge joins two
 * people's records if it is ever performed on the wrong pair, and a mistake
 * with no way back is a worse failure than the one being fixed. It only removes
 * the alias — wallets already folded into the surviving record stay there, and
 * are re-verified or moved by hand, because this module cannot know which
 * address came from which side.
 */
export function unlinkAccount(accountId) {
  const id = String(accountId || "").trim();
  if (!id) return false;
  const map = db();
  if (!Object.prototype.hasOwnProperty.call(map, id)) return false;
  delete map[id];
  writeJson(FILE, map);
  return true;
}

/** The whole map, for admin tooling and tests. */
export function listMerges() {
  return { ...db() };
}
