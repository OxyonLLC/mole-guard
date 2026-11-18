// The single entry point both the Discord adapter (src/faucet/bot.js) and
// the web adapter (src/mole/web.js's /api/faucet/* routes) call. Neither
// adapter talks to claimStore.js, eligibility.js, or the treasury directly —
// everything goes through claimFaucet() so the two platforms cannot
// silently diverge on eligibility, cooldown, or payout behavior.
//
// IMPORTANT: this file must never statically `import` payoutExecutor.js (or
// anything that imports it) at the top level. That module's chain pulls in
// src/faucet/faucet.js, which loads src/faucet/.env (containing the faucet
// Discord bot's own secrets) as an import-time side effect — loading that
// into the web process's process.env would leak unrelated secrets into a
// process with a public HTTP surface. The dynamic `import()` inside the
// 'discord' branch below is deliberate, not a style choice: it's what keeps
// that whole chain out of the web process's memory entirely, since that
// branch is never reached when source === 'web'.

import { Connection } from '@solana/web3.js';
import { createRequire } from 'node:module';
const { rpcConnectionOptions } = createRequire(import.meta.url)('../shared/solanaRpcFetch.cjs');
import { checkEligibility, normalizeWalletAddress, resolveCanonicalFaucetWallet } from './eligibility.js';
import {
  reserveClaim,
  findDuplicatePaidClaim,
  markProcessing,
  markSubmitted,
  markConfirmed,
  markFailed,
  markReconciling,
  releaseReservationAdministratively,
} from './claimStore.js';
import { getMintDecimals } from './mintInfo.js';
import { parseDecimalAmountToBaseUnits } from './amount.js';

let cachedReadConnection = null;
function getReadConnection(rpcUrl) {
  if (!cachedReadConnection) cachedReadConnection = new Connection(rpcUrl, rpcConnectionOptions('confirmed'));
  return cachedReadConnection;
}

/**
 * claimFaucet({discordUserId, source, requestId, requestedWallet})
 *
 * - discordUserId: from the authenticated session (web) or message.author.id
 *   (Discord) — never trust a value the caller says came from elsewhere.
 * - source: 'discord' | 'web', forced by the adapter, never client input.
 * - requestId: optional idempotency key; a retried request with the same
 *   requestId returns the original claim instead of reserving again.
 * - requestedWallet: Discord-only, and since 2026-08-02 it must MATCH the
 *   wallet the account has already registered — `!drip <address>` can no
 *   longer aim a claim at an arbitrary address (reason:
 *   'wallet_not_registered'). Must be omitted/null for source==='web' — the
 *   web wallet is ALWAYS the caller's canonical saved `faucet` wallet.
 *
 * Returns `{ok:true, claim, replay}` or `{ok:false, reason, ...}`. `reason`
 * is one of eligibility.js's ELIGIBILITY_REASONS, or 'cooldown',
 * 'invalid_wallet', 'wallet_not_registered', 'reconciling', 'payout_failed'.
 */
