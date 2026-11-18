#!/usr/bin/env node
// Execute a Tuesday HODL distribution — `npm run hodl:pay`.
//
//   npm run hodl:pay              DRY RUN — prints the plan, sends nothing
//   npm run hodl:pay -- --apply   sends
//   npm run hodl:pay -- --force   ignore the payout-day check (testing only)
//
// DRY RUN IS THE DEFAULT, as with faucet:reconcile. This moves real tokens;
// nothing happens until a human has read the plan and asked for it.
//
// THE ORDER OF OPERATIONS IS THE SAFETY PROPERTY:
//
//   1. refresh the store, so we are not deciding from a boot-time cache
//   2. RECONCILE first — resolve every submitted-but-unconfirmed chunk against
//      the chain BEFORE sending anything at all
//   3. only then send what is still pending
//
// Step 2 is the one that matters. A chunk with a signature may have landed; the
// only authority on that is the chain. Re-sending it because our record says
// "not confirmed" is precisely how this repo has twice paid people twice.
//
// An UNKNOWN answer leaves the chunk stuck on purpose. Waiting is recoverable.
// Paying twice is not.

import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
dotenv.config({ path: path.join(ROOT, ".env") });
process.chdir(path.join(ROOT, "src"));

const { PublicKey, Transaction, Connection } = await import("@solana/web3.js");
const spl = await import("@solana/spl-token");
const { createRequire } = await import("node:module");
const require_ = createRequire(import.meta.url);
const { rpcConnectionOptions } = require_("../shared/solanaRpcFetch.cjs");
const { confirmSignatureByPolling } = require_("../shared/solanaConfirm.cjs");

const { weekIndexFor, isPayoutDay, buildWeeklySnapshot } = await import("../mole/hodlEpochs.js");
const {
  planBatch, nextPendingChunk, unresolvedChunks, markSubmitted, markConfirmed,
  markFailed, batchProgress, paidTransferIds,
} = await import("../mole/hodlBatch.js");
const hodl = await import("../mole/hodlStore.js");
const { flushManagedWrites } = await import("../mole/storage.js");
const { gatherIdentities } = await import("../mole/hodlEligibility.js");
const { getSplBalance, getSplBalanceUnits } = await import("../mole/solana.js");
const { isDirectlyBanned } = await import("../faucet/walletBans.js");
const { isUserBanned } = await import("../faucet/userBans.js");
const { getProofOfValueScore } = await import("../mole/proofOfValue.js");
const { loadTreasuryKeypair } = await import("../faucet/keypair.js");
const { getFaucetConfig } = await import("../faucet/config.js");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const force = args.includes("--force");
const n = (v) => Number(v || 0).toLocaleString("en-US");

let _conn = null;
function conn() {
  if (!_conn) _conn = new Connection(getFaucetConfig().rpcUrl, rpcConnectionOptions("confirmed"));
  return _conn;
}

/**
 * Send one chunk. One chunk is one transaction, so one signature.
 *
 * `onSubmitted` is called the instant a signature exists and BEFORE
 * confirmation, so the caller can persist it. Everything after that line can
 * crash without losing the fact that a transfer was sent — mirrors
 * sendWinlew() in the quiz worker, which exists because that gap is where the
 * money is lost.
 */
async function sendChunk(chunk, mint, signer, onSubmitted) {
  const c = conn();
  const mintKey = new PublicKey(mint);
  const info = await c.getParsedAccountInfo(mintKey);
  const decimals = Number(info?.value?.data?.parsed?.info?.decimals ?? 6);

  const fromAta = await spl.getAssociatedTokenAddress(mintKey, signer.publicKey);
  if (!(await c.getAccountInfo(fromAta, "confirmed"))) {
    throw new Error(`source_ata_missing:${fromAta.toBase58()}`);
  }

  const tx = new Transaction();
  for (const t of chunk.transfers) {
    const recipient = new PublicKey(t.payoutWallet);
    const toAta = await spl.getAssociatedTokenAddress(mintKey, recipient);
    if (!(await c.getAccountInfo(toAta, "confirmed"))) {
      // In the SAME transaction as the transfer. A separate create-then-send
      // would leave a window where the account exists and the payment does not.
      tx.add(spl.createAssociatedTokenAccountInstruction(signer.publicKey, toAta, recipient, mintKey));
    }
    tx.add(spl.createTransferInstruction(
      fromAta, toAta, signer.publicKey,
      BigInt(Math.round(Number(t.amount) * 10 ** decimals)),
    ));
  }

  const latest = await c.getLatestBlockhash("confirmed");
  tx.recentBlockhash = latest.blockhash;
  tx.feePayer = signer.publicKey;
  tx.sign(signer);

  const signature = await c.sendRawTransaction(tx.serialize());
  await onSubmitted(signature, latest.lastValidBlockHeight);

  const result = await confirmSignatureByPolling(c, {
    signature, lastValidBlockHeight: latest.lastValidBlockHeight, commitment: "confirmed",
  });
  if (result?.value?.err) throw new Error(`on-chain error: ${JSON.stringify(result.value.err)}`);
  return signature;
}

