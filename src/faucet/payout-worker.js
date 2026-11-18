// Poll-and-process logic for web-originated faucet claims. Mirrors the
// shape of src/quiz/payout-worker.js: poll on a timer, process a small
// batch, idempotent-by-claim-id, dry-run support.
//
// Discord-originated claims are executed INLINE by src/faucet/bot.js
// (which already legitimately holds the treasury key for other admin
// commands) and are filtered out here by `source` — this worker only ever
// touches 'web' claims, so there is no race between this worker and
// bot.js's own inline processing during the brief 'reserved' window before
// bot.js calls markProcessing().
//
// This module has NO import-time side effects and never auto-starts —
// that's payout-worker-main.js's job (the actual runner.js entry point).
// Keeping this file inert-on-import is what makes scanOnce() safely
// testable in isolation.
import {
  listClaimsByStatus,
  takeReservedClaimForProcessing,
  findDuplicatePaidClaim,
  markSubmitted,
  markConfirmed,
  markFailed,
  markReconciling,
  releaseReservationAdministratively,
} from './claimStore.js';
import { executeFaucetPayout, categorizeTransferError } from './payoutExecutor.js';

const SCAN_MS = Math.max(1000, Number(process.env.FAUCET_PAYOUT_SCAN_MS || 5000));
const MAX_BATCH = Math.max(1, Number(process.env.FAUCET_PAYOUT_MAX_BATCH || 10));
const DRY_RUN = ['1', 'true', 'yes', 'on'].includes(String(process.env.FAUCET_PAYOUTS_DRY_RUN || '').trim().toLowerCase());

let running = false;

async function processClaim(claim) {
  const activeClaim = await takeReservedClaimForProcessing(claim.id);
  if (!activeClaim) return false;

  // Last gate before the treasury moves. The reservation lock already said
  // this was allowed, but locks can be deleted and reservations can be made
  // while the shared lock store is unreachable — the claim rows cannot. If
  // this wallet or user was already paid inside the cooldown, stop, and do
  // NOT release the reservation: a duplicate is not a failed payout, and
  // handing its cooldown back is exactly the wrong move.
  const duplicate = await findDuplicatePaidClaim(activeClaim);
  if (duplicate) {
    await markFailed(activeClaim.id, 'duplicate_within_cooldown');
    console.error(
      `[faucet-payouts] BLOCKED duplicate payout for claim ${activeClaim.id} ` +
        `(wallet ${activeClaim.wallet}, account ${activeClaim.discordUserId}) — ` +
        `claim ${duplicate.id} already paid at ${new Date(Number(duplicate.createdAt)).toISOString()} ` +
        `with status ${duplicate.status}.`,
    );
    return true;
  }

  if (DRY_RUN) {
    console.log(`[faucet-payouts] DRY RUN — would send ${activeClaim.amountDisplay} to ${activeClaim.wallet} (claim ${activeClaim.id})`);
    await markSubmitted(activeClaim.id, 'DRY_RUN_NO_SIGNATURE');
    await markConfirmed(activeClaim.id);
    return true;
  }

  try {
    const { signature } = await executeFaucetPayout({ recipientAddress: activeClaim.wallet });
    await markSubmitted(activeClaim.id, signature);
    await markConfirmed(activeClaim.id);
    console.log(`[faucet-payouts] confirmed claim ${activeClaim.id} -> ${signature}`);
    return true;
  } catch (err) {
    const category = categorizeTransferError(err);
    if (category === 'uncertain') {
      await markReconciling(activeClaim.id);
      console.warn(`[faucet-payouts] claim ${activeClaim.id} entered reconciliation (needs admin check):`, err?.message || err);
      return true;
    }
    await markFailed(activeClaim.id, category);
    const released = await releaseReservationAdministratively(activeClaim.id, 'payout_failed_pre_submission');
    // The release is refused when the claim already carries a signature, so
    // report what actually happened rather than assuming — a claim that kept
    // its cooldown needs a human and `npm run faucet:reconcile`, and a log
    // line saying "released" would hide that.
    console.error(
      `[faucet-payouts] claim ${activeClaim.id} failed pre-submission, ` +
        `${released?.ok ? 'cooldown released' : `cooldown KEPT (${released?.error || 'release refused'}) — needs faucet:reconcile`}:`,
      err?.message || err,
    );
    return true;
  }
}

export async function scanOnce() {
  if (running) return { skipped: true };
  running = true;
  let processed = 0;
  try {
    const reserved = await listClaimsByStatus('reserved', MAX_BATCH);
    const webClaims = reserved.filter((c) => c.source === 'web');
    for (const claim of webClaims) {
      const tookClaim = await processClaim(claim);
      if (tookClaim) processed += 1;
    }
    return { skipped: false, processed };
  } catch (err) {
    console.error('[faucet-payouts] scan error:', err?.message || err);
    return { skipped: false, processed, error: err?.message || String(err) };
  } finally {
    running = false;
  }
}

export function start() {
  console.log(`[faucet-payouts] starting — scan every ${SCAN_MS}ms, batch ${MAX_BATCH}, dryRun=${DRY_RUN}`);
  scanOnce();
  const interval = setInterval(scanOnce, SCAN_MS);
  return () => clearInterval(interval);
}
