// HODL Rewards — epoch and snapshot persistence.
//
// Two invariants carry the audit story: a closed epoch's terms cannot be
// rewritten, and a paid week's record cannot be replaced. A reward program
// whose history can be quietly edited cannot be audited by anyone.
//
// Follows the discipline established in governanceStore.test.mjs, for the same
// reasons stated there: storage.js reads DATA_DIR from a zod-validated
// getConfig() that expects a populated process.env, and this repo's .env points
// Mongo at a LIVE Atlas cluster that storage.js syncs every managed write to.
// So dotenv is loaded first and Mongo is force-disabled BEFORE storage.js is
// ever imported.
//
// DATA_DIR is a fresh temporary directory, NEVER the configured one. This suite
// used to write into the real data directory and restore it afterwards; on a
// machine whose .env points DATA_DIR at live data, an interrupted run leaves
// fixtures behind. A fixture-shaped epoch "e1" (users "111"/"222") in the live
// store is what blocked weekly HODL from 2026-08-22.
import 'dotenv/config';

process.env.MONGO_ENABLED = 'false';
delete process.env.MONGO_URI;

import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hodl-store-test-'));
process.env.DATA_DIR = DATA_DIR;

const store = await import("../../src/mole/hodlStore.js");
const { EPOCH_STATUS, DEFAULT_EPOCH_PARAMS, LIMITS } = await import("../../src/mole/hodlEpochs.js");
const { readJson, writeJson } = await import("../../src/mole/storage.js");

