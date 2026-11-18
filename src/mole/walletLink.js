import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { readJson, writeJson } from "./storage.js";
import { resolveAccountId, listAccountIdsForUser } from "./userAccounts.js";

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;
const CHALLENGES = "wallet_challenges.json";
const LINKS = "linked_wallets.json";
const ACTION_CHALLENGES = "wallet_action_challenges.json";
const PROFILE_EDIT_GRANTS = "profile_edit_grants.json";
export const WALLET_VERIFICATION_CYCLE_DAYS = Math.max(
  1,
  Number(process.env.WALLET_VERIFICATION_CYCLE_DAYS || 91),
);
export const WALLET_VERIFICATION_TTL_SEC = WALLET_VERIFICATION_CYCLE_DAYS * 24 * 60 * 60;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
// Legacy mirrors read by the faucet bot and the quiz. Defaults are the
// production locations; LINKED_WALLETS_DIRS (path-delimited, src first then
// root, same contract as quiz/wallets.js) redirects them for an isolated
// process. Resolved per call.
function linkedWalletMirrorPaths() {
  const override = String(process.env.LINKED_WALLETS_DIRS || '').trim();
  const dirs = override
    ? override.split(path.delimiter).filter(Boolean)
    : [path.resolve(PROJECT_ROOT, 'src', 'data'), path.resolve(PROJECT_ROOT, 'data')];
  return dirs.map((dir) => path.resolve(dir, 'linked_wallets.json'));
}
// Preserve the faucet bot's production path by default while allowing an
// explicitly isolated server process to keep every mirror inside its own
// disposable directory.
const FAUCET_WALLET_LINKS_PATH = path.resolve(
  String(process.env.FAUCET_DATA_DIR || path.resolve(PROJECT_ROOT, 'src', 'faucet')),
  'wallet_links.json',
);

function normalizeMsg(s) {
  return String(s || "").replace(/\r\n/g, "\n").trim();
}

function toMsgBytes(message) {
  return new TextEncoder().encode(String(message || "").replace(/\r\n/g, "\n"));
}

function createIntentWallet(address, input, source, nowIso, nowSec) {
  return {
    input: input || address,
    address,
    updatedAt: nowIso,
    linked_at: nowSec,
    source,
  };
}

function normalizeLinkedWalletRecord(record, { migrateLegacyVerification = false } = {}) {
  if (!record) return null;
  if (typeof record === "string") {
    const nowSec = migrateLegacyVerification ? Math.floor(Date.now() / 1000) : 0;
    const nowIso = nowSec ? new Date(nowSec * 1000).toISOString() : new Date(0).toISOString();
    return {
      wallet: record,
      linked_at: nowSec,
      verified_at: nowSec,
      verification_expires_at: nowSec ? nowSec + WALLET_VERIFICATION_TTL_SEC : 0,
      wallets: {
        verified: createIntentWallet(record, record, "legacy-string", nowIso, nowSec),
      },
      wallet_history: [record],
    };
  }
  if (typeof record !== "object" || Array.isArray(record)) return null;

  const normalized = { ...record };
  const wallets = normalized.wallets && typeof normalized.wallets === "object" && !Array.isArray(normalized.wallets)
    ? { ...normalized.wallets }
    : {};

  if (normalized.wallet && !wallets.verified?.address) {
    wallets.verified = {
      address: normalized.wallet,
      input: normalized.input || normalized.wallet,
      updatedAt: normalized.updatedAt || normalized.linked_at || 0,
      linked_at: normalized.linked_at || 0,
      source: normalized.source || "legacy-top-level",
    };
  }

  const historySet = new Set(
    Array.isArray(normalized.wallet_history) ? normalized.wallet_history.map((v) => String(v || "").trim()).filter(Boolean) : []
  );
  [normalized.wallet, normalized.last_verified_wallet, wallets.verified?.address, wallets.faucet?.address, wallets.payout?.address]
    .filter(Boolean)
    .forEach((v) => historySet.add(String(v).trim()));

  normalized.wallets = wallets;
  normalized.wallet_history = Array.from(historySet);
  if (!normalized.wallet && wallets.faucet?.address) normalized.wallet = wallets.faucet.address;
  if (!normalized.wallet && wallets.payout?.address) normalized.wallet = wallets.payout.address;
  if (!normalized.wallet && wallets.verified?.address) normalized.wallet = wallets.verified.address;
  if (!normalized.linked_at && wallets.verified?.linked_at) normalized.linked_at = wallets.verified.linked_at;
  const hasVerifiedWallet = !!(wallets.verified?.address || normalized.last_verified_wallet || normalized.wallet);
  const existingExpiresAt = Number(normalized.verification_expires_at || 0);
  let verifiedAt = Number(normalized.verified_at || normalized.linked_at || wallets.verified?.linked_at || 0);
  if (hasVerifiedWallet && migrateLegacyVerification && !existingExpiresAt) verifiedAt = Math.floor(Date.now() / 1000);
  if (verifiedAt) {
    normalized.verified_at = verifiedAt;
    normalized.verification_expires_at = existingExpiresAt || (verifiedAt + WALLET_VERIFICATION_TTL_SEC);
  }

  // MULTI-WALLET VERIFICATION (2026-08-20).
  //
  // Before this, an identity had exactly one verified wallet: re-linking
  // REPLACED it, and `wallet_history` kept the old address as a bare string
  // with no timestamp, which is not enough to say whether it is still verified.
  // A person with several wallets therefore had to choose which one the site
  // could see, and every balance the site showed was a fraction of what they
  // actually held.
  //
  // `verified_wallets` keeps one entry PER ADDRESS, each with its own
  // verification clock, so several wallets can be verified at the same time and
  // each expires on its own schedule.
  //
  // MIGRATION IS DELIBERATELY NARROW: only the CURRENT verified wallet is
  // seeded. Addresses in `wallet_history` are not retroactively marked
  // verified — some were replaced on purpose, and their proof is old. Anyone
  // wanting an old wallet back simply verifies it again, which costs one
  // signature and produces a fresh timestamp rather than an invented one.
  normalized.verified_wallets = normalizeVerifiedWallets(normalized, verifiedAt, existingExpiresAt);

  return normalized;
}

