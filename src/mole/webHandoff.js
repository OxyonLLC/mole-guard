/**
 * Desktop-to-phone session hand-off for /verify/.
 *
 * The problem this solves: on desktop the user may have no wallet extension,
 * so they need to finish inside a mobile wallet. The page therefore offered a
 * "verify link" to send to their phone — and that link was
 * `https://winlew.co/verify/?session=<token>`, i.e. the live session token
 * itself, in a URL. The page's own copy admitted it: "Treat this link like a
 * password… never paste it into a chat, a ticket, or a screenshot."
 *
 * Two buttons on that same panel then did exactly that. "Phantom handoff" and
 * "Solflare handoff" wrapped the URL into
 * `https://phantom.app/ul/browse/<encoded>` and the Solflare equivalent, which
 * are real HTTPS requests to those companies — so the session token travelled
 * in the path of a third-party request and landed in a third party's logs. It
 * is the same leak as the QR code that was removed in August 2026 for handing
 * the token to api.qrserver.com; that fix caught the picture and missed the
 * two buttons beside it.
 *
 * The shape here is the authorization-code exchange again, but note that the
 * DIRECTION IS REVERSED from src/mole/nativeHandoff.js, and that changes the
 * design in one important way. In the native flow the *receiver* (the wrapper)
 * starts the exchange, so it can invent a claim secret in advance and register
 * only its hash. Here the *sender* (the desktop) has the session and the
 * receiver is a phone that has never spoken to us. The receiver cannot
 * pre-register anything, so the server mints a pairing code instead:
 *
 *   1. start — the desktop presents its live session. It gets back a handoff
 *              id AND a six-digit pairing code. The id goes in the link; the
 *              code is displayed on the desktop screen and never travels.
 *   2. claim — the phone presents the id *and* the code. A fresh session is
 *              returned exactly once, and the record is tombstoned.
 *
 * So the link is inert on its own. Phantom's logs, a screenshot of the URL
 * bar, a forwarded message, browser history — all get an identifier that
 * cannot be redeemed without a code that only ever existed on the other
 * screen.
 *
 * Two further properties worth stating because they are deliberate:
 *
 * - The desktop's own token NEVER leaves the server. `claim` mints a NEW
 *   session for the same Discord user rather than copying the existing one, so
 *   the phone and the desktop can be revoked independently, and the token the
 *   desktop holds is never transmitted anywhere at all.
 *
 * - The new session inherits the REMAINING life of the originating one, capped
 *   at HANDOFF_SESSION_MAX_TTL_SEC. A hand-off must not be a way to extend
 *   authority past what the desktop already had — otherwise chaining hand-offs
 *   would renew a session forever.
 *
 * Residual risk, stated rather than hidden: whoever holds both the id and the
 * code can claim, once. That is inherent to a link the user copies themselves,
 * and it is why the code is displayed only on the originating screen, why the
 * window is five minutes rather than fifteen, and why `peek` exists — the
 * desktop can see that its hand-off was claimed, so a user who did not claim
 * it learns that someone else did.
 */

import crypto from "crypto";
import { nanoid } from "nanoid";
import { readJson, writeJson } from "./storage.js";
import { createSession, getSession } from "./sessions.js";

const HANDOFF_FILE = "web_handoffs.json";

/**
 * Two modes, because the two flows have different amounts of secrecy available.
 *
 * PAIRED — desktop to phone. Two screens exist, so a six-digit code can be
 *   displayed on one and typed into the other. The link is inert on its own.
 *   This is the strong one.
 *
 * DIRECT — same device, when the user taps "Open in Phantom" and the wallet's
 *   in-app browser opens as a separate storage context. There is NO second
 *   screen, so there is nowhere to show a code the link doesn't also reach.
 *   The id alone therefore redeems, and this mode is honestly weaker.
 *
 *   What it still buys is large. Before, the URL handed to phantom.app carried
 *   a session token valid for hours and replayable any number of times. Now it
 *   carries an id that is single-use and lives for two minutes, so redeeming it
 *   means winning a race against a page that loads a second later. A leak of a
 *   DIRECT id is a race; a leak of a session token was a key.
 *
 *   It is not equivalent to PAIRED and must not be described as if it were.
 */