after(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

test("the suite writes only to its own temporary DATA_DIR", () => {
  writeJson(store.__testing.EPOCHS, {});
  assert.ok(fs.existsSync(path.join(DATA_DIR, store.__testing.EPOCHS)), `expected ${store.__testing.EPOCHS} under ${DATA_DIR}`);
});

const WEEK = 7 * 24 * 60 * 60 * 1000;
// Relative to now: activity now depends on the clock (an ended epoch is not
// active), so a fixed calendar start would make these tests expire.
const START = Date.now() - 2 * WEEK;
const draft = (id = "E1", over = {}) => ({ id, startMs: START, endMs: START + 13 * WEEK, ...over });

// Reset through the storage layer, not by unlinking — readJson serves an
// in-memory cache, so deleting the file leaves the old contents live. That
// exact mistake made an earlier suite see five records where it wrote two.
beforeEach(() => {
  writeJson(store.__testing.EPOCHS, {});
  writeJson(store.__testing.SNAPSHOTS, {});
});

describe("epoch lifecycle", () => {
  test("a new epoch starts as a draft and pays nobody", () => {
    const res = store.createEpoch(draft());
    assert.equal(res.ok, true, res.error);
    assert.equal(res.epoch.status, EPOCH_STATUS.DRAFT);
    assert.equal(store.getActiveEpoch(), null);
  });

  test("defaults are applied so an epoch is never half-specified", () => {
    const { epoch } = store.createEpoch(draft());
    assert.equal(epoch.weeklyPool, DEFAULT_EPOCH_PARAMS.weeklyPool);
    assert.equal(epoch.minHold, DEFAULT_EPOCH_PARAMS.minHold);
    assert.equal(epoch.payoutDay, DEFAULT_EPOCH_PARAMS.payoutDay);
  });

  test("an invalid epoch is refused at CREATION, not just activation", () => {
    // Catching a bad number while it is still a draft is cheaper than catching
    // it on a Tuesday morning.
    const res = store.createEpoch(draft("BAD", { weeklyPool: LIMITS.MAX_WEEKLY_POOL + 1 }));
    assert.equal(res.ok, false);
    assert.match(res.error, /MAX_WEEKLY_POOL/);
    assert.equal(store.getEpoch("BAD"), null, "an invalid epoch was persisted anyway");
  });

  test("activation re-validates rather than trusting what was stored", () => {
    store.createEpoch(draft());
    // Simulate a hand-edit, an older build, or a restored backup.
    const epochs = readJson(store.__testing.EPOCHS, {});
    epochs.E1.weeklyPool = 999_999;
    writeJson(store.__testing.EPOCHS, epochs);

    const res = store.activateEpoch("E1");
    assert.equal(res.ok, false, "a tampered epoch was activated");
    assert.match(res.error, /MAX_WEEKLY_POOL/);
  });

  test("only one epoch may be active at a time", () => {
    // Two live epochs means two weekly pools drawing on one reserve with
    // nothing deciding which applies.
    store.createEpoch(draft("E1"));
    store.createEpoch(draft("E2", { startMs: START + 13 * WEEK, endMs: START + 26 * WEEK }));
    assert.equal(store.activateEpoch("E1").ok, true);
    const second = store.activateEpoch("E2");
    assert.equal(second.ok, false);
    assert.match(second.error, /still active/);
  });

  test("an epoch past its end is not active, whatever its stored status", () => {
    // The production e1: status "active", ended weeks ago, never closed.
    const epochs = readJson(store.__testing.EPOCHS, {});
    epochs.OLD = { id: "OLD", status: EPOCH_STATUS.ACTIVE, startMs: Date.now() - 20 * WEEK, endMs: Date.now() - 6 * WEEK, ...DEFAULT_EPOCH_PARAMS };
    writeJson(store.__testing.EPOCHS, epochs);
    assert.equal(store.getActiveEpoch(), null);
    assert.equal(store.getActiveEpoch({ nowMs: Date.now() - 10 * WEEK })?.id, "OLD", "inside its window it is active");
  });

  test("an ended-but-unclosed epoch no longer blocks activating a new one", () => {
    const epochs = readJson(store.__testing.EPOCHS, {});
    epochs.OLD = { id: "OLD", status: EPOCH_STATUS.ACTIVE, startMs: Date.now() - 20 * WEEK, endMs: Date.now() - 6 * WEEK, ...DEFAULT_EPOCH_PARAMS };
    writeJson(store.__testing.EPOCHS, epochs);
    store.createEpoch(draft("E1"));
    const res = store.activateEpoch("E1");
    assert.equal(res.ok, true, res.error);
    assert.equal(store.getActiveEpoch()?.id, "E1");
  });

  test("activating twice is a no-op, not an error", () => {
    store.createEpoch(draft());
    store.activateEpoch("E1");
    const again = store.activateEpoch("E1");
    assert.equal(again.ok, true);
    assert.equal(again.alreadyActive, true);
  });

  test("a closed epoch can never be reactivated", () => {
    store.createEpoch(draft());
    store.activateEpoch("E1");
    store.closeEpoch("E1");
    const res = store.activateEpoch("E1");
    assert.equal(res.ok, false);
    assert.match(res.error, /closed/);
  });

  test("duplicate ids are refused", () => {
    store.createEpoch(draft());
    assert.equal(store.createEpoch(draft()).ok, false);
  });
});

describe("a paid week is never rewritten", () => {
  const snap = (over = {}) => ({
    epochId: "E1", weekIndex: 1, status: "pending",
    weeklyPool: 10_000, qualifiedCount: 7, totalAllocated: 9_997,
    allocations: [{ discordUserId: "u1", payoutWallet: "W1", amount: 1428 }],
    ...over,
  });

  test("a pending snapshot may be replaced — nothing has been sent", () => {
    store.saveSnapshot(snap());
    const res = store.saveSnapshot(snap({ qualifiedCount: 8 }));
    assert.equal(res.ok, true);
    assert.equal(store.getSnapshot("E1", 1).qualifiedCount, 8);
  });

  test("a PAID snapshot cannot be overwritten", () => {
    // The worst available mistake: re-run a Tuesday, replace the record of what
    // was sent, and pay everybody again with no evidence it happened.
    store.saveSnapshot(snap());
    store.updateSnapshotBatch("E1", 1, { batchId: "E1-w1" }, "paid");
    const res = store.saveSnapshot(snap({ qualifiedCount: 99 }));
    assert.equal(res.ok, false);
    assert.match(res.error, /already paid/);
    assert.equal(store.getSnapshot("E1", 1).qualifiedCount, 7, "the paid record was altered");
  });

  test("a snapshot needs an epoch and a week", () => {
    assert.equal(store.saveSnapshot({ weekIndex: 1 }).ok, false);
    assert.equal(store.saveSnapshot({ epochId: "E1" }).ok, false);
  });

  test("weeks are stored separately, not collapsed", () => {
    store.saveSnapshot(snap({ weekIndex: 1 }));
    store.saveSnapshot(snap({ weekIndex: 2 }));
    assert.equal(store.listSnapshots("E1").length, 2);
    assert.ok(store.getSnapshot("E1", 1));
    assert.ok(store.getSnapshot("E1", 2));
  });

  test("batch progress is attached to the week that authorised it", () => {
    store.saveSnapshot(snap());
    const batch = { batchId: "E1-w1", chunks: [{ index: 0, status: "confirmed" }] };
    const res = store.updateSnapshotBatch("E1", 1, batch, "paid");
    assert.equal(res.ok, true);
    assert.equal(store.getSnapshot("E1", 1).batch.batchId, "E1-w1");
    assert.equal(store.getSnapshot("E1", 1).status, "paid");
  });

  test("attaching a batch to a week that does not exist is refused", () => {
    assert.equal(store.updateSnapshotBatch("E1", 9, {}, "paid").ok, false);
  });
});
