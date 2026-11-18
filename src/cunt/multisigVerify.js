// Multisig signer-set verification (§18, §50). Pure logic, no I/O, no network.
//
// This module NEVER touches private keys. Every input is a public address or a
// signature — both public by definition. Key generation happens on the three
// devices; this only checks that what came off them is what we think it is.
//
// The checks worth knowing about, because they are the ones that fail silently:
//
//   1. AN OFF-CURVE ADDRESS IS A PDA. It has no private key and can never sign.
//      Put one in a 2-of-3 and you have not made a weaker 2-of-3 — you have made
//      a 2-of-2 with no recovery, and you find out the day you need it.
//
//   2. A BACKUP CUTS BOTH WAYS. A key survives losing a location only if its
//      backup is somewhere else (AND), but it is compromised if EITHER location
//      is breached (OR). So every backup you add makes loss less likely and
//      theft more likely. Those are different scenarios and they need separate
//      arithmetic — most setups only ever compute one of them.
//
//   3. TWO KEYS IN ONE PLACE IS THE WHOLE BALLGAME. If any single location
//      holds m keys, a burglar has the threshold. If it holds n-m+1, a fire
//      takes recovery. One house can fail both at once.

import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

// Addresses that are never a valid signer. Pasting one of these is a typo or a
// misunderstanding, not a choice.
export const RESERVED_ADDRESSES = new Map([
  ["11111111111111111111111111111111", "System Program"],
  ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "SPL Token Program"],
  ["ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", "Associated Token Program"],
  ["1nc1nerator11111111111111111111111111111111", "the incinerator (burn address)"],
  ["SysvarRent111111111111111111111111111111111", "Rent sysvar"],
]);

export class VerifyError extends Error {}

const norm = (s) => String(s ?? "").trim();

/**
 * Structural inspection of one address. Catches mangled pastes before they
 * become an on-chain mistake.
 */
export function inspectAddress(raw) {
  const address = norm(raw);
  const issues = [];
  const result = { address, valid: false, chars: address.length, bytes: null, onCurve: null, issues };

  if (!address) {
    issues.push({ level: "fail", code: "EMPTY", message: "no address given" });
    return result;
  }

  let decoded;
  try {
    decoded = bs58.decode(address);
  } catch {
    issues.push({ level: "fail", code: "NOT_BASE58", message: "not valid base58 — check for 0, O, I or l, which base58 excludes" });
    return result;
  }

  result.bytes = decoded.length;
  if (decoded.length !== 32) {
    issues.push({
      level: "fail",
      code: "WRONG_LENGTH",
      message: `decodes to ${decoded.length} bytes, not 32 — the paste is truncated or padded`,
    });
    return result;
  }

  // The 13Cr…CUNT lesson: a leading '1' is a literal zero byte, and any base58
  // implementation that routes through a BigInt silently drops it, yielding a
  // DIFFERENT 43-char address. Round-tripping proves this one survives.
  if (bs58.encode(decoded) !== address) {
    issues.push({
      level: "fail",
      code: "ROUNDTRIP",
      message: "does not survive a decode/encode round-trip — leading zero bytes were likely dropped",
    });
    return result;
  }

  const reserved = RESERVED_ADDRESSES.get(address);
  if (reserved) {
    issues.push({ level: "fail", code: "RESERVED", message: `this is ${reserved}, not a wallet` });
  }

  // The silent one. See the header note.
  result.onCurve = PublicKey.isOnCurve(decoded);
  if (!result.onCurve) {
    issues.push({
      level: "fail",
      code: "OFF_CURVE",
      message: "off the ed25519 curve — this is a PDA with NO private key. It can never sign, so a 2-of-3 containing it is really a 2-of-2 with no recovery.",
    });
  }

  if (/CUNT$/i.test(address)) {
    issues.push({
      level: "warn",
      code: "VANITY",
      message: "a ground vanity address is a software keyfile — it cannot live on a hardware wallet, which is what a signer key is for",
    });
  }

  result.valid = !issues.some((i) => i.level === "fail");
  return result;
}

