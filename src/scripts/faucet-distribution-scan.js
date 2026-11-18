#!/usr/bin/env node
// WinLEW faucet lifetime-distribution scanner — CLI entry point. Run via
// `npm run faucet:scan`. Companion to `npm run burn:scan`.
//
// Answers "how much has the Faucet Reserve wallet actually paid out, ever",
// read from the chain. This is NOT the same as claimStore's confirmed-claim
// totals (which count what this platform recorded) — see the header comment
// in src/mole/evidence/faucetDistributionScanner.js for why both exist.
//
// Like burn:scan, this is the ONLY place a full historical scan runs. Public
// HTTP routes only ever read the checkpoint this command writes.
//
// Usage:
//   npm run faucet:scan              incremental (only signatures newer than last run)
//   npm run faucet:scan -- --full    rebuild from genesis
//   npm run faucet:scan -- --rpc=primary
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(SRC_DIR, "..");

dotenv.config({ path: path.join(REPO_ROOT, ".env") });

// Same reasoning as burn-scan.js: chdir to src/ so DATA_DIR resolves exactly
// as it does for the running winlew-mole service, otherwise the checkpoint
// lands where /api/... will never look for it.
process.chdir(SRC_DIR);

const { scanFaucetDistribution, reconcileAgainstChain, FAUCET_ATA, FAUCET_OWNER } = await import(
  "../mole/evidence/faucetDistributionScanner.js"
);
const { loadFaucetDistributionCheckpoint, saveFaucetDistributionCheckpoint, mergeFaucetScanResult } = await import(
  "../mole/evidence/faucetDistributionCheckpoint.js"
);

function parseArgs(argv) {
  const args = { mode: "incremental", rpcMode: "auto" };
  for (const raw of argv) {
    if (raw === "--full") args.mode = "full";
    else if (raw === "--incremental") args.mode = "incremental";
    else if (raw.startsWith("--rpc=")) args.rpcMode = raw.slice("--rpc=".length);
  }
  return args;
}

const fmt = (base) => {
  const n = BigInt(base);
  const whole = n / 1_000_000n;
  const frac = (n % 1_000_000n).toString().padStart(6, "0");
  return `${whole.toLocaleString("en-US")}.${frac}`;
};

const args = parseArgs(process.argv.slice(2));
const existing = args.mode === "full" ? null : loadFaucetDistributionCheckpoint();

console.log("WinLEW faucet distribution scan");
console.log("  wallet :", FAUCET_OWNER);
console.log("  ATA    :", FAUCET_ATA);
console.log("  mode   :", args.mode, existing ? `(resuming after ${existing.newestSignature?.slice(0, 12)}…)` : "(from genesis)");
console.log("");

let lastPhase = "";
const scan = await scanFaucetDistribution({
  untilSignature: existing?.newestSignature || null,
  rpcMode: args.rpcMode,
  onProgress: ({ phase, count, total }) => {
    if (phase !== lastPhase) { process.stdout.write("\n"); lastPhase = phase; }
    process.stdout.write(`  ${phase}: ${count}${total ? `/${total}` : ""}\r`);
  },
});
process.stdout.write("\n\n");

if (!scan.complete) {
  console.error(`INCOMPLETE — ${scan.unresolvedSignatures.length} transaction(s) could not be fetched.`);
  console.error("Refusing to write a checkpoint from a partial scan; a partial walk under-reports.");
  console.error("Re-run when the RPC is healthier. Unresolved:", scan.unresolvedSignatures.slice(0, 5));
  process.exit(1);
}

if (scan.signaturesScanned === 0 && existing) {
  console.log("No new signatures since the last scan — checkpoint already current.");
  console.log("  total distributed:", fmt(existing.totalDistributedBaseUnits), "WinLEW");
  process.exit(0);
}

const merged = mergeFaucetScanResult(existing, scan, { liveBalanceBaseUnits: "0", impliedBalanceBaseUnits: "0", reconciles: false });

// Reconcile the MERGED lifetime totals, not just this run's delta.
const reconciliation = await reconcileAgainstChain(
  {
    inBaseUnits: BigInt(merged.totalReceivedBaseUnits),
    outBaseUnits: BigInt(merged.totalDistributedBaseUnits),
    burnedBaseUnits: BigInt(merged.totalBurnedBaseUnits),
  },
  { rpcMode: args.rpcMode },
);

const final = { ...merged, ...reconciliation };

console.log("RECONCILIATION");
console.log("  received IN     :", fmt(final.totalReceivedBaseUnits));
console.log("  sent OUT        :", fmt(final.totalDistributedBaseUnits));
if (final.totalBurnedBaseUnits !== "0") console.log("  burned          :", fmt(final.totalBurnedBaseUnits));
console.log("  implied balance :", fmt(final.impliedBalanceBaseUnits));
console.log("  live balance    :", fmt(final.liveBalanceBaseUnits));
console.log("  reconciles      :", final.reconciles ? "YES" : `NO (off by ${fmt(final.differenceBaseUnits)})`);
console.log("");

if (!final.reconciles) {
  console.error("Totals do not close against the live balance — NOT writing a checkpoint.");
  console.error("");
  console.error("Most likely causes, in order:");
  console.error("  1. A payout landed mid-scan. Just re-run; the numbers move together.");
  console.error("  2. This was an incremental run over a stale checkpoint — try `--full`.");
  console.error("  3. Transactions genuinely missing from the walk (RPC gaps).");
  console.error("");
  console.error("A published total that doesn't close is worse than no total, so nothing was written.");
  process.exit(1);
}

const written = saveFaucetDistributionCheckpoint(final);
console.log("RESULT");
console.log("  total distributed  :", fmt(final.totalDistributedBaseUnits), "WinLEW");
console.log("  payout transfers   :", final.payoutCount.toLocaleString("en-US"));
console.log("  distinct recipients:", final.distinctRecipients);
console.log("  first payout       :", final.firstPayoutAtIso);
console.log("  latest payout      :", final.lastPayoutAtIso);
console.log("  checkpoint written :", written);
