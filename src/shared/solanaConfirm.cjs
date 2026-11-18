const CONFIRMATION_POLL_INTERVAL_MS = 1_000;

// MUST stay longer than a blockhash lives, and this is a money-path invariant
// rather than a tuning knob.
//
// A Solana blockhash is valid for 150 slots — roughly 60-90 seconds. This
// function has two ways to give up: the transaction's blockhash expired, or a
// wall-clock timeout. Only the first is SAFE for the callers here, because all
// three of them retry:
//
//   src/quiz/payout-worker.js   throws -> record stays unpaid -> retried
//   src/games/payout-worker.js  "Leave these rows unpaid — they retry on the
//                                next nightly run."
//
// Expired means the transaction can never land, so re-sending pays once. But a
// wall-clock timeout that fires while the blockhash is STILL VALID leaves a
// transaction that may confirm seconds later — and the retry then pays a second
// time, in real tokens. At the original 30_000 that fired at roughly the halfway
// point of every blockhash, so it was not an edge case; it was the normal
// outcome of any congested minute.
//
// 120s is comfortably past the longest blockhash life, which makes block-height
// expiry the terminating condition in practice and the timeout a backstop
// against a wedged RPC.
const CONFIRMATION_TIMEOUT_MS = 120_000;

// Carries the signature. A caller that catches this still knows what it sent,
// which is what lets a payout be reported with its proof instead of vanishing —
// the failure this project already fixed once, on 2026-08-01, when a timeout
// swallowed the signature inside spl-token's transfer() and users were told
// their claim "is still being verified" with no link.
class SignatureUnconfirmedError extends Error {
  constructor(signature, message) {
    super(message);
    this.name = 'SignatureUnconfirmedError';
    this.signature = signature;
    this.unconfirmed = true;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isStatusConfirmed(status) {
  if (!status) return false;
  if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') return true;
  return status.confirmations === null && status.slot != null && !status.err;
}

async function confirmSignatureByPolling(
  connection,
  {
    signature,
    lastValidBlockHeight,
    commitment = 'confirmed',
    pollIntervalMs = CONFIRMATION_POLL_INTERVAL_MS,
    timeoutMs = CONFIRMATION_TIMEOUT_MS,
  },
) {
  const startedAt = Date.now();

  for (;;) {
    const statuses = await connection.getSignatureStatuses([signature]);
    const status = statuses?.value?.[0] ?? null;

    if (status?.err) return { value: { err: status.err } };
    if (isStatusConfirmed(status)) return { value: { err: null } };

    // Checked before the timeout, deliberately: expiry is the safe reason to
    // give up and should win whenever both are true.
    const blockHeight = await connection.getBlockHeight(commitment);
    if (blockHeight > lastValidBlockHeight) {
      throw new Error(`Signature ${signature} has expired: block height exceeded`);
    }

    if (Date.now() - startedAt >= timeoutMs) {
      // Not "failed" — unknown. The blockhash may still be valid, so this
      // transaction can still confirm. Callers must not treat this as a
      // reason to re-send.
      throw new SignatureUnconfirmedError(
        signature,
        `Transaction ${signature} was not confirmed in ${(timeoutMs / 1000).toFixed(2)} seconds — `
          + 'its blockhash may still be valid, so it may yet land. Do not re-send.',
      );
    }

    await sleep(pollIntervalMs);
  }
}

module.exports = {
  confirmSignatureByPolling,
  SignatureUnconfirmedError,
  CONFIRMATION_TIMEOUT_MS,
};