/** Levenshtein distance — used to catch a transposed character, not to be clever. */
export function editDistance(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * The challenge a device must sign to prove it actually holds the key.
 *
 * Bound to the address, the purpose and a nonce, so a signature captured
 * anywhere else cannot be replayed into this ceremony.
 */
export function proofChallenge({ address, nonce, purpose = "CUNT multisig signer proof-of-possession", oneline = false }) {
  if (!norm(address)) throw new VerifyError("address required");
  if (!norm(nonce)) throw new VerifyError("nonce required");
  // Ledger's off-chain message signing accepts restricted ASCII; a newline can
  // push the message into a UTF-8 format the Solana app refuses. The one-line
  // form signs everywhere. Both bind the same three facts, so neither is weaker
  // — but the VERIFIER must be told which was signed, since a signature is over
  // exact bytes.
  const sep = oneline ? " | " : "\n";
  return `${purpose}${sep}address: ${norm(address)}${sep}nonce: ${norm(nonce)}`;
}

// Solana's off-chain message envelope (agave offchain_message.rs).
//
// `solana sign-offchain-message` does NOT sign the raw text. It signs:
//
//   b"\xffsolana offchain"  16 bytes
//   version                  u8   (0)
//   format                   u8   (0 restricted-ascii, 1 limited-utf8, 2 extended)
//   message length           u16 little-endian
//   message
//
// Browser wallets' signMessage() sign the RAW bytes. Both are legitimate and
// they are different signatures over different data — a verifier that knows
// only one rejects valid signatures from the other, which looks exactly like a
// broken device. This cost a real debugging round on the first signer.
const OFFCHAIN_DOMAIN = new Uint8Array([0xff, ...new TextEncoder().encode("solana offchain")]);

export function offchainEnvelope(message, format = 0, version = 0) {
  const body = new TextEncoder().encode(message);
  const out = new Uint8Array(OFFCHAIN_DOMAIN.length + 4 + body.length);
  out.set(OFFCHAIN_DOMAIN, 0);
  let i = OFFCHAIN_DOMAIN.length;
  out[i++] = version;
  out[i++] = format;
  out[i++] = body.length & 0xff;
  out[i++] = (body.length >> 8) & 0xff;
  out.set(body, i);
  return out;
}

/**
 * Verify a device really can sign. Skipping this is how a ceremony ends with a
 * key nobody can actually use — discovered later, when it matters.
 *
 * Accepts both encodings and reports which one matched, because "it failed" and
 * "it failed in the form your tool produces" are very different problems.
 */
export function verifyPossession({ address, message, signature }) {
  const pub = bs58.decode(norm(address));
  let sig;
  try {
    sig = bs58.decode(norm(signature));
  } catch {
    return { ok: false, reason: "signature is not valid base58" };
  }
  if (pub.length !== 32) return { ok: false, reason: "address does not decode to 32 bytes" };
  if (sig.length !== 64) return { ok: false, reason: `signature is ${sig.length} bytes, expected 64` };

  const verify = (bytes) => nacl.sign.detached.verify(bytes, sig, pub);
  if (verify(new TextEncoder().encode(message))) {
    return { ok: true, encoding: "raw", $note: "raw UTF-8 — a browser wallet's signMessage()" };
  }
  for (const format of [0, 1, 2]) {
    if (verify(offchainEnvelope(message, format))) {
      return { ok: true, encoding: `offchain-v0-format-${format}`, $note: "Solana off-chain message envelope — `solana sign-offchain-message`" };
    }
  }
  return { ok: false, reason: "signature does not verify against this address, in either the raw or off-chain-envelope encoding" };
}

/**
 * Set-level checks: duplicates, typos, threshold arithmetic.
 */
export function verifySignerSet(addresses, { m = 2 } = {}) {
  const findings = [];
  const n = addresses.length;

  if (n < 2) findings.push({ level: "fail", code: "TOO_FEW", message: "a multisig needs at least 2 signers" });
  if (n > 11) findings.push({ level: "fail", code: "TOO_MANY", message: "SPL native multisig supports at most 11 signers" });
  if (m > n) findings.push({ level: "fail", code: "THRESHOLD_IMPOSSIBLE", message: `threshold ${m} exceeds ${n} signers` });
  if (m === n) {
    findings.push({
      level: "fail",
      code: "NO_RECOVERY",
      message: `${m}-of-${n} has NO recovery: lose any one key and the treasury is frozen permanently`,
    });
  }
  if (m < 2) findings.push({ level: "fail", code: "THRESHOLD_TOO_LOW", message: "a threshold of 1 is a single key wearing a costume" });

  const seen = new Map();
  for (const a of addresses) {
    const key = norm(a);
    if (seen.has(key)) {
      findings.push({ level: "fail", code: "DUPLICATE", message: `${key} appears twice — that is ${n - 1} keys, not ${n}` });
    }
    seen.set(key, true);
  }

  const list = [...new Set(addresses.map(norm))];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const d = editDistance(list[i], list[j]);
      if (d > 0 && d <= 2) {
        findings.push({
          level: "fail",
          code: "NEAR_DUPLICATE",
          message: `two addresses differ by only ${d} character(s) — almost certainly a typo, not two keys (${list[i]} / ${list[j]})`,
        });
      }
    }
  }

  return { n, m, findings };
}

