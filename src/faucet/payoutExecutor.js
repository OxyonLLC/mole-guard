// Actual token-transfer execution. Only imported by src/faucet/bot.js and
// src/faucet/payout-worker.js — NEVER by src/mole/web.js or anything it
// imports. This is what keeps the treasury keypair out of the web process:
// it's a structural guarantee (the import graph never reaches keypair.js
// from web.js), not just a policy.

import { Connection, PublicKey } from '@solana/web3.js';
import { createRequire } from 'node:module';
const { rpcConnectionOptions } = createRequire(import.meta.url)('../shared/solanaRpcFetch.cjs');
import { dripTokens } from './faucet.js';
import { loadTreasuryKeypair } from './keypair.js';
import { getFaucetConfig } from './config.js';

let cachedConnection = null;
function getConnection(rpcUrl) {
  if (!cachedConnection) cachedConnection = new Connection(rpcUrl, rpcConnectionOptions('confirmed'));
  return cachedConnection;
}

/**
 * Categorizes a transfer failure so the caller knows whether it's safe to
 * release the claim's cooldown reservation:
 *  - 'uncertain' — the failure happened around send/confirm; the
 *    transaction MAY have landed. Caller must go to `reconciling`, never
 *    release the lock, and needs a human to check the chain.
 *  - 'failed' — the failure happened before any signature could exist
 *    (bad recipient, RPC unreachable, treasury ATA error, etc.). Safe to
 *    mark `known_failed` and release the lock so the user isn't
 *    penalized for a claim that certainly never sent tokens.
 *
 * This is a best-effort classification based on error shape, not a
 * guarantee — see docs/faucet-web-expansion.md's reconciliation procedure
 * for how an admin double-checks via the chain when in doubt.
 */
export function categorizeTransferError(err) {
  // A signature is proof the network accepted the transaction, so the outcome
  // is uncertain by definition — no string matching required, and no way for a
  // reworded RPC error to be misread as "never sent" and wrongly release the
  // cooldown. dripTokens() attaches this via PayoutUnconfirmedError.
  if (err?.signature) return 'uncertain';

  const msg = String(err?.message || err?.name || err || '');
  if (/timeout|expired|block height exceeded|blockhash not found|not confirmed/i.test(msg)) {
    return 'uncertain';
  }
  return 'failed';
}

/** The signature of a submitted-but-unconfirmed transfer, or '' if none exists. */
export function signatureFromTransferError(err) {
  return typeof err?.signature === 'string' ? err.signature : '';
}

/**
 * Executes the actual SPL transfer for one claim. Always sends the
 * env-configured DRIP_AMOUNT (via faucet.js's dripTokens) — there is no
 * amount parameter here at all, structurally preventing a caller from ever
 * requesting a different amount.
 */
export async function executeFaucetPayout({ recipientAddress }) {
  const cfg = getFaucetConfig();
  if (!cfg.botKeypairPath) throw new Error('treasury_not_configured');
  const connection = getConnection(cfg.rpcUrl);
  const payer = loadTreasuryKeypair(cfg.botKeypairPath);
  const recipientPubkey = new PublicKey(recipientAddress);
  const signature = await dripTokens(connection, payer, recipientPubkey);
  return { signature };
}
