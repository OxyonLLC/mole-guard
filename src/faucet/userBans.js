// Discord account bans.
//
// Built 2026-08-15, after seven wallets belonging to one operator were banned in
// a single evening. Banning wallets is necessary and insufficient: a wallet
// costs nothing to make, so the eighth was always going to arrive. The account
// is the more expensive identity — it carries the roles, the quiz points, the
// standing and whatever social cost the person is unwilling to pay again.
//
// Deliberately much simpler than walletBans.js. There is NO cluster walk here
// and there must never be one: Discord gives us no funding graph, and inventing
// a link between accounts from anything we do have (shared IP, shared device,
// timing) would be a guess dressed as evidence. Those signals already exist in
// the participation trust layer, where they are scored, weighted and reviewable.
// This file does exactly one thing: an exact-match list a human wrote.
//
// Same two-tier design as the wallet list — `reviewOnly` records a suspicion
// without refusing anyone, so a mod can say "watching this" and have it survive
// being forgotten about. And the same lesson as the wallet list: a ban that
// evaporates un-bans someone silently, so this file is Mongo-managed with a
// `records` accessor (see storage.js) rather than trusting a wrapper key.

import { loadManagedJson, writeManagedJson, refreshManagedJson } from './storage.js';
import { listAccountIdsForUser } from '../mole/userAccounts.js';

const USER_BANS_FILE = 'user_bans.json';

function emptyDb() {
  return { version: 1, bans: {} };
}

function db() {
  const raw = loadManagedJson(USER_BANS_FILE, emptyDb());
  if (!raw || typeof raw !== 'object' || !raw.bans) return emptyDb();
  return raw;
}

function save(d) {
  writeManagedJson(USER_BANS_FILE, d);
}

/**
 * Discord snowflakes are numeric strings, and people paste them as `<@1234>`,
 * `<@!1234>` or with stray whitespace. Normalising here rather than at each
 * call site means a ban entered as a mention and a check made against a raw id
 * are the same key — otherwise a ban silently matches nothing, which looks
 * exactly like no ban at all.
 */
export function normalizeUserId(input) {
  const raw = String(input || '').trim().replace(/^<@!?/, '').replace(/>$/, '');
  if (!/^\d{5,32}$/.test(raw)) throw new Error(`not_a_discord_user_id:${raw.slice(0, 24)}`);
  return raw;
}

export function banUser(userId, { reason = '', bannedBy = '', reviewOnly = false } = {}) {
  const id = normalizeUserId(userId);
  const d = db();
  const existing = d.bans[id];
  d.bans[id] = {
    userId: id,
    reason: String(reason || '').slice(0, 500),
    bannedBy: String(bannedBy || '').slice(0, 120),
    reviewOnly: Boolean(reviewOnly),
    // Re-banning keeps the original timestamp: when this started is evidence,
    // and overwriting it would quietly erase how long someone has been at it.
    bannedAt: existing?.bannedAt || Date.now(),
    updatedAt: Date.now(),
  };
  save(d);
  return d.bans[id];
}

export function unbanUser(userId) {
  const id = normalizeUserId(userId);
  const d = db();
  if (!d.bans[id]) return null;
  const removed = d.bans[id];
  delete d.bans[id];
  save(d);
  return removed;
}

export function getUserBan(userId) {
  let id;
  try { id = normalizeUserId(userId); } catch { return null; }
  return db().bans[id] || null;
}

export function listUserBans() {
  return Object.values(db().bans).sort((a, b) => Number(b.bannedAt || 0) - Number(a.bannedAt || 0));
}

/**
 * Every account id this person holds — one per door they signed in through.
 *
 * A BAN MUST NOT BE SHEDDABLE BY MERGING (2026-08-22). Bans are keyed by
 * Discord snowflake, and a person can now hold two accounts joined into one
 * user. If only the surviving id were checked, someone with a banned account
 * and a clean one could merge them and walk away clean. Any door being banned
 * bans the person.
 *
 * Falls back to the id alone when the merge map cannot be read: a ban check
 * that throws is a ban check that did not happen.
 */
function doorsOf(userId) {
  const raw = String(userId || '').trim();
  if (!raw) return [];
  try {
    const ids = listAccountIdsForUser(raw);
    return ids.length ? ids : [raw];
  } catch {
    return [raw];
  }
}

/** The enforcing ban on any of this person's accounts, or null. `reviewOnly`
 *  records are notes to a human, not refusals, so they never match here. */
function enforcingBanFor(userId) {
  for (const id of doorsOf(userId)) {
    const ban = getUserBan(id);
    if (ban && !ban.reviewOnly) return ban;
  }
  return null;
}

/** Enforcing only. A `reviewOnly` record is a note to a human, not a refusal. */
export function isUserBanned(userId) {
  return Boolean(enforcingBanFor(userId));
}

/**
 * The check the claim path calls.
 *
 * Refreshes from Mongo first, throttled, for the same reason the wallet list
 * does: bans are set from Discord and enforced from BOTH the bot and the
 * website, each of which caches this file at boot. Without a refresh, a ban
 * issued in Discord would not reach web claims until the web process happened
 * to restart — and a ban that only half-applies is worse than none, because
 * whoever set it stops watching.
 *
 * Never throws. An unreadable ban list must not refuse everybody.
 */
export async function checkUserBan(userId) {
  try {
    await refreshManagedJson(USER_BANS_FILE).catch(() => {});
    const enforcing = enforcingBanFor(userId);
    if (enforcing) return { banned: true, ban: enforcing };
    return { banned: false, ban: getUserBan(userId) || null };
  } catch {
    return { banned: false, ban: null };
  }
}

export const __testing = { USER_BANS_FILE, emptyDb };
