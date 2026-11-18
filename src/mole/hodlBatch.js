// HODL Rewards — turning a weekly snapshot into a resumable batch.
//
// Pure. Planning what to send is kept apart from sending it, because the
// property that matters most here cannot be tested against a live chain: a
// worker that dies mid-batch and restarts must never pay anyone twice.
//
// THE IDEMPOTENCY KEY IS THE WHOLE DESIGN. Every transfer carries a stable id
// derived from epoch + week + identity, so re-planning the same Tuesday
// produces byte-identical ids. That is what lets a restarted worker ask "has
// this transfer already gone out?" and get a truthful answer, instead of
// starting again from a blank list and sending everything a second time.
//
// This repo has shipped that bug twice — a confirmation timeout that fired
// while a transaction was still landable, and a crash window between sending
// and recording. Both were found and fixed in the quiz payout worker. The same
// discipline applies here from the start rather than after the fact.

/**
 * Transfers per transaction — ONE, for now, and the reason is structural rather
 * than cautious.
 *
 * A chunk stores exactly one `signature`, because that is what makes resumption
 * exact: a signature identifies a transaction, and a transaction either landed
 * or did not. Put eight transfers in a chunk that becomes eight transactions
 * and the field is a lie — a restarted worker cannot tell which of the eight
 * went out.
 *
 * Multi-recipient transactions are entirely possible (the quiz worker already
 * puts an ATA-creation instruction and a transfer in one transaction, so a
 * chunk of several recipients is a packing problem, not a design problem) and
 * the chunking machinery here is built for it. But it needs a per-recipient
 * instruction count, a size check against Solana's hard 1232-byte limit, and a
 * decision about what happens when ONE recipient in a packed transaction fails
 * — which fails the whole transaction, for everyone in it.
 *
 * At today's participation that optimisation would save six transactions a
 * week. It is not worth being the first thing that moves real tokens.
 */
export const DEFAULT_CHUNK_SIZE = 1;

export const CHUNK_STATUS = Object.freeze({
  PENDING: "pending",
  SUBMITTED: "submitted",
  CONFIRMED: "confirmed",
  FAILED: "failed",
});

/**
 * A stable id for one participant's payment in one week.
 *
 * Deliberately derived, never random: the same inputs must always produce the
 * same id, on any machine, after any restart. A random id would make every
 * re-plan look like a brand new set of payments.
 */
export function transferId(epochId, weekIndex, discordUserId) {
  return `${epochId}:w${weekIndex}:${discordUserId}`;
}

/**
 * The signature of the transaction that paid one allocation: its own chunk's, never another
 * recipient's. Matched by the stable transferId, then (for older batches) by wallet and amount.
 * Null when that chunk has no signature yet; never a guess.
 */
export function signatureForAllocation(snapshot, alloc) {
  const chunks = snapshot?.batch?.chunks || [];
  const id = transferId(snapshot?.epochId, snapshot?.weekIndex, alloc?.discordUserId);
  const byId = chunks.find((c) => (c.transfers || []).some((t) => t.transferId === id));
  const chunk = byId || chunks.find((c) => (c.transfers || []).some((t) =>
    t.payoutWallet && t.payoutWallet === alloc?.payoutWallet && Number(t.amount) === Number(alloc?.amount)));
  return chunk?.signature || null;
}

/** A stable id for the whole Tuesday. Re-planning returns the same batch. */
export function batchIdFor(epochId, weekIndex) {
  return `${epochId}-w${weekIndex}`;
}

/**
 * Plan one Tuesday.
 *
 * Zero allocations is a valid plan, not an error — a week where nobody
 * qualified should record that it happened and paid nothing, rather than
 * leaving a gap someone later reads as a missed run.
 */