/** Per-address verification clocks, migrated from the single-wallet shape. */
function normalizeVerifiedWallets(normalized, verifiedAt, existingExpiresAt) {
  const source = normalized.verified_wallets;
  const out = {};
  if (source && typeof source === "object" && !Array.isArray(source)) {
    for (const [address, entry] of Object.entries(source)) {
      const addr = String(address || "").trim();
      if (!addr || !entry || typeof entry !== "object") continue;
      const vAt = Number(entry.verified_at || 0);
      if (!vAt) continue;
      out[addr] = {
        verified_at: vAt,
        expires_at: Number(entry.expires_at || 0) || vAt + WALLET_VERIFICATION_TTL_SEC,
        source: String(entry.source || "mole-verification"),
      };
    }
  }

  const current = normalized.wallets?.verified?.address || normalized.last_verified_wallet || normalized.wallet;
  if (current && verifiedAt && !out[String(current).trim()]) {
    out[String(current).trim()] = {
      verified_at: verifiedAt,
      expires_at: existingExpiresAt || verifiedAt + WALLET_VERIFICATION_TTL_SEC,
      source: "migrated-single-wallet",
    };
  }
  return out;
}

function shouldReplaceIntent(current, previousVerified) {
  if (!current || typeof current !== "object" || !current.address) return true;
  const source = String(current.source || "");
  if (["verified-default", "mole-verification", "legacy-top-level", "legacy-string"].includes(source)) return true;
  if (previousVerified && current.address === previousVerified) return true;
  if (previousVerified && current.input === previousVerified) return true;
  return false;
}

function setIntentWallet(wallets, intent, entry, previousVerified) {
  const current = wallets[intent];
  if (!shouldReplaceIntent(current, previousVerified)) return wallets;
  return { ...wallets, [intent]: entry };
}

function buildVerifiedWalletRecord(previous, walletStr) {
  const nowSec = Math.floor(Date.now() / 1000);
  const nowIso = new Date().toISOString();
  const normalized = normalizeLinkedWalletRecord(previous) || {};
  let wallets = normalized.wallets || {};
  const previousVerified = wallets.verified?.address || normalized.last_verified_wallet || normalized.wallet || null;

  const verifiedEntry = createIntentWallet(walletStr, walletStr, "mole-verification", nowIso, nowSec);
  const defaultEntry = createIntentWallet(walletStr, walletStr, "verified-default", nowIso, nowSec);

  wallets = { ...wallets, verified: verifiedEntry };
  wallets = setIntentWallet(wallets, "faucet", defaultEntry, previousVerified);
  wallets = setIntentWallet(wallets, "payout", defaultEntry, previousVerified);

  const historySet = new Set(Array.isArray(normalized.wallet_history) ? normalized.wallet_history : []);
  [walletStr, previousVerified, wallets.faucet?.address, wallets.payout?.address].filter(Boolean).forEach((v) => historySet.add(String(v).trim()));

  const preferredDefault = wallets.faucet?.address || wallets.payout?.address || walletStr;

  // ADDS, never replaces. Verifying a second wallet used to overwrite the
  // first; now each address keeps its own clock and both stay verified until
  // they separately expire. Re-verifying an address already present just
  // refreshes that address's clock.
  const verifiedWallets = {
    ...(normalized.verified_wallets || {}),
    [walletStr]: {
      verified_at: nowSec,
      expires_at: nowSec + WALLET_VERIFICATION_TTL_SEC,
      source: "mole-verification",
    },
  };

  return {
    ...normalized,
    wallet: preferredDefault,
    input: walletStr,
    linked_at: nowSec,
    verified_at: nowSec,
    verification_expires_at: nowSec + WALLET_VERIFICATION_TTL_SEC,
    updatedAt: nowIso,
    last_verified_wallet: walletStr,
    wallets,
    verified_wallets: verifiedWallets,
    wallet_history: Array.from(historySet),
  };
}


