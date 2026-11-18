// Backup WinLEW burn-history scanner — reconstructs verified burn records
// directly from Solana transaction history, independent of the hand-
// maintained BURN_EVENTS ledger in src/mole/burnEvents.js. This exists
// because that ledger is populated by a human fetching and reading one
// transaction at a time (see docs/burn-program.md §6, and the 2026-07-24
// session that found the ~22.9M post-graduation gap the same way) — this
// module formalizes and automates that exact process so it can be re-run,
// verified, and reconciled against the ledger on demand.
//
// This is a BACKUP/verification path, not a replacement: BURN_EVENTS stays
// the canonical source for what the site displays. See
// docs/burn-history-scanner.md for the full design writeup.
//
// SAFETY: pure read path. No signing capability anywhere in this file or
// its RPC client (solanaRpcClient.js) — nothing here can send tokens or
// touch a private key.
import { getSignaturesForAddressRpc, getTransactionRpc, getTokenSupplyRpc } from "./solanaRpcClient.js";

export const BURN_SCANNER_VERSION = "1.0.0";
export const FALLBACK_DECIMALS = 6; // documented fallback only — see getWinlewDecimals()
const DEFAULT_PAGE_SIZE = 1000; // Solana RPC's own max for getSignaturesForAddress
const DEFAULT_MAX_SIGNATURES = 50_000;
const DEFAULT_CONCURRENCY = 5;

function explorerUrl(signature) {
  return `https://solscan.io/tx/${signature}`;
}

/** BigInt-safe integer -> decimal string, e.g. (1234n, 6) -> "0.001234". Never touches Number for the raw value. */
export function rawAmountToUiString(rawAmount, decimals) {
  const raw = BigInt(rawAmount);
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  const divisor = 10n ** BigInt(decimals);
  const whole = abs / divisor;
  const fracDigits = decimals > 0 ? (abs % divisor).toString().padStart(decimals, "0").replace(/0+$/, "") : "";
  const s = fracDigits ? `${whole}.${fracDigits}` : `${whole}`;
  return neg ? `-${s}` : s;
}

/**
 * Mint decimals, preferring a live getTokenSupply() read over the
 * documented fallback constant — per project requirement, WinLEW's 6
 * decimals must never be silently assumed when the chain can answer.
 */
export async function getWinlewDecimals({ mint, getTokenSupply = getTokenSupplyRpc, rpcMode } = {}) {
  try {
    const { result, rpcLabel } = await getTokenSupply(mint, { rpcMode });
    if (result?.value?.decimals != null) {
      return { decimals: result.value.decimals, source: "getTokenSupply", rpcLabel };
    }
  } catch {
    // fall through to the documented fallback below
  }
  return { decimals: FALLBACK_DECIMALS, source: "fallback-constant", rpcLabel: null };
}

function extractAmount(info) {
  if (info?.tokenAmount?.amount != null) {
    return { rawAmount: String(info.tokenAmount.amount), decimalsHint: info.tokenAmount.decimals ?? null };
  }
  if (info?.amount != null) {
    return { rawAmount: String(info.amount), decimalsHint: null };
  }
  return null;
}

function makeRecordId({ signature, location, outerIndex, innerIndex }) {
  return `${signature}:${location}:${outerIndex ?? "-"}:${innerIndex ?? "-"}`;
}

function matchBurnInstruction(ix, ctx) {
  const type = ix?.parsed?.type;
  if (type !== "burn" && type !== "burnChecked") return null;
  const info = ix.parsed.info || {};
  if (info.mint !== ctx.mint) return null;

  const amt = extractAmount(info);
  if (!amt) return null;
  const decimals = amt.decimalsHint ?? ctx.decimals;

  return {
    id: makeRecordId(ctx),
    signature: ctx.signature,
    slot: ctx.slot ?? null,
    blockTime: ctx.blockTime ?? null,
    instructionType: type,
    instructionLocation: ctx.location,
    outerInstructionIndex: ctx.outerIndex ?? null,
    innerInstructionIndex: ctx.innerIndex ?? null,
    mint: ctx.mint,
    authority: info.authority || null,
    tokenAccount: info.account || null,
    rawAmount: amt.rawAmount,
    decimals,
    uiAmount: rawAmountToUiString(amt.rawAmount, decimals),
    explorerUrl: explorerUrl(ctx.signature),
    status: ctx.commitment === "finalized" ? "finalized" : "confirmed",
    source: "solana-rpc-history-scan",
    rpcProviderLabel: ctx.rpcLabel || null,
    verified: true,
  };
}

/**
 * Scans one already-fetched transaction for burn instructions on `mint`.
 * Exported standalone (not just used internally) so tests can feed it a
 * fixture transaction directly without going through the RPC/pagination
 * machinery at all.
 */