export const HANDOFF_MODES = Object.freeze({ PAIRED: "paired", DIRECT: "direct" });

/** Deliberately shorter than the native wrapper's 15 minutes. That one covers
 *  an unhurried first-time wallet round trip; this one covers typing six
 *  digits, and the link is a live target for exactly as long as this lasts.
 *  Re-generating is one click. */
export const WEB_HANDOFF_TTL_SEC = 5 * 60;

/** DIRECT lives for as long as an app switch plausibly takes and no longer:
 *  tap, the OS resolves the universal link, the wallet cold-starts, the page
 *  loads. Ten seconds is typical and this allows twelve times that. Every extra
 *  second is a second the id is redeemable by whoever read it in transit, so
 *  this should be raised only if real-device testing proves it too tight —
 *  and then by the smallest amount that works. */
export const WEB_HANDOFF_DIRECT_TTL_SEC = 120;

/** Ceiling on the session handed to the phone. The real limit is the
 *  originating session's own remaining life; this only stops a very long-lived
 *  Discord session from minting an equally long-lived one on an unknown
 *  device. */
export const HANDOFF_SESSION_MAX_TTL_SEC = 60 * 60;

/** Wrong-code guesses tolerated before the record is burned. Unlike the native
 *  flow's 256-bit secret, a six-digit code IS guessable in principle — 1 in a
 *  million per try — so here the attempt cap is load-bearing, not just an
 *  anti-oracle measure. Five attempts against a five-minute window is 5e-6. */
const MAX_CLAIM_ATTEMPTS = 5;

/** Defensive ceiling on concurrent pending hand-offs; oldest go first. */
const MAX_OPEN_HANDOFFS = 5000;

const CODE_DIGITS = 6;

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

/** Uniform six-digit code. crypto.randomInt rejects out-of-range draws
 *  internally, so this has no modulo bias — `randomBytes % 1000000` would. */
function mintPairingCode() {
  return String(crypto.randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, "0");
}

