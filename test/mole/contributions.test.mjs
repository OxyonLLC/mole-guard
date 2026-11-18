// Contribution system — controlled fault-injection tests for
// confirmContribution()'s on-chain verification logic. Same dependency-
// injection pattern as test/mole/governanceRpcFailure.test.mjs: real
// production code never overrides `getParsedTransaction`/
// `checkSignatureRecorded`, only these tests do, so every case here is
// deterministic and touches zero real RPC or storage I/O (every case below
// returns before confirmContribution ever reaches recordContribution()).
import "dotenv/config";

process.env.MONGO_ENABLED = "false";
delete process.env.MONGO_URI;

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { confirmContribution, CONTRIBUTION_CAUSES, EXTERNAL_CONTRIBUTION_LINKS, recordExternalSubmission } from "../../src/mole/contributions.js";

const WALLET = "TestWalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1";
const OTHER_WALLET = "TestWalletBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2";
const MINT = String(process.env.WINLEW_MINT || "TestMintCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC3");
const BURN_ADDRESS = CONTRIBUTION_CAUSES.burn.address;

function baseTx({ signer = WALLET, err = null } = {}) {
  return {
    meta: { err, preTokenBalances: [], postTokenBalances: [] },
    transaction: { message: { accountKeys: [{ pubkey: signer, signer: true }] } },
  };
}

const neverRecorded = async () => false;

describe("confirmContribution — controlled on-chain verification fault injection", () => {
  test("rejects an unknown cause before ever looking at the chain", async () => {
    const result = await confirmContribution({ wallet: WALLET, cause: "not_a_real_cause", signature: "sig1" });
    assert.equal(result.ok, false);
    assert.equal(result.error, "unknown_cause");
  });

  test("rejects a missing signature", async () => {
    const result = await confirmContribution({ wallet: WALLET, cause: "burn", signature: "" });
    assert.equal(result.ok, false);
    assert.equal(result.error, "signature_required");
  });

  test("rejects a signature already recorded (dedupe) before fetching it from the chain", async () => {
    let fetchCalled = false;
    const result = await confirmContribution({
      wallet: WALLET,
      cause: "burn",
      signature: "sig-dup",
      checkSignatureRecorded: async () => true,
      getParsedTransaction: async () => { fetchCalled = true; return baseTx(); },
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "already_recorded");
    assert.equal(fetchCalled, false, "must not spend an RPC call on a signature already known to be recorded");
  });

  test("rejects a signature the RPC can't find", async () => {
    const result = await confirmContribution({
      wallet: WALLET,
      cause: "burn",
      signature: "sig-missing",
      checkSignatureRecorded: neverRecorded,
      getParsedTransaction: async () => null,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "signature_not_found");
  });

  test("rejects an errored (failed) transaction", async () => {
    const result = await confirmContribution({
      wallet: WALLET,
      cause: "burn",
      signature: "sig-failed",
      checkSignatureRecorded: neverRecorded,
      getParsedTransaction: async () => baseTx({ err: { InstructionError: [0, "Custom"] } }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "transaction_failed");
  });

  test("rejects a transaction not signed by the caller's own verified wallet (prevents claiming someone else's transfer)", async () => {
    const result = await confirmContribution({
      wallet: WALLET,
      cause: "burn",
      signature: "sig-wrong-signer",
      checkSignatureRecorded: neverRecorded,
      getParsedTransaction: async () => baseTx({ signer: OTHER_WALLET }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "wallet_mismatch");
  });

  test("rejects a transaction with no matching destination/mint token-balance change (wrong recipient)", async () => {
    const tx = baseTx();
    tx.meta.postTokenBalances = [{ accountIndex: 1, owner: "SomeoneElsesWalletNotACause", mint: MINT, uiTokenAmount: { uiAmount: 100 } }];
    const result = await confirmContribution({
      wallet: WALLET,
      cause: "burn",
      signature: "sig-wrong-dest",
      checkSignatureRecorded: neverRecorded,
      getParsedTransaction: async () => tx,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "wrong_destination_or_mint");
  });

  test("rejects a transaction to the right wallet but the wrong token mint (e.g. sent SOL, not WinLEW)", async () => {
    const tx = baseTx();
    tx.meta.postTokenBalances = [{ accountIndex: 1, owner: BURN_ADDRESS, mint: "SomeOtherMintNotWinlew", uiTokenAmount: { uiAmount: 100 } }];
    const result = await confirmContribution({
      wallet: WALLET,
      cause: "burn",
      signature: "sig-wrong-mint",
      checkSignatureRecorded: neverRecorded,
      getParsedTransaction: async () => tx,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "wrong_destination_or_mint");
  });

  test("rejects a transaction with no positive balance increase at the destination (e.g. a transfer out, not in)", async () => {
    const tx = baseTx();
    tx.meta.preTokenBalances = [{ accountIndex: 1, uiTokenAmount: { uiAmount: 500 } }];
    tx.meta.postTokenBalances = [{ accountIndex: 1, owner: BURN_ADDRESS, mint: MINT, uiTokenAmount: { uiAmount: 500 } }];
    const result = await confirmContribution({
      wallet: WALLET,
      cause: "burn",
      signature: "sig-no-increase",
      checkSignatureRecorded: neverRecorded,
      getParsedTransaction: async () => tx,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "no_positive_transfer_found");
  });

  test("a thrown RPC lookup error surfaces as rpc_lookup_failed, never a false rejection", async () => {
    const result = await confirmContribution({
      wallet: WALLET,
      cause: "burn",
      signature: "sig-rpc-down",
      checkSignatureRecorded: neverRecorded,
      getParsedTransaction: async () => { throw new Error("connection refused"); },
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "rpc_lookup_failed");
  });
});

describe("CONTRIBUTION_CAUSES — the 5 real reserve wallets", () => {
  test("has exactly dev/faucet/xFaucet/burn/governance, each a plausible base58 address", () => {
    assert.deepEqual(Object.keys(CONTRIBUTION_CAUSES).sort(), ["burn", "dev", "faucet", "governance", "xFaucet"]);
    for (const cause of Object.values(CONTRIBUTION_CAUSES)) {
      assert.match(cause.address, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, `${cause.label} address looks malformed`);
    }
  });
});

describe("recordExternalSubmission — review-queue validation (no storage I/O on these paths)", () => {
  test("rejects an unknown link id before ever touching storage", async () => {
    const result = await recordExternalSubmission({ discordUserId: "u1", wallet: WALLET, linkId: "not_a_real_link", address: BURN_ADDRESS });
    assert.equal(result.ok, false);
    assert.equal(result.error, "unknown_link");
  });

  test("rejects a missing/malformed address", async () => {
    const result = await recordExternalSubmission({ discordUserId: "u1", wallet: WALLET, linkId: "jupiterLock", address: "not-a-real-address!!" });
    assert.equal(result.ok, false);
    assert.equal(result.error, "invalid_address");
  });

  test("every EXTERNAL_CONTRIBUTION_LINKS entry has a platform, type, and https url", () => {
    for (const link of Object.values(EXTERNAL_CONTRIBUTION_LINKS)) {
      assert.ok(link.platform && link.type && /^https:\/\//.test(link.url), `${link.label} is missing a required field`);
    }
  });
});
