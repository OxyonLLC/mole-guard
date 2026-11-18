/**
 * Native-wrapper session hand-off (mobile beta).
 *
 * The problem this solves: in the Capacitor wrapper, "Connect wallet" opens
 * Phantom/Solflare/GeoWallet, and the user signs inside *that app's* in-app
 * browser. It is a different storage context, so the session created there is
 * invisible to the wrapper's own WebView — the user comes back to WinLEW still
 * logged out. See docs/mobile-beta.md.
 *
 * The shape is deliberately OAuth's authorization-code exchange, not "put the
 * session token in the return URL". The return trip is a custom-scheme deep
 * link (co.winlew.app://auth-callback), and a custom scheme is claimable by any
 * app on the device — on Android a second app registering the same scheme gets
 * a chooser, and on iOS which app wins is undefined. Anything in that URL must
 * therefore be assumed readable by an attacker. So:
 *
 *   1. start   — the wrapper invents a claim secret, keeps it, and registers
 *                only its SHA-256 hash. It gets back a handoff id.
 *   2. deposit — the wallet-browser page, once it has actually logged in,
 *                attaches its session token to that handoff id. Requires a
 *                real session, so only someone who completed a signature can
 *                deposit.
 *   3. claim   — the wrapper presents the handoff id *and* the claim secret.
 *                The session is returned exactly once and the record deleted.
 *
 * The deep link carries only the handoff id. An app that intercepts it holds an
 * identifier it cannot redeem, because the claim secret never left the wrapper.
 *
 * Known residual risk, stated rather than hidden: an attacker who learns a
 * pending handoff id before the legitimate deposit could attach *their own*
 * session to it and land the wrapper in their account (a login-CSRF /
 * session-fixation shape). The id is 32 chars of nanoid and lives for five
 * minutes inside one wallet-browser URL, and OAuth's `state` has the same
 * property, but it is the reason the id must never be logged, shortened,
 * embedded in a QR code, or otherwise widened beyond the two parties.
 */

import crypto from "crypto";
import { nanoid } from "nanoid";
import { readJson, writeJson } from "./storage.js";
import { getSession } from "./sessions.js";

const HANDOFF_FILE = "native_handoffs.json";

/** Long enough for a real wallet round trip, short enough that an abandoned
 *  hand-off stops being a live target quickly.
 *
 *  Was 5 minutes, which sounded generous and wasn't. A first-time flow is:
 *  open Phantom, approve the connection, read and sign the message, notice the
 *  return banner, switch apps. Reported from a device on 2026-08-02 as "the
 *  banner showed but it never took me back" — the deposit had succeeded and the
 *  hand-off had simply expired before the user got back, which the app then
 *  reported as nothing at all. 15 minutes covers an unhurried first attempt
 *  while still expiring well within the session's own lifetime. */
export const HANDOFF_TTL_SEC = 15 * 60;

/** Wrong-secret guesses tolerated before the record is burned. The secret is
 *  256 bits, so this is not what makes guessing infeasible — it just stops a
 *  hand-off being used as an oracle, and bounds the work a flood can cause. */
const MAX_CLAIM_ATTEMPTS = 5;

/** Defensive ceiling on concurrent pending hand-offs; oldest go first. */
const MAX_OPEN_HANDOFFS = 5000;

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function db() {
  return readJson(HANDOFF_FILE, {});
}

