/**
 * The single blocklist check that every fund-release path must pass.
 *
 * WHY THIS EXISTS
 *
 * The ban lists were being enforced in some places and not others, which meant
 * "banned" quietly meant different things depending on which system was paying:
 *
 *   faucet claims  — account ban + wallet ban + funding-cluster walk  ✅
 *   HODL rewards   — account ban + direct wallet ban                  ✅
 *   game payouts   — NOTHING                                          ❌
 *
 * Verified 2026-08-16: src/games/payoutPlanner.js skipped a user for exactly
 * two reasons, `no_wallet` and `below_min`. A wallet banned from the faucet for
 * sybil abuse was still paid its game winnings on the nightly run, by a worker
 * that signs real transactions. Nothing about that was visible from inside
 * either file — you only see it by listing the payout paths side by side.
 *
 * One gate, imported by all of them, so adding a wallet to the list stops
 * every kind of payment rather than whichever ones someone remembered.
 *
 * FAIL CLOSED — AND WHY THAT DIFFERS FROM THE FAUCET
 *
 * walletBans.js deliberately fails OPEN when its cluster walk cannot reach the
 * chain: a live claimant standing in front of a broken RPC should not be
 * refused for something that is our fault. That reasoning does NOT transfer to
 * a batch payout. Here the money is already accrued and paying it out one night
 * later costs the user nothing, while paying a banned wallet is an irreversible
 * on-chain transfer. So if the blocklist cannot be read, this refuses to
 * release funds and says so.
 *
 * Direct bans only — no cluster walk. The walk needs an RPC round trip per
 * wallet (~1-2.5s, see walletBans.js) which a nightly batch cannot absorb, and
 * a direct ban is decided from local state so it can never fail open. The
 * cluster walk still runs on the faucet claim path, where it belongs: that is
 * the interactive path, and it is where new cluster members are DISCOVERED and
 * then added here.
 */

import { isDirectlyBanned, listBans } from "../faucet/walletBans.js";
import { isUserBanned, listUserBans } from "../faucet/userBans.js";
import { canBePaid } from "../mole/syncedIdentities.js";
import { listAccountIdsForUser } from "../mole/userAccounts.js";

/** Every account id behind one person, falling back to the id itself if the
 *  merge map cannot be read — a ban check must never widen into an exception
 *  that skips the check entirely. */
function accountIdsOf(discordUserId) {
  const id = String(discordUserId || "").trim();
  if (!id) return [];
  try {
    const ids = listAccountIdsForUser(id);
    return ids.length ? ids : [id];
  } catch {
    return [id];
  }
}

export const PAYOUT_BLOCK_REASONS = Object.freeze({
  WALLET_BANNED: "wallet_banned",
  ACCOUNT_BANNED: "account_banned",
  BLOCKLIST_UNAVAILABLE: "blocklist_unavailable",
  // A wallet-rooted account with no social identity synced to it. NOT a ban and
  // must never be treated as one: it is a step the person has not taken yet,
  // and it resolves the moment they take it. See NEEDS_IDENTITY_SYNC below.
  NEEDS_IDENTITY_SYNC: "needs_identity_sync",
});

/**
 * Snapshot both ban lists once, for a batch that will test many rows.
 *
 * Returns `{ ok: false }` rather than an empty blocklist when the stores cannot
 * be read. An empty set is indistinguishable from "nobody is banned", and a
 * caller that treated the two the same would pay everyone during exactly the
 * failure this is meant to catch. That is not hypothetical here: the ban list
 * was silently emptied once already (2026-08-15, see src/faucet/storage.js's
 * hasRecords note), and every consumer carried on as if the list were simply
 * clean.
 */
export function loadPayoutBlocklist() {
  try {
    // listBans()/listUserBans() include review-only records. Those are recorded
    // for observation and explicitly DO NOT refuse anything — see walletBans.js
    // line 109. Filtering them here keeps "review-only" meaning the same thing
    // on the payout path as it does on the claim path.
    const wallets = new Set(
      (listBans() || []).filter((b) => b && !b.reviewOnly).map((b) => String(b.wallet || "").trim()).filter(Boolean)
    );
    const users = new Set(
      (listUserBans() || []).filter((b) => b && !b.reviewOnly).map((b) => String(b.userId || b.user || "").trim()).filter(Boolean)
    );
    return { ok: true, wallets, users, loadedAt: new Date().toISOString() };
  } catch (error) {
    return { ok: false, error: error?.message || String(error), wallets: null, users: null };
  }
}

/**
 * Sync predicate for a preloaded blocklist. Returns a block reason, or null to
 * allow.
 *
 * Kept synchronous so pure planners (src/games/payoutPlanner.js) can call it
 * inline without becoming async and losing their testability.
 */