function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, filePath);
}

function syncLinkedWalletMirrors(discordUserId, record) {
  const userId = String(discordUserId);
  for (const filePath of linkedWalletMirrorPaths()) {
    const db = readJsonFile(filePath, {});
    db[userId] = record;
    writeJsonFile(filePath, db);
  }

  const faucetDb = readJsonFile(FAUCET_WALLET_LINKS_PATH, { version: 1, links: {} });
  if (!faucetDb.version) faucetDb.version = 1;
  if (!faucetDb.links || typeof faucetDb.links !== 'object' || Array.isArray(faucetDb.links)) faucetDb.links = {};
  const faucetWallet = record?.wallets?.faucet?.address || record?.wallets?.verified?.address || record?.wallet || null;
  if (faucetWallet) {
    faucetDb.links[userId] = {
      input: record?.wallets?.faucet?.input || faucetWallet,
      address: faucetWallet,
      updatedAt: record?.wallets?.faucet?.updatedAt || record?.updatedAt || new Date().toISOString(),
      source: record?.wallets?.faucet?.source || 'verified-default',
    };
    writeJsonFile(FAUCET_WALLET_LINKS_PATH, faucetDb);
  }
}

function decodeSignature(sig) {
  if (sig == null) throw new Error("missing_signature");
  if (sig instanceof Uint8Array) return sig;
  if (Array.isArray(sig)) return Uint8Array.from(sig);
  if (typeof sig === "object" && Array.isArray(sig.data)) return Uint8Array.from(sig.data);

  let s = String(sig).trim().replace(/\s+/g, "");

  if (s.startsWith("[") && s.endsWith("]")) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return Uint8Array.from(arr);
    } catch {}
  }

  if (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0) {
    try { return Uint8Array.from(Buffer.from(s, "hex")); } catch {}
  }

  if (/^[A-Za-z0-9+/=]+$/.test(s) && s.length % 4 === 0) {
    try {
      const b = Buffer.from(s, "base64");
      if (b.length) return Uint8Array.from(b);
    } catch {}
  }

  try {
    return Uint8Array.from(bs58.decode(s));
  } catch {
    throw new Error("signature_decode_failed");
  }
}

function challengesDb() { return readJson(CHALLENGES, {}); }
function saveChallenges(d) { writeJson(CHALLENGES, d); }
function linksDb() { return readJson(LINKS, {}); }
function saveLinks(d) { writeJson(LINKS, d); }
function actionChallengesDb() { return readJson(ACTION_CHALLENGES, {}); }
function saveActionChallenges(d) { writeJson(ACTION_CHALLENGES, d); }
function profileEditGrantsDb() { return readJson(PROFILE_EDIT_GRANTS, {}); }
function saveProfileEditGrants(d) { writeJson(PROFILE_EDIT_GRANTS, d); }

function hashGrantToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

export function issueProfileEditGrant({ wallet, discordUserId, ttlSec = 91 * 24 * 60 * 60 }) {
  const walletStr = String(wallet || "").trim();
  const userStr = String(discordUserId || "").trim();
  if (!walletStr) throw new Error("wallet_required");
  if (!userStr) throw new Error("discord_user_required");
  const now = Math.floor(Date.now() / 1000);
  const expires_at = now + Math.max(3600, Number(ttlSec || 0));
  const token = crypto.randomBytes(24).toString("hex");
  const db = profileEditGrantsDb();
  db[walletStr] = {
    wallet: walletStr,
    discordUserId: userStr,
    tokenHash: hashGrantToken(token),
    created_at: now,
    last_used_at: now,
    expires_at,
  };
  saveProfileEditGrants(db);
  return { token, expires_at };
}

export function verifyProfileEditGrant({ wallet, token, discordUserId }) {
  const walletStr = String(wallet || "").trim();
  const tokenStr = String(token || "").trim();
  const userStr = discordUserId == null ? "" : String(discordUserId).trim();
  if (!walletStr) throw new Error("wallet_required");
  if (!tokenStr) throw new Error("edit_token_required");

  const db = profileEditGrantsDb();
  const row = db[walletStr];
  if (!row) throw new Error("edit_grant_missing");
  const now = Math.floor(Date.now() / 1000);
  if (Number(row.expires_at || 0) < now) throw new Error("edit_grant_expired");
  // Compared at the USER level: a grant issued before a merge names the
  // absorbed account, and refusing the person's own grant after they merged
  // their two logins would be the merge silently locking them out of their own
  // profile.
  if (userStr && resolveAccountId(String(row.discordUserId || "")) !== resolveAccountId(userStr)) {
    throw new Error("edit_grant_user_mismatch");
  }
  if (String(row.tokenHash || "") !== hashGrantToken(tokenStr)) throw new Error("edit_grant_invalid");

  row.last_used_at = now;
  db[walletStr] = row;
  saveProfileEditGrants(db);

  return { ok: true, wallet: walletStr, discordUserId: String(row.discordUserId || ""), expires_at: Number(row.expires_at || 0) };
}


