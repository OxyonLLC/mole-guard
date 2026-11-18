#!/usr/bin/env node
// Resolves faucet claims stuck in `reconciling` — the manual procedure in
// docs/faucet-web-expansion.md §15, which that document notes has no admin
// UI and therefore rarely gets done.
//
//   npm run faucet:reconcile              DRY RUN — prints the plan, changes nothing
//   npm run faucet:reconcile -- --apply   executes the plan
//   npm run faucet:reconcile -- --include-failed
//                                         also examine known_failed claims,
//                                         since categorizeTransferError() is
//                                         best-effort and can misfile a
//                                         transfer that actually landed
//   npm run faucet:reconcile -- --window-hours=6 --release-after-hours=48
//
// DRY RUN IS THE DEFAULT ON PURPOSE. This writes to claim records that decide
// who got paid; nothing changes until someone reads the plan and passes
// --apply.
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(SRC_DIR, "..");

dotenv.config({ path: path.join(REPO_ROOT, ".env") });
// Same reasoning as burn-scan.js / faucet-distribution-scan.js: resolve
// DATA_DIR exactly as the running service does.
process.chdir(SRC_DIR);

const {
  CLAIM_STATUSES, listClaimsByStatus, markSubmitted, markConfirmed,
  releaseReservationAdministratively, getGlobalFaucetStats,
} = await import("../faucet/claimStore.js");
const { planReconciliation, summarizePlan, DEFAULT_WINDOW_MS } = await import("../faucet/reconcileClaims.js");
const { getSignaturesForAddressRpc, getTransactionRpc } = await import("../mole/evidence/solanaRpcClient.js");
const { FAUCET_ATA } = await import("../mole/evidence/faucetDistributionScanner.js");

function parseArgs(argv) {
  const a = { apply: false, includeFailed: false, windowMs: DEFAULT_WINDOW_MS, releaseAfterMs: 24 * 3600 * 1000, lookbackDays: 45 };
  for (const raw of argv) {
    if (raw === "--apply") a.apply = true;
    else if (raw === "--include-failed") a.includeFailed = true;
    else if (raw.startsWith("--window-hours=")) a.windowMs = Number(raw.split("=")[1]) * 3600 * 1000;
    else if (raw.startsWith("--release-after-hours=")) a.releaseAfterMs = Number(raw.split("=")[1]) * 3600 * 1000;
    else if (raw.startsWith("--lookback-days=")) a.lookbackDays = Number(raw.split("=")[1]);
  }
  return a;
}
const args = parseArgs(process.argv.slice(2));
const fmt = (b) => {
  const n = BigInt(b || "0");
  return `${(n / 1000000n).toLocaleString("en-US")}.${(n % 1000000n).toString().padStart(6, "0")}`;
};
const when = (ms) => (Number.isFinite(Number(ms)) && Number(ms) > 0 ? new Date(Number(ms)).toISOString() : "—");

console.log("Faucet claim reconciliation");
console.log("  mode        :", args.apply ? "APPLY (will modify claim records)" : "DRY RUN (no changes)");
console.log("  statuses    :", args.includeFailed ? "reconciling + known_failed" : "reconciling");
console.log("  match window: ±" + args.windowMs / 3600000 + "h around claim creation");
console.log("");

// ── 1. stuck claims ─────────────────────────────────────────────────────
const stuck = [...(await listClaimsByStatus(CLAIM_STATUSES.RECONCILING, 500))];
if (args.includeFailed) stuck.push(...(await listClaimsByStatus(CLAIM_STATUSES.KNOWN_FAILED, 500)));

if (!stuck.length) {
  console.log("No stuck claims found. Nothing to reconcile.");
  process.exit(0);
}
console.log(`Found ${stuck.length} claim(s) to examine.`);

// ── 2. signatures already credited, so one payout can never pay two claims ──
const credited = new Set();
for (const status of [CLAIM_STATUSES.CONFIRMED, CLAIM_STATUSES.SUBMITTED]) {
  for (const c of await listClaimsByStatus(status, 5000)) {
    if (c.signature) credited.add(c.signature);
  }
}
console.log(`Signatures already credited to other claims: ${credited.size}`);

