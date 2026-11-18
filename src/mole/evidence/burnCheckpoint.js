// Persistence for the backup burn scanner's (src/mole/evidence/burnScanner.js)
// indexed results, so an incremental re-scan doesn't have to walk full
// history every time. Plain JSON file under DATA_DIR, same pattern as
// src/mole/contributions.js's file store — no new database dependency.
// DATA_DIR is gitignored (see .gitignore's `data/` entry), so this file is
// runtime-generated cache, never committed.
import fs from "fs";
import path from "path";
import { getConfig } from "../config.js";
import { rawAmountToUiString } from "./burnScanner.js";

function checkpointPath() {
  return path.join(getConfig().DATA_DIR, "burn-scan-checkpoint.json");
}

export function loadBurnScanCheckpoint() {
  try {
    const raw = fs.readFileSync(checkpointPath(), "utf8");
    const parsed = JSON.parse(raw);
    return isValidCheckpoint(parsed) ? parsed : null;
  } catch {
    return null; // no checkpoint yet, or it's unreadable — either way, treat as "no prior scan"
  }
}

function isValidCheckpoint(data) {
  return (
    !!data &&
    typeof data === "object" &&
    typeof data.signaturesScanned === "number" &&
    Array.isArray(data.records) &&
    typeof data.totalRawBurned === "string"
  );
}

/**
 * Atomic write: build+validate the full new state first, write to a temp
 * file, then rename over the canonical path. A crash or failed scan mid-way
 * through never leaves a truncated or partial checkpoint in place — the
 * rename either fully happens or the old (still-valid) file is untouched.
 */
export function saveBurnScanCheckpoint(data) {
  if (!isValidCheckpoint(data)) {
    throw new Error("invalid_checkpoint_shape_refusing_to_persist");
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
 * Merges a new scan's records into the prior checkpoint (dedup by record
 * id — see burnScanner.js's makeRecordId), so incremental scans accumulate
 * rather than replace. `existing` may be null (first-ever scan).
 */
export function mergeBurnScanResult(existing, result) {
  const byId = new Map((existing?.records || []).map((r) => [r.id, r]));
  for (const r of result.records) byId.set(r.id, r);
  const records = [...byId.values()].sort((a, b) => (a.blockTime ?? 0) - (b.blockTime ?? 0));
  const totalRawBurned = records.reduce((sum, r) => sum + BigInt(r.rawAmount), 0n).toString();

  return {
    ...result.checkpoint,
    oldestIndexedSignature: existing?.oldestIndexedSignature || result.checkpoint.oldestIndexedSignature,
    lastFullScanAt: existing ? existing.lastFullScanAt || null : result.checkpoint.lastSuccessfulScanAt,
    records,
    burnInstructionsFound: records.length,
    totalRawBurned,
    totalUiBurned: rawAmountToUiString(totalRawBurned, result.decimals),
    decimals: result.decimals,
    mint: result.mint,
    address: result.address,
    // Accumulated across scans, never just this run's list — an incremental
    // scan only re-checks signatures newer than the checkpoint cursor, so a
    // signature that was unresolved in an earlier full scan would otherwise
    // silently vanish from this set (and start reading as "genuinely
    // absent" instead of "never successfully resolved") the moment a
    // 0-new-signatures incremental run overwrote it. Never removed here
    // either — see reconcileBurnRecords()'s doc comment for why erring
    // toward "unresolved" is the safer failure mode than falsely clearing a
    // signature that was never actually re-verified.
    unresolvedSignatures: [...new Set([...(existing?.unresolvedSignatures || []), ...(result.unresolved || []).map((u) => u.signature)])],
  };
}