function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

export function hashActionPayload(payload) {
  return crypto.createHash("sha256").update(stableStringify(payload || {})).digest("hex");
}

// Per-action heading + footer for the message a user signs. Defaults to the
// original profile-update wording so existing flows sign byte-identical messages.
function walletActionCopy(action) {
  switch (String(action || "").trim()) {
    case "gaming-hub-login":
      return {
        heading: "WinLEW Gaming Hub Login",
        footer: "Only sign this to log in to the WinLEW Gaming Hub. Signing proves you own this wallet — it cannot move funds or spend anything.",
      };
    default:
      return {
        heading: "WinLEW Profile Update Authorization",
        footer: "Only sign this message if you are approving this WinLEW profile update.",
      };
  }
}

export function issueWalletActionChallenge({ wallet, action, payload, ttlSec = 300 }) {
  const walletStr = String(wallet || "").trim();
  const actionStr = String(action || "").trim();
  if (!walletStr) throw new Error("wallet_required");
  if (!actionStr) throw new Error("action_required");
  if (!BASE58_RE.test(walletStr)) throw new Error("wallet_not_base58");

  const payloadHash = hashActionPayload(payload || {});
  const nonce = crypto.randomBytes(16).toString("hex");
  const now = Math.floor(Date.now() / 1000);
  const expires_at = now + Math.max(60, Number(ttlSec || 300));

  const db = actionChallengesDb();
  db[`${walletStr}:${nonce}`] = {
    wallet: walletStr,
    action: actionStr,
    payloadHash,
    nonce,
    created_at: now,
    expires_at,
    used: false,
  };
  saveActionChallenges(db);

  // Heading/footer are action-aware so the wallet prompt reads like what the
  // user is actually doing. Only the field lines below (Wallet/Action/Payload
  // Hash/Nonce/Expires) are parsed/verified — the prose around them is free.
  const copy = walletActionCopy(actionStr);
  const message =
`${copy.heading}
Wallet: ${walletStr}
Action: ${actionStr}
Payload Hash: ${payloadHash}
Nonce: ${nonce}
Expires: ${expires_at}

${copy.footer}`;

  return { wallet: walletStr, action: actionStr, payloadHash, nonce, expires_at, message };
}

export function verifyWalletAction({ wallet, action, payload, signature, message }) {
  const walletStr = String(wallet || "").trim();
  const actionStr = String(action || "").trim();
  if (!walletStr) throw new Error("wallet_required");
  if (!actionStr) throw new Error("action_required");
  if (!BASE58_RE.test(walletStr)) throw new Error("wallet_not_base58");

  const norm = normalizeMsg(String(message || ""));
  const nonceMatch = norm.match(/Nonce:\s*([a-f0-9]+)/i);
  const expiresMatch = norm.match(/Expires:\s*(\d+)/i);
  const hashMatch = norm.match(/Payload Hash:\s*([a-f0-9]+)/i);
  if (!nonceMatch) throw new Error("nonce_missing_in_message");
  if (!expiresMatch) throw new Error("expires_missing_in_message");
  if (!hashMatch) throw new Error("payload_hash_missing_in_message");

  const nonce = String(nonceMatch[1] || "");
  const expiresAt = Number(expiresMatch[1] || 0);
  const messageHash = String(hashMatch[1] || "");
  const expectedHash = hashActionPayload(payload || {});
  if (messageHash !== expectedHash) throw new Error("payload_hash_mismatch");
  if (!norm.includes(`Wallet: ${walletStr}`)) throw new Error("wallet_missing_in_message");
  if (!norm.includes(`Action: ${actionStr}`)) throw new Error("action_missing_in_message");
  if (!norm.includes(`Payload Hash: ${expectedHash}`)) throw new Error("payload_hash_missing_in_message");
  if (!norm.includes(`Nonce: ${nonce}`)) throw new Error("nonce_missing_in_message");
  if (!norm.includes(`Expires: ${expiresAt}`)) throw new Error("expires_missing_in_message");

  const db = actionChallengesDb();
  const row = db[`${walletStr}:${nonce}`];
  if (!row) throw new Error("challenge_missing");
  const now = Math.floor(Date.now() / 1000);
  if (row.used) throw new Error("challenge_used");
  if (Number(row.expires_at || 0) < now) throw new Error("challenge_expired");
  if (String(row.action || "") !== actionStr) throw new Error("challenge_action_mismatch");
  if (String(row.payloadHash || "") !== expectedHash) throw new Error("challenge_hash_mismatch");

  const sigBytes = decodeSignature(signature);
  if (sigBytes.length !== 64) throw new Error(`bad_signature_size:${sigBytes.length}`);
  const pubBytes = new PublicKey(walletStr).toBytes();
  if (pubBytes.length !== 32) throw new Error(`bad_pubkey_size:${pubBytes.length}`);

  const ok = nacl.sign.detached.verify(toMsgBytes(norm), sigBytes, pubBytes);
  if (!ok) throw new Error("bad_signature");

  row.used = true;
  row.used_at = now;
  db[`${walletStr}:${nonce}`] = row;
  saveActionChallenges(db);

  return { ok: true, wallet: walletStr, action: actionStr, payloadHash: expectedHash, nonce };
}