export function findBurnInstructionsInTransaction(tx, { signature, mint, decimals, rpcLabel = null, commitment = "finalized" }) {
  if (!tx) return [];
  if (tx.meta?.err) return []; // failed transaction — never a burn, no matter what it parses as

  const records = [];
  const outer = tx.transaction?.message?.instructions || [];
  outer.forEach((ix, outerIndex) => {
    const rec = matchBurnInstruction(ix, {
      signature, mint, decimals, rpcLabel, commitment,
      location: "outer", outerIndex, innerIndex: null,
      slot: tx.slot, blockTime: tx.blockTime,
    });
    if (rec) records.push(rec);
  });

  for (const group of tx.meta?.innerInstructions || []) {
    (group.instructions || []).forEach((ix, innerIndex) => {
      const rec = matchBurnInstruction(ix, {
        signature, mint, decimals, rpcLabel, commitment,
        location: "inner", outerIndex: group.index, innerIndex,
        slot: tx.slot, blockTime: tx.blockTime,
      });
      if (rec) records.push(rec);
    });
  }
  return records;
}

/**
 * Walks one address's signature history backward (paginating on `before`),
 * fetches each transaction with bounded concurrency, and returns every
 * verified burn instruction on `mint` found along the way.
 *
 * `address` defaults to the mint itself, but scanning the mint's OWN
 * signature history is almost never what you want in practice — every
 * swap/transferChecked against WinLEW references the mint, so its history
 * is enormous (confirmed empirically: ~1000 signatures covers only ~1.5
 * days of trading). Pass a specific known wallet/account (e.g. the burn
 * wallet, or a bonding-curve reserve account) for a scan that actually
 * completes in reasonable time — see src/scripts/burn-scan.js, which
 * defaults to BURN_WALLET_ADDRESS for exactly this reason.
 */
export async function scanWinLewBurnHistory(options = {}, deps = {}) {
  const {
    mint,
    address = mint,
    before,
    until,
    maxSignatures = DEFAULT_MAX_SIGNATURES,
    pageSize = DEFAULT_PAGE_SIZE,
    commitment = "finalized",
    rpcMode = "auto",
    concurrency = DEFAULT_CONCURRENCY,
  } = options;

  if (!mint) throw new Error("mint_required");
  if (!address) throw new Error("address_required");

  const {
    getSignaturesForAddress = getSignaturesForAddressRpc,
    getTransaction = getTransactionRpc,
    getTokenSupply = getTokenSupplyRpc,
    onProgress,
  } = deps;

  const decimalsInfo = await getWinlewDecimals({ mint, getTokenSupply, rpcMode });

  // ── Phase 1: paginate signatures ──────────────────────────────────────
  const signatures = [];
  let cursor = before;
  let rpcSourceUsed = null;
  let reachedUntil = false;
  while (signatures.length < maxSignatures) {
    const limit = Math.min(pageSize, maxSignatures - signatures.length, 1000);
    const { result: page, rpcLabel } = await getSignaturesForAddress(address, { before: cursor, until, limit, commitment, rpcMode });
    if (rpcLabel) rpcSourceUsed = rpcLabel;
    if (!page || !page.length) break;

    for (const entry of page) {
      if (until && entry.signature === until) { reachedUntil = true; break; }
      signatures.push(entry);
    }
    onProgress?.({ phase: "signatures", collected: signatures.length });
    if (reachedUntil || page.length < limit) break; // hit the until-cursor, or the true start of history
    cursor = page[page.length - 1].signature;
  }

  // ── Phase 2: fetch + scan transactions, bounded concurrency ───────────
  const records = [];
  const unresolved = [];
  let transactionsFetched = 0;
  const queue = signatures.map((s) => s.signature);

  async function worker() {
    while (queue.length) {
      const sig = queue.pop();
      try {
        const { result: tx, rpcLabel } = await getTransaction(sig, { commitment, rpcMode });
        transactionsFetched++;
        if (tx == null) {
          // A missing/pruned/unavailable transaction is unresolved evidence,
          // never proof of "no burn happened here" — see spec's error
          // handling requirements.
          unresolved.push({ signature: sig, reason: "null_or_pruned_transaction" });
        } else {
          if (rpcLabel) rpcSourceUsed = rpcLabel;
          records.push(...findBurnInstructionsInTransaction(tx, { signature: sig, mint, decimals: decimalsInfo.decimals, rpcLabel, commitment }));
        }
      } catch (err) {
        unresolved.push({ signature: sig, reason: err?.message || "fetch_failed" });
      }
      onProgress?.({ phase: "transactions", collected: transactionsFetched, total: signatures.length });
    }
  }
  const workerCount = Math.max(1, Math.min(concurrency, queue.length));
  await Promise.all(Array.from({ length: workerCount }, worker));

  // ── Phase 3: dedupe + aggregate ────────────────────────────────────────
  // Dedup key is signature+location+indices, not just signature — a single
  // transaction can legitimately contain more than one burn instruction
  // (see spec: multiple distinct burns in one tx must both survive).
  const byId = new Map();
  for (const r of records) byId.set(r.id, r);
  const dedupedRecords = [...byId.values()].sort((a, b) => (a.blockTime ?? 0) - (b.blockTime ?? 0));

  const totalRawBurned = dedupedRecords.reduce((sum, r) => sum + BigInt(r.rawAmount), 0n);
  const burnTxSignatures = new Set(dedupedRecords.map((r) => r.signature));

  return {
    mint,
    address,
    decimals: decimalsInfo.decimals,
    decimalsSource: decimalsInfo.source,
    burnTransactionCount: burnTxSignatures.size,
    burnInstructionCount: dedupedRecords.length,
    totalRawBurned: totalRawBurned.toString(),
    totalUiBurned: rawAmountToUiString(totalRawBurned.toString(), decimalsInfo.decimals),
    firstBurnAt: dedupedRecords[0]?.blockTime ? new Date(dedupedRecords[0].blockTime * 1000).toISOString() : null,
    latestBurnAt: dedupedRecords.length ? new Date(dedupedRecords[dedupedRecords.length - 1].blockTime * 1000).toISOString() : null,
    records: dedupedRecords,
    unresolved,
    checkpoint: {
      newestIndexedSignature: signatures[0]?.signature ?? until ?? null,
      oldestIndexedSignature: signatures[signatures.length - 1]?.signature ?? null,
      lastSuccessfulScanAt: new Date().toISOString(),
      signaturesScanned: signatures.length,
      burnInstructionsFound: dedupedRecords.length,
      rpcSourceUsed: rpcSourceUsed || "unknown",
      scanVersion: BURN_SCANNER_VERSION,
    },
  };
}

