// Joining two accounts into one user.
//
// WHEN THIS RUNS. Somebody proves two doors belong to them:
//
//   * they are signed in on account A and complete an OAuth flow for a Discord
//     or X identity that already roots account B (the old "ALREADY LINKED"
//     dead end), or
//   * they are signed in on a proven account A and sign a wallet that is
//     already verified on account B — the signature is the proof, and a private
//     key is not something one person hands another.
//
// WHY MERGING IS SAFE FOR THE ANTI-SYBIL RULE. A merge never mints an identity;
// it removes one. Two accounts that could each claim once become one account
// that claims once. The direction the rules care about is the other one —
// SPLITTING — and nothing here does that.
//
// WHAT IT IS NOT. It is not a way to reach an account you cannot authenticate.
// Every caller must have proved BOTH sides at the moment it calls: a live
// session for one, and a fresh signature or OAuth round trip for the other.
// This module deliberately takes no view on that — it cannot tell a real proof
// from a forged claim, so the route that owns the proof is the route that must
// check it.
//
// ORDER MATTERS, AND IT IS: alias first, data second. The alias is what every
// read resolves through, so a crash after step one leaves a user who is
// correctly one person with their records still in two places — which
// readUserRecord() and listLinkedProfiles() already assemble on the fly. A
// crash the other way round would leave two accounts each holding everything,
// and one of those lists pays money.

import { linkAccounts, resolveAccountId, listAccountIdsForUser } from "./userAccounts.js";
import { applyRecordMerge, getPayoutWallet, getLinkedWalletRecord, listVerifiedWallets } from "./walletLink.js";
import { reassignSyncedIdentities, listSyncedIdentities } from "./syncedIdentities.js";
import { getProfilePrefsByUser, saveProfilePrefs } from "./profilePrefs.js";
import { getRewardSummary } from "./rewardHistory.js";
import { readJson, writeJson, getStorageSyncHealth } from "./storage.js";
import crypto from "node:crypto";

const MERGE_AUDIT_FILE = "account_merge_audit.json";
const MERGE_ALIAS_FILE = "account_merges.json";

function auditMerge(entry) {
  const rows = readJson(MERGE_AUDIT_FILE, {});
  const eventId = crypto.randomUUID();
  rows[eventId] = { eventId, at: new Date().toISOString(), ...entry };
  writeJson(MERGE_AUDIT_FILE, rows);
  return eventId;
}

/**
 * Best-effort visibility only — never awaited, never blocks a merge or a
 * conflict response. `writeJson` is fire-and-forget to Mongo by design
 * (storage.js), so a merge call site cannot synchronously know whether its
 * own write landed; this just surfaces what storage.js already knows about
 * the two stores a merge touches, for logging/response metadata.
 */
function degradedPersistInfo() {
  const degraded = getStorageSyncHealth().filter(
    (entry) => entry.name === MERGE_AUDIT_FILE || entry.name === MERGE_ALIAS_FILE,
  );
  return degraded.length ? degraded : null;
}

/**
 * Join two accounts. Idempotent: merging accounts that are already one person
 * reports `changed: false` and touches nothing.
 *
 * Returns a summary the caller can log and show — which account survived, which
 * was absorbed, how many wallets the person now holds, and which single wallet
 * gets paid.
 */
export function mergeAccounts({ a, b, reason = "proved-both" }) {
  const left = String(a || "").trim();
  const right = String(b || "").trim();
  if (!left || !right) throw new Error("account_id_required");

  const before = resolveAccountId(left) === resolveAccountId(right);
  const { userId, absorbed, changed } = linkAccounts(left, right);
  if (!changed || before) {
    return { userId, absorbed: null, changed: false, reason, wallets: walletSummary(userId) };
  }

  // Best effort from here on. The alias is written and that is what makes the
  // person whole; a failure to tidy the stores must not throw back into an
  // OAuth callback and leave them staring at an error page after a merge that
  // in fact succeeded.
  let identitiesMoved = 0;
  try {
    identitiesMoved = reassignSyncedIdentities({ from: absorbed, to: userId });
  } catch (error) {
    console.warn("[account-merge] identity reassign failed:", error?.message || error);
  }

  try {
    applyRecordMerge({ userId, absorbedId: absorbed });
  } catch (error) {
    console.warn("[account-merge] wallet record fold failed:", error?.message || error);
  }

  try {
    mergeProfilePrefs({ userId, absorbedId: absorbed });
  } catch (error) {
    console.warn("[account-merge] profile prefs merge failed:", error?.message || error);
  }

  const result = {
    userId,
    absorbed,
    changed: true,
    reason,
    identitiesMoved,
    identities: listSyncedIdentities(userId).map((entry) => entry.provider),
    wallets: walletSummary(userId),
  };
  result.auditEventId = auditMerge({
    status: "merged", reason, userId, absorbed,
    identitiesMoved, walletCount: result.wallets.verifiedCount,
  });
  const degraded = degradedPersistInfo();
  if (degraded) {
    result.degradedPersist = degraded;
    console.error("[account-merge] merge recorded locally but not yet confirmed in Mongo:", degraded);
  }
  return result;
}