function save(d) {
  writeJson(HANDOFF_FILE, d);
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

/** Timing-safe compare of two hex digests of equal, known length. */
function hashesMatch(a, b) {
  const left = Buffer.from(String(a || ""), "utf8");
  const right = Buffer.from(String(b || ""), "utf8");
  if (left.length !== right.length || left.length === 0) return false;
  return crypto.timingSafeEqual(left, right);
}

/** Drops expired records, then trims the oldest if the map is still oversized. */
function sweep(d) {
  const cutoff = nowSec();
  for (const [id, rec] of Object.entries(d)) {
    if (!rec || Number(rec.expires_at || 0) < cutoff) delete d[id];
  }
  const ids = Object.keys(d);
  if (ids.length > MAX_OPEN_HANDOFFS) {
    ids
      .sort((a, b) => Number(d[a]?.created_at || 0) - Number(d[b]?.created_at || 0))
      .slice(0, ids.length - MAX_OPEN_HANDOFFS)
      .forEach((id) => delete d[id]);
  }
  return d;
}

/**
 * Step 1, called by the native wrapper before it opens the wallet app.
 * `claimHash` is SHA-256 of a secret the wrapper keeps to itself.
 */
export function startNativeHandoff({ claimHash } = {}) {
  const hash = String(claimHash || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("invalid_claim_hash");

  const d = sweep(db());
  const handoffId = nanoid(32);
  const created = nowSec();
  d[handoffId] = {
    claim_hash: hash,
    created_at: created,
    expires_at: created + HANDOFF_TTL_SEC,
    session: "",
    wallet_hint: "",
    deposited_at: 0,
    attempts: 0,
  };
  save(d);
  return { handoffId, expiresAt: created + HANDOFF_TTL_SEC, ttlSec: HANDOFF_TTL_SEC };
}

/**
 * Step 2, called by the page running inside the wallet's in-app browser once
 * it holds a real session. `wallet` is carried through untrusted, purely so the
 * wrapper can label its nav button without an extra round trip — every
 * authorization decision downstream comes from the session token, never from
 * this string.
 */
export function depositNativeHandoff({ handoffId, session, wallet } = {}) {
  const id = String(handoffId || "").trim();
  const token = String(session || "").trim();
  if (!id || !token) throw new Error("invalid_handoff_deposit");

  const d = sweep(db());
  const rec = d[id];
  if (!rec) throw new Error("handoff_not_found");
  // One deposit per hand-off: without this, a later deposit could displace the
  // legitimate one in the window before the wrapper claims.
  if (rec.deposited_at) throw new Error("handoff_already_deposited");
  if (!getSession(token)) throw new Error("session_invalid");

  rec.session = token;
  rec.wallet_hint = String(wallet || "").trim().slice(0, 64);
  rec.deposited_at = nowSec();
  d[id] = rec;
  save(d);
  return { ok: true, expiresAt: Number(rec.expires_at || 0) };
}

/**
 * Step 3, called by the native wrapper. Returns the session exactly once.
 *
 * `pending` (rather than an error) when the user has not finished signing yet,
 * so the wrapper can poll on app resume without treating "not done" as failure.
 */
export function claimNativeHandoff({ handoffId, claimSecret } = {}) {
  const id = String(handoffId || "").trim();
  const secret = String(claimSecret || "");
  if (!id || !secret) throw new Error("invalid_handoff_claim");

  const d = sweep(db());
  const rec = d[id];
  if (!rec) throw new Error("handoff_not_found");

  if (!hashesMatch(sha256Hex(secret), rec.claim_hash)) {
    rec.attempts = Number(rec.attempts || 0) + 1;
    if (rec.attempts >= MAX_CLAIM_ATTEMPTS) delete d[id];
    else d[id] = rec;
    save(d);
    throw new Error("claim_secret_mismatch");
  }

  if (!rec.deposited_at || !rec.session) {
    // Correct secret, but the wallet round trip is still in flight. Leave the
    // record alone so the wrapper can ask again.
    return { ok: true, pending: true };
  }

  const session = String(rec.session || "");
  const wallet = String(rec.wallet_hint || "");
  delete d[id];
  save(d);

  // Re-check on the way out: the session could have been revoked (or aged out)
  // between deposit and claim, and handing back a dead token would strand the
  // wrapper in a "logged in" state that fails on its first API call.
  if (!getSession(session)) throw new Error("session_invalid");

  return { ok: true, pending: false, session, wallet };
}

/** Exposed for tests. */
export const __testing = { sha256Hex, sweep, HANDOFF_FILE };
