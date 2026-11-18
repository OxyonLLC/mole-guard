// Gap-1 regression: storage.js's managed-JSON layer used to swallow a Mongo
// write failure with only a console.warn, for every store including the four
// that decide who owns an identity (account_merges.json,
// account_merge_audit.json, linked_wallets.json, synced_identities.json).
// That is the same "points differ depending on how you access the platform"
// bug the reward ledger already fails loudly for, one layer down.
//
// This test points at a real MongoClient config that can never succeed
// (nothing listens on 127.0.0.1:1), so every persist attempt fails the same
// way an unreachable Atlas cluster would — hermetically, no real network
// endpoint, no risk to any actual database, and no `RUN_MONGO_INTEGRATION_TESTS`
// gate needed since it makes no real connection.
import "dotenv/config";

process.env.MONGO_ENABLED = "true";
process.env.MONGO_URI = "mongodb://127.0.0.1:1/unreachable";
process.env.MONGO_DATABASE = "mole_guard_unreachable_test";
process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS = "500";

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "winlew-storage-health-"));
process.env.DATA_DIR = TMP_DATA_DIR;

const { readJson, writeJson, refreshManagedFile, getStorageSyncHealth, flushManagedWrites } = await import(
  "../../src/mole/storage.js"
);
const { closeMongo } = await import("../../src/lib/mongo.js");

after(async () => {
  await closeMongo();
  fs.rmSync(TMP_DATA_DIR, { recursive: true, force: true });
});

describe("storage sync health: critical stores fail visibly, others stay quiet", () => {
  test("a failed persist for a critical store is recorded and logged, not swallowed", async () => {
    writeJson("account_merges.json", { "wallet:absorbed": "discord:123" });
    await flushManagedWrites();

    const health = getStorageSyncHealth();
    const entry = health.find((h) => h.name === "account_merges.json");
    assert.ok(entry, "account_merges.json should show up as degraded after an unreachable Mongo write");
    assert.ok(entry.lastError, "the failure reason should be captured");

    // The local write itself must never be lost — it's still the correct data.
    assert.deepEqual(readJson("account_merges.json", {}), { "wallet:absorbed": "discord:123" });
  });

  test("refreshManagedFile refuses to clobber a degraded critical store with a stale Mongo read", async () => {
    const refreshed = await refreshManagedFile("account_merges.json");
    assert.equal(refreshed, false, "refresh should be a no-op while the store is degraded");
    // The known-good local write must still be what's served.
    assert.deepEqual(readJson("account_merges.json", {}), { "wallet:absorbed": "discord:123" });
  });

  test("a failed persist for a NON-critical store is not tracked as degraded", async () => {
    writeJson("sessions.json", { "session-1": { discordUserId: "123" } });
    await flushManagedWrites();

    const health = getStorageSyncHealth();
    assert.equal(
      health.find((h) => h.name === "sessions.json"),
      undefined,
      "sessions.json is deliberately out of scope for the fail-loudly fix",
    );
    // Behavior for non-critical stores is intentionally untouched by this fix
    // (still fire-and-forget, still a console.warn only) — not re-asserted
    // here beyond the scoping check above.
  });
});
