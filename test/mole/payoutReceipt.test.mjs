// Payout receipts — Stage 5.
//
// The claim a receipt makes is "this payout resulted from this decision, under
// these rules, at this time, and you can check that without trusting us." Two
// properties make that true and both are pinned here: the hash is deterministic
// from the record, and nothing private is inside it.
import test, { describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildPayoutDecision, canonicalHash, replayPayoutDecision,
  issuePayoutReceipt, RECEIPT_VERSION,
} from "../../src/mole/payoutReceipt.js";

const RECORD = {
  id: "1786678391085-fca37c742fc42",
  kind: "cycle_payout",
  cycleId: "C3",
  userId: "94943b30aef10c3ee81387feceda439e",
  payoutWallet: "7sf9u22pUvCaVN1ntxZCJCgMDN8ede9PUQzkbuVxApBp",
  amount: 1500,
  winlewSent: 1500,
  decision: "settle",
  settlementMode: "auto_worker",
  paidTs: 1786678391085,
  risk: { band: "elevated", score: 32, signals: ["shared_device", "no_signal"], rulesVersion: "participation-trust/1.0.0" },
};

beforeEach(() => {
  process.env.PAYOUT_RECEIPT_SALT = "test-receipt-salt";
  process.env.GEOPROOF_RECEIPTS_ENABLED = "true";
  process.env.GEOPROOF_ANCHORING_ENABLED = "false";
  delete process.env.GEOPROOF_SERVICE_URL;
});

describe("nothing private is in a receipt", () => {
  test("no raw identifier survives", () => {
    const json = JSON.stringify(buildPayoutDecision(RECORD));
    assert.ok(!json.includes(RECORD.userId), "the Discord id is in the receipt");
    assert.ok(!json.includes(RECORD.payoutWallet), "the wallet address is in the receipt");
  });

  test("identifiers are references a holder of the DB can confirm, and a stranger cannot reverse", () => {
    const d = buildPayoutDecision(RECORD);
    assert.match(d.participantRef, /^[a-f0-9]{64}$/);
    assert.match(d.walletRef, /^[a-f0-9]{64}$/);
    // Salted: the same user under a different salt is a different reference.
    process.env.PAYOUT_RECEIPT_SALT = "rotated";
    assert.notEqual(buildPayoutDecision(RECORD).participantRef, d.participantRef);
  });

  test("a field that is not allowlisted cannot reach a receipt", () => {
    // The guard is a positive list, so a new field on a redemption record
    // cannot leak by being forgotten about.
    const leaky = { ...RECORD, ipAddress: "203.0.113.9", deviceFingerprint: "raw-ua-string", sessionToken: "V1StGXR8" };
    const json = JSON.stringify(buildPayoutDecision(leaky));
    for (const secret of ["203.0.113.9", "raw-ua-string", "V1StGXR8"]) {
      assert.ok(!json.includes(secret), `${secret} reached the receipt`);
    }
  });

  test("no salt means no receipt, rather than an unsalted one", () => {
    delete process.env.PAYOUT_RECEIPT_SALT;
    assert.throws(() => buildPayoutDecision(RECORD), /salt/);
  });
});

describe("the decision is replayable", () => {
  test("the same record always produces the same hash", () => {
    assert.equal(canonicalHash(buildPayoutDecision(RECORD)), canonicalHash(buildPayoutDecision(RECORD)));
  });

  test("key order in the source record cannot change the hash", () => {
    const reordered = Object.fromEntries(Object.entries(RECORD).reverse());
    assert.equal(canonicalHash(buildPayoutDecision(reordered)), canonicalHash(buildPayoutDecision(RECORD)));
    // ...nor can signal order, which is sorted before hashing.
    const shuffled = { ...RECORD, risk: { ...RECORD.risk, signals: ["no_signal", "shared_device"] } };
    assert.equal(canonicalHash(buildPayoutDecision(shuffled)), canonicalHash(buildPayoutDecision(RECORD)));
  });

  test("replay detects a record edited after the receipt was issued", () => {
    const receipt = { decisionHash: canonicalHash(buildPayoutDecision(RECORD)) };
    assert.equal(replayPayoutDecision(RECORD, receipt).matches, true);

    // Someone quietly raises the amount after the fact.
    const tampered = { ...RECORD, winlewSent: 15000 };
    const replayed = replayPayoutDecision(tampered, receipt);
    assert.equal(replayed.matches, false, "a changed payout amount went undetected");
    assert.notEqual(replayed.recomputedHash, receipt.decisionHash);
  });

  test("the risk verdict is frozen at decision time", () => {
    // Re-tuning thresholds later must not retroactively change what a receipt
    // says was decided — the rules version travels with it.
    const d = buildPayoutDecision(RECORD);
    assert.equal(d.rulesVersion, "participation-trust/1.0.0");
    assert.equal(d.riskBand, "elevated");
    assert.equal(d.receiptVersion, RECEIPT_VERSION);
  });
});