export function checkAgainstBlocklist({ wallet, discordUserId } = {}, blocklist) {
  if (!blocklist || blocklist.ok !== true) return PAYOUT_BLOCK_REASONS.BLOCKLIST_UNAVAILABLE;
  const w = String(wallet || "").trim();
  const u = String(discordUserId || "").trim();
  // A BAN FOLLOWS THE PERSON THROUGH A MERGE (2026-08-22). Bans are keyed by
  // account id, and one person can now hold several — so a ban recorded against
  // the account they came in through last month would be invisible to a payout
  // planned against the account that survived a merge. Merging must never be a
  // way to shed a ban: every door is checked, and any one of them being banned
  // refuses the payment.
  if (u && accountIdsOf(u).some((id) => blocklist.users.has(id))) return PAYOUT_BLOCK_REASONS.ACCOUNT_BANNED;
  if (w && blocklist.wallets.has(w)) return PAYOUT_BLOCK_REASONS.WALLET_BANNED;
  return null;
}

/**
 * Ban check AND identity check, in the order a human needs them reported.
 *
 * Kept SEPARATE from checkAgainstBlocklist() rather than folded into it. That
 * function is named for the blocklist and its callers ask it exactly one
 * question — "is this pair banned?" — and quietly widening it to also mean "…
 * and fully set up" broke a test that was right to break: a clean pair IS clean
 * as far as the blocklist is concerned.
 *
 * Bans are tested first on purpose. A banned wallet that also has no identity
 * synced must be reported as BANNED, because the two demand opposite responses:
 * one is a person to refuse, the other is a person to help finish signing up.
 *
 * THE IDENTITY RULE. The wallet is the account and connecting is free; being
 * PAID is what needs a person behind it. A wallet costs nothing to generate so
 * it can never be evidence of one; a Discord or X account not already attached
 * to another WinLEW account can be. Accounts keyed by a Discord snowflake pass
 * with no record — the id is itself the proof, and every account predating this
 * rule is keyed that way.
 *
 * NEEDS_IDENTITY_SYNC IS NOT A BAN. Callers must hold and retry, never withhold
 * permanently: it is a step not yet taken, and it clears the moment they sync.
 */
export function checkPayoutEligibility({ wallet, discordUserId } = {}, blocklist) {
  const banned = checkAgainstBlocklist({ wallet, discordUserId }, blocklist);
  if (banned) return banned;
  const u = String(discordUserId || "").trim();
  if (u && !canBePaid(u)) return PAYOUT_BLOCK_REASONS.NEEDS_IDENTITY_SYNC;
  return null;
}

/**
 * One-off check that reads the stores directly. For single payments where the
 * per-call cost does not matter; batches should use loadPayoutBlocklist() once
 * and then checkAgainstBlocklist() per row.
 */
export function checkPayoutAllowed({ wallet, discordUserId } = {}) {
  try {
    const u = String(discordUserId || "").trim();
    // Every account behind this person — see checkAgainstBlocklist() above.
    if (u && accountIdsOf(u).some((id) => isUserBanned(id))) {
      return { allowed: false, reason: PAYOUT_BLOCK_REASONS.ACCOUNT_BANNED };
    }
    const w = String(wallet || "").trim();
    if (w && isDirectlyBanned(w)) return { allowed: false, reason: PAYOUT_BLOCK_REASONS.WALLET_BANNED };
    // Same identity requirement as the batch path — one rule, both doors.
    if (u && !canBePaid(u)) return { allowed: false, reason: PAYOUT_BLOCK_REASONS.NEEDS_IDENTITY_SYNC };
    // (checkPayoutAllowed is the single-payment entry point and is expected to
    //  answer the whole question, unlike checkAgainstBlocklist above.)
    return { allowed: true, reason: null };
  } catch (error) {
    // Same fail-closed reasoning as above: an unreadable list must not read as
    // an empty one.
    return { allowed: false, reason: PAYOUT_BLOCK_REASONS.BLOCKLIST_UNAVAILABLE, error: error?.message || String(error) };
  }
}

/** Human-readable line for a hold record or a moderator log. */
export function describePayoutBlock(reason) {
  switch (reason) {
    case PAYOUT_BLOCK_REASONS.WALLET_BANNED:
      return "payout wallet is on the faucet ban list";
    case PAYOUT_BLOCK_REASONS.ACCOUNT_BANNED:
      return "Discord account is banned";
    case PAYOUT_BLOCK_REASONS.NEEDS_IDENTITY_SYNC:
      return "account has no Discord or X identity synced — nothing is wrong, they just have not synced yet";
    case PAYOUT_BLOCK_REASONS.BLOCKLIST_UNAVAILABLE:
      return "the ban list could not be read — funds held rather than released unchecked";
    default:
      return "payout blocked";
  }
}