/**
 * The key this identity's wallets actually live under.
 *
 * ONE RECORD PER USER, NOT PER DOOR (2026-08-22). An account that has been
 * merged into another reads and writes the survivor's record, so a person who
 * signed in with X on Monday and Discord on Tuesday has ONE set of wallets and
 * ONE payout address — which is the whole point of the USER layer. Every
 * function in this file that touches linksDb() by key goes through here.
 */
function linksKey(discordUserId) {
  return String(resolveAccountId(String(discordUserId || "").trim()));
}

/**
 * Fold two wallet records into one. Pure, so the rule is testable without
 * touching the store.
 *
 * NOTHING IS DISCARDED except duplication: every verified address from both
 * sides survives with its own clock (the LONGER-lived entry wins when both
 * sides know an address, because both were real verifications and the later one
 * is the one the person actually still holds), and both histories are unioned.
 *
 * EXACTLY ONE PAYOUT ADDRESS COMES OUT. `base`'s nomination wins when it is
 * still among the verified set, then `incoming`'s; if neither survives, the
 * nomination is dropped rather than guessed, and getPayoutWallet() falls back
 * to the most recently verified wallet the way it always has. This is the rule
 * the owner stated: as many wallets as you like, one of them gets paid.
 */
export function mergeLinkedWalletRecords(baseRecord, incomingRecord) {
  const base = normalizeLinkedWalletRecord(baseRecord);
  const incoming = normalizeLinkedWalletRecord(incomingRecord);
  if (!base) return incoming;
  if (!incoming) return base;

  const verified_wallets = { ...(base.verified_wallets || {}) };
  for (const [address, entry] of Object.entries(incoming.verified_wallets || {})) {
    const current = verified_wallets[address];
    if (!current || Number(entry?.expires_at || 0) > Number(current?.expires_at || 0)) {
      verified_wallets[address] = entry;
    }
  }

  const history = new Set([
    ...(Array.isArray(base.wallet_history) ? base.wallet_history : []),
    ...(Array.isArray(incoming.wallet_history) ? incoming.wallet_history : []),
    ...Object.keys(verified_wallets),
  ].map((v) => String(v || "").trim()).filter(Boolean));

  const baseNewer = Number(base.verified_at || 0) >= Number(incoming.verified_at || 0);
  const newer = baseNewer ? base : incoming;
  const older = baseNewer ? incoming : base;

  const wallets = { ...(older.wallets || {}), ...(newer.wallets || {}) };
  const liveAddresses = new Set(Object.keys(verified_wallets));
  const nominated = [base.wallets?.payout?.address, incoming.wallets?.payout?.address]
    .map((v) => String(v || "").trim())
    .find((address) => address && liveAddresses.has(address)) || null;
  if (nominated) {
    wallets.payout = (base.wallets?.payout?.address === nominated ? base : incoming).wallets.payout;
    wallets.faucet = wallets.payout;
  } else {
    delete wallets.payout;
  }

  return {
    ...older,
    ...newer,
    wallets,
    verified_wallets,
    wallet_history: Array.from(history),
    verified_at: Math.max(Number(base.verified_at || 0), Number(incoming.verified_at || 0)) || 0,
    verification_expires_at:
      Math.max(Number(base.verification_expires_at || 0), Number(incoming.verification_expires_at || 0)) || 0,
    wallet: newer.wallet || older.wallet || null,
  };
}

/**
 * This user's record, with any un-merged sibling records folded in.
 *
 * Belt AND braces: accountMerge.js physically folds the records when a merge
 * happens, so this normally finds exactly one. It still sweeps the aliases
 * because the alias map is the source of truth for "who is one person" and the
 * record fold is a consequence — if a fold ever half-completes (a Mongo blip
 * mid-write), reading must not hand back half a person's wallets, and HODL must
 * not see the two halves as two participants and pay both.
 */
function readUserRecord(d, discordUserId) {
  const ids = listAccountIdsForUser(String(discordUserId || "").trim());
  let record = null;
  for (const id of ids) {
    const found = normalizeLinkedWalletRecord(d[String(id)]);
    if (found) record = record ? mergeLinkedWalletRecords(record, found) : found;
  }
  return record;
}