/**
 * Resolve chunks that were sent but never confirmed, by asking the chain.
 *
 * Three answers, and the third is the important one:
 *   landed        -> confirmed
 *   definitely not -> back to pending, safe to retry
 *   unknown        -> LEFT ALONE. Not retried, not failed.
 */
async function reconcile(batch, save) {
  const unresolved = unresolvedChunks(batch);
  if (!unresolved.length) return batch;

  console.log(`  reconciling ${unresolved.length} unresolved chunk(s) before sending anything…`);
  for (const chunk of unresolved) {
    try {
      const status = await conn().getSignatureStatuses([chunk.signature], { searchTransactionHistory: true });
      const value = status?.value?.[0];
      if (value && !value.err) {
        batch = markConfirmed(batch, chunk.index, chunk.signature);
        console.log(`    chunk ${chunk.index}: already landed — recorded, not resent`);
      } else if (value?.err) {
        batch = markFailed(batch, chunk.index, `on-chain error: ${JSON.stringify(value.err)}`);
        console.log(`    chunk ${chunk.index}: failed on-chain — returned to pending`);
      } else {
        console.log(`    chunk ${chunk.index}: UNKNOWN — left stuck deliberately, will not resend`);
      }
      await save(batch);
    } catch (error) {
      console.warn(`    chunk ${chunk.index}: could not check (${error?.message}) — left stuck`);
    }
  }
  return batch;
}