describe("a receipt is never a gate on the payout", () => {
  test("disabled produces no receipt and no error", async () => {
    process.env.GEOPROOF_RECEIPTS_ENABLED = "false";
    assert.equal(await issuePayoutReceipt(RECORD), null);
  });

  test("an unreachable attestation service still yields a replayable receipt", async () => {
    process.env.GEOPROOF_SERVICE_URL = "http://127.0.0.1:9";
    const receipt = await issuePayoutReceipt(RECORD, { fetchImpl: async () => { throw new Error("ECONNREFUSED"); } });
    assert.ok(receipt, "the payout lost its receipt because a service was down");
    assert.match(receipt.decisionHash, /^[a-f0-9]{64}$/);
    assert.equal(receipt.attestation, null);
  });

  test("a broken record is logged, not thrown", async () => {
    assert.equal(await issuePayoutReceipt({}), null);
  });

  test("only the hash is sent to the attestation service", async () => {
    process.env.GEOPROOF_SERVICE_URL = "https://geoproof.local";
    let sent = null;
    await issuePayoutReceipt(RECORD, {
      fetchImpl: async (_url, opts) => {
        sent = JSON.parse(opts.body);
        return { ok: true, status: 200, json: async () => ({ verifier: "0xabc", proofHash: "deadbeef", anchored: false }) };
      },
    });
    // The service attests that a decision with this hash existed. It has no
    // business knowing who was paid or how much.
    assert.deepEqual(Object.keys(sent).sort(), ["anchor", "decisionHash", "receiptVersion"]);
    assert.ok(!JSON.stringify(sent).includes(RECORD.payoutWallet));
    assert.equal(sent.anchor, false, "anchoring is on without anyone asking for it");
  });

  test("anchoring changes what is published, never what is sent", async () => {
    // Stage 6. Turning anchoring on must widen nothing: the same hash goes over
    // the wire, and the service is told to publish a commitment to it. Raw
    // evidence must never reach a public chain — that is irreversible.
    process.env.GEOPROOF_SERVICE_URL = "https://geoproof.local";
    process.env.GEOPROOF_ANCHORING_ENABLED = "true";
    let sent = null;
    const receipt = await issuePayoutReceipt(RECORD, {
      fetchImpl: async (_url, opts) => {
        sent = JSON.parse(opts.body);
        return { ok: true, status: 200, json: async () => ({ proofHash: "beef", anchored: true }) };
      },
    });
    assert.deepEqual(Object.keys(sent).sort(), ["anchor", "decisionHash", "receiptVersion"]);
    assert.equal(sent.anchor, true);
    assert.equal(sent.decisionHash, canonicalHash(buildPayoutDecision(RECORD)));
    assert.equal(receipt.attestation.anchored, true);
  });

  test("a receipt is not built at all when the record is missing its id", async () => {
    // The worker calls this straight after recording a payout; a malformed call
    // must produce nothing rather than a receipt for an unidentifiable payout.
    assert.equal(await issuePayoutReceipt({ userId: "x", payoutWallet: "y" }), null);
  });
});

// A source-level pin, in the same spirit as the 90s-timeout guard on
// solanaConfirm. The round-trip test in test/quiz/db-platform-stats.test.cjs
// proves a receipt built from the PERSISTED record verifies; nothing there
// stops someone re-introducing the spread of the stale in-memory one, because
// the worker's settle path needs a live Solana transfer to execute.
test("the payout worker issues receipts from the persisted record", () => {
  const source = readFileSync(new URL("../../src/quiz/payout-worker.js", import.meta.url), "utf8");
  const call = source.match(/issuePayoutReceipt\(([^)]*)\)/);
  assert.ok(call, "the worker no longer issues receipts at all");
  assert.equal(call[1].trim(), "result.rec",
    "receipts must be built from markRedemptionPaidById's stored record — " +
    "the in-memory `record` predates the risk verdict and the real paidTs, so " +
    "every receipt built from it fails `npm run receipts:verify`");
});
