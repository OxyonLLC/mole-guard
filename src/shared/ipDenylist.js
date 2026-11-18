import { loadManagedJson, refreshManagedJson, writeManagedJson } from '../faucet/storage.js';
import { isIpLiteral, normalizeIp } from '../mole/clientIp.js';

const BANS_FILE = 'ip_bans.json';
const REFRESH_MAX_AGE_MS = 10_000;
const MAX_REASON_LEN = 500;
const MAX_BANNED_BY_LEN = 120;

let lastRefreshAt = 0;

/**
 * Escalation, per the owner's policy (2026-08-16):
 *   1st offence  6 months
 *   2nd offence  permanent
 *
 * Both are appealable — every refusal carries the contact route, because an
 * automatic ban from a heuristic will eventually catch someone real. A shared
 * office, a phone on the same NAT as a laptop, a café.
 */
export const IP_OFFENCE_FIRST_BAN_MS = 182 * 24 * 60 * 60 * 1000; // ~6 months
export const IP_OFFENCE_PERMANENT_AT_STRIKE = 2;

function emptyDb() {
  return { version: 1, bans: {}, strikes: {} };
}

function db() {
  const raw = loadManagedJson(BANS_FILE, emptyDb());
  if (!raw || typeof raw !== 'object' || !raw.bans || typeof raw.bans !== 'object') return emptyDb();
  // `strikes` was added after `bans`; a file written before that has none.
  if (!raw.strikes || typeof raw.strikes !== 'object') raw.strikes = {};
  return raw;
}

function save(next) {
  writeManagedJson(BANS_FILE, next);
}

export function normalizeIpBanTarget(input) {
  const value = normalizeIp(input);
  if (!isIpLiteral(value)) throw new Error(`not_an_ip_address:${String(input || '').trim().slice(0, 64)}`);
  return value;
}

export function parseIpBanTtl(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return null;
  const match = /^(\d+)([smhdw])$/.exec(raw);
  if (!match) throw new Error(`invalid_ttl:${raw.slice(0, 32)}`);
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`invalid_ttl:${raw.slice(0, 32)}`);

  const unitMs = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  }[match[2]];

  return amount * unitMs;
}

function isExpired(entry, now = Date.now()) {
  return Number(entry?.expiresAt || 0) > 0 && Number(entry.expiresAt) <= now;
}

function purgeExpired(state, now = Date.now()) {
  let changed = false;
  for (const [ip, entry] of Object.entries(state?.bans || {})) {
    if (!isExpired(entry, now)) continue;
    delete state.bans[ip];
    changed = true;
  }
  return changed;
}

function activeBanRecord(input, now = Date.now()) {
  let ip;
  try {
    ip = normalizeIpBanTarget(input);
  } catch {
    return null;
  }
  const entry = db().bans[ip];
  if (!entry || isExpired(entry, now)) return null;
  return entry;
}

export function addIpBan(ip, { reason = '', bannedBy = '', ttlMs = null } = {}) {
  const address = normalizeIpBanTarget(ip);
  const now = Date.now();
  const state = db();
  purgeExpired(state, now);

  const existing = state.bans[address];
  state.bans[address] = {
    ip: address,
    reason: String(reason || '').slice(0, MAX_REASON_LEN),
    bannedBy: String(bannedBy || '').slice(0, MAX_BANNED_BY_LEN),
    bannedAt: existing?.bannedAt || now,
    updatedAt: now,
    expiresAt: Number(ttlMs) > 0 ? now + Number(ttlMs) : null,
  };
  save(state);
  return state.bans[address];
}

export function removeIpBan(ip) {
  const address = normalizeIpBanTarget(ip);
  const state = db();
  purgeExpired(state);
  if (!state.bans[address]) return false;
  delete state.bans[address];
  save(state);
  return true;
}

export function listIpBans() {
  const now = Date.now();
  const state = db();
  const changed = purgeExpired(state, now);
  if (changed) save(state);
  return Object.values(state.bans).sort((a, b) => Number(b.bannedAt || 0) - Number(a.bannedAt || 0));
}