/**
 * Compares scanner-derived burn records against the hand-maintained
 * BURN_EVENTS ledger by transaction signature. Only ledger entries that
 * carry a signature are reconcilable at all (e.g. a PENDING_VERIFICATION
 * entry recorded from a supply-delta, with no signature yet, correctly
 * can't be matched — it isn't "missing," it was never claimed as located).
 * Never deletes or rewrites anything; purely a read-only comparison.
 *
 * `unresolvedSignatures` (optional — pass `scanResult.unresolved.map(u =>
 * u.signature)`) distinguishes two very different situations for a stored
 * event whose signature the scan didn't find: the transaction was fetched
 * and genuinely contains no matching burn (missingFromRpcScan), versus the
 * scan simply couldn't reach that transaction this run — e.g. rate-limited
 * by the public RPC — which is inconclusive, not evidence of anything
 * (missingButUnresolved). Conflating the two would let a rate-limit make a
 * real, previously-verified burn look disputed.
 */
export function reconcileBurnRecords(scanResult, storedEvents = [], unresolvedSignatures = []) {
  const matched = [];
  const missingFromRpcScan = [];
  const missingButUnresolved = [];
  const missingFromStoredHistory = [];
  const amountMismatches = [];
  const duplicateStoredRecords = [];
  const duplicateRpcRecords = [];
  const unresolvedSet = new Set(unresolvedSignatures);

  const scanBySig = new Map();
  for (const r of scanResult.records) {
    if (!scanBySig.has(r.signature)) scanBySig.set(r.signature, []);
    scanBySig.get(r.signature).push(r);
  }
  for (const [sig, group] of scanBySig) {
    if (group.length > 1) duplicateRpcRecords.push(sig);
  }

  const seenStoredSigs = new Set();
  for (const event of storedEvents) {
    if (!event.signature) continue; // unresolvable by signature — not a mismatch, just out of scope for this comparison
    if (seenStoredSigs.has(event.signature)) {
      duplicateStoredRecords.push(event.id);
      continue;
    }
    seenStoredSigs.add(event.signature);

    const scanMatches = scanBySig.get(event.signature);
    if (!scanMatches) {
      if (unresolvedSet.has(event.signature)) missingButUnresolved.push(event.id);
      else missingFromRpcScan.push(event.id);
      continue;
    }
    const scannedTotal = scanMatches.reduce((sum, r) => sum + BigInt(r.rawAmount), 0n);
    const storedAmount = BigInt(event.amountBaseUnits);
    if (scannedTotal === storedAmount) {
      matched.push(event.id);
    } else {
      amountMismatches.push({ id: event.id, storedAmount: storedAmount.toString(), scannedAmount: scannedTotal.toString() });
    }
  }

  for (const sig of scanBySig.keys()) {
    if (!seenStoredSigs.has(sig)) missingFromStoredHistory.push(sig);
  }

  return { matched, missingFromRpcScan, missingButUnresolved, missingFromStoredHistory, amountMismatches, duplicateStoredRecords, duplicateRpcRecords };
}