/** Digits only, so a user pasting "123 456" or "123-456" is not punished. */
export function normalizePairingCode(value) {
  return String(value == null ? "" : value).replace(/\D+/g, "");
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
 * Step 1, called by the desktop page. Requires a live session — otherwise
 * anyone could mint hand-offs and use the store as free storage.
 *
 * Returns the pairing code in clear exactly once, to the caller that already
 * holds the session. Only its hash is stored.
 */
export function startWebHandoff({ session, mode = HANDOFF_MODES.PAIRED } = {}) {
  const token = String(session || "").trim();
  if (!token) throw new Error("session_required");
  if (mode !== HANDOFF_MODES.PAIRED && mode !== HANDOFF_MODES.DIRECT) throw new Error("invalid_handoff_mode");

  const rec = getSession(token);
  if (!rec) throw new Error("session_invalid");

  const direct = mode === HANDOFF_MODES.DIRECT;
  const d = sweep(db());
  const handoffId = nanoid(32);
  // A DIRECT hand-off has no code at all. Minting one and not using it would
  // be worse than none: it would look like a second factor in the record while
  // the claim path ignored it.
  const pairingCode = direct ? "" : mintPairingCode();
  const created = nowSec();
  const ttl = direct ? WEB_HANDOFF_DIRECT_TTL_SEC : WEB_HANDOFF_TTL_SEC;

  // Never store the originating token. All the phone's session needs is the
  // Discord identity behind it, and the remaining life it is allowed to
  // inherit — so that is all this record holds.
  const remaining = Math.max(0, Number(rec.expires_at || 0) - created);
  d[handoffId] = {
    mode,
    code_hash: direct ? "" : sha256Hex(pairingCode),
    discord_user_id: String(rec.discordUserId || ""),
    grant_ttl_sec: Math.min(remaining, HANDOFF_SESSION_MAX_TTL_SEC),
    created_at: created,
    expires_at: created + ttl,
    claimed_at: 0,
    attempts: 0,
  };
  save(d);

  return {
    handoffId,
    mode,
    pairingCode,
    expiresAt: created + ttl,
    ttlSec: ttl,
  };
}

/**
 * Step 2, called by the phone. Mints and returns a fresh session exactly once.
 *
 * The record is tombstoned rather than deleted so that `peek` can tell the
 * desktop "this was claimed" instead of the ambiguous "gone" — a user who did
 * not claim it needs to be able to tell that someone else did.
 */
export function claimWebHandoff({ handoffId, pairingCode } = {}) {
  const id = String(handoffId || "").trim();
  const code = normalizePairingCode(pairingCode);
  if (!id) throw new Error("invalid_handoff_claim");

  const d = sweep(db());
  const rec = d[id];
  if (!rec) throw new Error("handoff_not_found");
  if (rec.claimed_at) throw new Error("handoff_already_claimed");

  // Default to PAIRED for any record without an explicit mode. Records written
  // before DIRECT existed have no `mode`, and the safe reading of a missing
  // field is "the one that requires a code", never "the one that doesn't".
  const direct = rec.mode === HANDOFF_MODES.DIRECT;

  if (!direct) {
    if (!code) {
      // Distinct from a wrong code, and deliberately does NOT count as a failed
      // attempt. The site-wide auto-claim in wallet-auth.js probes every ?h=
      // it sees without a code; if that burned attempts, five page loads would
      // destroy a hand-off the user was about to complete correctly.
      throw new Error("pairing_code_required");
    }
    if (!hashesMatch(sha256Hex(code), rec.code_hash)) {
      rec.attempts = Number(rec.attempts || 0) + 1;
      // Burn on too many misses. Deleting outright (rather than tombstoning) is
      // right here: there was no legitimate claim, so there is nothing to report
      // back, and leaving a record would let a flood pin storage.
      if (rec.attempts >= MAX_CLAIM_ATTEMPTS) delete d[id];
      else d[id] = rec;
      save(d);
      throw new Error("pairing_code_mismatch");
    }
  }

  const ttl = Number(rec.grant_ttl_sec || 0);
  if (!rec.discord_user_id || ttl <= 0) {
    // The originating session had already aged out by the time the phone
    // arrived. Handing back a session with no life left would strand the phone
    // in a "logged in" state that fails on its first API call.
    delete d[id];
    save(d);
    throw new Error("handoff_expired");
  }

  const session = createSession(rec.discord_user_id, ttl);

  // Keep code_hash on the tombstone. Clearing it looks tidier and quietly
  // breaks peek(): with no hash to compare, peek would have to report "claimed"
  // to anyone holding the id alone, which is exactly the probe this design
  // says it prevents. The code is single-use regardless — claimed_at is what
  // refuses a second claim.
  rec.claimed_at = nowSec();
  rec.discord_user_id = "";
  rec.grant_ttl_sec = 0;
  d[id] = rec;
  save(d);

  return { ok: true, session, expiresInSec: ttl };
}

/**
 * Lets the originating desktop see whether its hand-off has been used. Both
 * the id and the code are required, so this cannot be used to probe which ids
 * exist — and it never returns the session.
 */
export function peekWebHandoff({ handoffId, pairingCode } = {}) {
  const id = String(handoffId || "").trim();
  const code = normalizePairingCode(pairingCode);
  if (!id || !code) throw new Error("invalid_handoff_peek");

  const d = sweep(db());
  const rec = d[id];
  // Unknown and expired are deliberately the same answer, so an id alone
  // reveals nothing about whether it was ever real.
  if (!rec) return { ok: true, status: "expired" };

  // A DIRECT record has no code, so there is nothing to authenticate against —
  // answering at all would let anyone holding the id watch it. Nothing polls
  // these anyway: the same-device flow completes in seconds and the screen that
  // started it is gone.
  if (rec.mode === HANDOFF_MODES.DIRECT) throw new Error("peek_unsupported");

  // Authenticate FIRST, including on a claimed record — otherwise holding the
  // id alone would be enough to learn that a hand-off existed and was used.
  if (!hashesMatch(sha256Hex(code), rec.code_hash)) throw new Error("pairing_code_mismatch");

  if (rec.claimed_at) return { ok: true, status: "claimed", claimedAt: Number(rec.claimed_at) };
  return { ok: true, status: "pending", expiresAt: Number(rec.expires_at || 0) };
}

/** Exposed for tests. */
export const __testing = { sha256Hex, sweep, mintPairingCode, HANDOFF_FILE, MAX_CLAIM_ATTEMPTS };
