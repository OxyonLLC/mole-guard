// WinLEW Governance v1.1 — point-in-time eligibility snapshots.
//
// Honest limitation, stated once here and repeated in docs/governance-v1.1-
// hardening.md: this is NOT a chain-wide historical holder snapshot. This
// repository has no indexer capable of answering "what did every wallet
// hold at block N" after the fact. What this file actually provides is
// narrower but still real: the FIRST successful eligibility check for a
// given wallet on a given proposal, at or after that proposal's snapshot
// boundary, is recorded immutably and reused for every later check on that
// same proposal+wallet pair — so a wallet cannot change its own recorded
// eligibility by acquiring or disposing of tokens after that first check.
// A wallet that is never checked before voting closes simply never gets a
// snapshot (and therefore was never eligible to vote in the first place,
// since voting itself triggers the same check).
import { readJson, writeJson } from "./storage.js";
import { resolveSnapshotBoundaryIso } from "./governanceData.js";

const SNAPSHOTS_FILE = "governance_eligibility_snapshots.json";

function readAllSnapshots() {
  return readJson(SNAPSHOTS_FILE, {});
}

function writeAllSnapshots(snapshots) {
  writeJson(SNAPSHOTS_FILE, snapshots);
}

function nowIso() {
  return new Date().toISOString();
}

/** Read-only — the recorded snapshot for one wallet on one proposal, or null if none exists yet. */
function getRecordedSnapshot(proposalId, walletAddress) {
  if (!walletAddress) return null;
  const snapshots = readAllSnapshots();
  return snapshots[proposalId]?.[walletAddress] || null;
}

/**
 * Resolves eligibility for a wallet against a proposal's snapshot boundary.
 *
 * - Before the boundary (or if the proposal has none): delegates straight to
 *   `checkLiveEligibility` and returns a `preview: true` result — nothing is
 *   recorded, since there is nothing to lock in yet.
 * - At/after the boundary: if a snapshot already exists for this
 *   proposal+wallet, it is returned as-is — the live balance is never
 *   consulted again. If none exists yet, `checkLiveEligibility` is called
 *   once; a successful result is recorded immutably (first-write-wins under
 *   concurrency — see below); a failed (RPC-unavailable) result is NEVER
 *   recorded, so a transient outage can't lock a wallet into a false
 *   ineligible snapshot — the next check (by this or another concurrent
 *   caller) gets to try again fresh.
 *
 * `checkLiveEligibility` is injected (not imported directly) so tests and
 * the fault-injection walkthrough can force a deterministic RPC failure
 * without touching real Solana RPC or pointing production at a fake
 * endpoint — see src/mole/web.js's resolveGovernanceEligibility().
 */
async function resolveSnapshotEligibility({ proposal, walletAddress, checkLiveEligibility, nowMs = Date.now() }) {
  if (!walletAddress) {
    return { eligible: false, reason: "wallet_not_verified", wallet: null, balance: null, balanceCheckOk: true, preview: true, snapshot: null };
  }

  const boundaryIso = resolveSnapshotBoundaryIso(proposal);
  const boundaryMs = boundaryIso ? Date.parse(boundaryIso) : NaN;
  const atOrPastBoundary = Number.isFinite(boundaryMs) && nowMs >= boundaryMs;

  if (!atOrPastBoundary) {
    const live = await checkLiveEligibility(walletAddress);
    return { ...live, preview: true, snapshot: null };
  }

  const existing = getRecordedSnapshot(proposal.id, walletAddress);
  if (existing) {
    return { ...existing, preview: false, snapshot: existing };
  }

  const live = await checkLiveEligibility(walletAddress);
  if (!live.balanceCheckOk) {
    // Never record a snapshot from a failed check — return the honest
    // "unavailable" state and let the next attempt (this or a concurrent
    // caller) try again fresh.
    return { ...live, preview: false, snapshot: null };
  }

  const record = {
    eligible: live.eligible,
    balance: live.balance,
    balanceCheckOk: true,
    snapshotAtIso: boundaryIso,
    recordedAtIso: nowIso(),
    source: "live-balance-snapshot",
  };

  // Compare-and-swap-style first-write-wins: re-read immediately before the
  // write in case a concurrent caller already recorded one while this
  // call's own async balance check was in flight. Both the read and the
  // write below happen with no further `await` in between, so nothing else
  // can interleave inside this specific window.
  const snapshots = readAllSnapshots();
  if (!snapshots[proposal.id]) snapshots[proposal.id] = {};
  if (snapshots[proposal.id][walletAddress]) {
    // Someone else won the race — use their recorded result, not ours.
    return { ...snapshots[proposal.id][walletAddress], preview: false, snapshot: snapshots[proposal.id][walletAddress] };
  }
  snapshots[proposal.id][walletAddress] = record;
  writeAllSnapshots(snapshots);

  return { eligible: record.eligible, balance: record.balance, balanceCheckOk: true, preview: false, snapshot: record };
}

export { resolveSnapshotEligibility, getRecordedSnapshot, readAllSnapshots };