export function getLinkedWallet(discordUserId) {
  const record = readUserRecord(linksDb(), discordUserId);
  return record?.wallet || record?.wallets?.verified?.address || null;
}

export function getLinkedWalletRecord(discordUserId) {
  return readUserRecord(linksDb(), discordUserId) || null;
}

/**
 * Every linked profile, for jobs that need the whole population rather than one
 * user — the HODL weekly snapshot is the first.
 *
 * Returns normalised records so callers never poke at the raw store's shape,
 * which has three historical layouts (top-level `wallet`, `wallets.verified`,
 * and `wallet_history`) that findLinkedProfileByWallet already knows about.
 */
export function listLinkedProfiles() {
  const d = linksDb();
  // ONE ROW PER PERSON. This list is what the HODL weekly snapshot pays from,
  // so two rows for one merged user would be two payouts to one person — the
  // per-wallet version of the exact bug the USER layer exists to end. Records
  // that resolve to the same user are folded here even if their physical merge
  // has not run yet.
  const byUser = new Map();
  for (const [discordUserId, raw] of Object.entries(d)) {
    const record = normalizeLinkedWalletRecord(raw);
    if (!record) continue;
    const userId = resolveAccountId(String(discordUserId));
    const current = byUser.get(userId);
    byUser.set(userId, current ? mergeLinkedWalletRecords(current, record) : record);
  }
  return Array.from(byUser, ([discordUserId, record]) => ({ discordUserId, record }));
}

export function findLinkedProfileByWallet(inputWallet) {
  const wallet = String(inputWallet || "").trim();
  if (!wallet) return null;
  const d = linksDb();
  for (const [discordUserId, raw] of Object.entries(d)) {
    const record = normalizeLinkedWalletRecord(raw);
    if (!record) continue;
    const candidates = new Set([
      record.wallet,
      record.last_verified_wallet,
      record.wallets?.verified?.address,
      record.wallets?.faucet?.address,
      record.wallets?.payout?.address,
      ...(Array.isArray(record.wallet_history) ? record.wallet_history : []),
    ].filter(Boolean).map((v) => String(v).trim()));
    if (candidates.has(wallet)) {
      // The USER's id, not the door the wallet happened to come in through.
      // The faucet resolves a claimant's identity FROM the wallet, and the
      // answer has to be the person — otherwise the cooldown check looks at
      // one half of a merged account and clears a second claim.
      const userId = resolveAccountId(String(discordUserId));
      return { discordUserId: userId, record: readUserRecord(d, userId) || record };
    }
  }
  return null;
}

export function getWalletVerificationStatus(record, nowSec = Math.floor(Date.now() / 1000)) {
  const normalized = normalizeLinkedWalletRecord(record);
  const wallet = normalized?.wallets?.verified?.address || normalized?.last_verified_wallet || normalized?.wallet || null;
  const verifiedAt = Number(normalized?.verified_at || normalized?.linked_at || normalized?.wallets?.verified?.linked_at || 0);
  const expiresAt = Number(normalized?.verification_expires_at || 0) || (verifiedAt ? verifiedAt + WALLET_VERIFICATION_TTL_SEC : 0);
  const verified = !!wallet && verifiedAt > 0 && expiresAt > Number(nowSec || 0);
  return {
    status: verified ? "verified" : (wallet ? "expired" : "unverified"),
    verified,
    wallet,
    verified_at: verifiedAt || null,
    expires_at: expiresAt || null,
    cycle_days: WALLET_VERIFICATION_CYCLE_DAYS,
  };
}

/**
 * Every wallet this identity has verified that has NOT yet expired.
 *
 * This is the list the dashboard sums and the list eligibility checks read.
 * `getWalletVerificationStatus()` above is unchanged and still answers for the
 * single nominated wallet, because payouts, contributions and signing all need
 * ONE address and must not start guessing between several.
 *
 * Sorted most-recently-verified first, so [0] is "the last wallet they
 * verified with" — the default the owner chose for payouts.
 */
export function listVerifiedWallets(record, nowSec = Math.floor(Date.now() / 1000)) {
  const normalized = normalizeLinkedWalletRecord(record);
  const entries = Object.entries(normalized?.verified_wallets || {});
  return entries
    .filter(([, entry]) => Number(entry?.expires_at || 0) > Number(nowSec || 0))
    .sort((a, b) => Number(b[1].verified_at || 0) - Number(a[1].verified_at || 0))
    .map(([address, entry]) => ({
      wallet: address,
      verified_at: Number(entry.verified_at || 0),
      expires_at: Number(entry.expires_at || 0),
      source: entry.source || "mole-verification",
    }));
}

