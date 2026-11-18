// Sync your account — social identities attached to a WinLEW account.
//
// THE MODEL, in the owner's words: "not everyone has discord and not everyone
// has X ... Key Word, LINKS. links to an existing account, What? A Wallet."
//
// So the WALLET is the account. Connecting one costs nothing and gates nothing:
// you can play the moment you arrive. What a social identity buys is the right
// to be PAID, and the reason is arithmetic rather than policy — a wallet is
// free to generate, so a wallet alone can never be evidence of a person. A
// Discord or X account that is not already attached to another WinLEW account
// is. That is the whole anti-sybil argument, and it puts the one cost exactly
// where the money is instead of at the front door.
//
// This deliberately replaces the "sign in with Discord before you may connect"
// gate, which made the community's own platform a wall — and which the owner
// rejected in exactly those terms: "feels like to many hurdles."
//
// UNIQUENESS IS THE SHAPE, NOT A CHECK. The store is
//
//   { "discord:<id>": "<accountId>", "x:<id>": "<accountId>" }
//
// one provider identity per key, one account per key. Two accounts cannot claim
// the same Discord login because the map cannot hold that, rather than because
// a validation function remembered to look.
//
// WHEN SOMEONE TRIES ANYWAY, syncIdentity() still refuses and still names the
// account it already belongs to — but that refusal is no longer the end of the
// road. The caller (the OAuth callbacks in web.js) treats it as the signal to
// MERGE: somebody who just authenticated this identity AND holds a session for
// the other account is one person with two doors, not two people. See
// userAccounts.js for the USER layer and accountMerge.js for what a merge
// actually moves.

import { readJson, writeJson } from "./storage.js";
import { resolveAccountId, listAccountIdsForUser } from "./userAccounts.js";

const FILE = "synced_identities.json";

/** The providers a person may sync. Equal by decision: either one, on its own,
 *  unlocks payouts. Discord stays the community's home; it stopped being the
 *  only door. */
export const IDENTITY_PROVIDERS = Object.freeze({ DISCORD: "discord", X: "x" });

const VALID_PROVIDERS = new Set(Object.values(IDENTITY_PROVIDERS));

/** A Discord snowflake — the id shape used as an account key since long before
 *  wallet-rooted accounts existed. */
function isDiscordSnowflake(value) {
  return /^\d{5,25}$/.test(String(value || "").trim());
}

export function identityKey(provider, providerUserId) {
  const p = String(provider || "").trim().toLowerCase();
  const id = String(providerUserId || "").trim();
  if (!VALID_PROVIDERS.has(p)) throw new Error(`unknown_identity_provider:${p}`);
  if (!id) throw new Error("provider_user_id_required");
  if (id.includes(":")) throw new Error("provider_user_id_invalid");
  return `${p}:${id}`;
}

/** The store, or an empty map if it cannot be read.
 *
 *  A read failure must never throw INTO the payout path. canBePaid() is called
 *  from src/services/payoutGate.js while a batch is being planned, and an
 *  exception there takes down the run rather than refusing one row.
 *
 *  Empty is the FAIL-CLOSED answer here, and only because of the order
 *  canBePaid() checks things in: a Discord-keyed account is judged by its id
 *  before this store is ever consulted, so an outage cannot lock out an existing
 *  participant. A wallet-rooted account simply stays unpayable until the store
 *  is readable again — held, not withheld, so it clears by itself. */
/** The account id from a stored value. Entries written before handles existed
 *  are a bare string; newer ones are { account, handle }. Both stay valid, so
 *  no migration step can fail halfway and strand somebody's identity. */
function ownerOf(value) {
  if (typeof value === "string") return value || null;
  if (value && typeof value === "object" && typeof value.account === "string") return value.account || null;
  return null;
}

function handleOf(value) {
  if (value && typeof value === "object" && typeof value.handle === "string") return value.handle || null;
  return null;
}