/**
 * A location is a BLAST RADIUS, not a room.
 *
 * The matrix treats location strings as independent, so "home-office" and
 * "home-safe" look like two places and survive each other's fire. They do not:
 * they are one building. This flags names that share a leading token, because
 * that is exactly how the mistake gets written down — and a setup that fails
 * only when you notice the two names mean one house is the setup most likely
 * to be believed.
 */
export function suspectedSharedSite(locations) {
  const site = (l) => String(l).split(/[-_ ]/)[0].toLowerCase();
  const groups = new Map();
  for (const l of new Set(locations.filter(Boolean))) {
    const s = site(l);
    groups.set(s, [...(groups.get(s) || []), l]);
  }
  return [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([s, members]) => ({ site: s, locations: members }));
}

/**
 * THE MEASUREMENT NOBODY TAKES.
 *
 * Three keys is not the same as three places. This enumerates every single
 * location and device, and asks two DIFFERENT questions:
 *
 *   loss       — the location burns down. A key survives only if its backup is
 *                somewhere else. Recovery needs m survivors.
 *   compromise — the location is breached. A key is exposed if EITHER its
 *                device or its backup is there. Theft needs m exposures.
 *
 * @param {Array<{id, location, device, backup_location?, online?}>} signers
 */
export function lossMatrix(signers, m) {
  const n = signers.length;
  const locations = [...new Set(signers.flatMap((s) => [s.location, s.backup_location].filter(Boolean)))];
  const devices = [...new Set(signers.map((s) => s.device).filter(Boolean))];

  const scenarios = [];

  const evaluate = (label, kind, hit) => {
    // Loss needs BOTH copies gone; compromise needs EITHER.
    const lost = signers.filter((s) => hit(s.location) && (!s.backup_location || hit(s.backup_location)));
    const exposed = signers.filter((s) => hit(s.location) || (s.backup_location && hit(s.backup_location)));
    const surviving = n - lost.length;
    scenarios.push({
      scenario: label,
      kind,
      lost: lost.map((s) => s.id),
      exposed: exposed.map((s) => s.id),
      surviving,
      can_still_sign: surviving >= m,
      attacker_has_threshold: exposed.length >= m,
      fatal: surviving < m || exposed.length >= m,
    });
  };

  for (const loc of locations) evaluate(`"${loc}" destroyed or breached`, "location", (x) => x === loc);
  for (const dev of devices) {
    const ids = signers.filter((s) => s.device === dev).map((s) => s.id);
    const lost = signers.filter((s) => s.device === dev && !s.backup_location);
    const exposed = signers.filter((s) => s.device === dev);
    scenarios.push({
      scenario: `device "${dev}" compromised`,
      kind: "device",
      lost: lost.map((s) => s.id),
      exposed: exposed.map((s) => s.id),
      surviving: n - lost.length,
      can_still_sign: n - lost.length >= m,
      attacker_has_threshold: exposed.length >= m,
      fatal: n - lost.length < m || exposed.length >= m,
      signers: ids,
    });
  }

  const perLocation = locations.map((loc) => signers.filter((s) => s.location === loc || s.backup_location === loc).length);
  const online = signers.filter((s) => s.online);

  const measurements = {
    signers: n,
    threshold: m,
    // How many you can lose and still spend.
    redundancy: n - m,
    // How many an attacker must obtain. The lower this is, the cheaper the attack.
    keys_attacker_needs: m,
    // How many losses break recovery forever.
    losses_until_frozen: n - m + 1,
    distinct_locations: locations.length,
    distinct_devices: devices.length,
    // The single most predictive number in the whole exercise.
    max_keys_at_one_location: perLocation.length ? Math.max(...perLocation) : 0,
    keys_with_online_exposure: online.length,
    single_points_of_failure: scenarios.filter((s) => s.fatal).map((s) => s.scenario),
  };

  measurements.effective_threshold_against_worst_case = measurements.single_points_of_failure.length ? 1 : m;

  return { scenarios, measurements };
}