export async function claimFaucet({ discordUserId, source, requestId = null, requestedWallet = null }) {
  if (!discordUserId) throw new Error('discordUserId_required');
  if (source !== 'discord' && source !== 'web') throw new Error(`invalid_source:${source}`);
  if (source === 'web' && requestedWallet) throw new Error('web_source_cannot_specify_wallet');

  let walletOverride = null;
  if (source === 'discord' && requestedWallet) {
    try {
      walletOverride = normalizeWalletAddress(requestedWallet);
    } catch {
      return { ok: false, reason: 'invalid_wallet' };
    }

    // `!drip <address>` may only target the wallet this account has already
    // registered. Paying an arbitrary address on request meant a claim could
    // be aimed anywhere with no durable Discord-to-wallet link behind it,
    // which is what made a group of accounts hard to attribute in the first
    // place — and an unregistered wallet can never satisfy the verification
    // gate either, so it would simply fail later and less clearly.
    //
    // Enforced here rather than in the Discord adapter so the rule cannot
    // drift between interfaces, which is this module's whole purpose. The
    // same-wallet case is allowed through: typing your own address out of
    // habit is not the thing being prevented.
    const registered = resolveCanonicalFaucetWallet(discordUserId);
    if (!registered || registered.address !== walletOverride) {
      return {
        ok: false,
        reason: 'wallet_not_registered',
        requestedWallet: walletOverride,
        registeredWallet: registered?.address || null,
      };
    }
  }

  const eligibility = await checkEligibility({ discordUserId, wallet: walletOverride });
  if (!eligibility.eligible) {
    // eligibility.js's own cooldown pre-check (an early bail-out before ever
    // attempting a reservation) nests its fields under `eligibility.cooldown`.
    // reserveClaim()'s cooldown result (below) puts the same two fields at
    // the top level. Both adapters (bot.js, web.js) only read the top-level
    // shape, so flatten here — otherwise this path reports a claim time of
    // `undefined - Date.now()` (NaN) and an unknown claim source.
    if (eligibility.reason === 'cooldown') {
      return {
        ok: false,
        reason: eligibility.reason,
        eligibility,
        nextEligibleAt: eligibility.cooldown?.nextEligibleAt ?? null,
        lastClaimSource: eligibility.cooldown?.lastClaimSource ?? null,
        // True when the block came from ANOTHER wallet of the same person
        // rather than this one — the adapters say so, because "you already
        // claimed" reads as a bug to someone whose wallet never has.
        otherWallet: eligibility.cooldown?.otherWallet === true,
      };
    }
    return { ok: false, reason: eligibility.reason, eligibility };
  }

  const cfg = eligibility.config;
  const connection = getReadConnection(cfg.rpcUrl);
  const decimals = await getMintDecimals(connection, cfg.winlewMint);
  const amountBaseUnits = parseDecimalAmountToBaseUnits(cfg.dripAmountDecimal, decimals);

  const reservation = await reserveClaim({
    discordUserId,
    wallet: eligibility.wallet.address,
    source,
    amountBaseUnits,
    amountDisplay: cfg.dripAmountDecimal,
    mint: cfg.winlewMint,
    cooldownMs: cfg.cooldownMs,
    requestId,
  });

  if (!reservation.ok) {
    return {
      ok: false,
      reason: 'cooldown',
      blockedBy: reservation.blockedBy,
      nextEligibleAt: reservation.nextEligibleAt,
      lastClaimSource: reservation.lastClaimSource,
    };
  }

  if (reservation.replay) {
    return { ok: true, claim: reservation.claim, replay: true };
  }

  const claim = reservation.claim;

  if (source === 'discord') {
    // bot.js already legitimately holds the treasury key for other admin
    // commands (!send) — executing inline here preserves the existing
    // immediate "Sent X WinLEW! Tx: ..." Discord reply. See the file-level
    // comment above for why this MUST be a dynamic import.
    const { executeFaucetPayout, categorizeTransferError, signatureFromTransferError } =
      await import('./payoutExecutor.js');

    // Same last gate the web worker applies (src/faucet/payout-worker.js), for
    // the same reason: the reservation lock is not the only thing standing
    // between a duplicate row and a second drip, and this path pays inline.
    // Deliberately NOT released — a duplicate must not get its cooldown back.
    const duplicate = await findDuplicatePaidClaim(claim);
    if (duplicate) {
      await markFailed(claim.id, 'duplicate_within_cooldown');
      return {
        ok: false,
        reason: 'cooldown',
        blockedBy: String(duplicate.wallet) === String(claim.wallet) ? 'wallet' : 'user',
        nextEligibleAt: Number(duplicate.createdAt || 0) + Number(claim.cooldownMs || 0),
        lastClaimSource: duplicate.source || null,
      };
    }

    await markProcessing(claim.id);
    try {
      const { signature } = await executeFaucetPayout({ recipientAddress: eligibility.wallet.address });
      await markSubmitted(claim.id, signature);
      const confirmed = await markConfirmed(claim.id);
      return { ok: true, claim: confirmed, replay: false };
    } catch (err) {
      const category = categorizeTransferError(err);
      if (category === 'uncertain') {
        // Record the signature when there is one, so the claim carries its own
        // proof: the Discord reply can link it, /api/faucet/status can show it,
        // and `npm run faucet:reconcile` can resolve it against the chain
        // instead of an admin hunting for the transaction by hand.
        const signature = signatureFromTransferError(err);
        if (signature) await markSubmitted(claim.id, signature);
        const reconciling = await markReconciling(claim.id, signature);
        return { ok: false, reason: 'reconciling', claim: reconciling, signature, error: err?.message };
      }
      await markFailed(claim.id, category);
      await releaseReservationAdministratively(claim.id, 'payout_failed_pre_submission');
      return { ok: false, reason: 'payout_failed', error: err?.message };
    }
  }

  // Web: reservation only. src/faucet/payout-worker.js (a separate process)
  // picks up this 'reserved' claim and executes it — the web process never
  // touches the treasury key. The frontend polls /api/faucet/status.
  return { ok: true, claim, replay: false, pending: true };
}