function db() {
  try {
    const raw = readJson(FILE, {});
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch (error) {
    console.warn("[synced-identities] store unreadable, treating as empty:", error?.message || error);
    return {};
  }
}

/** Which account owns this social identity, or null.
 *
 *  Resolved through the merge map, so an identity attached to an account that
 *  has since been absorbed answers with the USER's surviving account rather
 *  than a dead one. Without that, signing in with X after a merge would land
 *  the person back on the empty half of their own account. */
export function accountForIdentity(provider, providerUserId) {
  const owner = ownerOf(db()[identityKey(provider, providerUserId)]);
  return owner ? resolveAccountId(owner) : null;
}

/** Every identity synced to an account, newest field order irrelevant.
 *
 *  ANSWERS FOR THE USER, NOT THE DOOR. Both sides of a merge are included, so
 *  the profile page lists the Discord AND the X login of somebody who joined
 *  two accounts, and canBePaid() below stays true through a merge instead of
 *  briefly reporting that a proven person proved nothing. */
export function listSyncedIdentities(accountId) {
  const id = String(accountId || "").trim();
  if (!id) return [];
  const mine = new Set(listAccountIdsForUser(id));
  return Object.entries(db())
    .filter(([, value]) => {
      const owner = ownerOf(value);
      return !!owner && mine.has(owner);
    })
    .map(([key, value]) => {
      const [provider, ...rest] = key.split(":");
      return { provider, providerUserId: rest.join(":"), key, handle: handleOf(value) };
    });
}

/**
 * The Discord snowflake behind an account id, or null.
 *
 * The other half of the model this file describes. `canBePaid()` answers "is
 * there a person behind this account"; this answers "which Discord person",
 * which is what every store keyed by a snowflake actually needs.
 *
 * A SNOWFLAKE IS ITS OWN ANSWER, for the same reason it is in canBePaid():
 * accounts that predate wallet-rooted ids ARE their Discord id, and no record
 * exists in this store for them.
 *
 * Returns null for a wallet- or X-rooted account with no Discord synced. That
 * is a real state, not an error — the caller's job is to say "attach Discord",
 * not "you never registered".
 */
export function discordUserIdForAccount(accountId) {
  const id = String(accountId || "").trim();
  if (!id) return null;
  // A merged user can hold a Discord snowflake on either side of the merge —
  // the surviving account is usually the snowflake (accountRank prefers it),
  // but an absorbed one still answers here, because stores written under that
  // id before the merge are still keyed by it.
  const snowflake = listAccountIdsForUser(id).find((entry) => isDiscordSnowflake(entry));
  if (snowflake) return snowflake;
  const hit = listSyncedIdentities(id)
    .find((entry) => entry.provider === IDENTITY_PROVIDERS.DISCORD);
  return hit?.providerUserId || null;
}

/**
 * May this account be paid?
 *
 * True when at least one social identity is synced to it.
 *
 * A NUMERIC DISCORD ID COUNTS ON ITS OWN, with no record in this store. Every
 * account that existed before this file was written is keyed by its Discord
 * snowflake — the id IS the proof, and requiring them to re-sync something they
 * already proved would lock out every current participant on the day this
 * shipped. New wallet-rooted accounts have no such implicit proof, which is
 * precisely why they need an explicit one.
 */
export function canBePaid(accountId) {
  const id = String(accountId || "").trim();
  if (!id) return false;
  if (listAccountIdsForUser(id).some((entry) => isDiscordSnowflake(entry))) return true;
  return listSyncedIdentities(id).length > 0;
}

/**
 * Attach a social identity to an account.
 *
 * Refuses when that identity already belongs to a DIFFERENT account, and says
 * which — the owner's choice, so somebody who forgot an old account can go and
 * find it instead of hitting an unexplained wall.
 *
 * Re-syncing to the same account is a no-op success, so a user who clicks twice,
 * or an OAuth callback that arrives twice, does not get an error for doing
 * nothing wrong.
 */
export function syncIdentity({ accountId, provider, providerUserId, handle = null }) {
  const requested = String(accountId || "").trim();
  if (!requested) throw new Error("account_id_required");
  // Always write to the SURVIVING account. Syncing to an absorbed id would
  // attach the identity to a door nobody can open any more.
  const account = resolveAccountId(requested);
  const key = identityKey(provider, providerUserId);

  const all = db();
  const stored = ownerOf(all[key]);
  const current = stored ? resolveAccountId(stored) : null;
  if (current && current !== account) {
    const error = new Error("identity_already_synced");
    error.code = "identity_already_synced";
    error.linkedTo = current;
    throw error;
  }
  const cleanHandle = String(handle || "").trim().replace(/^@/, "").slice(0, 40) || null;
  if (current === account) {
    // Already ours. Refresh the stored handle if the provider now reports a
    // different one — people rename themselves — but report no change, so a
    // double click or a repeated OAuth callback is not an error.
    if (cleanHandle && handleOf(all[key]) !== cleanHandle) {
      all[key] = { account, handle: cleanHandle };
      writeJson(FILE, all);
    }
    return { ok: true, key, accountId: account, changed: false };
  }

  // STORING A HANDLE IS NOT PUBLISHING ONE. It is kept so a display surface has
  // something to render IF the person opts in; publicIdentityFor() in web.js is
  // the only thing that decides whether it is ever shown.
  all[key] = cleanHandle ? { account, handle: cleanHandle } : account;
  writeJson(FILE, all);
  return { ok: true, key, accountId: account, changed: true };
}

/**
 * Move every identity from one account to another. Used only by a merge.
 *
 * A TIDY-UP, NOT THE MECHANISM. accountForIdentity() already resolves a stored
 * account through the merge map, so the identities keep answering correctly
 * even if this never runs. Rewriting them means the store reads the way the
 * model reads — one person's logins filed under one account — instead of
 * needing the alias map to make sense of it.
 */
export function reassignSyncedIdentities({ from, to }) {
  const fromId = String(from || "").trim();
  const toId = String(to || "").trim();
  if (!fromId || !toId || fromId === toId) return 0;
  const all = db();
  let moved = 0;
  for (const [key, value] of Object.entries(all)) {
    if (ownerOf(value) !== fromId) continue;
    const handle = handleOf(value);
    all[key] = handle ? { account: toId, handle } : toId;
    moved += 1;
  }
  if (moved) writeJson(FILE, all);
  return moved;
}

/**
 * Detach an identity.
 *
 * REFUSES TO LEAVE AN ACCOUNT UNPAYABLE. Removing the last synced identity from
 * a wallet-rooted account would silently strip its right to be paid, which is
 * not something a person should be able to do to themselves by accident — and
 * is a tidy way for someone to launder an identity onto a second account. Sync
 * the replacement first.
 */
export function unsyncIdentity({ accountId, provider, providerUserId }) {
  const account = resolveAccountId(String(accountId || "").trim());
  const key = identityKey(provider, providerUserId);
  const all = db();
  const storedOwner = ownerOf(all[key]);
  if (!storedOwner || resolveAccountId(storedOwner) !== account) {
    const error = new Error("identity_not_synced_to_account");
    error.code = "identity_not_synced_to_account";
    throw error;
  }
  const remaining = listSyncedIdentities(account).filter((entry) => entry.key !== key);
  const hasSnowflakeDoor = listAccountIdsForUser(account).some((entry) => isDiscordSnowflake(entry));
  if (!remaining.length && !hasSnowflakeDoor) {
    const error = new Error("last_identity_cannot_be_removed");
    error.code = "last_identity_cannot_be_removed";
    throw error;
  }
  delete all[key];
  writeJson(FILE, all);
  return { ok: true, key, removed: true };
}
