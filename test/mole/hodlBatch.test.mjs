// HODL Rewards — the batch planner.
//
// The property under test is the one that cannot be checked against a live
// chain without risking real tokens: a worker that dies mid-batch and comes
// back must never pay anyone twice. Everything here is about restart, resume
// and partial failure.
import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  planBatch, transferId, batchIdFor, nextPendingChunk, unresolvedChunks,
  markSubmitted, markConfirmed, markFailed, batchProgress, paidTransferIds,
  CHUNK_STATUS, DEFAULT_CHUNK_SIZE,
} from "../../src/mole/hodlBatch.js";

const snapshot = (n, over = {}) => ({
  epochId: "E1", weekIndex: 3, takenAtIso: "2026-09-01T00:00:00.000Z",
  allocations: Array.from({ length: n }, (_, i) => ({
    discordUserId: `u${i}`, payoutWallet: `W${i}`, amount: 1000 + i,
  })),
  ...over,
});

describe("ids are stable, because that is the whole defence", () => {
  test("re-planning the same week produces byte-identical transfer ids", () => {
    // A restarted worker re-plans from the stored snapshot. If ids differed,
    // every payment would look new and everyone would be paid again.
    const a = planBatch(snapshot(20));
    const b = planBatch(snapshot(20));
    assert.deepEqual(
      a.chunks.flatMap((c) => c.transfers.map((t) => t.transferId)),
      b.chunks.flatMap((c) => c.transfers.map((t) => t.transferId)),
    );
    assert.equal(a.batchId, b.batchId);
  });

  test("an id is derived from epoch, week and identity — never random", () => {
    assert.equal(transferId("E1", 3, "u7"), "E1:w3:u7");
    assert.equal(batchIdFor("E1", 3), "E1-w3");
    // Different week, different id: the same person is paid again next Tuesday
    // and that must not collide with this Tuesday.
    assert.notEqual(transferId("E1", 3, "u7"), transferId("E1", 4, "u7"));
  });

  test("ids are unique within a batch", () => {
    const ids = planBatch(snapshot(50)).chunks.flatMap((c) => c.transfers.map((t) => t.transferId));
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe("chunking", () => {
  test("transfers are split into transaction-sized chunks", () => {
    const batch = planBatch(snapshot(20), { chunkSize: 8 });
    assert.deepEqual(batch.chunks.map((c) => c.transfers.length), [8, 8, 4]);
    assert.equal(batch.transferCount, 20);
  });

  test("a chunk is exactly one transaction, so it can hold one signature", () => {
    // The resumption model rests on this. A chunk stores ONE signature; a
    // signature identifies ONE transaction. Eight transfers that become eight
    // transactions would make that field a lie, and a restarted worker could
    // not tell which of the eight had gone out.
    assert.equal(DEFAULT_CHUNK_SIZE, 1,
      "raising this requires real multi-recipient transactions AND a decision " +
      "about one failing recipient taking down everyone packed with them");
  });

  test("zero allocations is a valid plan, not an error", () => {
    // A week where nobody qualified should record that it happened and paid
    // nothing, rather than leaving a gap that reads as a missed run.
    const batch = planBatch(snapshot(0));
    assert.equal(batch.chunks.length, 0);
    assert.equal(batch.totalAmount, 0);
    assert.equal(nextPendingChunk(batch), null);
    assert.equal(batchProgress(batch).complete, false, "an empty batch is not a completed one");
  });

  test("zero-amount allocations are dropped rather than sent", () => {
    const batch = planBatch(snapshot(3, {
      allocations: [
        { discordUserId: "a", payoutWallet: "A", amount: 500 },
        { discordUserId: "b", payoutWallet: "B", amount: 0 },
      ],
    }));
    assert.equal(batch.transferCount, 1, "a zero-token transfer costs a fee and moves nothing");
  });

  test("the total matches the sum of every transfer", () => {
    const batch = planBatch(snapshot(17));
    const summed = batch.chunks.flatMap((c) => c.transfers).reduce((s, t) => s + t.amount, 0);
    assert.equal(batch.totalAmount, summed);
  });
});

describe("a restart must never pay twice", () => {
  test("a SUBMITTED chunk is never handed back as work", () => {
    // The dangerous state: sent, not yet confirmed, transaction may still land.
    // Returning it here would re-send it — precisely the double-pay this
    // repo has already shipped twice and fixed twice.
    let batch = planBatch(snapshot(20));
    batch = markSubmitted(batch, 0, "sig-0");
    const next = nextPendingChunk(batch);
    assert.notEqual(next.index, 0, "a submitted chunk was offered for sending again");
    assert.equal(next.status, CHUNK_STATUS.PENDING);
  });

  test("unresolved chunks are listed for the reconcile pass", () => {
    let batch = planBatch(snapshot(20));
    batch = markSubmitted(batch, 0, "sig-0");
    batch = markSubmitted(batch, 1, "sig-1");
    batch = markConfirmed(batch, 1);
    const unresolved = unresolvedChunks(batch);
    assert.equal(unresolved.length, 1);
    assert.equal(unresolved[0].signature, "sig-0");
  });

  test("confirmed transfer ids are the guard against re-sending", () => {
    let batch = planBatch(snapshot(20), { chunkSize: 8 });
    batch = markConfirmed(markSubmitted(batch, 0, "sig-0"), 0);
    const paid = paidTransferIds(batch);
    assert.equal(paid.size, 8);
    assert.ok(paid.has("E1:w3:u0"));
    assert.ok(!paid.has("E1:w3:u9"), "an unsent transfer was reported as paid");
  });

  test("resuming continues where it stopped", () => {
    let batch = planBatch(snapshot(20), { chunkSize: 8 });   // 3 chunks
    batch = markConfirmed(markSubmitted(batch, 0, "s0"), 0);
    batch = markConfirmed(markSubmitted(batch, 1, "s1"), 1);
    // A crash here. The stored batch is all a new worker has.
    const resumed = JSON.parse(JSON.stringify(batch));
    const next = nextPendingChunk(resumed);
    assert.equal(next.index, 2, "resumed at the wrong chunk");
    assert.equal(batchProgress(resumed).confirmed, 2);
  });

  test("only CONFIRMED money counts as paid", () => {
    // Submitted-but-unconfirmed has not been proven to move. Counting it is how
    // a partial batch gets mistaken for a complete one.
    let batch = planBatch(snapshot(16), { chunkSize: 8 });
    batch = markSubmitted(batch, 0, "s0");
    assert.equal(batchProgress(batch).paidAmount, 0);
    batch = markConfirmed(batch, 0);
    assert.ok(batchProgress(batch).paidAmount > 0);
  });
});

describe("partial failure", () => {
  test("a chunk proven not to have landed returns to pending", () => {
    let batch = planBatch(snapshot(20));
    batch = markSubmitted(batch, 0, "sig-0");
    batch = markFailed(batch, 0, "blockhash expired");
    const chunk = batch.chunks[0];
    assert.equal(chunk.status, CHUNK_STATUS.PENDING);
    assert.equal(chunk.signature, null, "a failed chunk must not keep a signature that never landed");
    assert.match(chunk.lastError, /blockhash/);
    assert.equal(chunk.attempts, 1, "the attempt still counted");
  });

  test("one failed chunk does not strand the others", () => {
    let batch = planBatch(snapshot(24), { chunkSize: 8 });
    batch = markConfirmed(markSubmitted(batch, 0, "s0"), 0);
    batch = markFailed(markSubmitted(batch, 1, "s1"), 1, "rpc down");
    batch = markConfirmed(markSubmitted(batch, 2, "s2"), 2);
    const p = batchProgress(batch);
    assert.equal(p.confirmed, 2);
    assert.equal(p.pending, 1);
    assert.equal(p.complete, false);
    assert.equal(nextPendingChunk(batch).index, 1, "the retryable chunk was not offered");
  });

  test("a batch is complete only when every chunk is confirmed", () => {
    let batch = planBatch(snapshot(16), { chunkSize: 8 });
    batch = markConfirmed(markSubmitted(batch, 0, "s0"), 0);
    assert.equal(batchProgress(batch).complete, false);
    batch = markConfirmed(markSubmitted(batch, 1, "s1"), 1);
    assert.equal(batchProgress(batch).complete, true);
  });

  test("marking is immutable — the previous state survives", () => {
    // A worker holding an older reference must not silently observe a mutation
    // it did not make.
    const batch = planBatch(snapshot(8));
    const after = markSubmitted(batch, 0, "sig");
    assert.equal(batch.chunks[0].status, CHUNK_STATUS.PENDING);
    assert.equal(after.chunks[0].status, CHUNK_STATUS.SUBMITTED);
  });
});