/**
 * Merge only when doing so cannot silently combine two independently active
 * reward accounts. Proof of both identities establishes ownership, but it does
 * not establish that two existing ledgers contain no duplicates. Those cases
 * are preserved for deterministic/admin reconciliation instead.
 */
export async function mergeAccountsWithRewardGuard({ a, b, reason = "proved-both" }) {
  const left = resolveAccountId(String(a || "").trim());
  const right = resolveAccountId(String(b || "").trim());
  if (!left || !right) throw new Error("account_id_required");
  if (left === right) return mergeAccounts({ a: left, b: right, reason });

  const [leftRewards, rightRewards] = await Promise.all([
    getRewardSummary(left),
    getRewardSummary(right),
  ]);
  if (leftRewards.totalClaims > 0 && rightRewards.totalClaims > 0) {
    const auditEventId = auditMerge({
      status: "conflict", reason, left, right,
      leftClaims: leftRewards.totalClaims,
      rightClaims: rightRewards.totalClaims,
      leftTotal: leftRewards.totalPayout,
      rightTotal: rightRewards.totalPayout,
    });
    const error = new Error("account_merge_review_required");
    error.code = "account_merge_review_required";
    error.auditEventId = auditEventId;
    const degraded = degradedPersistInfo();
    if (degraded) {
      error.degradedPersist = degraded;
      console.error("[account-merge] conflict recorded locally but not yet confirmed in Mongo:", degraded);
    }
    throw error;
  }
  return mergeAccounts({ a: left, b: right, reason });
}

/** Wallets and the single payout address, after the merge. */
function walletSummary(userId) {
  const record = getLinkedWalletRecord(userId);
  const verified = listVerifiedWallets(record).map((entry) => entry.wallet);
  return {
    verified,
    verifiedCount: verified.length,
    known: Array.isArray(record?.wallet_history) ? record.wallet_history : [],
    payoutWallet: getPayoutWallet(record),
  };
}

/**
 * Fill the survivor's blanks from the absorbed profile.
 *
 * ADDITIVE ONLY. A merge must never overwrite the name, bio or avatar somebody
 * is actually using — the absorbed account's values are used only where the
 * survivor has nothing, so the worst case is that a merge changes nothing
 * visible.
 *
 * `publicIdentity` is deliberately NOT inherited when the survivor has made a
 * choice, and stays off when neither has: it is a consent flag, and consent
 * given on one account is not consent for the merged one.
 */
export function mergeProfilePrefs({ userId, absorbedId }) {
  const survivor = String(userId || "").trim();
  const absorbed = String(absorbedId || "").trim();
  if (!survivor || !absorbed || survivor === absorbed) return null;

  const from = getProfilePrefsByUser(absorbed);
  if (!from) return null;
  const to = getProfilePrefsByUser(survivor) || {};

  const patch = { discordUserId: survivor };
  if (!String(to.displayName || "").trim() && String(from.displayName || "").trim()) patch.displayName = from.displayName;
  if (!String(to.bio || "").trim() && String(from.bio || "").trim()) patch.bio = from.bio;
  if (!String(to.avatarUrl || "").trim() && String(from.avatarUrl || "").trim()) patch.avatarUrl = from.avatarUrl;
  if (!String(to.wallet || "").trim() && String(from.wallet || "").trim()) patch.wallet = from.wallet;

  if (Object.keys(patch).length === 1) return null;
  return saveProfilePrefs(patch);
}

/** Every account id behind one user — for admin tooling and the profile page. */
export function accountsForUser(accountId) {
  return listAccountIdsForUser(accountId);
}
