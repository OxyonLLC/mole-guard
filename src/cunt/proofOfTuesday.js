// Proof of Tuesday — participation history, derived (§35).
//
// PROOF OF TUESDAY > PROOF OF WEALTH.
//
// The single most important property: NOTHING HERE IS STORED. Every figure is
// computed from claim records that already exist on chain. There is no Proof of
// Tuesday account to write to, so there is nothing to forge, nothing to edit,
// and nothing an authority can adjust. §37 forbids an instruction that edits
// claim history; deriving the record rather than storing it means such an
// instruction has nothing to point at.
//
// It is also why this runs OFF chain. §29: the chain enforces, the bot and the
// website report. Scanning every epoch for one identity is trivial in an
// indexer and wasteful in a program, and nothing depends on the result being
// available on-chain — no reward, no weight, no gate. (§35 is explicit that
// voting weight must not be built on this without separate review. It has not
// been.)
//
// Keyed by IDENTITY, not wallet, so a rotated wallet keeps its history and a
// second wallet cannot fork a second record.

import { EPOCH_STATUS, statusAt } from "./epoch.js";

/**
 * Which epochs a given identity could possibly have claimed, in order.
 *
 * An epoch counts as eligible if the identity had registered before it ended —
 * registering mid-epoch still leaves time to claim. Epochs that had already
 * closed when they joined are NOT counted, because calling those "missed" would
 * punish someone for the period before they existed.
 */
export function eligibleEpochs(state, { identityHash, asOfTs }) {
  const registeredAt = state.registeredAt.get(identityHash) ?? null;
  return [...state.epochs.values()]
    .filter((e) => e.startTs <= asOfTs) // has begun
    .filter((e) => registeredAt === null || registeredAt < e.endTs)
    .sort((a, b) => a.epochNumber - b.epochNumber);
}

const claimed = (state, epochNumber, identityHash) =>
  state.claims.has(`${epochNumber}:${identityHash}`);

/**
 * The full record. All counts are plain numbers; `totalClaimed` is BigInt
 * because it is a token amount.
 *
 * @returns {{
 *   firstEpoch: number|null, totalEligibleEpochs: number, totalClaimedEpochs: number,
 *   missedEpochs: number, currentStreak: number, longestStreak: number,
 *   totalClaimed: bigint, pendingEpoch: number|null
 * }}
 */
export function proofOfTuesday(state, { identityHash, asOfTs }) {
  const epochs = eligibleEpochs(state, { identityHash, asOfTs });

  let firstEpoch = null;
  let totalClaimedEpochs = 0;
  let missedEpochs = 0;
  let totalClaimed = 0n;
  let longestStreak = 0;
  let run = 0;
  let pendingEpoch = null;

  for (const e of epochs) {
    const didClaim = claimed(state, e.epochNumber, identityHash);
    const status = statusAt(e, asOfTs);
    const resolved = status !== EPOCH_STATUS.OPEN; // closed or finalized

    if (didClaim) {
      if (firstEpoch === null) firstEpoch = e.epochNumber;
      totalClaimedEpochs += 1;
      totalClaimed += e.rewardPerClaim;
      run += 1;
      if (run > longestStreak) longestStreak = run;
      continue;
    }

    // An OPEN epoch that has not been claimed yet is PENDING, not missed. The
    // window is still running — breaking someone's streak mid-Tuesday would be
    // wrong, and would also make the number flap for anyone reading it live.
    if (!resolved) {
      pendingEpoch = e.epochNumber;
      continue;
    }

    missedEpochs += 1;
    run = 0;
  }

  // The current streak is the run ending at the most recent RESOLVED epoch,
  // plus the open one if it has already been claimed. Recomputed backwards so a
  // pending epoch neither extends nor breaks it.
  let currentStreak = 0;
  for (let i = epochs.length - 1; i >= 0; i--) {
    const e = epochs[i];
    const didClaim = claimed(state, e.epochNumber, identityHash);
    const open = statusAt(e, asOfTs) === EPOCH_STATUS.OPEN;
    if (didClaim) {
      currentStreak += 1;
      continue;
    }
    if (open) continue; // pending — skip without breaking
    break; // a resolved, unclaimed epoch ends the streak
  }

  return {
    firstEpoch,
    totalEligibleEpochs: epochs.length,
    totalClaimedEpochs,
    missedEpochs,
    currentStreak,
    longestStreak,
    totalClaimed,
    pendingEpoch,
  };
}

/**
 * A leaderboard ordered by participation rather than holdings — the whole
 * point of §35. Ties break toward the longer streak, then the earlier joiner,
 * so being early and consistent beats arriving late and claiming hard.
 *
 * Deliberately does NOT expose token balances. A "top participants" board that
 * also prints holdings quietly becomes a rich list.
 */
export function leaderboard(state, { asOfTs, limit = 20 } = {}) {
  const rows = [];
  for (const identityHash of state.identities.keys()) {
    const record = proofOfTuesday(state, { identityHash, asOfTs });
    if (record.totalClaimedEpochs === 0) continue;
    rows.push({ identityHash, ...record });
  }
  rows.sort(
    (a, b) =>
      b.totalClaimedEpochs - a.totalClaimedEpochs ||
      b.longestStreak - a.longestStreak ||
      (a.firstEpoch ?? Infinity) - (b.firstEpoch ?? Infinity)
  );
  return rows.slice(0, limit);
}