export function getIpBan(ip) {
  return activeBanRecord(ip);
}

/**
 * Offence history for one IP. NEVER purged.
 *
 * This has to live outside `bans` because purgeExpired() DELETES a ban record
 * the moment it expires. If the strike count lived on the ban, a six-month ban
 * lapsing would erase the evidence that there had ever been a first offence,
 * and the next one would be treated as a first — which is exactly the escalation
 * this is meant to implement, quietly not happening.
 */
export function getIpStrikes(ip) {
  let address;
  try { address = normalizeIpBanTarget(ip); } catch { return null; }
  return db().strikes[address] || null;
}

export function listIpStrikes() {
  return Object.values(db().strikes || {}).sort((a, b) => Number(b.lastAt || 0) - Number(a.lastAt || 0));
}

/**
 * The escalation decision, as a pure function — no I/O, so every branch is
 * directly testable without writing to the real ban store.
 *
 * Extracted after the first version of its test wrote TEST IPs into the
 * tracked src/faucet/ip_bans.json: faucet storage resolves paths next to its
 * own module (storage.js `path.resolve(__dirname, name)`) and honours no
 * data-dir environment variable, so an override in a test is silently inert.
 * Same reasoning as hodlEligibility.js injecting its dependencies and
 * identityAge.js keeping evaluateIdentityAge() pure.
 *
 * @param {{priorCount?: number}} input  strikes already on record for this IP
 * @returns {{strikeCount: number, permanent: boolean, ttlMs: number|null}}
 */
export function decideIpOffence({ priorCount = 0 } = {}) {
  const prior = Number.isFinite(Number(priorCount)) && Number(priorCount) > 0 ? Math.floor(Number(priorCount)) : 0;
  const strikeCount = prior + 1;
  const permanent = strikeCount >= IP_OFFENCE_PERMANENT_AT_STRIKE;
  return { strikeCount, permanent, ttlMs: permanent ? null : IP_OFFENCE_FIRST_BAN_MS };
}

/**
 * Record an offence and apply the escalating ban.
 *
 * Returns `{ strikeCount, permanent, ban }`. The caller does not choose the
 * duration — the policy does — so a new call site cannot accidentally hand out
 * a 24-hour ban for a repeat offender.
 */
export function recordIpOffence(ip, { reason = '', bannedBy = '', now = Date.now() } = {}) {
  const address = normalizeIpBanTarget(ip);
  const state = db();

  const prior = state.strikes[address];
  const { strikeCount, permanent, ttlMs } = decideIpOffence({ priorCount: prior?.count });

  state.strikes[address] = {
    ip: address,
    count: strikeCount,
    firstAt: prior?.firstAt || now,
    lastAt: now,
    // Bounded: keeps the recent record without growing without limit.
    history: [...(prior?.history || []), { at: now, reason: String(reason || '').slice(0, MAX_REASON_LEN) }].slice(-10),
  };
  save(state);

  const ban = addIpBan(address, {
    reason: `${reason}${reason ? ' — ' : ''}offence ${strikeCount}${permanent ? ' (permanent)' : ' (6 months)'}`,
    bannedBy,
    ttlMs,
  });

  return { strikeCount, permanent, ban };
}

export async function refreshIpDenylist({ maxAgeMs = REFRESH_MAX_AGE_MS } = {}) {
  const now = Date.now();
  if (now - lastRefreshAt < maxAgeMs) return false;
  lastRefreshAt = now;
  return refreshManagedJson(BANS_FILE).catch(() => false);
}

export async function checkIpBan(ip, { maxAgeMs = REFRESH_MAX_AGE_MS } = {}) {
  try {
    await refreshIpDenylist({ maxAgeMs });
  } catch {
    return { blocked: false, ban: null };
  }
  const ban = activeBanRecord(ip);
  return ban ? { blocked: true, ban } : { blocked: false, ban: null };
}

export const __testing = {
  BANS_FILE,
  REFRESH_MAX_AGE_MS,
  emptyDb,
  isExpired,
  purgeExpired,
};
