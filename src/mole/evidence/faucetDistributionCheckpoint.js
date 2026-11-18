// Persistence for the faucet distribution scanner, same pattern as
// burnCheckpoint.js: a plain JSON file under DATA_DIR, atomically written,
// gitignored, runtime-generated. No new database dependency.
//
// The checkpoint lets an incremental re-scan pick up only signatures newer
// than the last one seen, instead of walking ~1,000 transactions every time.
import fs from "fs";
import path from "path";
import { getConfig } from "../config.js";

function checkpointPath() {
  return path.join(getConfig().DATA_DIR, "faucet-distribution-checkpoint.json");
}

// A checkpoint is only valid if it reconciled against the chain when written.
// An unreconciled tally is known-incomplete, and publishing one would be worse
// than publishing nothing — so it never becomes a checkpoint at all.
function isValidCheckpoint(data) {
  return (
    !!data &&
    typeof data === "object" &&
    typeof data.totalDistributedBaseUnits === "string" &&
    typeof data.totalReceivedBaseUnits === "string" &&
    typeof data.payoutCount === "number" &&
    typeof data.signaturesScanned === "number" &&
    data.reconciles === true
  );
}

export function loadFaucetDistributionCheckpoint() {
  try {
    const parsed = JSON.parse(fs.readFileSync(checkpointPath(), "utf8"));
    return isValidCheckpoint(parsed) ? parsed : null;
  } catch {
    return null; // never scanned here, or unreadable — treat as "no data"
  }
}

export function saveFaucetDistributionCheckpoint(data) {
  if (!isValidCheckpoint(data)) {
    throw new Error("invalid_or_unreconciled_checkpoint_refusing_to_persist");
  }
  const dir = getConfig().DATA_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const target = checkpointPath();
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, target);
  return target;
}

/**
 * Folds a fresh (incremental) scan into a prior checkpoint. Totals accumulate;
 * recipient sets union; timestamps take the outer bounds. `existing` may be
 * null for a first-ever full scan.
 */
export function mergeFaucetScanResult(existing, scan, reconciliation) {
  const prevOut = BigInt(existing?.totalDistributedBaseUnits || "0");
  const prevIn = BigInt(existing?.totalReceivedBaseUnits || "0");
  const prevBurned = BigInt(existing?.totalBurnedBaseUnits || "0");
  const prevRecipients = new Set(existing?.recipients || []);
  for (const r of scan.tally.recipients) prevRecipients.add(r);

  const firstMs = [existing?.firstPayoutAtIso ? Date.parse(existing.firstPayoutAtIso) : null, scan.tally.firstPayoutAtMs]
    .filter((x) => typeof x === "number" && x > 0);
  const lastMs = [existing?.lastPayoutAtIso ? Date.parse(existing.lastPayoutAtIso) : null, scan.tally.lastPayoutAtMs]
    .filter((x) => typeof x === "number" && x > 0);

  return {
    ata: scan.ata,
    owner: scan.owner,
    totalDistributedBaseUnits: (prevOut + scan.tally.outBaseUnits).toString(),
    totalReceivedBaseUnits: (prevIn + scan.tally.inBaseUnits).toString(),
    totalBurnedBaseUnits: (prevBurned + scan.tally.burnedBaseUnits).toString(),
    payoutCount: (existing?.payoutCount || 0) + scan.tally.payoutCount,
    distinctRecipients: prevRecipients.size,
    recipients: [...prevRecipients],
    signaturesScanned: (existing?.signaturesScanned || 0) + scan.signaturesScanned,
    newestSignature: scan.newestSignature || existing?.newestSignature || null,
    firstPayoutAtIso: firstMs.length ? new Date(Math.min(...firstMs)).toISOString() : null,
    lastPayoutAtIso: lastMs.length ? new Date(Math.max(...lastMs)).toISOString() : null,
    lastScanAtIso: new Date().toISOString(),
    liveBalanceBaseUnits: reconciliation.liveBalanceBaseUnits,
    impliedBalanceBaseUnits: reconciliation.impliedBalanceBaseUnits,
    reconciles: reconciliation.reconciles,
  };
}