export function planBatch(snapshot, { chunkSize = DEFAULT_CHUNK_SIZE } = {}) {
  const epochId = snapshot?.epochId ?? null;
  const weekIndex = snapshot?.weekIndex ?? null;
  const allocations = (snapshot?.allocations || []).filter((a) => Number(a.amount) > 0);

  const transfers = allocations.map((a) => ({
    transferId: transferId(epochId, weekIndex, a.discordUserId),
    discordUserId: a.discordUserId,
    payoutWallet: a.payoutWallet,
    amount: Number(a.amount),
  }));

  const chunks = [];
  for (let i = 0; i < transfers.length; i += chunkSize) {
    chunks.push({
      index: chunks.length,
      transfers: transfers.slice(i, i + chunkSize),
      status: CHUNK_STATUS.PENDING,
      signature: null,
      lastError: null,
      attempts: 0,
      submittedAt: null,
      confirmedAt: null,
    });
  }

  return {
    batchId: batchIdFor(epochId, weekIndex),
    epochId,
    weekIndex,
    chunkSize,
    transferCount: transfers.length,
    totalAmount: transfers.reduce((sum, t) => sum + t.amount, 0),
    chunks,
    createdAtIso: new Date(snapshot?.takenAtIso || Date.now()).toISOString(),
  };
}

/**
 * The next chunk a worker should act on, or null when there is nothing to do.
 *
 * SUBMITTED is deliberately NOT returned. A chunk with a signature but no
 * confirmation is the dangerous state — the transaction may still land — so it
 * must be resolved against the chain by the caller's reconcile step, never
 * simply retried. Handing it back here would be exactly the double-spend this
 * file exists to prevent.
 */
export function nextPendingChunk(batch) {
  return (batch?.chunks || []).find((c) => c.status === CHUNK_STATUS.PENDING) || null;
}

/** Chunks that were sent but never confirmed — for the reconcile pass to
 *  resolve against the chain before anything else is sent. */
export function unresolvedChunks(batch) {
  return (batch?.chunks || []).filter((c) => c.status === CHUNK_STATUS.SUBMITTED);
}

function withChunk(batch, index, patch) {
  return {
    ...batch,
    chunks: (batch.chunks || []).map((c) => (c.index === index ? { ...c, ...patch } : c)),
  };
}

/** Record that a chunk's transaction was sent. Called BEFORE confirmation, so a
 *  crash in the gap leaves evidence rather than a silent re-send. */
export function markSubmitted(batch, index, signature) {
  const chunk = (batch.chunks || []).find((c) => c.index === index);
  return withChunk(batch, index, {
    status: CHUNK_STATUS.SUBMITTED,
    signature,
    attempts: Number(chunk?.attempts || 0) + 1,
    submittedAt: Date.now(),
  });
}

export function markConfirmed(batch, index, signature) {
  return withChunk(batch, index, {
    status: CHUNK_STATUS.CONFIRMED,
    signature: signature || (batch.chunks || []).find((c) => c.index === index)?.signature || null,
    confirmedAt: Date.now(),
    lastError: null,
  });
}

/** A chunk that provably did NOT land. Returns to pending so it can be retried;
 *  only call this when the chain has been asked and answered. */
export function markFailed(batch, index, error) {
  return withChunk(batch, index, {
    status: CHUNK_STATUS.PENDING,
    signature: null,
    lastError: String(error || "unknown").slice(0, 300),
  });
}

/** Where the batch has got to. `paidAmount` counts CONFIRMED chunks only —
 *  submitted-but-unconfirmed money is not yet known to have moved, and
 *  reporting it as paid is how a partial batch gets mistaken for a whole one. */
export function batchProgress(batch) {
  const chunks = batch?.chunks || [];
  const by = (status) => chunks.filter((c) => c.status === status);
  const confirmed = by(CHUNK_STATUS.CONFIRMED);
  return {
    total: chunks.length,
    pending: by(CHUNK_STATUS.PENDING).length,
    submitted: by(CHUNK_STATUS.SUBMITTED).length,
    confirmed: confirmed.length,
    paidAmount: confirmed.reduce(
      (sum, c) => sum + c.transfers.reduce((s, t) => s + t.amount, 0), 0),
    complete: chunks.length > 0 && confirmed.length === chunks.length,
  };
}

/** Every identity already confirmed paid in this batch. The guard a worker
 *  checks before sending anything, so a re-plan cannot pay someone twice. */
export function paidTransferIds(batch) {
  const out = new Set();
  for (const chunk of batch?.chunks || []) {
    if (chunk.status !== CHUNK_STATUS.CONFIRMED) continue;
    for (const t of chunk.transfers) out.add(t.transferId);
  }
  return out;
}
