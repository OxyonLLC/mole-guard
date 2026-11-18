// Burn-scan checkpoint persistence — atomic write + validation. Uses a
// throwaway DATA_DIR under the OS temp dir so this never touches real
// project data, and cleans up after itself.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

const TMP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "winlew-burn-checkpoint-test-"));
process.env.DATA_DIR = TMP_DATA_DIR;
import "dotenv/config";

import { loadBurnScanCheckpoint, saveBurnScanCheckpoint, mergeBurnScanResult } from "../../src/mole/evidence/burnCheckpoint.js";

after(() => {
  fs.rmSync(TMP_DATA_DIR, { recursive: true, force: true });
});

function validCheckpoint(overrides = {}) {
  return {
    newestIndexedSignature: "sigZ",
    oldestIndexedSignature: "sigA",
    lastSuccessfulScanAt: new Date().toISOString(),
    signaturesScanned: 2,
    burnInstructionsFound: 1,
    rpcSourceUsed: "primary-configured-rpc",
    scanVersion: "1.0.0",
    totalRawBurned: "1000000",
    records: [{ id: "sigA:outer:0:-", signature: "sigA", rawAmount: "1000000", blockTime: 1 }],
    ...overrides,
  };
}

describe("burn scan checkpoint: load/save", () => {
  test("returns null when no checkpoint has ever been written", () => {
    assert.equal(loadBurnScanCheckpoint(), null);
  });

  test("round-trips a valid checkpoint", () => {
    saveBurnScanCheckpoint(validCheckpoint());
    const loaded = loadBurnScanCheckpoint();
    assert.equal(loaded.signaturesScanned, 2);
    assert.equal(loaded.records.length, 1);
  });

  test("refuses to persist a malformed checkpoint (missing required fields)", () => {
    assert.throws(() => saveBurnScanCheckpoint({ totalRawBurned: "1" }), /invalid_checkpoint_shape/);
  });

  test("a rejected malformed write never overwrites the previously valid checkpoint", () => {
    saveBurnScanCheckpoint(validCheckpoint({ signaturesScanned: 42 }));
    try {
      saveBurnScanCheckpoint({ garbage: true });
    } catch {
      // expected — see previous test
    }
    const loaded = loadBurnScanCheckpoint();
    assert.equal(loaded.signaturesScanned, 42, "the last VALID write must still be what's on disk");
  });

  test("leaves no stray .tmp file behind after a successful save", () => {
    saveBurnScanCheckpoint(validCheckpoint());
    const leftovers = fs.readdirSync(TMP_DATA_DIR).filter((f) => f.includes(".tmp-"));
    assert.deepEqual(leftovers, []);
  });
});

describe("mergeBurnScanResult: incremental accumulation", () => {
  test("with no prior checkpoint, the merged result is just the new scan's records", () => {
    const result = {
      mint: "MintAAAA", address: "WalletAAAA", decimals: 6, totalUiBurned: "1",
      checkpoint: { newestIndexedSignature: "s2", oldestIndexedSignature: "s1", lastSuccessfulScanAt: "t", signaturesScanned: 2, rpcSourceUsed: "x", scanVersion: "1.0.0" },
      records: [{ id: "s1:outer:0:-", signature: "s1", rawAmount: "1000000", blockTime: 1 }],
    };
    const merged = mergeBurnScanResult(null, result);
    assert.equal(merged.records.length, 1);
    assert.equal(merged.lastFullScanAt, "t");
  });

  test("merges new records into existing ones by id, without dropping prior history", () => {
    const existing = {
      lastFullScanAt: "first-scan-time",
      oldestIndexedSignature: "s0",
      records: [{ id: "s0:outer:0:-", signature: "s0", rawAmount: "500", blockTime: 0 }],
    };
    const result = {
      mint: "MintAAAA", address: "WalletAAAA", decimals: 6, totalUiBurned: "irrelevant-recomputed",
      checkpoint: { newestIndexedSignature: "s2", oldestIndexedSignature: "s1", lastSuccessfulScanAt: "second-scan-time", signaturesScanned: 2, rpcSourceUsed: "x", scanVersion: "1.0.0" },
      records: [{ id: "s1:outer:0:-", signature: "s1", rawAmount: "1000000", blockTime: 1 }],
    };
    const merged = mergeBurnScanResult(existing, result);
    assert.equal(merged.records.length, 2, "both the old and new record must survive");
    assert.equal(merged.oldestIndexedSignature, "s0", "the oldest cursor is preserved from the original full scan");
    assert.equal(merged.lastFullScanAt, "first-scan-time", "lastFullScanAt tracks the original full scan, not each incremental refresh");
    assert.equal(merged.totalRawBurned, "1000500");
  });

  test("re-scanning the same instruction twice does not double it in the merged total", () => {
    const existing = { records: [{ id: "s1:outer:0:-", signature: "s1", rawAmount: "1000000", blockTime: 1 }] };
    const result = {
      mint: "MintAAAA", address: "WalletAAAA", decimals: 6, totalUiBurned: "1",
      checkpoint: { newestIndexedSignature: "s1", oldestIndexedSignature: "s1", lastSuccessfulScanAt: "t", signaturesScanned: 1, rpcSourceUsed: "x", scanVersion: "1.0.0" },
      records: [{ id: "s1:outer:0:-", signature: "s1", rawAmount: "1000000", blockTime: 1 }], // same id as existing
    };
    const merged = mergeBurnScanResult(existing, result);
    assert.equal(merged.records.length, 1);
    assert.equal(merged.totalRawBurned, "1000000");
  });

  test("unresolvedSignatures accumulates across runs — a 0-new-signatures incremental run never erases an older run's unresolved entry", () => {
    const existing = { records: [], unresolvedSignatures: ["sig-rate-limited-earlier"] };
    const result = {
      mint: "MintAAAA", address: "WalletAAAA", decimals: 6, totalUiBurned: "0",
      checkpoint: { newestIndexedSignature: "sig-rate-limited-earlier", oldestIndexedSignature: null, lastSuccessfulScanAt: "t2", signaturesScanned: 0, rpcSourceUsed: "x", scanVersion: "1.0.0" },
      records: [],
      unresolved: [], // this run found 0 new signatures, so nothing failed THIS run either
    };
    const merged = mergeBurnScanResult(existing, result);
    assert.deepEqual(merged.unresolvedSignatures, ["sig-rate-limited-earlier"]);
  });
});
