#!/usr/bin/env node
// WinLEW backup burn-history scanner — CLI entry point. Run via
// `npm run burn:scan`. See docs/burn-history-scanner.md.
//
// This is the ONLY way a full historical scan runs — never from a public
// HTTP route (see src/mole/web.js's /api/burn/status, which only ever
// reads the checkpoint this command writes).
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url)); // .../src/scripts
const SRC_DIR = path.resolve(SCRIPT_DIR, ".."); // .../src
const REPO_ROOT = path.resolve(SRC_DIR, ".."); // repo root, where the real .env lives

// Load the root .env explicitly by absolute path — independent of cwd,
// unlike a bare `import "dotenv/config"` (which looks for .env relative to
// process.cwd() and would silently find nothing once we chdir below).
dotenv.config({ path: path.join(REPO_ROOT, ".env") });

// DATA_DIR (src/mole/config.js) defaults to the relative "./data", and
// every long-running service resolves it relative to ITS OWN directory —
// see src/runner.js's spawnService() and ecosystem.config.cjs, both of
// which set cwd to path.dirname(entryFile) for exactly this reason (so
// winlew-mole's real data lives at src/data/, not a repo-root data/). This
// script chdir's to src/ (same as winlew-mole's own cwd) so it resolves
// DATA_DIR identically — otherwise its checkpoint lands somewhere
// /api/burn/status's read of the same env var will never find.
process.chdir(SRC_DIR);

import { WINLEW_MINT, BURN_WALLET_ADDRESS, BURN_EVENTS } from "../mole/burnEvents.js";
import { scanWinLewBurnHistory, reconcileBurnRecords } from "../mole/evidence/burnScanner.js";
import { loadBurnScanCheckpoint, saveBurnScanCheckpoint, mergeBurnScanResult } from "../mole/evidence/burnCheckpoint.js";

function parseArgs(argv) {
  const args = { mode: "incremental", rpcMode: "auto", verifyOnly: false };
  for (const raw of argv) {
    if (raw === "--full") args.mode = "full";
    else if (raw === "--incremental") args.mode = "incremental";
    else if (raw === "--verify-only") args.verifyOnly = true;
    else if (raw.startsWith("--rpc=")) args.rpcMode = raw.slice("--rpc=".length);
  }
  return args;
}

function short(addr) {
  const s = String(addr || "");
  return s.length > 10 ? `${s.slice(0, 6)}...${s.slice(-4)}` : s;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log("WinLEW burn-history scan");
  console.log(`Mint: ${short(WINLEW_MINT)}`);
  console.log(`Address scanned: burn wallet (${short(BURN_WALLET_ADDRESS)})`);
  console.log(`Mode: ${args.mode}${args.verifyOnly ? " (verify-only — checkpoint will not be written)" : ""}`);
  console.log(`RPC mode: ${args.rpcMode}`);

  const existing = loadBurnScanCheckpoint();
  const until = args.mode === "incremental" ? existing?.newestIndexedSignature || undefined : undefined;
  if (until) console.log(`Incremental: only scanning signatures newer than ${short(until)}`);
  else if (existing) console.log("Full scan: re-walking entire signature history (ignoring existing checkpoint's cursor)");
  else console.log("No prior checkpoint found — this will be a full historical scan");

  let lastLoggedSigCount = 0;
  let lastLoggedTxCount = 0;
  const startedAt = Date.now();

  const result = await scanWinLewBurnHistory(
    { mint: WINLEW_MINT, address: BURN_WALLET_ADDRESS, until, rpcMode: args.rpcMode },
    {
      onProgress: (p) => {
        if (p.phase === "signatures" && p.collected - lastLoggedSigCount >= 500) {
          lastLoggedSigCount = p.collected;
          console.log(`  ...${p.collected} signatures indexed so far`);
        }
        if (p.phase === "transactions" && p.collected - lastLoggedTxCount >= 200) {
          lastLoggedTxCount = p.collected;
          console.log(`  ...${p.collected}/${p.total} transactions parsed`);
        }
      },
    },
  );

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log("");
  console.log(`RPC source used: ${result.checkpoint.rpcSourceUsed}`);
  console.log(`Decimals: ${result.decimals} (source: ${result.decimalsSource})`);
  console.log(`Signatures indexed: ${result.checkpoint.signaturesScanned}`);
  console.log(`Transactions parsed: ${result.checkpoint.signaturesScanned - result.unresolved.length}`);
  console.log(`Burn instructions found (this scan): ${result.burnInstructionCount}`);
  console.log(`Total burned (this scan's address): ${result.totalUiBurned} WinLEW`);
  console.log(`Unresolved transactions: ${result.unresolved.length}`);
  console.log(`Elapsed: ${elapsedSec}s`);

  // Reconcile against the FULL accumulated history (this run's finds merged
  // with everything a prior scan already indexed), not just this run's
  // delta — an incremental scan with 0 new signatures would otherwise make
  // every previously-found burn look "missing" simply because this run's
  // own result.records is empty.
  // mergeBurnScanResult() accumulates both records AND unresolvedSignatures
  // across runs (see its own doc comment) — reconciling against the merged
  // checkpoint, not this run's bare result, so a 0-new-signatures
  // incremental run doesn't make prior finds look newly missing.
  const merged = mergeBurnScanResult(existing, result);
  console.log("");
  console.log("--- Reconciliation vs. src/mole/burnEvents.js (accumulated history) ---");
  const reconciliation = reconcileBurnRecords({ records: merged.records }, BURN_EVENTS, merged.unresolvedSignatures);
  console.log(`Matched: ${reconciliation.matched.length}`);
  console.log(`In ledger, genuinely not found: ${reconciliation.missingFromRpcScan.length}`);
  if (reconciliation.missingButUnresolved.length) {
    console.log(`In ledger, inconclusive — this run couldn't fetch that transaction (rate-limited/pruned, not evidence either way): ${reconciliation.missingButUnresolved.length}`);
  }
  console.log(`Found in history, not in ledger: ${reconciliation.missingFromStoredHistory.length}`);
  console.log(`Amount mismatches: ${reconciliation.amountMismatches.length}`);
  for (const m of reconciliation.amountMismatches) {
    console.log(`  ${m.id}: ledger=${m.storedAmount} scanned=${m.scannedAmount}`);
  }
  if (reconciliation.duplicateStoredRecords.length) {
    console.log(`Duplicate ledger entries (same signature): ${reconciliation.duplicateStoredRecords.join(", ")}`);
  }

  if (args.verifyOnly) {
    console.log("");
    console.log("verify-only mode: checkpoint not written.");
    return;
  }

  const target = saveBurnScanCheckpoint(merged);
  console.log("");
  console.log(`Checkpoint written (${merged.records.length} total indexed burn instructions, ${merged.totalUiBurned} WinLEW).`);
  console.log(`(local file, not committed to git: ${target})`);
}

main().catch((err) => {
  console.error("Burn scan failed:", err?.message || err);
  process.exitCode = 1;
});
