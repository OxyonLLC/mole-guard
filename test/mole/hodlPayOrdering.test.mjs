// HODL payout — the ordering invariants in the send path.
//
// The batch logic is unit-tested in hodlBatch.test.mjs. What cannot be unit
// tested without moving real tokens is the ORDER the worker does things in, and
// that order is the entire safety property. So it is pinned against the source,
// the same approach used for the api-proxy circuit breaker.
//
// Every rule here was learned from a bug this repo actually shipped.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../src/scripts/hodl-pay.js", import.meta.url), "utf8");

describe("nothing is sent before the chain has been asked", () => {
  test("reconcile runs before the send loop", () => {
    // A chunk holding a signature may have landed. Re-sending it because our
    // record says "not confirmed" is exactly how this repo paid people twice.
    const reconcileAt = src.indexOf("batch = await reconcile(batch, save)");
    const sendLoopAt = src.indexOf("const chunk = nextPendingChunk(batch)");
    assert.ok(reconcileAt > 0, "the reconcile step is gone");
    assert.ok(sendLoopAt > 0, "the send loop is gone");
    assert.ok(reconcileAt < sendLoopAt, "the send loop runs BEFORE reconciliation");
  });

  test("an unknown signature status is left alone, never resent or failed", () => {
    const fn = src.slice(src.indexOf("async function reconcile"), src.indexOf("async function main"));
    assert.match(fn, /UNKNOWN/);
    assert.match(fn, /will not resend/i);
    // It must not call markFailed on the unknown branch — that would return the
    // chunk to pending and make it eligible for a second send.
    const unknownBranch = fn.slice(fn.indexOf("} else {"), fn.indexOf("await save(batch)"));
    assert.ok(!/markFailed/.test(unknownBranch), "an unknown status returns the chunk to pending");
  });
});

describe("a signature is persisted before it is confirmed", () => {
  test("markSubmitted and a save happen inside the onSubmitted callback", () => {
    // The crash window. Between sending and recording, the money is gone and
    // nothing knows it. sendWinlew() in the quiz worker exists in this shape for
    // the same reason.
    const cb = src.slice(src.indexOf("async (sig) => {"), src.indexOf("batch = markConfirmed(batch, chunk.index, signature)"));
    assert.match(cb, /markSubmitted/);
    assert.match(cb, /await save\(batch\)/);
  });

  test("sendChunk hands the signature back before confirming", () => {
    const fn = src.slice(src.indexOf("async function sendChunk"), src.indexOf("async function reconcile"));
    const submittedAt = fn.indexOf("await onSubmitted(signature");
    const confirmAt = fn.indexOf("confirmSignatureByPolling");
    assert.ok(submittedAt > 0 && confirmAt > 0);
    assert.ok(submittedAt < confirmAt, "the signature is confirmed before it is handed back to be persisted");
  });

  test("a send failure that already has a signature stays SUBMITTED", () => {
    // Only the chain can say whether it landed. Marking it failed would return
    // it to pending and allow a second send.
    const cat = src.slice(src.indexOf("} catch (error) {", src.indexOf("const signature = await sendChunk")));
    assert.match(cat, /if \(!current\.signature\)/);
    assert.match(cat, /markFailed/);
  });
});

describe("it refuses rather than guessing", () => {
  test("dry run is the default and --apply is required to send", () => {
    assert.match(src, /const apply = args\.includes\("--apply"\)/);
    assert.match(src, /if \(!apply\)/);
    assert.match(src, /DRY RUN/);
  });

  test("a stale participant list refuses the payout", () => {
    assert.match(src, /Refusing to pay from a stale list/);
  });

  test("a stored snapshot is reused, never rebuilt", () => {
    // Rebuilding a paid week would re-derive eligibility from TODAY and pay a
    // different set of people against the same week.
    assert.match(src, /let snapshot = hodl\.getSnapshot/);
    assert.match(src, /if \(!snapshot\) \{/);
  });

  test("no active epoch means no payout", () => {
    assert.match(src, /No active epoch/);
  });

  test("the payout-day check can only be bypassed deliberately", () => {
    assert.match(src, /isPayoutDay\(epoch, now\) && !force/);
    assert.match(src, /--force only for testing/);
  });

  test("repeated failures stop the run instead of grinding on", () => {
    assert.match(src, /failed >= 3/);
  });
});

describe("the guard on top of the guard", () => {
  test("an already-paid transfer is never sent again, whatever the chunk says", () => {
    const loop = src.slice(src.indexOf("const paid = paidTransferIds(batch)"), src.indexOf("try {", src.indexOf("const paid =")));
    assert.match(loop, /paid\.has\(t\.transferId\)/);
    assert.match(loop, /markConfirmed/);
  });
});

// ---------------------------------------------------------------------------
// Durability of the persist. Found 2026-08-16 during the first live hodl:pay.
//
// writeJson() writes local disk synchronously and pushes to Mongo on a
// background chain. refreshHodlStore() at the top of the next run reads MONGO.
// So "persisted before confirmation" was only half true: the signature reached
// local disk, and the next run — looking at Mongo — could not see it.
//
// Observed for real. The first run confirmed and recorded chunk 0 as paid; the
// second run re-read "submitted, pending" from Mongo. That one was recoverable
// because reconcile asks the chain. The unrecoverable version is a SIGKILL
// between submit and confirm, where the next run sees no signature at all and
// sends a second transaction.
describe("a write reaches the store the NEXT run will read", () => {
  test("save() awaits the flush, so it is durable before the confirm poll", () => {
    const save = src.slice(src.indexOf("const save = async (b) => {"), src.indexOf("batch = await reconcile"));
    assert.match(save, /updateSnapshotBatch/);
    assert.match(save, /await flushManagedWrites\(\)/,
      "save() no longer flushes — a SIGKILL before the confirm would hide the signature from the next run");
    // Order matters: flushing before the write would flush nothing.
    assert.ok(
      save.indexOf("updateSnapshotBatch") < save.indexOf("await flushManagedWrites"),
      "the flush runs before the write it is meant to flush",
    );
  });

  test("both exit paths flush, including the failure path", () => {
    // A run that crashed after submitting is precisely the run whose signature
    // must survive, so the catch branch cannot skip the flush.
    const tail = src.slice(src.indexOf("main()\n"));
    assert.match(tail, /\.then\(async \(\) => \{\s*await flushManagedWrites\(\)/);
    const katch = tail.slice(tail.indexOf(".catch("));
    assert.match(katch, /await flushManagedWrites\(\)/, "the failure path exits without flushing");
  });
});

describe("flushManagedWrites is real, in both storage layers", () => {
  test("mole/storage.js exports it and awaits the queued persists", async () => {
    const mod = readFileSync(new URL("../../src/mole/storage.js", import.meta.url), "utf8");
    assert.match(mod, /export async function flushManagedWrites/);
    assert.match(mod, /persistChains\.values\(\)/);
  });

  test("faucet/storage.js exports it too", async () => {
    const mod = readFileSync(new URL("../../src/faucet/storage.js", import.meta.url), "utf8");
    assert.match(mod, /export async function flushManagedWrites/);
    assert.match(mod, /persistChains\.values\(\)/);
  });
});