async function main() {
  const mint = process.env.WINLEW_MINT;
  if (!mint) { console.error("WINLEW_MINT is not set."); process.exit(2); }

  await hodl.refreshHodlStore();
  const epoch = hodl.getActiveEpoch();
  if (!epoch) {
    console.error("No active epoch. Create and activate one before paying anybody.");
    process.exit(2);
  }

  const now = new Date();
  if (!isPayoutDay(epoch, now) && !force) {
    console.log(`Not the payout day for ${epoch.id}. Use --force only for testing.`);
    process.exit(0);
  }

  const weekIndex = weekIndexFor(epoch, now.getTime());
  if (!weekIndex) { console.error("Now is before this epoch starts."); process.exit(2); }

  // A stored snapshot is authoritative. Rebuilding one for a week already paid
  // would re-derive eligibility from TODAY and pay a different set of people
  // against the same week — so it is only built when absent.
  let snapshot = hodl.getSnapshot(epoch.id, weekIndex);
  if (!snapshot) {
    const gathered = await gatherIdentities({
      epoch,
      // Exact base units: the payout is computed in integers (hodlMath.js).
      getBalance: async (w) => getSplBalanceUnits(w, mint),
      isWalletBanned: async (w) => isDirectlyBanned(w),
      isAccountBanned: async (u) => isUserBanned(u),
      getPovScore: async (u) => (await getProofOfValueScore(u))?.score ?? 0,
      getActiveDays: await (await import("../mole/hodlActiveDaysLive.js")).makeLiveActiveDaysReader(),
    });
    if (!gathered.sourceRefreshed) {
      console.error("The participant list could not be refreshed. Refusing to pay from a stale list.");
      process.exit(2);
    }
    // Refused BEFORE the snapshot is built or saved: a stored snapshot is
    // authoritative, so one built from an incomplete participation count would
    // lock in an underpayment for the whole week.
    const activityFailures = gathered.activityReadFailures || [];
    if (activityFailures.length) {
      console.error(`Participation (active days) could not be read for ${activityFailures.length} identity(ies). Refusing to pay a rate that may be understated:`);
      for (const f of activityFailures.slice(0, 10)) console.error(`  ••${String(f.discordUserId).slice(-4)}: ${f.errors.join("; ")}`);
      console.error("Fix the read and run hodl:preview again. Nothing was saved or sent.");
      process.exit(2);
    }
    snapshot = buildWeeklySnapshot({ epoch, participants: gathered.qualified });
    const saved = hodl.saveSnapshot(snapshot);
    if (!saved.ok) { console.error(`Could not save the snapshot: ${saved.error}`); process.exit(2); }
    snapshot = saved.snapshot;
    console.log(`  snapshot taken: ${snapshot.qualifiedCount} qualified, ${n(snapshot.totalAllocated)} WinLEW`);
  } else {
    console.log(`  reusing the stored snapshot for ${epoch.id} week ${weekIndex} (status: ${snapshot.status})`);
  }

  let batch = snapshot.batch || planBatch(snapshot);

  // Every save is flushed to the AUTHORITATIVE store before it returns.
  //
  // updateSnapshotBatch() writes local disk synchronously and queues the Mongo
  // push in the background. That is not good enough here. The next run begins
  // with refreshHodlStore(), which reads Mongo — so a signature that reached
  // only local disk is invisible to it, the chunk still looks pending, and it
  // sends a SECOND transaction. A SIGKILL between submit and confirm is exactly
  // when that happens, and no exit handler can rescue it.
  //
  // "Persisted before confirmation" has to mean persisted where the next run
  // will actually look.
  const save = async (b) => {
    const res = hodl.updateSnapshotBatch(epoch.id, weekIndex, b, snapshot.status);
    await flushManagedWrites();
    return res;
  };

  batch = await reconcile(batch, save);

  const progress = batchProgress(batch);
  console.log("");
  console.log(`HODL payout — ${epoch.id} week ${weekIndex}      ${apply ? "APPLYING" : "DRY RUN, nothing moves"}`);
  console.log(`  transfers        ${batch.transferCount}   total ${n(batch.totalAmount)} WinLEW`);
  console.log(`  already paid     ${progress.confirmed}/${progress.total} chunks  (${n(progress.paidAmount)} WinLEW)`);
  console.log(`  still to send    ${progress.pending}`);
  if (progress.submitted) console.log(`  ⚠️  unresolved   ${progress.submitted} — not resent, resolve these first`);
  console.log("");

  if (!apply) {
    for (const chunk of batch.chunks.filter((c) => c.status === "pending")) {
      for (const t of chunk.transfers) {
        console.log(`    would send ${String(n(t.amount)).padStart(7)} -> ${t.payoutWallet}`);
      }
    }
    console.log("");
    console.log("DRY RUN — nothing was sent. Re-run with --apply to execute.");
    return;
  }

  const signer = loadTreasuryKeypair(getFaucetConfig().botKeypairPath);
  let sent = 0;
  let failed = 0;

  for (;;) {
    const chunk = nextPendingChunk(batch);
    if (!chunk) break;

    // Belt and braces on top of nextPendingChunk: never send a transfer that is
    // already recorded as paid, whatever the chunk's own status says.
    const paid = paidTransferIds(batch);
    if (chunk.transfers.every((t) => paid.has(t.transferId))) {
      batch = markConfirmed(batch, chunk.index, chunk.signature);
      await save(batch);
      continue;
    }

    try {
      const signature = await sendChunk(chunk, mint, signer, async (sig) => {
        // Persisted BEFORE confirmation. A crash between here and the confirm
        // leaves a signature to reconcile, not a silent gap.
        batch = markSubmitted(batch, chunk.index, sig);
        await save(batch);
      });
      batch = markConfirmed(batch, chunk.index, signature);
      await save(batch);
      sent += 1;
      console.log(`    ✅ chunk ${chunk.index}  ${signature}`);
    } catch (error) {
      // Left SUBMITTED if a signature was already recorded — only the chain can
      // say whether it landed. Returned to pending only when it never got that
      // far.
      const current = batch.chunks.find((c) => c.index === chunk.index);
      if (!current.signature) {
        batch = markFailed(batch, chunk.index, error?.message || "send failed");
      }
      await save(batch);
      failed += 1;
      console.error(`    ❌ chunk ${chunk.index}: ${error?.message || error}`);
      if (failed >= 3) { console.error("  three failures — stopping rather than grinding through the list."); break; }
    }
  }

  const final = batchProgress(batch);
  await hodl.updateSnapshotBatch(epoch.id, weekIndex, batch, final.complete ? "paid" : "partial");
  console.log("");
  console.log(`Done. ${sent} chunk(s) sent, ${final.confirmed}/${final.total} confirmed, ${n(final.paidAmount)} WinLEW paid.`);
  if (!final.complete) console.log("Batch INCOMPLETE — re-run to continue; already-paid chunks are skipped.");
}

// flushManagedWrites() before ANY exit, including the failure path — a run that
// crashed after submitting is exactly the run whose signature must survive.
main()
  .then(async () => {
    await flushManagedWrites();
    process.exit(process.exitCode || 0);
  })
  .catch(async (error) => {
    console.error("hodl:pay failed:", error?.message || error);
    await flushManagedWrites().catch(() => {});
    process.exit(2);
  });
