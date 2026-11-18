// HODL participation counter + /mole checkin store (owner policy 2026-11-13).
// Synthetic identities and records only; the check-in store uses a temp DATA_DIR
// with Mongo disabled.
import 'dotenv/config';
process.env.MONGO_ENABLED = 'false';
delete process.env.MONGO_URI;

import test, { describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hodl-active-days-"));
process.env.DATA_DIR = DATA_DIR;
after(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

const { countActiveDays, activeDaysWindow, makeActiveDaysReader, utcDayKey } = await import("../../src/mole/hodlActiveDays.js");
const { recordCheckin, listCheckinDays, CHECKINS } = await import("../../src/mole/hodlCheckins.js");
const { gatherIdentities } = await import("../../src/mole/hodlEligibility.js");
const { computeWeeklyAllocation, buildWeeklySnapshot, DEFAULT_EPOCH_PARAMS, DEFAULT_BALANCE_RATES } = await import("../../src/mole/hodlEpochs.js");
const { readJson } = await import("../../src/mole/storage.js");

const D = (iso) => Date.parse(iso);
const SNAPSHOT = D("2026-11-24T10:00:00Z"); // a Tuesday
const W = activeDaysWindow(SNAPSHOT);        // 2026-11-17T00:00Z .. 2026-11-24T00:00Z
const ID = "123456789012345678";
const faucet = (iso, status = "confirmed") => ({ status, createdAt: D(iso) });
const game = (iso, g = "diglew") => ({ game: g, claimedAt: iso });

describe("window and UTC days", () => {
  test("the window is the 7 complete UTC days before the snapshot day", () => {
    assert.equal(new Date(W.startMs).toISOString(), "2026-11-17T00:00:00.000Z");
    assert.equal(new Date(W.endMs).toISOString(), "2026-11-24T00:00:00.000Z");
  });

  test("UTC boundaries: 23:59:59Z and 00:00:00Z the next day are two different days", () => {
    const r = countActiveDays({ faucetClaims: [faucet("2026-11-18T23:59:59Z"), faucet("2026-11-19T00:00:00Z")] }, W);
    assert.equal(r.activeDays, 2);
    assert.deepEqual(r.days, ["2026-11-18", "2026-11-19"]);
  });

  test("activity on the snapshot day itself, or before the window, does not count (no replay)", () => {
    const r = countActiveDays({ faucetClaims: [faucet("2026-11-24T00:00:01Z"), faucet("2026-11-16T23:59:59Z"), faucet("2025-01-01T12:00:00Z")] }, W);
    assert.equal(r.activeDays, 0);
  });
});

describe("counting", () => {
  test("0 through 7 participation days", () => {
    for (let n = 0; n <= 7; n++) {
      const claims = Array.from({ length: n }, (_, i) => faucet(`2026-11-${String(17 + i).padStart(2, "0")}T12:00:00Z`));
      assert.equal(countActiveDays({ faucetClaims: claims }, W).activeDays, n);
    }
  });

  test("several activities on one day, across every source, count once", () => {
    const r = countActiveDays({
      faucetClaims: [faucet("2026-11-20T01:00:00Z")],
      gameClaims: [game("2026-11-20T05:00:00Z"), game("2026-11-20T06:00:00Z")],
      quizDaily: { "2026-11-20": 9 },
      checkinDays: ["2026-11-20"],
    }, W);
    assert.equal(r.activeDays, 1);
    assert.deepEqual(r.bySource, { faucet: ["2026-11-20"], games: ["2026-11-20"], quiz: ["2026-11-20"], checkin: ["2026-11-20"] });
  });

  test("sources combine into distinct days; a missed day does not reset earlier ones", () => {
    const r = countActiveDays({
      faucetClaims: [faucet("2026-11-17T08:00:00Z")],
      gameClaims: [game("2026-11-18T08:00:00Z")],
      quizDaily: { "2026-11-20": 3 }, // 19th missed
      checkinDays: ["2026-11-21", "2026-11-23"],
    }, W);
    assert.equal(r.activeDays, 5);
  });

  test("only real activity counts: unconfirmed faucet claims, the migration credit and zero quiz days are ignored", () => {
    const r = countActiveDays({
      faucetClaims: [faucet("2026-11-18T08:00:00Z", "pending"), faucet("2026-11-19T08:00:00Z", "failed")],
      gameClaims: [game("2026-11-20T08:00:00Z", "migration")],
      quizDaily: { "2026-11-21": 0 },
      checkinDays: ["not-a-day"],
    }, W);
    assert.equal(r.activeDays, 0);
  });

  test("a failing reader never throws, and is REPORTED, not hidden", async () => {
    const read = makeActiveDaysReader({
      snapshotAtMs: SNAPSHOT,
      readFaucetClaims: async () => { throw new Error("db down"); },
      readCheckinDays: async () => ["2026-11-22"],
    });
    const r = await read(ID);
    assert.equal(r.activeDays, 1);
    assert.deepEqual(r.errors, ["faucet: db down"]);
  });

  test("all readers fine: errors is empty; a global error reaches every result", async () => {
    const ok = makeActiveDaysReader({ snapshotAtMs: SNAPSHOT, readCheckinDays: async () => ["2026-11-22"] });
    assert.deepEqual((await ok(ID)).errors, []);
    const stale = makeActiveDaysReader({ snapshotAtMs: SNAPSHOT, globalErrors: ["checkin_refresh: mongo down"] });
    assert.deepEqual((await stale(ID)).errors, ["checkin_refresh: mongo down"]);
  });
});

describe("/mole checkin store", () => {
  test("one record per identity per UTC day; repeats change nothing", () => {
    const a = recordCheckin(ID, { nowMs: D("2026-11-20T01:00:00Z") });
    const b = recordCheckin(ID, { nowMs: D("2026-11-20T23:00:00Z") });
    const c = recordCheckin(ID, { nowMs: D("2026-11-21T00:00:01Z") });
    assert.equal(a.already, false); assert.equal(b.already, true); assert.equal(c.already, false);
    assert.deepEqual(listCheckinDays(ID).sort(), ["2026-11-20", "2026-11-21"]);
    assert.ok(fs.existsSync(path.join(DATA_DIR, CHECKINS)), "written to the temp DATA_DIR only");
  });

  test("the day comes from the server clock; a non-Discord id is refused", () => {
    assert.equal(recordCheckin("wallet:abc", { nowMs: D("2026-11-20T01:00:00Z") }).ok, false);
    assert.equal(recordCheckin(ID, { nowMs: D("2026-11-22T12:00:00Z") }).day, utcDayKey(D("2026-11-22T12:00:00Z")));
  });

  test("check-ins and a faucet claim on the same day are one day, not two", async () => {
    const read = makeActiveDaysReader({
      snapshotAtMs: SNAPSHOT,
      readFaucetClaims: async () => [faucet("2026-11-20T09:00:00Z")],
      readCheckinDays: async (id) => listCheckinDays(id),
    });
    assert.equal((await read(ID)).activeDays, 3); // 20 (both), 21, 22
  });

  test("old check-ins are pruned beyond the retention window", () => {
    recordCheckin(ID, { nowMs: D("2027-01-30T12:00:00Z") });
    assert.ok(!Object.values(readJson(CHECKINS, {})).some((v) => v.day === "2026-11-20"));
  });
});

describe("through eligibility into the allocation and snapshot", () => {
  const NOW_SEC = Math.floor(SNAPSHOT / 1000);
  const profile = (id, wallets) => ({
    discordUserId: id,
    record: {
      wallet: wallets[0], verified_at: NOW_SEC - 100, verification_expires_at: NOW_SEC + 86400,
      wallets: Object.fromEntries(wallets.map((w, i) => [i === 0 ? "verified" : `extra${i}`, { address: w, linked_at: NOW_SEC - 100 }])),
    },
  });
  const epoch = { id: "E1", ...DEFAULT_EPOCH_PARAMS, balanceRates: [...DEFAULT_BALANCE_RATES], startMs: D("2026-11-17T00:00:00Z"), endMs: D("2027-02-16T00:00:00Z") };

  test("activeDays reaches the participant; a failed read keeps eligibility but is flagged, never silent", async () => {
    const res = await gatherIdentities({
      epoch, nowSec: NOW_SEC,
      listProfiles: () => [profile("100000000000000001", ["W1"]), profile("100000000000000002", ["W2"])],
      getBalance: async () => 1_000_000,
      getActiveDays: async (id) => { if (id.endsWith("2")) throw new Error("x"); return { activeDays: 7, days: [] }; },
    });
    assert.equal(res.qualified.length, 2);
    assert.deepEqual(res.qualified.map((q) => q.activeDays).sort(), [0, 7]);
    assert.deepEqual(res.activityReadFailures, [{ discordUserId: "100000000000000002", errors: ["active_days: x"] }]);
    assert.ok(res.degraded.some((d) => d.discordUserId === "100000000000000002" && d.reason.startsWith("activity_read_failed")));
  });

  test("a partial source failure (reader returns errors) is flagged too", async () => {
    const res = await gatherIdentities({
      epoch, nowSec: NOW_SEC,
      listProfiles: () => [profile("100000000000000005", ["W5"])],
      getBalance: async () => 1_000_000,
      getActiveDays: async () => ({ activeDays: 2, days: [], errors: ["quiz: timeout"] }),
    });
    assert.equal(res.activityReadFailures.length, 1);
    assert.deepEqual(res.activityReadFailures[0].errors, ["quiz: timeout"]);
  });

  test("clean reads produce no activity failures", async () => {
    const res = await gatherIdentities({
      epoch, nowSec: NOW_SEC,
      listProfiles: () => [profile("100000000000000006", ["W6"])],
      getBalance: async () => 1_000_000,
      getActiveDays: async () => ({ activeDays: 4, days: [], errors: [] }),
    });
    assert.deepEqual(res.activityReadFailures, []);
    assert.equal(res.degraded.length, 0);
  });

  test("hodl-pay refuses before saving a snapshot; hodl-preview lists it as NOT SAFE", () => {
    const pay = fs.readFileSync(new URL("../../src/scripts/hodl-pay.js", import.meta.url), "utf8");
    const guard = pay.indexOf("activityReadFailures");
    assert.ok(guard > 0 && guard < pay.indexOf("buildWeeklySnapshot({ epoch, participants"), "guard sits before the snapshot is built");
    const preview = fs.readFileSync(new URL("../../src/scripts/hodl-preview.js", import.meta.url), "utf8");
    assert.match(preview, /activityReadFailures[\s\S]*problems\.push/);
  });

  test("hodl-preview previews the STORED epoch (as hodl-pay pays it), never one derived from defaults", () => {
    const preview = fs.readFileSync(new URL("../../src/scripts/hodl-preview.js", import.meta.url), "utf8");
    assert.match(preview, /hodl\.getEpoch\(wanted\)\s*:\s*hodl\.getActiveEpoch\(\)/);
    assert.match(preview, /refreshHodlStore\(\)/);
    assert.doesNotMatch(preview, /\.\.\.DEFAULT_EPOCH_PARAMS/, "a derived epoch previews the wrong rule");
  });

  test("unverified identities never qualify, whatever their activity", async () => {
    const p = profile("100000000000000003", ["W3"]);
    p.record.verification_expires_at = NOW_SEC - 1;
    const res = await gatherIdentities({ epoch, nowSec: NOW_SEC, listProfiles: () => [p], getBalance: async () => 1_000_000, getActiveDays: async () => ({ activeDays: 7 }) });
    assert.equal(res.qualified.length, 0);
  });

  test("end to end: days drive the rate, and the snapshot reproduces it", async () => {
    const res = await gatherIdentities({
      epoch, nowSec: NOW_SEC,
      listProfiles: () => [profile("100000000000000004", ["W4"])],
      getBalance: async () => 1_000_000,
      getActiveDays: async () => ({ activeDays: 3, days: ["2026-11-18", "2026-11-20", "2026-11-22"] }),
    });
    const alloc = computeWeeklyAllocation(res.qualified, epoch);
    assert.equal(alloc.allocations[0].amount, 1150); // 1,000,000 x 0.115%
    const snap = buildWeeklySnapshot({ epoch, participants: res.qualified, takenAtMs: SNAPSHOT });
    assert.equal(snap.allocations?.[0]?.activeDays ?? snap.allocation?.allocations?.[0]?.activeDays, 3);
    assert.equal(snap.params.activeDaysWindow.startIso, "2026-11-17T00:00:00.000Z");
  });
});
