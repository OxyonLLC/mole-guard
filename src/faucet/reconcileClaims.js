// Reconciliation logic for faucet claims stuck in `reconciling`.
//
// WHY THIS EXISTS
//
// payoutExecutor.categorizeTransferError() routes timeout/expiry/blockhash
// errors to `reconciling`, meaning "the transfer MAY have landed — a human
// must check the chain." docs/faucet-web-expansion.md §15 documents that
// check as a manual REPL job and notes there is no admin UI. In practice it
// never gets done, so tokens that really did send stay uncredited: as of
// 2026-08-01, 3 of 45 on-chain drips since the claim store shipped had no
// confirmed row.
//
// This module is the matching half. It is PURE — no network, no database —
// so the rules that decide whether someone gets credited can be unit-tested
// exhaustively rather than trusted.
//
// SAFETY POSTURE: this feeds a process that MUTATES claim records, so it is
// deliberately conservative. It only ever reports a confident match when
// exactly ONE on-chain transfer matches on recipient, exact amount, and time
// window, AND that signature is not already credited to another claim.
// Anything else is reported as ambiguous or unmatched for a human to judge.
// Crediting the wrong claim is worse than crediting none.
import { PublicKey } from '@solana/web3.js';

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

/** Default tolerance either side of the claim's creation time. */
export const DEFAULT_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

export const MATCH = Object.freeze({
  MATCHED: 'matched',
  NONE: 'none',
  AMBIGUOUS: 'ambiguous',
});

/**
 * Deterministic associated token account for a wallet + mint. The faucet
 * sends via getOrCreateAssociatedTokenAccount, so a genuine payout always
 * lands in this exact address — which is what makes matching by recipient
 * reliable rather than a guess.
 */
export function deriveRecipientAta(walletAddress, mintAddress) {
  const owner = new PublicKey(walletAddress);
  const mint = new PublicKey(mintAddress);
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata.toBase58();
}

/**
 * Pure. Decides whether `claim` corresponds to one of `transfers`.
 *
 * `transfers` are outbound faucet payouts shaped as:
 *   { signature, blockTimeMs, destinationAta, amountBaseUnits }
 *
 * `alreadyCreditedSignatures` is the set of signatures already attached to
 * some other claim — the guard against crediting one on-chain payout to two
 * different claims.
 */
export function matchClaimToTransfers(claim, transfers, {
  windowMs = DEFAULT_WINDOW_MS,
  alreadyCreditedSignatures = new Set(),
} = {}) {
  if (!claim?.wallet || !claim?.mint || !claim?.amountBaseUnits) {
    return { status: MATCH.NONE, reason: 'claim_missing_fields', candidates: [] };
  }

  const expectedAta = deriveRecipientAta(claim.wallet, claim.mint);
  const anchor = Number(claim.createdAt ?? claim.reservedAt ?? claim.lastUpdateAt ?? 0);
  if (!Number.isFinite(anchor) || anchor <= 0) {
    return { status: MATCH.NONE, reason: 'claim_missing_timestamp', candidates: [] };
  }

  const candidates = transfers.filter((t) => {
    if (t.destinationAta !== expectedAta) return false;
    // Exact amount only. A faucet payout is a fixed drip; a near-miss means
    // it is a different payout (a quiz or game reward, say), not this claim.
    if (String(t.amountBaseUnits) !== String(claim.amountBaseUnits)) return false;
    if (alreadyCreditedSignatures.has(t.signature)) return false;
    return Math.abs(Number(t.blockTimeMs) - anchor) <= windowMs;
  });

  if (candidates.length === 1) {
    return { status: MATCH.MATCHED, transfer: candidates[0], candidates };
  }
  if (candidates.length > 1) {
    // Two identical drips to the same wallet inside the window. A human must
    // pick; auto-choosing risks crediting the wrong claim and leaving the
    // other permanently stuck.
    return { status: MATCH.AMBIGUOUS, reason: 'multiple_candidates', candidates };
  }
  return { status: MATCH.NONE, reason: 'no_transfer_found', candidates: [] };
}

/**
 * Pure. Turns claims + transfers into an ordered action plan. Nothing here
 * performs the actions — the CLI prints the plan, and only applies it when
 * explicitly asked.
 *
 * Actions:
 *   confirm  — a single unambiguous transfer found; credit the user
 *   release  — no transfer, and the claim is older than releaseAfterMs, so
 *              free the cooldown (per §15) rather than leaving them blocked
 *   review   — ambiguous, or too recent to declare failed; human decides
 */
export function planReconciliation(claims, transfers, {
  windowMs = DEFAULT_WINDOW_MS,
  releaseAfterMs = 24 * 60 * 60 * 1000,
  now = Date.now(),
  alreadyCreditedSignatures = new Set(),
} = {}) {
  // Copy: as we plan confirmations we must reserve those signatures so two
  // claims in the same run can never be handed the same transfer.
  const credited = new Set(alreadyCreditedSignatures);
  const plan = [];

  // Oldest first, so if two claims contend for one transfer the earlier claim
  // wins deterministically instead of depending on input ordering.
  const ordered = [...claims].sort(
    (a, b) => Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0),
  );

  for (const claim of ordered) {
    const result = matchClaimToTransfers(claim, transfers, { windowMs, alreadyCreditedSignatures: credited });
    if (result.status === MATCH.MATCHED) {
      credited.add(result.transfer.signature);
      plan.push({ action: 'confirm', claim, transfer: result.transfer });
      continue;
    }
    if (result.status === MATCH.AMBIGUOUS) {
      plan.push({ action: 'review', claim, reason: result.reason, candidates: result.candidates });
      continue;
    }
    const age = now - Number(claim.createdAt ?? claim.reservedAt ?? now);
    if (age >= releaseAfterMs) {
      plan.push({ action: 'release', claim, reason: 'confirmed_not_sent' });
    } else {
      // Still young: a slow confirmation may yet appear, and releasing early
      // would hand out a second drip for the same claim window.
      plan.push({ action: 'review', claim, reason: 'no_match_but_too_recent' });
    }
  }
  return plan;
}

export function summarizePlan(plan) {
  return {
    confirm: plan.filter((p) => p.action === 'confirm').length,
    release: plan.filter((p) => p.action === 'release').length,
    review: plan.filter((p) => p.action === 'review').length,
    total: plan.length,
  };
}
