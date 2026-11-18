// Payout receipts — Stage 5.
//
// A receipt answers "why did this payout happen?" in a form someone else can
// check without trusting our database, our screenshots, or our payout worker.
//
// TWO DELIBERATE BOUNDARIES:
//
// 1. NO @xyo-network DEPENDENCY HERE. GeoProof's reference implementation needs
//    @xyo-network 7.x and runs TypeScript directly in another workspace. Adding
//    that to WinLEW would put a version conflict or a broken install directly in
//    the payout path. Instead this module builds the canonical decision payload
//    and its hash with nothing but node:crypto, and an optional HTTP client
//    hands it to a GeoProof service that owns the XYO half. If that service is
//    down, payouts continue and receipts are simply absent.
//
// 2. COMMITMENT → PRIVATE EVIDENCE, NEVER THE REVERSE. The payload carries
//    HASHES of evidence, never evidence. No IP, no device fingerprint, no GPS,
//    no session token, no Discord handle. A receipt is safe to publish; the
//    evidence behind it stays in the database where a reviewer with access can
//    look at it.
//
// The verdict is not asserted, it is DERIVED — GeoProof's Law I, "belief must be
// earned". buildPayoutDecision() recomputes the payout amount and the risk band
// from inputs, so replaying the same inputs must produce the same hash. If our
// database were edited afterwards, the recomputed hash would stop matching the
// receipt we issued.

import { createHash } from "node:crypto";

export const RECEIPT_VERSION = "winlew-payout-receipt/1.0.0";

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

/** Sort keys at every depth so an identical decision always serialises
 *  identically — the property the whole replay idea rests on. */
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

export function canonicalHash(payload) {
  return sha256(JSON.stringify(canonicalize(payload)));
}

// Everything a receipt may contain. An allowlist rather than a redaction pass:
// a new field on a redemption record cannot leak into a published receipt by
// being forgotten about, because it has to be named here first.
const RECEIPT_FIELDS = [
  "receiptVersion", "recordId", "kind", "cycleId",
  "participantRef", "walletRef",
  "points", "winlewAmount",
  "decision", "riskBand", "riskScore", "riskSignals", "rulesVersion",
  "settlementMode", "decidedAtIso",
];

/**
 * The canonical decision payload for one payout.
 *
 * Identifiers are REFERENCES, not identities: the Discord id and the wallet are
 * hashed with the receipt salt. A reviewer holding the database can confirm a
 * reference matches a user; a stranger holding the receipt learns nothing about
 * who was paid.
 */
export function buildPayoutDecision(record, { salt = process.env.PAYOUT_RECEIPT_SALT || "", now = Date.now() } = {}) {
  if (!record?.id) throw new Error("payout_receipt_requires_record_id");
  if (!salt) throw new Error("payout_receipt_requires_salt");

  const ref = (value, label) => (value ? sha256(`${salt}:${label}:${value}`) : null);

  const decision = {
    receiptVersion: RECEIPT_VERSION,
    recordId: String(record.id),
    kind: String(record.kind || "unknown"),
    cycleId: record.cycleId ? String(record.cycleId) : null,

    participantRef: ref(record.userId, "participant"),
    walletRef: ref(record.payoutWallet, "wallet"),

    points: Number(record.amount || 0),
    winlewAmount: Number(record.winlewSent ?? record.winlewDue ?? 0),

    // The risk verdict is copied from what was actually recorded at decision
    // time, including its rules version. A later change to the thresholds must
    // not retroactively change what this receipt says was decided.
    decision: String(record.decision || "settle"),
    riskBand: record.risk?.band || "normal",
    riskScore: Number.isFinite(record.risk?.score) ? Number(record.risk.score) : 0,
    riskSignals: Array.isArray(record.risk?.signals) ? [...record.risk.signals].sort() : [],
    rulesVersion: record.risk?.rulesVersion || "none",

    settlementMode: String(record.settlementMode || "unknown"),
    decidedAtIso: new Date(record.paidTs || now).toISOString(),
  };

  // Enforce the allowlist rather than trusting the literal above to stay honest.
  for (const key of Object.keys(decision)) {
    if (!RECEIPT_FIELDS.includes(key)) throw new Error(`receipt_field_not_allowlisted:${key}`);
  }
  return decision;
}

/**
 * Recompute a decision from a record and compare it to a receipt's hash.
 *
 * This is the point of the exercise: an independent process, given the record
 * and the salt, reaches the same hash — or does not, in which case the record
 * changed after the receipt was issued.
 */
export function replayPayoutDecision(record, receipt, options = {}) {
  const recomputed = buildPayoutDecision(record, options);
  const recomputedHash = canonicalHash(recomputed);
  const matches = recomputedHash === receipt?.decisionHash;
  return {
    matches,
    recomputedHash,
    receiptHash: receipt?.decisionHash || null,
    decision: recomputed,
  };
}

export function receiptsEnabled() {
  return String(process.env.GEOPROOF_RECEIPTS_ENABLED || "").toLowerCase() === "true";
}

export function anchoringEnabled() {
  return String(process.env.GEOPROOF_ANCHORING_ENABLED || "").toLowerCase() === "true";
}

/**
 * Build the receipt, and ask the GeoProof service to attest it if one is
 * configured.
 *
 * NEVER THROWS. A receipt is evidence produced alongside a payout, not a gate on
 * it — the participant earned the money whether or not our attestation service
 * is reachable. An unreachable service yields a locally-valid receipt with no
 * attestation, which is still replayable.
 */
export async function issuePayoutReceipt(record, { fetchImpl = fetch, timeoutMs = 5000, ...options } = {}) {
  if (!receiptsEnabled()) return null;

  let decision;
  try {
    decision = buildPayoutDecision(record, options);
  } catch (error) {
    console.warn("[receipt] could not build decision:", error?.message || error);
    return null;
  }

  const receipt = {
    decisionHash: canonicalHash(decision),
    decision,
    issuedAtIso: new Date().toISOString(),
    attestation: null,
  };

  const serviceUrl = process.env.GEOPROOF_SERVICE_URL;
  if (!serviceUrl) return receipt;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // Only the HASH crosses the wire by default. The service's job is to attest
    // that a decision with this hash existed at this time — it does not need to
    // know what was decided, and anchoring must never carry the payload.
    const res = await fetchImpl(`${String(serviceUrl).replace(/\/$/, "")}/attest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decisionHash: receipt.decisionHash,
        receiptVersion: RECEIPT_VERSION,
        anchor: anchoringEnabled(),
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const body = await res.json();
      receipt.attestation = {
        verifier: body?.verifier || null,
        proofHash: body?.proofHash || null,
        anchored: Boolean(body?.anchored),
        at: new Date().toISOString(),
      };
    } else {
      console.warn(`[receipt] attestation service returned ${res.status}`);
    }
  } catch (error) {
    console.warn("[receipt] attestation unavailable:", error?.message || error);
  }

  return receipt;
}
