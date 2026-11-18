import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Isolated tests supply inert configuration explicitly and must never read a
// developer or production credential file. Production startup is unchanged.
if (process.env.WINLEW_TEST_ISOLATED !== '1') {
  dotenv.config({ path: path.resolve(__dirname, '.env'), override: true });
  dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: false });
}

import { PublicKey, Transaction } from '@solana/web3.js';
import { getMint, getOrCreateAssociatedTokenAccount, createTransferInstruction } from '@solana/spl-token';
import { parseDecimalAmountToBaseUnits, assertSafeDecimalAmount } from './amount.js';

if (!process.env.WINLEW_MINT) {
  throw new Error('Missing WINLEW_MINT in .env!');
}

const TOKEN_MINT = new PublicKey(process.env.WINLEW_MINT);
// Kept as the raw decimal string — the base-unit conversion below is exact
// string/BigInt arithmetic (src/faucet/amount.js), not floating point, so
// DRIP_AMOUNT must not be coerced through Number() before that conversion.
const DRIP_AMOUNT = String(process.env.DRIP_AMOUNT ?? '1000').trim() || '1000';
assertSafeDecimalAmount(DRIP_AMOUNT); // throws on a catastrophic misconfiguration

/**
 * Thrown when the transfer reached the network but its outcome is unknown (or
 * it reverted on-chain). Always carries the signature, which is the whole
 * point: the caller can show the proof and reconcile against it instead of
 * guessing. Its presence is what marks a failure as "uncertain" downstream —
 * see categorizeTransferError() in src/faucet/payoutExecutor.js.
 */
export class PayoutUnconfirmedError extends Error {
  constructor(message, signature, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'PayoutUnconfirmedError';
    this.signature = signature;
    if (options.onChainError) this.onChainError = options.onChainError;
  }
}

let cachedDecimals = null;
const CONFIRMATION_POLL_INTERVAL_MS = 1_000;
const CONFIRMATION_TIMEOUT_MS = 30_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isStatusConfirmed(status) {
  if (!status) return false;
  if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') return true;
  return status.confirmations === null && status.slot != null && !status.err;
}

async function getMintDecimals(connection) {
  if (cachedDecimals !== null) return cachedDecimals;
  const mintInfo = await getMint(connection, TOKEN_MINT);
  cachedDecimals = mintInfo.decimals;
  return cachedDecimals;
}

export async function confirmSignatureByPolling(
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

    const blockHeight = await connection.getBlockHeight(commitment);
    if (blockHeight > lastValidBlockHeight) {
      throw new Error(`Signature ${signature} has expired: block height exceeded`);
    }

    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`Transaction was not confirmed in ${(timeoutMs / 1000).toFixed(2)} seconds`);
    }

    await sleep(pollIntervalMs);
  }
}

export async function dripTokens(connection, payerKeypair, recipientPubkey) {
  const decimals = await getMintDecimals(connection);
  // Was: BigInt(Math.round(DRIP_AMOUNT * (10 ** decimals))) — floating-point
  // multiplication before the BigInt conversion, which silently loses
  // precision for many amount/decimals combinations. This is now exact.
  const rawAmount = parseDecimalAmountToBaseUnits(DRIP_AMOUNT, decimals);

  const fromAta = await getOrCreateAssociatedTokenAccount(
    connection,
    payerKeypair,
    TOKEN_MINT,
    payerKeypair.publicKey
  );

  const toAta = await getOrCreateAssociatedTokenAccount(
    connection,
    payerKeypair,
    TOKEN_MINT,
    recipientPubkey
  );

  // Send and confirm are deliberately separate calls.
  //
  // This used to be spl-token's `transfer()`, which does both in one shot and
  // returns only on success. When confirmation timed out — an RPC being slow,
  // not the transfer failing — it threw, and the signature it had already
  // obtained died inside the library. The caller was left with no handle on a
  // transaction that had usually landed, so `!drip` could only say "still being
  // verified" with no proof, and the claim was parked in `reconciling` for a
  // manual check it didn't need. Verified on 2026-08-01: three claims reported
  // that way were all finalized on-chain with no error.
  //
  // Holding the signature ourselves means a confirmation timeout still yields
  // something the user can click and anyone can audit. Showing an unconfirmed
  // signature is honest as long as it is labelled as such — the caller does
  // that; withholding the proof entirely was not. Also, some RPC providers
  // accept HTTP requests but do not expose websocket `signatureSubscribe`, so
  // confirmation is polled over HTTP rather than via connection.confirmTransaction().
  const transferIx = createTransferInstruction(
    fromAta.address,
    toAta.address,
    payerKeypair.publicKey,
    rawAmount
  );

  const latest = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({
    feePayer: payerKeypair.publicKey,
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
  }).add(transferIx);
  tx.sign(payerKeypair);

  // Anything that throws here happened BEFORE the network accepted the
  // transaction, so no signature exists and the claim genuinely never sent.
  const signature = await connection.sendRawTransaction(tx.serialize());

  try {
    const result = await confirmSignatureByPolling(connection, {
      signature,
      lastValidBlockHeight: latest.lastValidBlockHeight,
      commitment: 'confirmed',
    });
    // A confirmed transaction can still have reverted on-chain. That is a real
    // failure with a real signature, and must not be reported as success.
    if (result?.value?.err) {
      throw new PayoutUnconfirmedError(
        `transfer confirmed with an on-chain error: ${JSON.stringify(result.value.err)}`,
        signature,
        { onChainError: result.value.err },
      );
    }
  } catch (err) {
    if (err instanceof PayoutUnconfirmedError) throw err;
    // Submitted, outcome unknown. Carry the signature out with the error.
    throw new PayoutUnconfirmedError(
      `transfer submitted but not confirmed: ${err?.message || err}`,
      signature,
      { cause: err },
    );
  }

  console.log(`Sent ${DRIP_AMOUNT} $WinLEW → ${toAta.address.toBase58()} (${signature})`);
  return signature;
}
