// Participation signals — hashed device and network identity.
//
// Stage 2 of the participation trust layer. This module COLLECTS and HASHES.
// It decides nothing and blocks nobody; the risk engine that reads these lands
// in Stage 3, behind its own flag.
//
// The abuse it exists to make visible (2026-08-14): one participant, many
// wallets, payout moved to a fresh wallet each time. Nothing counted wallets
// per device, so a new wallet reset every limit. A device hash gives that
// counting something to key on.
//
// PRIVACY IS THE POINT, NOT AN AFTERTHOUGHT:
//   • No raw IP is ever stored. The address is reduced to its network (/24 for
//     IPv4, /48 for IPv6) and then salted-hashed, so a household is one bucket
//     and the original address is not recoverable from what we keep.
//   • No raw fingerprint value is ever stored. User agent, platform, timezone,
//     screen and so on go in; one hash comes out.
//   • Rotating PARTICIPATION_HASH_SALT deliberately breaks all correlation with
//     older records. That is the retention mechanism, not a side effect.
//   • Nothing here is ever anchored publicly. See the privacy table in
//     docs/participation-trust.md.
//
// The hashing approach is ported from GeoPresence's apps/api/src/lib
// (hashDeviceFingerprint, hashClaim) rather than reinvented — but note the
// inversion: GeoPresence scores DEVICES PER WALLET, and WinLEW's abuse is the
// mirror image, WALLETS PER DEVICE. Stage 3 does that counting.

import { createHash } from "node:crypto";
import { resolveClientKey } from "./clientIp.js";

/** Enabled separately from every later stage — collection is not decision. */
export function signalsEnabled() {
  return String(process.env.PARTICIPATION_SIGNALS_ENABLED || "").toLowerCase() === "true";
}

function salt() {
  // No default in production. An unset salt means unsalted hashes, which would
  // be reversible for a small input space like a /24 — so collection is simply
  // off instead.
  return process.env.PARTICIPATION_HASH_SALT || "";
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

/** Sort keys at every depth so semantically equal inputs hash identically. */
function canonicalize(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.keys(value)
    .sort()
    .reduce((acc, key) => {
      acc[key] = canonicalize(value[key]);
      return acc;
    }, {});
}

// Only these fields are read from whatever the client sends. An allowlist, not a
// filter: a client that posts extra keys cannot widen what we store, and cannot
// smuggle a stable identifier of its own choosing into the hash.
const FINGERPRINT_FIELDS = ["userAgent", "platform", "language", "timezone", "screen", "memory", "cores"];

/**
 * One stable hash per browser/device environment. Returns null when there is
 * too little to be worth storing — a hash of three empty strings would collide
 * for every visitor who blocks everything, which is a false signal, not a weak
 * one.
 */
export function hashDeviceFingerprint(fingerprint = {}) {
  const s = salt();
  if (!s) return null;

  const picked = {};
  let present = 0;
  for (const field of FINGERPRINT_FIELDS) {
    const value = fingerprint?.[field];
    if (value === undefined || value === null || value === "") continue;
    // Bounded: a client cannot make us hash a megabyte of user agent.
    picked[field] = String(value).slice(0, 256);
    present += 1;
  }
  if (present < 3) return null;

  return sha256(`${s}:device:${JSON.stringify(canonicalize(picked))}`);
}

/**
 * Network bucket, not an address. IPv4 keeps three octets, IPv6 keeps the
 * routing prefix — enough that one household shares a bucket, not enough to
 * identify a machine.
 */
export function hashNetwork(ip) {
  const s = salt();
  const raw = String(ip || "").trim();
  if (!s || !raw || raw === "unknown") return null;

  let bucket;
  if (raw.includes(":")) {
    bucket = raw.split(":").slice(0, 3).join(":"); // /48
  } else {
    const parts = raw.split(".");
    if (parts.length !== 4) return null;
    bucket = `${parts[0]}.${parts[1]}.${parts[2]}`; // /24
  }
  return sha256(`${s}:net:${bucket}`);
}

/**
 * Everything Stage 2 records for one request. Never throws: a signal problem
 * must never fail a quiz answer, so the caller can treat null as "no signal"
 * and carry on.
 */
export function collectSignals(req, fingerprint) {
  if (!signalsEnabled() || !salt()) return null;
  try {
    const ip = resolveClientKey({
      reqIp: req?.ip,
      headers: req?.headers || {},
      secret: process.env.WEB_PROXY_SHARED_SECRET || "",
    });
    const deviceHash = hashDeviceFingerprint(fingerprint || {});
    const netHash = hashNetwork(ip);
    if (!deviceHash && !netHash) return null;
    return { deviceHash, netHash };
  } catch {
    return null;
  }
}