// ── 3. recent outbound faucet transfers from the chain ──────────────────
const cutoff = Date.now() - args.lookbackDays * 86400000;
const transfers = [];
let before;
let scanned = 0;
for (;;) {
  const { result } = await getSignaturesForAddressRpc(FAUCET_ATA, { limit: 1000, ...(before ? { before } : {}) });
  const page = result || [];
  if (!page.length) break;
  let done = false;
  for (const s of page) {
    if ((s.blockTime || 0) * 1000 < cutoff) { done = true; break; }
    if (s.err) continue;
    scanned += 1;
    const { result: tx } = await getTransactionRpc(s.signature, {});
    if (!tx || tx.meta?.err) continue;
    const ins = [
      ...(tx.transaction.message.instructions || []),
      ...((tx.meta.innerInstructions || []).flatMap((x) => x.instructions || [])),
    ];
    for (const ix of ins) {
      const p = ix.parsed;
      if (!p || typeof p !== "object") continue;
      if (p.type !== "transfer" && p.type !== "transferChecked") continue;
      if (p.info?.source !== FAUCET_ATA) continue;
      transfers.push({
        signature: s.signature,
        blockTimeMs: (tx.blockTime || 0) * 1000,
        destinationAta: p.info.destination,
        amountBaseUnits: String(p.info.amount || p.info.tokenAmount?.amount || "0"),
      });
    }
    process.stdout.write(`  scanning chain: ${scanned}\r`);
  }
  if (done) break;
  before = page[page.length - 1].signature;
  if (page.length < 1000) break;
}
console.log(`\nOutbound faucet transfers in the last ${args.lookbackDays} days: ${transfers.length}`);
console.log("");

// ── 4. plan ─────────────────────────────────────────────────────────────
const plan = planReconciliation(stuck, transfers, {
  windowMs: args.windowMs,
  releaseAfterMs: args.releaseAfterMs,
  alreadyCreditedSignatures: credited,
});
const summary = summarizePlan(plan);

console.log("PLAN");
for (const item of plan) {
  const c = item.claim;
  const head = `  [${item.action.toUpperCase().padEnd(7)}] ${c.id}  ${c.source || "?"}  ${fmt(c.amountBaseUnits)}  ${when(c.createdAt)}`;
  console.log(head);
  console.log(`             wallet ${c.wallet}`);
  if (item.action === "confirm") {
    console.log(`             -> credit signature ${item.transfer.signature}`);
    console.log(`                https://solscan.io/tx/${item.transfer.signature}`);
  } else if (item.action === "release") {
    console.log(`             -> no matching transfer after ${args.releaseAfterMs / 3600000}h; release cooldown (${item.reason})`);
  } else {
    console.log(`             -> NEEDS A HUMAN (${item.reason})${item.candidates?.length ? `, ${item.candidates.length} candidates` : ""}`);
    for (const cand of item.candidates || []) console.log(`                candidate ${cand.signature} @ ${when(cand.blockTimeMs)}`);
  }
}
console.log("");
console.log(`SUMMARY: ${summary.confirm} to confirm, ${summary.release} to release, ${summary.review} needing review (of ${summary.total}).`);

if (!args.apply) {
  console.log("");
  console.log("DRY RUN — nothing was changed. Re-run with --apply to execute the confirm/release actions.");
  console.log("Items marked NEEDS A HUMAN are never applied automatically.");
  process.exit(0);
}

// ── 5. apply ────────────────────────────────────────────────────────────
console.log("");
console.log("APPLYING…");
let confirmed = 0; let released = 0; const failures = [];
for (const item of plan) {
  try {
    if (item.action === "confirm") {
      await markSubmitted(item.claim.id, item.transfer.signature);
      await markConfirmed(item.claim.id);
      confirmed += 1;
      console.log(`  confirmed ${item.claim.id} <- ${item.transfer.signature}`);
    } else if (item.action === "release") {
      await releaseReservationAdministratively(item.claim.id, item.reason, { force: true });
      released += 1;
      console.log(`  released  ${item.claim.id}`);
    }
  } catch (error) {
    failures.push({ id: item.claim.id, error: error?.message || String(error) });
    console.error(`  FAILED    ${item.claim.id}: ${error?.message || error}`);
  }
}

const after = await getGlobalFaucetStats();
console.log("");
console.log(`Done. ${confirmed} confirmed, ${released} released, ${failures.length} failed.`);
console.log(`Claim store now reports ${after.totalConfirmedCount} confirmed claims totalling ${after.totalConfirmedAmount}.`);
if (failures.length) process.exit(1);
