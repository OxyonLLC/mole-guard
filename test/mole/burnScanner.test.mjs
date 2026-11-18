// Backup burn-history scanner — pure-fixture tests. No real RPC calls: every
// case here injects fake getSignaturesForAddress/getTransaction/getTokenSupply
// functions (same DI pattern as confirmContribution() in
// test/mole/contributions.test.mjs), so this suite is fully deterministic
// and touches zero network I/O.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  findBurnInstructionsInTransaction,
  scanWinLewBurnHistory,
  reconcileBurnRecords,
  rawAmountToUiString,
} from "../../src/mole/evidence/burnScanner.js";

const MINT = "DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump";
const OTHER_MINT = "SomeOtherMintAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const AUTHORITY = "AuthorityWalletAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function txWithOuterInstruction(instruction, { err = null, blockTime = 1_700_000_000, slot = 123 } = {}) {
  return {
    slot,
    blockTime,
    meta: { err, innerInstructions: [] },
    transaction: { message: { instructions: [instruction] } },
  };
}

function burnInstruction({ type = "burn", mint = MINT, amount = "1000000", account = "TokenAccountAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", authority = AUTHORITY } = {}) {
  return { program: "spl-token", programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", parsed: { type, info: { mint, amount, account, authority } } };
}

function burnCheckedInstruction({ mint = MINT, amount = "500000", decimals = 6, account = "TokenAccountBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", authority = AUTHORITY } = {}) {
  return {
    program: "spl-token",
    programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    parsed: { type: "burnChecked", info: { mint, tokenAmount: { amount, decimals, uiAmountString: "0.5" }, account, authority } },
  };
}

function transferInstruction() {
  return { program: "spl-token", programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", parsed: { type: "transfer", info: { source: "a", destination: "b", amount: "999" } } };
}

describe("findBurnInstructionsInTransaction: detection rules", () => {
  test("detects an outer burn instruction", () => {
    const tx = txWithOuterInstruction(burnInstruction());
    const records = findBurnInstructionsInTransaction(tx, { signature: "sig1", mint: MINT, decimals: 6 });
    assert.equal(records.length, 1);
    assert.equal(records[0].instructionType, "burn");
    assert.equal(records[0].instructionLocation, "outer");
    assert.equal(records[0].rawAmount, "1000000");
  });

  test("detects an outer burnChecked instruction and reads tokenAmount.amount/decimals", () => {
    const tx = txWithOuterInstruction(burnCheckedInstruction());
    const records = findBurnInstructionsInTransaction(tx, { signature: "sig2", mint: MINT, decimals: 6 });
    assert.equal(records.length, 1);
    assert.equal(records[0].instructionType, "burnChecked");
    assert.equal(records[0].rawAmount, "500000");
    assert.equal(records[0].decimals, 6);
    assert.equal(records[0].uiAmount, "0.5");
  });

  test("detects an inner burn instruction", () => {
    const tx = {
      slot: 1, blockTime: 1_700_000_100,
      meta: { err: null, innerInstructions: [{ index: 0, instructions: [burnInstruction({ amount: "42" })] }] },
      transaction: { message: { instructions: [{ program: "unknown-program", parsed: { type: "someOtherCall", info: {} } }] } },
    };
    const records = findBurnInstructionsInTransaction(tx, { signature: "sig3", mint: MINT, decimals: 6 });
    assert.equal(records.length, 1);
    assert.equal(records[0].instructionLocation, "inner");
    assert.equal(records[0].outerInstructionIndex, 0);
    assert.equal(records[0].innerInstructionIndex, 0);
    assert.equal(records[0].rawAmount, "42");
  });

  test("ignores a burn instruction for a different mint", () => {
    const tx = txWithOuterInstruction(burnInstruction({ mint: OTHER_MINT }));
    const records = findBurnInstructionsInTransaction(tx, { signature: "sig4", mint: MINT, decimals: 6 });
    assert.equal(records.length, 0);
  });

  test("ignores a failed transaction even if it parses as a burn", () => {
    const tx = txWithOuterInstruction(burnInstruction(), { err: { InstructionError: [0, "Custom"] } });
    const records = findBurnInstructionsInTransaction(tx, { signature: "sig5", mint: MINT, decimals: 6 });
    assert.equal(records.length, 0);
  });

  test("ignores an ordinary token transfer", () => {
    const tx = txWithOuterInstruction(transferInstruction());
    const records = findBurnInstructionsInTransaction(tx, { signature: "sig6", mint: MINT, decimals: 6 });
    assert.equal(records.length, 0);
  });

  test("returns nothing for a null transaction (never treated as proof of no burn by this function)", () => {
    const records = findBurnInstructionsInTransaction(null, { signature: "sig7", mint: MINT, decimals: 6 });
    assert.deepEqual(records, []);
  });

  test("preserves multiple distinct burns within one transaction", () => {
    const tx = {
      slot: 5, blockTime: 1_700_000_500,
      meta: { err: null, innerInstructions: [] },
      transaction: { message: { instructions: [burnInstruction({ amount: "111" }), burnCheckedInstruction({ amount: "222" })] } },
    };
    const records = findBurnInstructionsInTransaction(tx, { signature: "sig8", mint: MINT, decimals: 6 });
    assert.equal(records.length, 2);
    assert.equal(records[0].id, "sig8:outer:0:-");
    assert.equal(records[1].id, "sig8:outer:1:-");
  });

  test("deterministic record id includes location and both indices, for dedup by instruction not just signature", () => {
    const tx = {
      slot: 6, blockTime: 1_700_000_600,
      meta: { err: null, innerInstructions: [{ index: 2, instructions: [burnInstruction({ amount: "7" })] }] },
      transaction: { message: { instructions: [] } },
    };
    const records = findBurnInstructionsInTransaction(tx, { signature: "sig9", mint: MINT, decimals: 6 });
    assert.equal(records[0].id, "sig9:inner:2:0");
  });
});

describe("rawAmountToUiString: exact integer arithmetic", () => {
  test("never loses precision for amounts beyond Number.MAX_SAFE_INTEGER", () => {
    // 22,921,636.800396 WinLEW at 6 decimals — the exact figure from the
    // 2026-07-24 BOOST reconciliation. Way past float-safe territory once
    // summed with other large burns; BigInt must carry it exactly.
    assert.equal(rawAmountToUiString("22921636800396", 6), "22921636.800396");
  });

  test("handles a whole-number amount with no fractional part", () => {
    assert.equal(rawAmountToUiString("5000000", 6), "5");
  });

  test("handles zero decimals", () => {
    assert.equal(rawAmountToUiString("123", 0), "123");
  });
});

describe("scanWinLewBurnHistory: pagination and RPC orchestration", () => {
  function makeSig(n, blockTime = 1_700_000_000 + n) {
    return { signature: `sig-${n}`, slot: n, blockTime, err: null };
  }

  test("paginates getSignaturesForAddress using the before cursor until history is exhausted", async () => {
    const pages = [
      Array.from({ length: 3 }, (_, i) => makeSig(100 - i)), // sig-100, sig-99, sig-98
      Array.from({ length: 2 }, (_, i) => makeSig(97 - i)), // sig-97, sig-96 — shorter than pageSize, so this is the last page
    ];
    const beforeCallsSeen = [];
    const getSignaturesForAddress = async (_addr, opts) => {
      beforeCallsSeen.push(opts.before);
      const page = pages.shift() || [];
      return { result: page, rpcLabel: "primary-configured-rpc" };
    };
    const getTransaction = async (sig) => ({ result: txWithOuterInstruction(burnInstruction(), {}), rpcLabel: "primary-configured-rpc" });
    const getTokenSupply = async () => ({ result: { value: { decimals: 6 } }, rpcLabel: "primary-configured-rpc" });

    const result = await scanWinLewBurnHistory(
      { mint: MINT, address: "SomeWallet", pageSize: 3 },
      { getSignaturesForAddress, getTransaction, getTokenSupply },
    );

    assert.equal(beforeCallsSeen.length, 2);
    assert.equal(beforeCallsSeen[0], undefined);
    assert.equal(beforeCallsSeen[1], "sig-98"); // cursor = last signature of the first page
    assert.equal(result.checkpoint.signaturesScanned, 5);
  });

  test("stops paginating once the `until` signature is encountered, without including it", async () => {
    const page = [makeSig(10), makeSig(9), makeSig(8), makeSig(7)];
    const getSignaturesForAddress = async () => ({ result: page, rpcLabel: "primary-configured-rpc" });
    const getTransaction = async () => ({ result: txWithOuterInstruction(transferInstruction()), rpcLabel: "primary-configured-rpc" });
    const getTokenSupply = async () => ({ result: { value: { decimals: 6 } }, rpcLabel: "primary-configured-rpc" });

    const result = await scanWinLewBurnHistory(
      { mint: MINT, address: "SomeWallet", until: "sig-8" },
      { getSignaturesForAddress, getTransaction, getTokenSupply },
    );

    assert.equal(result.checkpoint.signaturesScanned, 2); // sig-10, sig-9 only — sig-8 (until) excluded
  });

  test("a null transaction result is recorded as unresolved, never as proof of no burn", async () => {
    const getSignaturesForAddress = async () => ({ result: [makeSig(1)], rpcLabel: "primary-configured-rpc" });
    const getTransaction = async () => ({ result: null, rpcLabel: "primary-configured-rpc" });
    const getTokenSupply = async () => ({ result: { value: { decimals: 6 } }, rpcLabel: "primary-configured-rpc" });

    const result = await scanWinLewBurnHistory(
      { mint: MINT, address: "SomeWallet" },
      { getSignaturesForAddress, getTransaction, getTokenSupply },
    );

    assert.equal(result.unresolved.length, 1);
    assert.equal(result.unresolved[0].reason, "null_or_pruned_transaction");
    assert.equal(result.burnInstructionCount, 0);
  });

  test("a transaction fetch that throws is recorded as unresolved, scan still completes", async () => {
    const getSignaturesForAddress = async () => ({ result: [makeSig(1), makeSig(2)], rpcLabel: "primary-configured-rpc" });
    const getTransaction = async (sig) => {
      if (sig === "sig-2") throw new Error("all_rpc_endpoints_failed:getTransaction");
      return { result: txWithOuterInstruction(burnInstruction()), rpcLabel: "primary-configured-rpc" };
    };
    const getTokenSupply = async () => ({ result: { value: { decimals: 6 } }, rpcLabel: "primary-configured-rpc" });

    const result = await scanWinLewBurnHistory(
      { mint: MINT, address: "SomeWallet" },
      { getSignaturesForAddress, getTransaction, getTokenSupply },
    );

    assert.equal(result.unresolved.length, 1);
    assert.equal(result.burnInstructionCount, 1);
  });

  test("falls back to the documented 6-decimal constant when getTokenSupply is unavailable", async () => {
    const getSignaturesForAddress = async () => ({ result: [], rpcLabel: "primary-configured-rpc" });
    const getTransaction = async () => ({ result: null });
    const getTokenSupply = async () => { throw new Error("rpc_unreachable"); };

    const result = await scanWinLewBurnHistory({ mint: MINT, address: "SomeWallet" }, { getSignaturesForAddress, getTransaction, getTokenSupply });
    assert.equal(result.decimals, 6);
    assert.equal(result.decimalsSource, "fallback-constant");
  });

  test("dedupes across pages by instruction id, not just signature — total reflects unique instructions only", async () => {
    // Simulate the same signature appearing twice (e.g. a flaky page overlap) —
    // the resulting burn record must only be counted once.
    let call = 0;
    const getSignaturesForAddress = async () => {
      call += 1;
      return call === 1 ? { result: [makeSig(1)], rpcLabel: "x" } : { result: [], rpcLabel: "x" };
    };
    const getTransaction = async () => ({ result: txWithOuterInstruction(burnInstruction({ amount: "1000" })), rpcLabel: "x" });
    const getTokenSupply = async () => ({ result: { value: { decimals: 6 } }, rpcLabel: "x" });

    const result = await scanWinLewBurnHistory({ mint: MINT, address: "SomeWallet" }, { getSignaturesForAddress, getTransaction, getTokenSupply });
    assert.equal(result.burnInstructionCount, 1);
    assert.equal(result.totalRawBurned, "1000");
  });
});

describe("reconcileBurnRecords: comparing scan output against the stored ledger", () => {
  const scanResult = {
    records: [
      { signature: "sigA", rawAmount: "1000000" },
      { signature: "sigB", rawAmount: "2000000" },
      { signature: "sigC", rawAmount: "999" }, // not in the stored ledger at all
    ],
  };

  test("matches a stored event whose signature and amount agree with the scan", () => {
    const stored = [{ id: "evt-a", signature: "sigA", amountBaseUnits: "1000000" }];
    const result = reconcileBurnRecords(scanResult, stored);
    assert.deepEqual(result.matched, ["evt-a"]);
    assert.equal(result.amountMismatches.length, 0);
  });

  test("flags an amount mismatch instead of silently accepting the stored figure", () => {
    const stored = [{ id: "evt-b", signature: "sigB", amountBaseUnits: "1" }];
    const result = reconcileBurnRecords(scanResult, stored);
    assert.equal(result.matched.length, 0);
    assert.deepEqual(result.amountMismatches, [{ id: "evt-b", storedAmount: "1", scannedAmount: "2000000" }]);
  });

  test("reports a stored event with no matching scan signature as missingFromRpcScan", () => {
    const stored = [{ id: "evt-ghost", signature: "sig-does-not-exist", amountBaseUnits: "5" }];
    const result = reconcileBurnRecords(scanResult, stored);
    assert.deepEqual(result.missingFromRpcScan, ["evt-ghost"]);
  });

  test("reports a scan-found signature with no stored counterpart as missingFromStoredHistory", () => {
    const stored = [{ id: "evt-a", signature: "sigA", amountBaseUnits: "1000000" }];
    const result = reconcileBurnRecords(scanResult, stored);
    assert.ok(result.missingFromStoredHistory.includes("sigB"));
    assert.ok(result.missingFromStoredHistory.includes("sigC"));
  });

  test("a stored event with no signature (e.g. a supply-delta PENDING_VERIFICATION entry) is skipped, not flagged missing", () => {
    const stored = [{ id: "evt-pending", signature: null, amountBaseUnits: "22921636800396" }];
    const result = reconcileBurnRecords(scanResult, stored);
    assert.equal(result.missingFromRpcScan.length, 0);
    assert.equal(result.amountMismatches.length, 0);
  });

  test("a missing signature that was merely rate-limited/unresolved this run is reported separately from a genuine gap", () => {
    const stored = [{ id: "evt-ghost", signature: "sig-rate-limited", amountBaseUnits: "5" }];
    const inconclusive = reconcileBurnRecords(scanResult, stored, ["sig-rate-limited"]);
    assert.deepEqual(inconclusive.missingButUnresolved, ["evt-ghost"]);
    assert.equal(inconclusive.missingFromRpcScan.length, 0, "must not also count as a confirmed gap");

    const genuinelyMissing = reconcileBurnRecords(scanResult, stored, []); // same signature, but this time the tx WAS fetched and had no burn
    assert.deepEqual(genuinelyMissing.missingFromRpcScan, ["evt-ghost"]);
    assert.equal(genuinelyMissing.missingButUnresolved.length, 0);
  });

  test("never mutates or deletes the stored ledger it's given — pure comparison only", () => {
    const stored = [{ id: "evt-a", signature: "sigA", amountBaseUnits: "1000000" }];
    const before = JSON.stringify(stored);
    reconcileBurnRecords(scanResult, stored);
    assert.equal(JSON.stringify(stored), before);
  });
});