/**
 * The one wallet that receives money.
 *
 * Order: an explicitly nominated payout wallet, then the most recently
 * verified one. The owner's rule, in their words: "either have a select wallet
 * on the faucet and the apk or have it tied to the last wallet verified with."
 *
 * A nomination is only honoured while that wallet is still verified — an
 * expired nomination silently falling back beats paying an address whose proof
 * has lapsed.
 */
export function getPayoutWallet(record, nowSec = Math.floor(Date.now() / 1000)) {
  const verified = listVerifiedWallets(record, nowSec);
  if (!verified.length) return null;
  const normalized = normalizeLinkedWalletRecord(record);
  const nominated = String(normalized?.wallets?.payout?.address || "").trim();
  if (nominated && verified.some((entry) => entry.wallet === nominated)) return nominated;
  return verified[0].wallet;
}

/**
 * Nominate which verified wallet receives payouts.
 *
 * Refuses an address this identity has not verified — otherwise anyone who
 * could reach this call could redirect their own rewards to a wallet they have
 * never proved they control, which is the whole point of verification.
 */
export function setPayoutWallet({ discordUserId, wallet }) {
  const walletStr = String(wallet || "").trim();
  if (!walletStr) throw new Error("wallet_required");
  const db = linksDb();
  const key = linksKey(discordUserId);
  const record = readUserRecord(db, key);
  if (!record) throw new Error("no_linked_record");
  const verified = listVerifiedWallets(record);
  if (!verified.some((entry) => entry.wallet === walletStr)) throw new Error("wallet_not_verified_for_user");

  const nowSec = Math.floor(Date.now() / 1000);
  const nowIso = new Date().toISOString();
  const entry = createIntentWallet(walletStr, walletStr, "user-selected", nowIso, nowSec);
  record.wallets = { ...(record.wallets || {}), payout: entry, faucet: entry };
  record.updatedAt = nowIso;
  db[key] = record;
  saveLinks(db);
  syncLinkedWalletMirrors(key, record);
  return walletStr;
}

export function issueChallenge(discordUserId) {
  const d = challengesDb();
  const nonce = crypto.randomBytes(16).toString("hex");
  const now = Math.floor(Date.now() / 1000);
  const expires_at = now + 5 * 60;
  d[String(discordUserId)] = { nonce, created_at: now, expires_at, used: false };
  saveChallenges(d);

  const message =
`WinLEW Wallet Link Verification
Discord: ${discordUserId}
Nonce: ${nonce}
Expires: ${expires_at}

Only sign this message if you are linking your wallet to The WinLEW Discord.`;
  return { nonce, expires_at, message };
}

export function getActiveChallenge(discordUserId) {
  const d = challengesDb();
  const c = d[String(discordUserId)];
  if (!c) return null;
  const now = Math.floor(Date.now() / 1000);
  if (c.used || c.expires_at < now) return null;
  return c;
}

export function completeLink({ discordUserId, wallet, signature, message }) {
  const walletStr = String(wallet || "").trim();
  const c = getActiveChallenge(discordUserId);
  if (!c) throw new Error("no_active_challenge");

  const msg = String(message || "");
  if (!msg.includes(c.nonce)) throw new Error("nonce_missing_in_message");
  const norm = normalizeMsg(msg);
  if (!norm.includes(`Discord: ${discordUserId}`)) throw new Error("discord_id_missing_in_message");
  if (!norm.includes(`Nonce: ${c.nonce}`)) throw new Error("nonce_missing_in_message");
  if (!norm.includes(`Expires: ${c.expires_at}`)) throw new Error("expires_missing_in_message");
  if (!BASE58_RE.test(walletStr)) throw new Error("wallet_not_base58");

  const sigBytes = decodeSignature(signature);
  if (sigBytes.length !== 64) throw new Error(`bad_signature_size:${sigBytes.length}`);
  const pubBytes = new PublicKey(walletStr).toBytes();
  if (pubBytes.length !== 32) throw new Error(`bad_pubkey_size:${pubBytes.length}`);

  const ok = nacl.sign.detached.verify(toMsgBytes(norm), sigBytes, pubBytes);
  if (!ok) throw new Error("bad_signature");

  const dch = challengesDb();
  if (!dch[String(discordUserId)]) throw new Error("challenge_missing");
  dch[String(discordUserId)].used = true;
  saveChallenges(dch);

  const dl = linksDb();
  // Written under the USER's key: verifying a wallet while signed in through a
  // merged-away door still adds it to the one record that person owns.
  const key = linksKey(discordUserId);
  const record = buildVerifiedWalletRecord(readUserRecord(dl, key), walletStr);
  dl[key] = record;
  saveLinks(dl);
  syncLinkedWalletMirrors(key, record);

  return walletStr;
}


/**
 * Fold the absorbed account's wallet record into the surviving one, on disk.
 *
 * Called by accountMerge.js AFTER the alias is written, so a crash between the
 * two leaves the alias in place and readUserRecord() still assembles the whole
 * person — the fold is an optimisation and a tidy-up, never the thing
 * correctness depends on.
 *
 * The absorbed key is deleted rather than left as a copy: two records holding
 * the same wallets is how one person becomes two rows in every list that
 * iterates the store, and one of those lists writes cheques.
 */
