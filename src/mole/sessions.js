import { nanoid } from 'nanoid';
import { readJson, writeJson } from './storage.js';
import { resolveAccountId } from './userAccounts.js';

const SESSION_FILE = 'sessions.json';

function db() { return readJson(SESSION_FILE, {}); }
function save(d) { writeJson(SESSION_FILE, d); }

export function createSession(discordUserId, ttlSec = 15 * 60) {
  const d = db();
  const token = nanoid(32);
  const now = Math.floor(Date.now()/1000);
  const ttl = Number.isFinite(Number(ttlSec)) && Number(ttlSec) > 0 ? Math.floor(Number(ttlSec)) : 15 * 60;
  d[token] = { discordUserId: String(discordUserId), created_at: now, expires_at: now + ttl };
  save(d);
  return token;
}

/**
 * The live session, with its account resolved to the USER (2026-08-22).
 *
 * THE SINGLE LEVER. Dozens of routes read `s.discordUserId` and hand it to a
 * store; resolving it HERE means every one of them speaks about the person
 * rather than the door — a session minted before someone merged their Discord
 * and X logins keeps working and lands on the merged account, instead of
 * showing them an empty half of their own profile until it expires.
 *
 * `sessionAccountId` keeps the id the token was actually issued for, because a
 * revoke or an audit line should name the door that was used.
 *
 * Non-account payloads pass through untouched: OAuth state is stashed in this
 * same field (see encodeSyncState in web.js), and the merge map only ever holds
 * real account ids, so a state blob resolves to itself.
 */
export function getSession(token) {
  const d = db();
  const rec = d[String(token)];
  if (!rec) return null;
  if (rec.expires_at < Math.floor(Date.now()/1000)) return null;
  const sessionAccountId = String(rec.discordUserId || '');
  const resolved = resolveAccountId(sessionAccountId);
  if (resolved === sessionAccountId) return { ...rec, sessionAccountId };
  return { ...rec, discordUserId: resolved, sessionAccountId };
}

/**
 * Hard-revokes a session token (2026-07-31, for the idle auto-disconnect).
 * Clearing localStorage alone only hides the token from the UI — it stays
 * valid here until its TTL, so anyone who already copied it could keep
 * using it. Deleting the record is what actually ends the session.
 *
 * Returns true only when a live session was removed, so a caller can't use
 * this to probe which tokens exist: an unknown token and an already-expired
 * one are indistinguishable from the outside.
 */
export function revokeSession(token) {
  const key = String(token || '');
  if (!key) return false;
  const d = db();
  const existed = Object.prototype.hasOwnProperty.call(d, key);
  if (!existed) return false;
  delete d[key];
  save(d);
  return true;
}
