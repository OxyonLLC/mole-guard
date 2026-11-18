import fs from "fs";
import path from "path";
import { getConfig } from "./config.js";
import { resolveAccountId, listAccountIdsForUser } from "./userAccounts.js";

function dataDir() {
  return getConfig().DATA_DIR;
}

function filePath() {
  return path.join(dataDir(), "profile_prefs.json");
}

function ensureDir() {
  fs.mkdirSync(dataDir(), { recursive: true });
}

function readDb() {
  ensureDir();
  const file = filePath();
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) || {};
  } catch {
    return {};
  }
}

function writeDb(db) {
  ensureDir();
  fs.writeFileSync(filePath(), JSON.stringify(db, null, 2));
}

/**
 * The fields a save actually names.
 *
 * OMITTED IS NOT EMPTY (2026-08-22). This used to return "" for every field the
 * caller left out, and those empties were spread over the stored record — so
 * `saveProfilePrefs({ discordUserId, wallet })`, which is exactly what the
 * wallet-login path calls, silently wiped the person's display name, bio and
 * avatar every time they connected. Only fields that were passed are written.
 */
function sanitize(input = {}) {
  const out = { updatedAt: new Date().toISOString() };
  if (input.displayName !== undefined) out.displayName = String(input.displayName || "").trim().slice(0, 60);
  if (input.bio !== undefined) out.bio = String(input.bio || "").trim().slice(0, 280);
  if (input.avatarUrl !== undefined) out.avatarUrl = String(input.avatarUrl || "").trim().slice(0, 500);
  return out;
}

/**
 * One person's profile.
 *
 * Reads at the USER level: after a merge the record may still be filed under
 * the door they came in through last month, and a profile that empties itself
 * because somebody linked their X account is not a profile.
 */
export function getProfilePrefsByUser(discordUserId) {
  const db = readDb();
  for (const id of listAccountIdsForUser(String(discordUserId || "").trim())) {
    const hit = db[String(id)];
    if (hit) return hit;
  }
  return null;
}

export function getProfilePrefsByWallet(wallet) {
  const db = readDb();
  const needle = String(wallet || "").trim();
  if (!needle) return null;
  for (const value of Object.values(db)) {
    if (String(value?.wallet || "").trim() === needle) return value;
  }
  return null;
}

export function saveProfilePrefs({ discordUserId, wallet, displayName, bio, avatarUrl, publicIdentity }) {
  const requested = String(discordUserId || "").trim();
  if (!requested) throw new Error("missing_discord_user");
  const id = String(resolveAccountId(requested));
  const db = readDb();
  const prev = db[id] || getProfilePrefsByUser(id) || {};
  const next = {
    ...prev,
    ...sanitize({ displayName, bio, avatarUrl }),
    discordUserId: id,
    wallet: String(wallet || prev.wallet || "").trim() || null,
  };
  // PUBLIC IDENTITY IS OPT-IN AND DEFAULTS TO OFF (2026-08-21).
  //
  // People synced Discord or X to unlock payouts. That is not consent to
  // appear on a public page, and reusing it as if it were would quietly change
  // the deal they agreed to. Undefined means "leave whatever they chose
  // before" — only an explicit true or false moves it, so an unrelated profile
  // save can never switch someone's visibility on by omission.
  if (publicIdentity !== undefined) next.publicIdentity = publicIdentity === true;
  db[id] = next;
  writeDb(db);
  return next;
}