export function applyRecordMerge({ userId, absorbedId }) {
  const survivor = String(userId || "").trim();
  const absorbed = String(absorbedId || "").trim();
  if (!survivor || !absorbed || survivor === absorbed) return null;

  const d = linksDb();
  const absorbedRecord = normalizeLinkedWalletRecord(d[absorbed]);
  const survivorRecord = normalizeLinkedWalletRecord(d[survivor]);
  if (!absorbedRecord && !survivorRecord) return null;

  const merged = mergeLinkedWalletRecords(survivorRecord, absorbedRecord);
  delete d[absorbed];
  d[survivor] = merged;
  saveLinks(d);
  syncLinkedWalletMirrors(survivor, merged);
  removeMirroredRecord(absorbed);
  return merged;
}

/**
 * Drop an absorbed account from the two on-disk mirrors and the faucet's link
 * file. syncLinkedWalletMirrors() only ever ADDS a key, so without this the
 * absorbed record would live on in the copies that the faucet and the dashboard
 * read — the merge would look done from Mongo and undone from disk.
 */
function removeMirroredRecord(absorbedId) {
  const key = String(absorbedId || "").trim();
  if (!key) return;
  for (const filePath of linkedWalletMirrorPaths()) {
    const db = readJsonFile(filePath, {});
    if (!Object.prototype.hasOwnProperty.call(db, key)) continue;
    delete db[key];
    writeJsonFile(filePath, db);
  }
  const faucetDb = readJsonFile(FAUCET_WALLET_LINKS_PATH, null);
  if (faucetDb?.links && Object.prototype.hasOwnProperty.call(faucetDb.links, key)) {
    delete faucetDb.links[key];
    writeJsonFile(FAUCET_WALLET_LINKS_PATH, faucetDb);
  }
}

/**
 * Merge Mole-derived faucet links over whatever the faucet's own file already
 * holds.
 *
 * Pure on purpose: the paths this writes are fixed to the repo root and cannot
 * be redirected by env, so a test that exercised the file version would write
 * real, gitignored, runtime linkage data — under `node --test`, concurrently
 * with everything else. The logic is the part worth pinning; the file I/O is
 * not.
 */
export function mergeFaucetLinks(existingLinks, derivedLinks) {
  const preserved = existingLinks && typeof existingLinks === 'object' && !Array.isArray(existingLinks)
    ? existingLinks
    : {};
  // Mole wins where both know a user — it is the verified, signature-backed
  // record. Keys it has never heard of are left alone, which is the fix.
  return { ...preserved, ...(derivedLinks || {}) };
}

export function syncAllLinkedWalletMirrors() {
  const db = linksDb();
  const normalizedDb = {};
  const faucetDb = { version: 1, links: {} };

  for (const [discordUserId, raw] of Object.entries(db || {})) {
    // Existing installations predate cycle timestamps. Treat their saved link as
    // verified for one fresh cycle, then persist the deadline so it cannot slide.
    const record = normalizeLinkedWalletRecord(raw, { migrateLegacyVerification: true });
    if (!record) continue;
    normalizedDb[String(discordUserId)] = record;

    const faucetWallet = record?.wallets?.faucet?.address || record?.wallets?.verified?.address || record?.wallet || null;
    if (faucetWallet) {
      faucetDb.links[String(discordUserId)] = {
        input: record?.wallets?.faucet?.input || faucetWallet,
        address: faucetWallet,
        updatedAt: record?.wallets?.faucet?.updatedAt || record?.updatedAt || new Date().toISOString(),
        source: record?.wallets?.faucet?.source || 'verified-default',
      };
    }
  }

  saveLinks(normalizedDb);
  for (const filePath of linkedWalletMirrorPaths()) writeJsonFile(filePath, normalizedDb);

  // MERGE, NEVER CLOBBER. This ran on every boot (src/index.js) and wrote
  // faucetDb over the faucet's file wholesale. But that file has a SECOND
  // writer: the faucet bot's !register (src/faucet/bot.js setLinkedWallet),
  // which writes to the faucet's own store and never to mole_linked_wallets.
  // So anyone whose only linkage came from !register was present in the file,
  // absent from this rebuild, and therefore ERASED on every restart of
  // winlew-mole — after which the faucet told them to go register again.
  //
  // The mole store still wins where both know a user: it is the verified,
  // signature-backed record. Keys it has never heard of are left alone, which
  // is the whole fix.
  const existingFaucet = readJsonFile(FAUCET_WALLET_LINKS_PATH, null);
  faucetDb.links = mergeFaucetLinks(existingFaucet?.links, faucetDb.links);
  writeJsonFile(FAUCET_WALLET_LINKS_PATH, faucetDb);
}
